const express = require('express');
const path = require('path');
const { isTwitterUrl } = require('./lib/twitter');
const { isInstagramUrl } = require('./lib/instagram');
const { extractWithYtdlp, isYtdlpAvailable } = require('./lib/ytdlp');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Detect which platform a URL belongs to
 */
function detectPlatform(url) {
  if (isTwitterUrl(url)) return 'twitter';
  if (isInstagramUrl(url)) return 'instagram';
  // yt-dlp supports many more platforms
  if (url.includes('tiktok.com')) return 'tiktok';
  return null;
}

/**
 * API endpoint to extract content from social media URLs
 */
app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a social media URL to view',
      });
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        error: 'Invalid URL',
        message: 'The provided URL is not valid',
      });
    }

    const platform = detectPlatform(url);

    if (!platform) {
      return res.status(400).json({
        error: 'Unsupported platform',
        message: 'Currently only Twitter/X, Instagram, and TikTok links are supported',
      });
    }

    // Try yt-dlp first (most reliable for videos)
    try {
      console.log(`Extracting ${platform} content with yt-dlp...`);
      const result = await extractWithYtdlp(url);

      // Check if we got meaningful data
      if (result && result.content?.media?.length > 0) {
        // Check if we have a valid video URL
        const hasVideo = result.content.media.some(m => m.type === 'video' && m.url);
        if (hasVideo) {
          console.log('yt-dlp extraction successful with video');
          return res.json(result);
        }
      }
    } catch (ytdlpError) {
      console.log('yt-dlp extraction failed:', ytdlpError.message);
    }

    // Fallback to embed mode if yt-dlp failed
    console.log('Falling back to embed mode');
    res.json({
      platform: platform,
      embedMode: true,
      originalUrl: url,
      embedUrl: getEmbedUrl(platform, url),
    });

  } catch (error) {
    console.error('Extraction error:', error);

    res.status(500).json({
      error: 'Extraction failed',
      message: error.message || 'Failed to extract content from the URL',
    });
  }
});

/**
 * Get embed URL for a platform
 */
function getEmbedUrl(platform, url) {
  if (platform === 'twitter') {
    return url.replace('x.com', 'twitter.com');
  }
  if (platform === 'instagram') {
    const match = url.match(/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return match ? `https://www.instagram.com/p/${match[1]}/embed/` : url;
  }
  if (platform === 'tiktok') {
    return url;
  }
  return url;
}

/**
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  const ytdlp = await isYtdlpAvailable();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ytdlp: ytdlp ? 'available' : 'not installed',
  });
});

/**
 * Catch-all route - serve index.html for SPA
 * Express 5 requires named wildcard parameters
 */
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, async () => {
  const ytdlp = await isYtdlpAvailable();
  console.log(`
╔═══════════════════════════════════════════╗
║         Social Media Viewer               ║
║                                           ║
║   Server running at:                      ║
║   http://localhost:${PORT}                     ║
║                                           ║
║   Supported platforms:                    ║
║   • Twitter/X                             ║
║   • Instagram                             ║
║   • TikTok                                ║
║                                           ║
║   yt-dlp: ${ytdlp ? 'Available ✓' : 'Not installed ✗'}                    ║
╚═══════════════════════════════════════════╝
  `);
});
