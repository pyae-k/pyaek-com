// Trending topics component — category-aware trending + historical timeline detail view
// Features 0-100 scoring with rank visualization, source badges, and top stories

import { fetchTrendingTopics, searchArticles, formatDate, extractDomain } from './api.js';
import { SOURCES, getSourceMeta } from './sources.js';

const CATEGORY_LABELS = {
  world: 'World', technology: 'Technology', business: 'Business',
  science: 'Science', health: 'Health', sports: 'Sports', entertainment: 'Entertainment',
};

// ─── Score Tier Helpers ─────────────────────────────────────────────────────

/**
 * Get the score tier label and CSS class for a 0-100 score.
 * 80+ = hot (green), 60-79 = trending (blue), 40-59 = rising (orange), <40 = mention (gray)
 */
export function getScoreTier(score) {
  if (score >= 80) return { label: 'Hot', class: 'score-tier-hot' };
  if (score >= 60) return { label: 'Trending', class: 'score-tier-trending' };
  if (score >= 40) return { label: 'Rising', class: 'score-tier-rising' };
  return { label: 'Mention', class: 'score-tier-mention' };
}

/**
 * Score an individual article by its overlap with trending keywords.
 * Returns a score 0-100 based on how many trending keywords the article contains.
 */
export function scoreArticle(article, keywords) {
  if (!article || !keywords || !keywords.length) return 0;
  const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
  let totalScore = 0;
  keywords.forEach((kw) => {
    if (text.includes(kw.word.toLowerCase())) {
      totalScore += kw.score;
    }
  });
  return Math.min(Math.round(totalScore / keywords.length), 100);
}

// ─── Render Trending Chips ───────────────────────────────────────────────────

/**
 * Render the trending chips section (minimal chips: label + score).
 * Category-aware: when a category is selected (feedType !== 'world') the panel
 * shows that category's trending topics; "world" shows global trending.
 * @param {Function} onSelect - Callback with (keyword, categories)
 * @param {object} [options]
 * @param {object} [options.trendingData] - Pre-computed { global, byCategory }
 * @param {string} [options.feedType] - Active category filter ('world' | category)
 * @param {string} [options.activeKeyword] - Currently selected topic to highlight
 */
export async function renderTrending(onSelect, options = {}) {
  const container = document.getElementById('trendingChips');
  const section = document.getElementById('trendingSection');
  if (!container || !section) return;

  const { trendingData, feedType = 'world', activeKeyword = null } = options;

  let data = trendingData;
  if (!data) {
    // Show loading state only when we have to fetch (no cached data yet)
    container.innerHTML = '<p class="trending-loading">Loading trending topics...</p>';
    // Fallback: fetch trending topics the old way
    const topics = await fetchTrendingTopics();
    data = {
      global: topics.map(t => ({ ...t, categories: [] })),
      byCategory: {},
    };
  }

  // Category-aware list: a selected category shows its own trending topics;
  // "world" (and any category without data) falls back to global trending.
  const isCategory = feedType !== 'world';
  const list = (isCategory && data.byCategory && data.byCategory[feedType] && data.byCategory[feedType].length)
    ? data.byCategory[feedType]
    : data.global;

  if (!list || !list.length) {
    container.innerHTML = '<p class="trending-loading">No trending topics right now.</p>';
    return;
  }

  updateTrendingTitle(feedType);

  // Trending chips (minimal: label + score)
  const html = list.map((t, i) => {
    const cats = t.categories && t.categories.length ? t.categories : [];
    const active = !!(activeKeyword && t.word.toLowerCase() === activeKeyword.toLowerCase());
    return renderChip(t, i, '', cats, { minimal: true, active });
  }).join('');

  container.innerHTML = html;

  // Wire click handlers
  container.querySelectorAll('.trending-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const keyword = chip.dataset.keyword;
      const categories = chip.dataset.categories ? chip.dataset.categories.split(',').filter(Boolean) : [];
      if (onSelect) onSelect(keyword, categories);
    });
  });
}

/**
 * Update the trending panel title to reflect the active category scope.
 * "world" shows no suffix; other categories show "· {Category}".
 */
function updateTrendingTitle(feedType) {
  const el = document.getElementById('trendingTitleCat');
  if (!el) return;
  if (feedType && feedType !== 'world') {
    el.textContent = `· ${CATEGORY_LABELS[feedType] || feedType}`;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function renderChip(t, index, extraBadge = '', cats = [], options = {}) {
  const tier = getScoreTier(t.score || 0);
  const sourceBadges = (t.sources || []).map(s => {
    const src = SOURCES[s];
    return src ? `<span class="trending-chip-source" style="background:${src.color}">${src.label}</span>` : '';
  }).join('');
  const minimal = options.minimal;
  const active = options.active;

  return `
    <button class="trending-chip${minimal ? ' trending-chip--minimal' : ''}${active ? ' active' : ''}" data-keyword="${escapeHtml(t.word)}" data-categories="${cats.join(',')}" type="button"${active ? ' aria-pressed="true"' : ''}>
      ${active ? '<svg class="trending-chip-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      ${minimal ? '' : `<span class="trending-chip-rank">#${index + 1}</span>`}
      <span class="trending-chip-label">${escapeHtml(t.word)}</span>
      ${t.word.includes(' ') ? '<span class="trending-chip-phrase">phrase</span>' : ''}
      ${minimal ? '' : extraBadge}
      <span class="trending-chip-score ${tier.class}">${t.score || t.count}</span>
      ${minimal ? '' : `
      <div class="trending-chip-bar" aria-hidden="true">
        <div class="trending-chip-bar-fill ${tier.class}" style="width:${t.score || 0}%"></div>
      </div>
      <span class="trending-chip-sources">${sourceBadges}</span>`}
    </button>
  `;
}

// ─── Render Top Stories ──────────────────────────────────────────────────────

/**
 * Render the top stories section — articles with the highest trending keyword overlap.
 * Shows the top 5 highest-scored articles.
 */
export function renderTopStories(articles, keywords) {
  const container = document.getElementById('topStoriesList');
  const section = document.getElementById('topStories');
  if (!container || !section) return;

  if (!articles || !articles.length || !keywords || !keywords.length) {
    section.style.display = 'none';
    return;
  }

  // Score each article by keyword overlap
  const scored = articles
    .map(a => ({ article: a, score: scoreArticle(a, keywords) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  container.innerHTML = scored.map(({ article, score }) => {
    const domain = extractDomain(article.url);
    const tier = getScoreTier(score);
    const src = getSourceMeta(article);
    const sourceBadge = `<span class="story-card-source-badge" style="background:${src.color}">${src.label}</span>`;

    return `
      <article class="top-story-card">
        <div class="top-story-card-content">
          <div class="top-story-card-meta">
            ${sourceBadge}
            <span class="top-story-card-source">${escapeHtml(article.source)}</span>
            ${domain ? `<span class="top-story-card-domain">${domain}</span>` : ''}
          </div>
          <h3 class="top-story-card-title">
            <a href="${article.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
          </h3>
          ${article.description ? `<p class="top-story-card-desc">${escapeHtml(article.description)}</p>` : ''}
        </div>
        <div class="top-story-card-score">
          <span class="top-story-card-score-value ${tier.class}">${score}</span>
          <span class="top-story-card-score-label">${tier.label}</span>
        </div>
      </article>
    `;
  }).join('');
}

// ─── Render Trending Detail ──────────────────────────────────────────────────

/**
 * Render the trending detail view — a timeline of articles for a topic.
 * Supports category filter tabs and source badges.
 */
export async function renderTrendingDetail(topic, onBack, options = {}) {
  const container = document.getElementById('trendingDetail');
  const storyList = document.getElementById('storyList');

  if (!container) return;

  // Hide story list, show detail view (keep sidebar visible)
  if (storyList) storyList.style.display = 'none';
  container.hidden = false;

  const { category, articles: preFetched, searchIndex } = options;

  // Render header with back button
  container.innerHTML = `
    <div class="trending-detail-header">
      <button class="trending-detail-back" type="button" aria-label="Back to stories">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
      <h2 class="trending-detail-title">Trending: <mark>${escapeHtml(topic)}</mark></h2>
    </div>
    <div class="trending-detail-filters" id="trendingDetailFilters" role="tablist" aria-label="Filter by category"></div>
    <div class="trending-detail-timeline" aria-live="polite">
      <div class="trending-detail-loading">Searching articles for "<strong>${escapeHtml(topic)}</strong>"...</div>
    </div>
  `;

  // Wire back button
  const backBtn = container.querySelector('.trending-detail-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (onBack) onBack();
    });
  }

  // Fetch articles
  const timelineContainer = container.querySelector('.trending-detail-timeline');
  const filtersContainer = container.querySelector('#trendingDetailFilters');
  try {
    let articles = preFetched;
    if (!articles && searchIndex && searchIndex.articleCount > 0) {
      articles = searchIndex.search(topic, { limit: 30 });
    }
    if (!articles || !articles.length) {
      articles = await searchArticles(topic, 30);
    }

    if (!articles || !articles.length) {
      timelineContainer.innerHTML = `
        <div class="trending-detail-empty">
          <p>No articles found for "<strong>${escapeHtml(topic)}</strong>".</p>
          <p class="trending-detail-empty-hint">Try a different trending topic.</p>
        </div>
      `;
      return;
    }

    // Build category filter tabs
    const allCategories = ['all', ...new Set(articles.map(a => a.category || 'world').filter(Boolean))];
    const activeFilter = category || 'all';
    filtersContainer.innerHTML = allCategories.map(c => `
      <button class="trending-detail-filter-btn${c === activeFilter ? ' active' : ''}" data-category="${c}" role="tab" aria-selected="${c === activeFilter}" type="button">
        ${c === 'all' ? 'All' : (CATEGORY_LABELS[c] || c)}
      </button>
    `).join('');

    // Wire filter tabs
    filtersContainer.querySelectorAll('.trending-detail-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category;
        filtersContainer.querySelectorAll('.trending-detail-filter-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        renderTimeline(timelineContainer, articles, cat);
      });
    });

    // Render initial timeline
    renderTimeline(timelineContainer, articles, activeFilter);
  } catch (err) {
    timelineContainer.innerHTML = `
      <div class="trending-detail-error">
        <p>Failed to load articles. Check your connection.</p>
        <button class="trending-detail-retry" type="button">Try again</button>
      </div>
    `;
    const retryBtn = timelineContainer.querySelector('.trending-detail-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        renderTrendingDetail(topic, onBack, options);
      });
    }
  }
}

/**
 * Render the timeline inside the trending detail view, optionally filtered by category.
 */
function renderTimeline(container, articles, activeCategory) {
  const filtered = activeCategory === 'all'
    ? articles
    : articles.filter(a => (a.category || 'world') === activeCategory);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="trending-detail-empty">
        <p>No articles in this category for this topic.</p>
      </div>
    `;
    return;
  }

  // Group articles by date for timeline display
  let currentDate = '';
  let html = '';
  filtered.forEach((article) => {
    const articleDate = formatDate(article.publishedAt);
    const dateChanged = articleDate !== currentDate;
    if (dateChanged) {
      if (currentDate) html += '</div>'; // close previous date group
      currentDate = articleDate;
      html += `
        <div class="trending-detail-date-group">
          <div class="trending-detail-date-marker" aria-hidden="true">
            <span class="trending-detail-date-dot"></span>
            <span class="trending-detail-date-label">${articleDate}</span>
          </div>
      `;
    }
    const domain = extractDomain(article.url);
    const catLabel = CATEGORY_LABELS[article.category] || article.category || '';
    const src = getSourceMeta(article);
    const sourceBadge = `<span class="story-card-source-badge" style="background:${src.color}">${src.label}</span>`;

    html += `
      <div class="trending-detail-item">
        <a class="trending-detail-item-title" href="${article.url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(article.title)}
        </a>
        <div class="trending-detail-item-meta">
          ${sourceBadge}
          <span class="trending-detail-item-domain">${escapeHtml(article.source)}</span>
          ${catLabel ? `<span class="category-badge category-badge--${article.category || 'world'}">${catLabel}</span>` : ''}
          ${domain ? `<span class="trending-detail-item-sep">·</span><span>${domain}</span>` : ''}
        </div>
      </div>
    `;
  });
  if (currentDate) html += '</div>'; // close last date group

  // Summary stats
  const uniqueSources = new Set(filtered.map(a => a.source)).size;

  html = `
    <div class="trending-detail-summary">
      <span>${filtered.length} article${filtered.length !== 1 ? 's' : ''}</span>
      <span class="trending-detail-summary-sep">·</span>
      <span>${uniqueSources} source${uniqueSources !== 1 ? 's' : ''}</span>
    </div>
  ` + html;

  container.innerHTML = html;
}

// ─── Hide Trending Detail ────────────────────────────────────────────────────

/**
 * Hide the trending detail view and restore main content.
 */
export function hideTrendingDetail() {
  const container = document.getElementById('trendingDetail');
  const storyList = document.getElementById('storyList');

  if (container) container.hidden = true;
  if (storyList) storyList.style.display = '';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
