// Main app module — bootstrap, state, routing, theme toggle, event handlers
import { fetchArticles, searchArticles, extractKeywords, fetchAllCategories, extractTrendingByCategory } from './api.js';
import { createStoryCard, renderExpandedContent } from './story-card.js';
import { renderTrending, renderTrendingDetail, hideTrendingDetail, renderTopStories } from './trending.js';
import { saveState, loadState, cacheData, getCachedData, saveSearchIndex, loadSearchIndex, saveTrendingData, loadTrendingData, saveClassifierData, loadClassifierData } from './store.js';
import { SearchIndex } from './search-index.js';
import { CategoryClassifier } from './classifier.js';
import { renderSkeletonCards, removeSkeletons } from './skeleton.js';
import { initRefreshControls, onFetchComplete } from './refresh.js';

const ARTICLES_PER_PAGE = 30;

const state = {
  feedType: 'world',
  stories: [],
  expandedId: null,
  lastUpdated: null,
  trendingKeywords: [],
  isLoading: false,
  isOffline: !navigator.onLine,
  view: 'stories', // 'stories' | 'trending-detail' | 'filtered'
  activeTrendingTopic: null,
  currentFilterKeyword: null, // keyword used for filtering (for "View full timeline")
  // New state fields
  searchIndex: null,
  classifier: null,
  allArticlesByCategory: {},
  allArticles: [],
  searchResults: [],
  searchQuery: '',
  searchScope: 'all', // 'all' | 'category'
  trendingData: null,
  // Real-time state
  newArticles: [],
  newArticleCount: 0,
  categoryNewCounts: {},
  breakingNews: [],
  shownBreakingIds: new Set(),
  refreshInterval: 120,
  refreshPaused: false,
  lastFetchTime: null,
  staleThreshold: 120000,
};

// DOM refs
const storyList = document.getElementById('storyList');
const loadingIndicator = document.getElementById('loadingIndicator');

// --- Theme Toggle ---
function initTheme() {
  const toggle = document.querySelector('.theme-toggle');
  const icon = toggle?.querySelector('.theme-toggle-icon');
  const current = document.documentElement.getAttribute('data-theme') || 'light';

  if (icon) {
    icon.innerHTML = current === 'dark'
      ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  toggle?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    toggle.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} mode`);
    toggle.setAttribute('title', `Switch to ${next === 'dark' ? 'light' : 'dark'} mode`);
    if (icon) {
      icon.innerHTML = next === 'dark'
        ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  });
}

// --- Category Filter Switching ---
function initFilters() {
  const filterContainer = document.querySelector('.header-filters');
  if (!filterContainer) return;

  filterContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.header-filter-btn');
    if (!btn) return;
    const feed = btn.dataset.filter;
    if (!feed || feed === state.feedType) return;

    filterContainer.querySelectorAll('.header-filter-btn').forEach(b => {
      b.classList.remove('active');
    });
    btn.classList.add('active');

    state.feedType = feed;
    state.expandedId = null;
    state.currentFilterKeyword = null;
    state.view = 'stories';
    state.searchScope = 'category';
    // Reset badge count for this category
    state.categoryNewCounts[feed] = 0;
    updateCategoryBadges();
    // Update the trending panel for the new category immediately (cached data),
    // then loadFeed's background fetch refreshes it with fresh data.
    renderTrendingPanel();
    loadFeed(true);
  });
}

// --- Load Feed ---
async function loadFeed(forceRefresh = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  state.expandedId = null;
  state.currentFilterKeyword = null;
  state.view = 'stories';

  // Show skeleton loading instead of text indicator
  loadingIndicator.style.display = 'none';
  renderSkeletonCards(storyList, 5);

  // Hide trending detail if visible
  hideTrendingDetail();

  // Clear any existing banners
  clearBanners();

  try {
    // Try loading from cache first for instant display
    if (!forceRefresh) {
      const cached = await getCachedData(`articles-${state.feedType}`);
      if (cached && cached.data && cached.data.length) {
        state.stories = cached.data;
        state.lastUpdated = cached.cachedAt;
        // Build search index from cached articles
        if (!state.searchIndex) {
          state.searchIndex = new SearchIndex();
        }
        state.searchIndex.addArticles(state.stories, state.feedType);
        removeSkeletons(storyList);
        renderStories();
      }
    }

    // Fetch fresh data from all sources
    const articles = await fetchArticles(state.feedType, ARTICLES_PER_PAGE);

    if (!articles.length) throw new Error('No articles returned');

    // Detect new articles since last fetch
    const existingIds = new Set(state.stories.map(a => a.id));
    const newArticles = articles.filter(a => !existingIds.has(a.id));
    if (newArticles.length > 0) {
      state.newArticles = newArticles;
      state.newArticleCount = newArticles.length;
      state.categoryNewCounts[state.feedType] = (state.categoryNewCounts[state.feedType] || 0) + newArticles.length;
    }

    state.stories = articles;
    const fetchTime = Date.now();
    state.lastUpdated = fetchTime;
    state.lastFetchTime = fetchTime;
    state.isOffline = false;

    // Immediately build search index from current feed
    if (!state.searchIndex) {
      state.searchIndex = new SearchIndex();
    }
    state.searchIndex.addArticles(state.stories, state.feedType);

    // Cache
    await cacheData(`articles-${state.feedType}`, articles);
    saveState(state);

    removeSkeletons(storyList);
    renderStories();

    // Show new articles banner if there are new articles
    if (newArticles.length > 0) {
      showNewArticlesBanner(newArticles.length);
    }

    // Detect and show breaking news
    const breaking = detectBreakingNews(articles);
    if (breaking.length > 0) {
      state.breakingNews = breaking;
      showBreakingNewsBanner(breaking);
    }

    // Update category badges
    updateCategoryBadges();

    // Notify refresh module
    onFetchComplete(fetchTime);

    // Fetch all categories in background to build search index and trending
    loadBackgroundData();

    removeOfflineBanner();
  } catch (err) {
    // Try cache fallback
    const cached = await getCachedData(`articles-${state.feedType}`);
    if (cached && cached.data && cached.data.length) {
      state.stories = cached.data;
      state.lastUpdated = cached.cachedAt;
      removeSkeletons(storyList);
      renderStories();
      renderTrendingPanel();
      showOfflineBanner();
      // Show stale data warning
      const minutesAgo = cached.cachedAt ? Math.floor((Date.now() - cached.cachedAt) / 60000) : 0;
      showStaleDataWarning(minutesAgo);
    } else {
      removeSkeletons(storyList);
      showErrorCard('Failed to load articles. Check your connection.');
    }
  }

  state.isLoading = false;
}

/**
 * Fetch all categories in background to build search index, train classifier, and extract trending.
 */
async function loadBackgroundData() {
  try {
    const byCategory = await fetchAllCategories(10);
    state.allArticlesByCategory = byCategory;
    state.allArticles = Object.values(byCategory).flat();

    // Build search index
    if (!state.searchIndex) {
      state.searchIndex = new SearchIndex();
    }
    for (const [cat, articles] of Object.entries(byCategory)) {
      if (articles && articles.length) {
        state.searchIndex.addArticles(articles, cat);
      }
    }
    // Also add current feed articles
    if (state.stories && state.stories.length) {
      state.searchIndex.addArticles(state.stories, state.feedType);
    }
    await saveSearchIndex(state.searchIndex.toJSON());

    // Train classifier
    if (!state.classifier) {
      state.classifier = new CategoryClassifier();
    }
    state.classifier.train(byCategory);
    await saveClassifierData(state.classifier.toJSON());

    // Extract trending data
    state.trendingData = extractTrendingByCategory(byCategory);
    await saveTrendingData(state.trendingData);

    // Re-render trending sidebar with fresh data
    renderTrendingPanel();

    // Re-render top stories with fresh trending data (category-scoped)
    renderTopStories(state.stories, currentTrendingKeywords());
  } catch (err) {
    console.warn('Background data load failed:', err);
  }
}

/**
 * Build search index from all available articles.
 */
async function buildSearchIndex() {
  if (!state.searchIndex) {
    state.searchIndex = new SearchIndex();
  }
  for (const [cat, articles] of Object.entries(state.allArticlesByCategory)) {
    if (articles && articles.length) {
      state.searchIndex.addArticles(articles, cat);
    }
  }
  if (state.stories && state.stories.length) {
    state.searchIndex.addArticles(state.stories, state.feedType);
  }
  await saveSearchIndex(state.searchIndex.toJSON());
}

// --- Trending Click Handler (filter + detail) ---
function handleTrendingClick(keyword, categories) {
  state.currentFilterKeyword = keyword;
  state.view = 'filtered';
  hideTrendingDetail();
  // Highlight the selected chip in the trending panel
  renderTrendingPanel();

  // On mobile (stacked layout), scroll to the content area so results are visible
  if (window.matchMedia('(max-width: 1024px)').matches) {
    const content = document.getElementById('newsContent');
    if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // If we have a search index, search across all articles (scoped to the
  // active category when one is selected, so results match the panel scope)
  if (state.searchIndex && state.searchIndex.articleCount > 0) {
    const category = state.feedType !== 'world' ? state.feedType : null;
    const results = state.searchIndex.search(keyword, { category, limit: 30 });
    if (results && results.length) {
      state.stories = results;
      renderStories();
      // Show filtered results bar
      const bar = document.createElement('div');
      bar.className = 'filtered-results-bar';
      bar.innerHTML = `
        <span>Filtered by: <strong>${escapeHtml(keyword)}</strong> — ${results.length} article${results.length !== 1 ? 's' : ''}</span>
        <div class="filtered-results-actions">
          <button class="filtered-results-btn" data-action="timeline" type="button">View full timeline</button>
          <button class="filtered-results-btn" data-action="show-all" type="button">Show all</button>
        </div>
      `;
      storyList.prepend(bar);

      bar.querySelector('[data-action="timeline"]').addEventListener('click', () => {
        showTrendingDetail(keyword);
      });
      bar.querySelector('[data-action="show-all"]').addEventListener('click', () => {
        state.currentFilterKeyword = null;
        state.view = 'stories';
        renderTrendingPanel();
        loadFeed(true);
      });
      return;
    }
  }

  // Fallback: filter current stories by keyword
  filterByKeyword(keyword);
}

// --- Render Stories ---
function renderStories() {
  storyList.innerHTML = '';

  if (!state.stories.length) {
    storyList.innerHTML = '<div class="empty-state">No articles to show.</div>';
    return;
  }

  state.stories.forEach(article => {
    const isExpanded = state.expandedId === article.id;
    const card = createStoryCard(article, isExpanded, (id) => toggleExpand(id));
    storyList.appendChild(card);

    if (isExpanded) {
      const expandedContainer = card.querySelector('.story-card-expanded');
      if (expandedContainer) {
        renderExpandedContent(expandedContainer, article, state.searchIndex, state.allArticles);
      }
    }
  });

  // Render top stories section (category-scoped keywords)
  const trendingKeywords = currentTrendingKeywords();
  if (trendingKeywords) {
    renderTopStories(state.stories, trendingKeywords);
  }
}

// --- Toggle Expand ---
function toggleExpand(id) {
  if (state.expandedId === id) {
    state.expandedId = null;
  } else {
    state.expandedId = id;
  }
  renderStories();
}

// --- Filter by Keyword (fallback when search index unavailable) ---
function filterByKeyword(keyword) {
  const kw = keyword.toLowerCase();
  const source = state.allArticles.length > 0 ? state.allArticles : state.stories;
  const filtered = source.filter(a =>
    (a.title && a.title.toLowerCase().includes(kw)) ||
    (a.description && a.description.toLowerCase().includes(kw))
  );

  storyList.innerHTML = '';

  if (!filtered.length) {
    storyList.innerHTML = `
      <div class="empty-state">
        <p>No articles found for "<strong>${escapeHtml(keyword)}</strong>".</p>
        <p class="trending-detail-empty-hint">Try a different trending topic.</p>
      </div>
    `;
    return;
  }

  // Show filtered results bar with actions
  const bar = document.createElement('div');
  bar.className = 'filtered-results-bar';
  bar.innerHTML = `
    <span>Filtered by: <strong>${escapeHtml(keyword)}</strong> — ${filtered.length} article${filtered.length !== 1 ? 's' : ''}</span>
    <div class="filtered-results-actions">
      <button class="filtered-results-btn" data-action="timeline" type="button">View full timeline</button>
      <button class="filtered-results-btn" data-action="show-all" type="button">Show all</button>
    </div>
  `;
  storyList.appendChild(bar);

  // Wire action buttons
  const timelineBtn = bar.querySelector('[data-action="timeline"]');
  const showAllBtn = bar.querySelector('[data-action="show-all"]');

  timelineBtn.addEventListener('click', () => {
    showTrendingDetail(keyword);
  });

  showAllBtn.addEventListener('click', () => {
    state.currentFilterKeyword = null;
    state.view = 'stories';
    renderTrendingPanel();
    renderStories();
  });

  // Render filtered articles
  filtered.forEach(article => {
    const card = createStoryCard(article, false, (id) => toggleExpand(id));
    storyList.appendChild(card);
  });
}

// --- Offline Banner ---
function showOfflineBanner() {
  if (document.querySelector('.offline-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = 'You are offline. Showing cached articles.';
  document.querySelector('main').prepend(banner);
  state.isOffline = true;
}

function removeOfflineBanner() {
  const banner = document.querySelector('.offline-banner');
  if (banner) banner.remove();
  state.isOffline = false;
}

// --- Clear Banners ---
function clearBanners() {
  const area = document.getElementById('notificationArea');
  if (area) area.innerHTML = '';
}

// --- New Articles Banner ---
function showNewArticlesBanner(count) {
  const area = document.getElementById('notificationArea');
  if (!area) return;

  const banner = document.createElement('div');
  banner.className = 'new-articles-banner';
  banner.innerHTML = `
    <span>${count} new article${count !== 1 ? 's' : ''} available</span>
    <button class="new-articles-btn" type="button">Update now</button>
    <button class="new-articles-dismiss" type="button" aria-label="Dismiss">&times;</button>
  `;

  banner.querySelector('.new-articles-btn').addEventListener('click', () => {
    state.newArticleCount = 0;
    state.categoryNewCounts[state.feedType] = 0;
    updateCategoryBadges();
    loadFeed(true);
  });

  banner.querySelector('.new-articles-dismiss').addEventListener('click', () => {
    banner.remove();
    state.newArticleCount = 0;
  });

  area.appendChild(banner);
}

// --- Breaking News Detection ---
const BREAKING_KEYWORDS = ['breaking', 'urgent', 'just in', 'developing', 'exclusive', 'alert'];

function detectBreakingNews(articles) {
  return articles.filter(a => {
    const title = (a.title || '').toLowerCase();
    return BREAKING_KEYWORDS.some(kw => title.includes(kw));
  }).filter(a => !state.shownBreakingIds.has(a.id));
}

// --- Breaking News Banner ---
function showBreakingNewsBanner(articles) {
  const area = document.getElementById('notificationArea');
  if (!area || !articles.length) return;

  // Track shown IDs to avoid repeats
  articles.forEach(a => state.shownBreakingIds.add(a.id));

  const headlines = articles.map(a => a.title).join(' • ');

  const banner = document.createElement('div');
  banner.className = 'breaking-news-banner';
  banner.innerHTML = `
    <span class="breaking-news-icon">BREAKING</span>
    <div class="breaking-news-scroll" title="${escapeHtml(headlines)}">${escapeHtml(headlines)}</div>
    <button class="breaking-news-dismiss" type="button" aria-label="Dismiss">&times;</button>
  `;

  banner.querySelector('.breaking-news-dismiss').addEventListener('click', () => {
    banner.remove();
  });

  area.prepend(banner);

  // Auto-dismiss after 30 seconds
  setTimeout(() => {
    if (banner.parentNode) banner.remove();
  }, 30000);
}

// --- Category Badges ---
function updateCategoryBadges() {
  document.querySelectorAll('.header-filter-btn').forEach(btn => {
    const feed = btn.dataset.filter;
    const count = state.categoryNewCounts[feed] || 0;
    let badge = btn.querySelector('.filter-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'filter-badge';
        btn.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : count;
    } else if (badge) {
      badge.remove();
    }
  });
}

// --- Error Card ---
function showErrorCard(message) {
  storyList.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML = `
    <p class="error-card-message">${escapeHtml(message)}</p>
    <button class="error-card-retry" type="button">Try again</button>
  `;
  card.querySelector('.error-card-retry').addEventListener('click', () => {
    loadFeed(true);
  });
  storyList.appendChild(card);
}

// --- Stale Data Warning ---
function showStaleDataWarning(minutesAgo) {
  const area = document.getElementById('notificationArea');
  if (!area) return;
  const warning = document.createElement('div');
  warning.className = 'stale-data-warning';
  warning.textContent = minutesAgo > 0
    ? `Showing cached data from ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`
    : 'Showing cached data';
  area.appendChild(warning);
}

// --- Visibility Change ---
function initVisibilityRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const elapsed = state.lastFetchTime ? Date.now() - state.lastFetchTime : Infinity;
      if (elapsed > state.staleThreshold) { // refresh if more than 2 min stale
        loadFeed(true);
      }
    }
  });

  window.addEventListener('online', () => {
    loadFeed(true);
  });
}

// --- Trending Detail View ---
function showTrendingDetail(topic) {
  state.view = 'trending-detail';
  state.activeTrendingTopic = topic;
  storyList.style.display = 'none';
  renderTrendingDetail(topic, () => {
    closeTrendingDetail();
  }, {
    category: state.feedType !== 'world' ? state.feedType : null,
    searchIndex: state.searchIndex,
  });
}

function closeTrendingDetail() {
  state.view = state.currentFilterKeyword ? 'filtered' : 'stories';
  state.activeTrendingTopic = null;
  hideTrendingDetail();

  // Restore story list
  storyList.style.display = '';

  // If we had a filter active, re-apply it
  if (state.currentFilterKeyword) {
    filterByKeyword(state.currentFilterKeyword);
  }
}

// --- Search ---
function initSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  // Create suggestions container
  const suggestions = document.createElement('div');
  suggestions.className = 'search-suggestions';
  suggestions.id = 'searchSuggestions';
  input.parentNode.style.position = 'relative';
  input.parentNode.appendChild(suggestions);

  let timer = null;
  let suggestTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();

    // Autocomplete suggestions
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => {
      if (q && state.searchIndex) {
        const sugs = state.searchIndex.suggest(q);
        suggestions.innerHTML = sugs.slice(0, 5).map(s =>
          `<button class="search-suggestion-item" type="button" data-suggestion="${escapeHtml(s.suggestion)}">${escapeHtml(s.suggestion)}</button>`
        ).join('');
        suggestions.classList.toggle('visible', sugs.length > 0);

        // Wire suggestion clicks
        suggestions.querySelectorAll('.search-suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.suggestion;
            suggestions.classList.remove('visible');
            doSearch(item.dataset.suggestion);
          });
        });
      } else {
        suggestions.classList.remove('visible');
      }
    }, 100);

    // Search
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      suggestions.classList.remove('visible');
      if (!q) {
        state.currentFilterKeyword = null;
        state.view = 'stories';
        state.searchQuery = '';
        loadFeed(true);
        return;
      }
      state.searchQuery = q;
      doSearch(q);
    }, 200);
  });

  // Close suggestions on blur
  input.addEventListener('blur', () => {
    setTimeout(() => suggestions.classList.remove('visible'), 200);
  });

  input.addEventListener('focus', () => {
    if (suggestions.children.length > 0) {
      suggestions.classList.add('visible');
    }
  });
}

/**
 * Execute a search using the search index or fallback.
 */
function doSearch(query) {
  state.view = 'filtered';
  hideTrendingDetail();
  // A manual search supersedes any selected trending chip
  state.currentFilterKeyword = null;
  renderTrendingPanel();

  const scope = state.searchScope;
  const category = scope === 'category' ? state.feedType : null;

  if (state.searchIndex && state.searchIndex.articleCount > 0) {
    const results = state.searchIndex.search(query, { category, limit: 30 });
    renderSearchResults(query, results, scope);
  } else {
    // Fallback: filter current stories
    filterByKeyword(query);
  }
}

/**
 * Render search results with category badges and relevance scores.
 */
function renderSearchResults(query, results, scope) {
  storyList.innerHTML = '';

  if (!results || !results.length) {
    storyList.innerHTML = `
      <div class="empty-state">
        <p>No results for "<strong>${escapeHtml(query)}</strong>".</p>
        <p class="trending-detail-empty-hint">Try different keywords or broaden your search.</p>
      </div>
    `;
    return;
  }

  // Search results header with scope toggle
  const header = document.createElement('div');
  header.className = 'search-results-header';
  header.innerHTML = `
    <span>Results for "<strong>${escapeHtml(query)}</strong>" — ${results.length} article${results.length !== 1 ? 's' : ''}</span>
    <button class="search-scope-toggle" type="button" data-scope="${scope === 'all' ? 'category' : 'all'}">
      ${scope === 'all' ? 'Search in ' + (state.feedType || 'world') : 'Search all categories'}
    </button>
  `;
  storyList.appendChild(header);

  // Wire scope toggle
  header.querySelector('.search-scope-toggle').addEventListener('click', (e) => {
    state.searchScope = e.target.dataset.scope;
    doSearch(query);
  });

  // Render results
  results.forEach(article => {
    const card = createStoryCard(article, false, (id) => toggleExpand(id));
    // Add category badge to card meta
    const meta = card.querySelector('.story-card-meta');
    if (meta && article.category) {
      const badge = document.createElement('span');
      badge.className = `category-badge category-badge--${article.category}`;
      badge.textContent = article.category;
      meta.appendChild(badge);
    }
    // Add relevance score
    if (article.score !== undefined) {
      const scoreEl = document.createElement('span');
      scoreEl.className = 'search-result-score';
      scoreEl.textContent = `${Math.round(article.score * 100)}%`;
      const meta = card.querySelector('.story-card-meta');
      if (meta) meta.appendChild(scoreEl);
    }
    storyList.appendChild(card);
  });
}

/**
 * Render the trending panel with category-aware trending data.
 */
function renderTrendingPanel() {
  renderTrending((keyword, categories) => {
    handleTrendingClick(keyword, categories);
  }, {
    trendingData: state.trendingData,
    feedType: state.feedType,
    activeKeyword: state.currentFilterKeyword,
  });
}

/**
 * Trending keywords for the current category scope — category-specific when a
 * category is selected, global otherwise. Used to score "Top Stories" so the
 * section stays consistent with the category-aware trending panel.
 */
function currentTrendingKeywords() {
  if (!state.trendingData) return null;
  if (state.feedType !== 'world' && state.trendingData.byCategory &&
      state.trendingData.byCategory[state.feedType] && state.trendingData.byCategory[state.feedType].length) {
    return state.trendingData.byCategory[state.feedType];
  }
  return state.trendingData.global;
}

// --- Init ---
async function init() {
  initTheme();
  initFilters();
  initSearch();
  initVisibilityRefresh();

  // Initialize refresh controls (auto-refresh, countdown, freshness)
  initRefreshControls(state, {
    onRefresh: () => loadFeed(true),
  });

  // Restore search index and classifier from cache
  try {
    const savedIndex = await loadSearchIndex();
    if (savedIndex) {
      state.searchIndex = SearchIndex.fromJSON(savedIndex);
    }
    const savedClassifier = loadClassifierData();
    if (savedClassifier) {
      state.classifier = CategoryClassifier.fromJSON(savedClassifier);
    }
    const savedTrending = loadTrendingData();
    if (savedTrending) {
      state.trendingData = savedTrending;
    }
  } catch { /* cache unavailable */ }

  // Try loading saved state first
  const saved = loadState();
  if (saved && saved.stories && saved.stories.length) {
    state.feedType = saved.feedType || 'world';
    state.stories = saved.stories;
    state.lastUpdated = saved.lastUpdated;
    state.lastFetchTime = saved.lastUpdated;
    state.trendingKeywords = saved.trendingKeywords || [];
    renderStories();
    renderTrendingPanel();

    // Set active filter button
    const activeBtn = document.querySelector(`.header-filter-btn[data-filter="${state.feedType}"]`);
    if (activeBtn) {
      document.querySelectorAll('.header-filter-btn').forEach(b => {
        b.classList.remove('active');
      });
      activeBtn.classList.add('active');
    }

    // Refresh in background
    setTimeout(() => loadFeed(true), 1000);
  } else {
    loadFeed();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
