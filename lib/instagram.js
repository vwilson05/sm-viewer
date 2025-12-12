/**
 * Instagram content extractor
 * Uses Puppeteer to extract media from Instagram posts
 */

const puppeteer = require('puppeteer');

// Regex patterns for Instagram URLs
const INSTAGRAM_URL_PATTERNS = [
  /(?:www\.)?instagram\.com\/p\/([A-Za-z0-9_-]+)/i,
  /(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)/i,
  /(?:www\.)?instagram\.com\/reels\/([A-Za-z0-9_-]+)/i,
  /(?:www\.)?instagram\.com\/tv\/([A-Za-z0-9_-]+)/i,
  /(?:www\.)?instagr\.am\/p\/([A-Za-z0-9_-]+)/i,
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
 * Extract shortcode from an Instagram URL
 */
function extractShortcode(url) {
  for (const pattern of INSTAGRAM_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if a URL is an Instagram URL
 */
function isInstagramUrl(url) {
  return extractShortcode(url) !== null;
}

/**
 * Determine if URL is a reel
 */
function isReel(url) {
  return url.includes('/reel/') || url.includes('/reels/');
}

/**
 * Extract content using Puppeteer
 */
async function extractWithPuppeteer(shortcode, originalUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Capture video URLs from network requests
  const capturedVideos = [];
  const capturedImages = [];

  try {
    // Listen for media URLs in network responses
    page.on('response', async (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Capture video URLs
      if (contentType.includes('video') || url.includes('.mp4') ||
          (url.includes('scontent') && url.includes('video'))) {
        if (!capturedVideos.includes(url)) {
          console.log('Captured video URL:', url.substring(0, 100));
          capturedVideos.push(url);
        }
      }

      // Capture high-res images
      if ((contentType.includes('image') || url.includes('.jpg') || url.includes('.webp')) &&
          (url.includes('cdninstagram.com') || url.includes('fbcdn.net')) &&
          !url.includes('150x150') && !url.includes('profile')) {
        if (!capturedImages.includes(url)) {
          capturedImages.push(url);
        }
      }
    });

    // Also intercept requests to look for video URLs in request params
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();

      // Look for video URLs in graphql responses
      if (url.includes('graphql') || url.includes('api/v1')) {
        // This might contain video URLs in the response
      }

      // Capture video URLs from requests
      if (url.includes('.mp4') || (url.includes('scontent') && url.includes('video'))) {
        if (!capturedVideos.includes(url)) {
          console.log('Captured video from request:', url.substring(0, 100));
          capturedVideos.push(url);
        }
      }

      request.continue();
    });

    // Set a mobile user agent for better compatibility
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    );

    // Set viewport
    await page.setViewport({ width: 390, height: 844 });

    // Navigate to the post
    const url = isReel(originalUrl)
      ? `https://www.instagram.com/reel/${shortcode}/`
      : `https://www.instagram.com/p/${shortcode}/`;

    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForSelector('video, img', { timeout: 10000 }).catch(() => {});

    // For reels, try to trigger video loading by clicking play or scrolling
    if (isReel(originalUrl)) {
      // Wait a bit for video to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try clicking the video to trigger loading
      await page.click('video').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Extract data from the page
    const data = await page.evaluate((originalUrl) => {
      const result = {
        author: { username: '', displayName: '', avatar: '' },
        content: { text: '', media: [] },
        timestamp: '',
      };

      // Try to find video URL in page scripts (Instagram embeds JSON data)
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';

        // Look for video_url in various formats
        const videoUrlMatch = text.match(/"video_url"\s*:\s*"([^"]+)"/) ||
                              text.match(/video_url['"]\s*:\s*['"]([^'"]+)['"]/) ||
                              text.match(/"playback_url"\s*:\s*"([^"]+)"/);
        if (videoUrlMatch) {
          let videoUrl = videoUrlMatch[1];
          // Decode escaped unicode
          videoUrl = videoUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          if (!result.content.media.some(m => m.url === videoUrl)) {
            result.content.media.push({
              type: 'video',
              url: videoUrl,
            });
          }
        }

        // Also look for display_url (images)
        if (result.content.media.length === 0) {
          const displayUrlMatch = text.match(/"display_url"\s*:\s*"([^"]+)"/);
          if (displayUrlMatch) {
            let imageUrl = displayUrlMatch[1];
            imageUrl = imageUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            result.content.media.push({
              type: 'image',
              url: imageUrl,
            });
          }
        }
      }

      // Get username from meta tags (most reliable)
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) {
        const titleContent = metaTitle.getAttribute('content') || '';
        // Format: "Username on Instagram: caption" or "@username"
        const match = titleContent.match(/^([^@\s]+)(?:\s|$)/) || titleContent.match(/@(\w+)/);
        if (match) {
          result.author.username = match[1].replace(/[^\w]/g, '');
        }
      }

      // Try getting username from page links
      if (!result.author.username) {
        const links = document.querySelectorAll('a[href^="/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.match(/^\/[\w.]+\/?$/) && !href.includes('/p/') && !href.includes('/reel/')) {
            result.author.username = href.replace(/\//g, '');
            break;
          }
        }
      }

      // Get caption/text from meta description
      const metaDesc = document.querySelector('meta[property="og:description"]');
      if (metaDesc) {
        let text = metaDesc.getAttribute('content') || '';
        // Clean up common Instagram description patterns
        text = text.replace(/^\d+(\.\d+)?[KMB]?\s*(likes?|Likes?),?\s*\d+\s*comments?\s*-?\s*/i, '');
        text = text.replace(/^[\d,]+\s*likes?,?\s*[\d,]+\s*comments?\s*-?\s*/i, '');
        result.content.text = text.trim();
      }

      // Get video element (backup if script parsing failed)
      if (!result.content.media.some(m => m.type === 'video')) {
        const videoEl = document.querySelector('video');
        if (videoEl) {
          const videoSrc = videoEl.getAttribute('src') || videoEl.currentSrc;
          const poster = videoEl.getAttribute('poster');

          if (videoSrc && videoSrc.startsWith('http')) {
            result.content.media.push({
              type: 'video',
              url: videoSrc,
              thumbnail: poster || '',
            });
          } else if (poster) {
            // Add placeholder for video, we'll fill URL from captured requests
            result.content.media.push({
              type: 'video',
              url: '', // Will be filled from captured requests
              thumbnail: poster,
            });
          }
        }
      }

      // If no video, try to get video URL from og:video meta
      if (!result.content.media.some(m => m.type === 'video' && m.url)) {
        const videoMeta = document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
        if (videoMeta) {
          const videoUrl = videoMeta.getAttribute('content');
          if (videoUrl) {
            // Check if we already have a video placeholder
            const existingVideo = result.content.media.find(m => m.type === 'video');
            if (existingVideo) {
              existingVideo.url = videoUrl;
            } else {
              result.content.media.push({
                type: 'video',
                url: videoUrl,
              });
            }
          }
        }
      }

      // Get image from meta if no media yet
      if (result.content.media.length === 0) {
        const imageMeta = document.querySelector('meta[property="og:image"]');
        if (imageMeta) {
          const imageUrl = imageMeta.getAttribute('content');
          if (imageUrl) {
            result.content.media.push({
              type: 'image',
              url: imageUrl,
            });
          }
        }
      }

      return result;
    }, originalUrl);

    // Fill in video URLs from captured network requests
    if (capturedVideos.length > 0) {
      const videoMedia = data.content.media.find(m => m.type === 'video');
      if (videoMedia && !videoMedia.url) {
        // Get highest quality video (usually the last one loaded, or largest file indicator)
        videoMedia.url = capturedVideos[capturedVideos.length - 1];
      } else if (!videoMedia && isReel(originalUrl)) {
        // Add video from captured requests for reels
        data.content.media.unshift({
          type: 'video',
          url: capturedVideos[capturedVideos.length - 1],
          thumbnail: capturedImages[0] || '',
        });
      }
    }

    // If still no media and we have captured images
    if (data.content.media.length === 0 && capturedImages.length > 0) {
      // Find the largest/best quality image (usually has larger dimensions in URL)
      const bestImage = capturedImages.find(url => url.includes('1080') || url.includes('1440')) ||
                        capturedImages[capturedImages.length - 1];
      if (bestImage) {
        data.content.media.push({
          type: 'image',
          url: bestImage,
        });
      }
    }

    return data;
  } finally {
    await page.close();
  }
}

/**
 * Extract and normalize Instagram post data
 */
async function extractInstagramContent(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL');
  }

  try {
    const data = await extractWithPuppeteer(shortcode, url);

    return {
      platform: 'instagram',
      author: data.author,
      content: data.content,
      timestamp: data.timestamp,
      originalUrl: url,
    };
  } catch (error) {
    console.error('Puppeteer extraction failed:', error);
    throw new Error('Failed to extract Instagram content. The post may be private or unavailable.');
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
  isInstagramUrl,
  extractInstagramContent,
  extractShortcode,
};
