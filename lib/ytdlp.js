/**
 * yt-dlp wrapper for extracting media from social media
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Extract media info using yt-dlp
 * @param {string} url - The URL to extract from
 * @returns {Promise<object>} - Extracted media info
 */
async function extractWithYtdlp(url) {
  try {
    // Use yt-dlp to get JSON info without downloading
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-download --no-warnings "${url}"`,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
    );

    const info = JSON.parse(stdout);
    return parseYtdlpInfo(info, url);
  } catch (error) {
    console.error('yt-dlp extraction failed:', error.message);
    throw new Error('Failed to extract media. The content may be private or unavailable.');
  }
}

/**
 * Parse yt-dlp output into our normalized format
 */
function parseYtdlpInfo(info, originalUrl) {
  const platform = detectPlatform(originalUrl);

  // Get the best video/audio URL
  let videoUrl = '';
  let thumbnailUrl = info.thumbnail || '';

  // yt-dlp provides formats array with different qualities
  if (info.formats && info.formats.length > 0) {
    // Find formats with video (has width/height, has video track)
    const videoFormats = info.formats.filter(f => {
      const hasVideo = f.width && f.height && f.url;
      const isNotAudioOnly = f.vcodec !== 'none' && f.video_ext !== 'none';
      return hasVideo && isNotAudioOnly;
    });

    if (videoFormats.length > 0) {
      // Prefer progressive mp4 over DASH (contains both audio+video)
      const progressiveFormats = videoFormats.filter(f =>
        !f.format_id?.includes('dash') && (f.ext === 'mp4' || f.video_ext === 'mp4')
      );

      const candidates = progressiveFormats.length > 0 ? progressiveFormats : videoFormats;

      // Sort by quality (height)
      candidates.sort((a, b) => (b.height || 0) - (a.height || 0));
      videoUrl = candidates[0].url;
    } else {
      // Fallback to the URL yt-dlp selected
      videoUrl = info.url || '';
    }
  } else if (info.url) {
    videoUrl = info.url;
  }

  // Build media array
  const media = [];

  if (videoUrl) {
    media.push({
      type: 'video',
      url: videoUrl,
      thumbnail: thumbnailUrl,
    });
  } else if (thumbnailUrl) {
    media.push({
      type: 'image',
      url: thumbnailUrl,
    });
  }

  return {
    platform: platform,
    author: {
      username: info.uploader_id || info.channel_id || info.uploader || '',
      displayName: info.uploader || info.channel || '',
      avatar: info.uploader_url || '',
    },
    content: {
      text: info.description || info.title || '',
      media: media,
    },
    timestamp: info.timestamp ? new Date(info.timestamp * 1000).toISOString() : '',
    originalUrl: originalUrl,
    stats: {
      likes: info.like_count || 0,
      views: info.view_count || 0,
      comments: info.comment_count || 0,
    },
    // Include raw yt-dlp data for debugging
    _ytdlp: {
      title: info.title,
      duration: info.duration,
      extractor: info.extractor,
    },
  };
}

/**
 * Detect platform from URL
 */
function detectPlatform(url) {
  if (url.includes('instagram.com') || url.includes('instagr.am')) {
    return 'instagram';
  }
  if (url.includes('twitter.com') || url.includes('x.com')) {
    return 'twitter';
  }
  if (url.includes('tiktok.com')) {
    return 'tiktok';
  }
  return 'unknown';
}

/**
 * Check if yt-dlp is available
 */
async function isYtdlpAvailable() {
  try {
    await execAsync('which yt-dlp');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  extractWithYtdlp,
  isYtdlpAvailable,
};
