/**
 * SM Viewer - Frontend Application
 */

// DOM Elements
const form = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoading = submitBtn.querySelector('.btn-loading');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const contentContainer = document.getElementById('content-container');

/**
 * Show loading state
 */
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  btnText.hidden = isLoading;
  btnLoading.hidden = !isLoading;
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorContainer.hidden = false;
  contentContainer.hidden = true;
}

/**
 * Hide error message
 */
function hideError() {
  errorContainer.hidden = true;
}

/**
 * Format timestamp
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format number (e.g., 1234 -> 1.2K)
 */
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

/**
 * Create media HTML
 */
function createMediaHtml(media) {
  if (!media || media.length === 0) return '';

  const items = media.map((item, index) => {
    if (item.type === 'video' || item.type === 'gif') {
      return `
        <div class="media-item">
          <video
            controls
            playsinline
            preload="metadata"
            ${item.thumbnail ? `poster="${item.thumbnail}"` : ''}
          >
            <source src="${item.url}" type="video/mp4">
            Your browser does not support video playback.
          </video>
        </div>
      `;
    }
    return `
      <div class="media-item">
        <img
          src="${item.url}"
          alt="Post media ${index + 1}"
          loading="lazy"
          onclick="openLightbox(this.src)"
        >
      </div>
    `;
  });

  // Single item
  if (media.length === 1) {
    return `<div class="media-container">${items[0]}</div>`;
  }

  // Multiple items - use carousel
  const dots = media.map((_, i) =>
    `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`
  ).join('');

  return `
    <div class="media-container carousel">
      <div class="carousel-inner">
        ${items.map(item => `<div class="carousel-item">${item}</div>`).join('')}
      </div>
      <div class="carousel-dots">${dots}</div>
    </div>
  `;
}

/**
 * Create quoted tweet HTML
 */
function createQuotedTweetHtml(quoted) {
  if (!quoted) return '';

  return `
    <div class="quoted-tweet">
      <div class="post-header">
        ${quoted.author.avatar
          ? `<img class="avatar" src="${quoted.author.avatar}" alt="${quoted.author.username}">`
          : '<div class="avatar"></div>'
        }
        <div class="author-info">
          <div class="display-name">${quoted.author.displayName || quoted.author.username}</div>
          <div class="username">@${quoted.author.username}</div>
        </div>
      </div>
      <div class="post-content">
        ${quoted.content.text ? `<p class="post-text">${escapeHtml(quoted.content.text)}</p>` : ''}
        ${createMediaHtml(quoted.content.media)}
      </div>
    </div>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render embedded content (fallback mode)
 */
function renderEmbed(data) {
  const { platform, embedUrl, originalUrl } = data;

  let embedHtml = '';

  if (platform === 'twitter') {
    // Twitter embed
    embedHtml = `
      <div class="embed-container">
        <div class="embed-header">
          <span class="platform-badge">${platform}</span>
          <span class="embed-notice">Using official embed (API unavailable)</span>
        </div>
        <blockquote class="twitter-tweet" data-theme="dark">
          <a href="${originalUrl}">Loading tweet...</a>
        </blockquote>
        <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
      </div>
    `;
  } else if (platform === 'instagram') {
    // Instagram embed
    embedHtml = `
      <div class="embed-container">
        <div class="embed-header">
          <span class="platform-badge">${platform}</span>
          <span class="embed-notice">Using official embed (API unavailable)</span>
        </div>
        <iframe
          src="${embedUrl}"
          class="instagram-embed"
          frameborder="0"
          scrolling="no"
          allowtransparency="true"
          allowfullscreen="true"
        ></iframe>
      </div>
    `;
  }

  contentContainer.innerHTML = embedHtml;
  contentContainer.hidden = false;

  // Reload Twitter widgets if needed
  if (platform === 'twitter' && window.twttr && window.twttr.widgets) {
    window.twttr.widgets.load(contentContainer);
  }
}

/**
 * Render content to the page
 */
function renderContent(data) {
  // Check if this is embed mode
  if (data.embedMode) {
    return renderEmbed(data);
  }

  const { platform, author, content, timestamp, stats, quotedTweet } = data;

  const statsHtml = stats ? `
    <div class="stats">
      ${stats.replies !== undefined ? `<span>${formatNumber(stats.replies)} replies</span>` : ''}
      ${stats.retweets !== undefined ? `<span>${formatNumber(stats.retweets)} retweets</span>` : ''}
      ${stats.likes !== undefined ? `<span>${formatNumber(stats.likes)} likes</span>` : ''}
    </div>
  ` : '';

  const html = `
    <div class="post-header">
      ${author.avatar
        ? `<img class="avatar" src="${author.avatar}" alt="${author.username}">`
        : '<div class="avatar"></div>'
      }
      <div class="author-info">
        <div class="display-name">
          ${escapeHtml(author.displayName || author.username)}
          ${author.verified ? '<span class="verified-badge">✓</span>' : ''}
        </div>
        <div class="username">@${escapeHtml(author.username)}</div>
      </div>
      <span class="platform-badge">${platform}</span>
    </div>
    <div class="post-content">
      ${content.text ? `<p class="post-text">${escapeHtml(content.text)}</p>` : ''}
      ${createMediaHtml(content.media)}
      ${createQuotedTweetHtml(quotedTweet)}
    </div>
    <div class="post-footer">
      <span class="timestamp">${formatTimestamp(timestamp)}</span>
      ${statsHtml}
    </div>
  `;

  contentContainer.innerHTML = html;
  contentContainer.hidden = false;

  // Initialize carousel if present
  initCarousel();
}

/**
 * Initialize carousel functionality
 */
function initCarousel() {
  const carousel = contentContainer.querySelector('.carousel');
  if (!carousel) return;

  const inner = carousel.querySelector('.carousel-inner');
  const dots = carousel.querySelectorAll('.carousel-dot');

  inner.addEventListener('scroll', () => {
    const scrollLeft = inner.scrollLeft;
    const itemWidth = inner.offsetWidth;
    const activeIndex = Math.round(scrollLeft / itemWidth);

    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === activeIndex);
    });
  });

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const index = parseInt(dot.dataset.index, 10);
      const itemWidth = inner.offsetWidth;
      inner.scrollTo({ left: index * itemWidth, behavior: 'smooth' });
    });
  });
}

/**
 * Open image in lightbox
 */
window.openLightbox = function(src) {
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = `<img src="${src}" alt="Full size image">`;
  lightbox.addEventListener('click', () => lightbox.remove());
  document.body.appendChild(lightbox);
};

/**
 * Extract content from URL
 */
async function extractContent(url) {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to extract content');
  }

  return data;
}

/**
 * Handle form submission
 */
async function handleSubmit(e) {
  e.preventDefault();

  const url = urlInput.value.trim();
  if (!url) return;

  hideError();
  contentContainer.hidden = true;
  setLoading(true);

  try {
    const data = await extractContent(url);
    renderContent(data);
  } catch (error) {
    showError(error.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

/**
 * Handle paste event - auto-submit if it looks like a valid URL
 */
function handlePaste(e) {
  // Small delay to allow the paste to complete
  setTimeout(() => {
    const url = urlInput.value.trim();
    if (url && (url.includes('twitter.com') || url.includes('x.com') || url.includes('instagram.com') || url.includes('tiktok.com'))) {
      form.dispatchEvent(new Event('submit'));
    }
  }, 100);
}

// Event listeners
form.addEventListener('submit', handleSubmit);
urlInput.addEventListener('paste', handlePaste);

// Focus input on load
urlInput.focus();
