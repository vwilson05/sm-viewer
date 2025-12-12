/**
 * Twitter/X content extractor
 * Uses Puppeteer to extract media from tweets
 */

const puppeteer = require('puppeteer');

// Regex patterns for Twitter/X URLs
const TWITTER_URL_PATTERNS = [
  /(?:twitter\.com|x\.com)\/(?:#!\/)?(\w+)\/status(?:es)?\/(\d+)/i,
  /(?:mobile\.twitter\.com|mobile\.x\.com)\/(\w+)\/status(?:es)?\/(\d+)/i,
];

// Browser instance (reused for performance)
let browserInstance = null;

/**
 * Get or create browser instance
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
      ],
    });
  }
  return browserInstance;
}

/**
 * Extract tweet ID from a Twitter/X URL
 */
function extractTweetId(url) {
  for (const pattern of TWITTER_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return {
        username: match[1],
        tweetId: match[2],
      };
    }
  }
  return null;
}

/**
 * Check if a URL is a Twitter/X URL
 */
function isTwitterUrl(url) {
  return extractTweetId(url) !== null;
}

/**
 * Extract content using Puppeteer
 */
async function extractWithPuppeteer(username, tweetId) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Capture video URLs from network requests
  const capturedVideos = [];

  try {
    // Listen for video URLs in network requests
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('.mp4') || url.includes('video.twimg.com')) {
        capturedVideos.push(url);
      }
      request.continue();
    });

    // Set user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate to the tweet
    const url = `https://twitter.com/${username}/status/${tweetId}`;
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForSelector('article', { timeout: 10000 }).catch(() => {});

    // Give time for videos to start loading
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract data from the page
    const data = await page.evaluate(() => {
      const result = {
        author: { username: '', displayName: '', avatar: '', verified: false },
        content: { text: '', media: [] },
        timestamp: '',
        stats: { likes: 0, retweets: 0, replies: 0 },
      };

      // Find the main tweet article
      const article = document.querySelector('article');
      if (!article) return result;

      // Get author info
      const userLink = article.querySelector('a[href*="/status/"]')?.closest('div')?.parentElement?.querySelector('a[href^="/"]');
      if (userLink) {
        const href = userLink.getAttribute('href');
        result.author.username = href?.replace('/', '') || '';
      }

      // Get display name
      const displayNameEl = article.querySelector('[data-testid="User-Name"]');
      if (displayNameEl) {
        const spans = displayNameEl.querySelectorAll('span');
        if (spans.length > 0) {
          result.author.displayName = spans[0]?.textContent || '';
        }
        // Check for verified badge
        if (displayNameEl.querySelector('svg[aria-label*="Verified"]')) {
          result.author.verified = true;
        }
      }

      // Get avatar
      const avatarEl = article.querySelector('img[src*="profile_images"]');
      if (avatarEl) {
        result.author.avatar = avatarEl.getAttribute('src') || '';
      }

      // Get tweet text
      const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
      if (tweetTextEl) {
        result.content.text = tweetTextEl.textContent || '';
      }

      // Get images
      const imageEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
      imageEls.forEach((img) => {
        let src = img.getAttribute('src') || '';
        // Get larger version
        if (src.includes('?format=')) {
          src = src.replace(/&name=\w+/, '&name=large');
        } else if (!src.includes('name=')) {
          src += '?format=jpg&name=large';
        }
        result.content.media.push({
          type: 'image',
          url: src,
        });
      });

      // Get video poster (for video posts)
      const videoEl = article.querySelector('video');
      if (videoEl) {
        const poster = videoEl.getAttribute('poster');
        result.content.media.push({
          type: 'video',
          url: '', // Will be filled from captured requests
          thumbnail: poster || '',
        });
      }

      // Get timestamp
      const timeEl = article.querySelector('time');
      if (timeEl) {
        result.timestamp = timeEl.getAttribute('datetime') || '';
      }

      // Get stats
      const statsGroup = article.querySelector('[role="group"]');
      if (statsGroup) {
        const buttons = statsGroup.querySelectorAll('button');
        buttons.forEach((btn, index) => {
          const text = btn.textContent || '';
          const num = parseInt(text.replace(/[^0-9]/g, '')) || 0;
          if (index === 0) result.stats.replies = num;
          if (index === 1) result.stats.retweets = num;
          if (index === 2) result.stats.likes = num;
        });
      }

      return result;
    });

    // Add captured video URLs to media
    if (capturedVideos.length > 0 && data.content.media.some(m => m.type === 'video')) {
      // Find the best quality video
      const bestVideo = capturedVideos.find(url => url.includes('720x') || url.includes('1280x')) ||
                        capturedVideos.find(url => url.includes('.mp4')) ||
                        capturedVideos[0];

      const videoMedia = data.content.media.find(m => m.type === 'video');
      if (videoMedia && bestVideo) {
        videoMedia.url = bestVideo;
      }
    }

    return data;
  } finally {
    await page.close();
  }
}

/**
 * Extract and normalize tweet data
 */
async function extractTwitterContent(url) {
  const parsed = extractTweetId(url);
  if (!parsed) {
    throw new Error('Invalid Twitter/X URL');
  }

  try {
    const data = await extractWithPuppeteer(parsed.username, parsed.tweetId);

    return {
      platform: 'twitter',
      author: data.author,
      content: data.content,
      timestamp: data.timestamp,
      originalUrl: url,
      stats: data.stats,
    };
  } catch (error) {
    console.error('Puppeteer extraction failed:', error);
    throw new Error('Failed to extract tweet. The tweet may be private or unavailable.');
  }
}

/**
 * Clean up browser on process exit
 */
process.on('exit', () => {
  if (browserInstance) {
    browserInstance.close().catch(() => {});
  }
});

module.exports = {
  isTwitterUrl,
  extractTwitterContent,
  extractTweetId,
};
