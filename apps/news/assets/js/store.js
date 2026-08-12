// localStorage + Cache Storage wrapper for offline/state persistence
const STORAGE_KEY = 'pyaek-news-state-v5';
const CACHE_KEY = 'pyaek-news-data-v5';
const SEARCH_INDEX_KEY = 'pyaek-news-search-index-v2';
const TRENDING_KEY = 'pyaek-news-trending-v3';
const CLASSIFIER_KEY = 'pyaek-news-classifier-v1';

// --- State persistence (localStorage) ---

export function saveState(state) {
  try {
    const data = {
      feedType: state.feedType,
      stories: state.stories.map(s => ({
        id: s.id, title: s.title, url: s.url,
        description: s.description, image: s.image,
        source: s.source, sourceName: s.sourceName,
        sourceLabel: s.sourceLabel, sourceColor: s.sourceColor,
        publishedAt: s.publishedAt, content: s.content,
        clusterId: s.clusterId,
        related: (s.related || []).map(r => ({
          id: r.id, title: r.title, url: r.url,
          source: r.source, sourceName: r.sourceName,
          sourceLabel: r.sourceLabel, sourceColor: r.sourceColor,
          publishedAt: r.publishedAt,
        })),
      })),
      lastUpdated: state.lastUpdated,
      trendingKeywords: state.trendingKeywords,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full or unavailable */ }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// --- Article data cache (Cache Storage) ---

export async function cacheData(key, data) {
  try {
    const cache = await caches.open(CACHE_KEY);
    const response = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache-Date': Date.now().toString() }
    });
    cache.put(key, response);
  } catch { /* cache unavailable */ }
}

export async function getCachedData(key) {
  try {
    const cache = await caches.open(CACHE_KEY);
    const response = await cache.match(key);
    if (!response) return null;
    const data = await response.json();
    const cacheDate = parseInt(response.headers.get('X-Cache-Date') || '0');
    return { data, cachedAt: cacheDate };
  } catch { return null; }
}

// --- Search index persistence (Cache Storage) ---

export async function saveSearchIndex(indexData) {
  try {
    const cache = await caches.open(CACHE_KEY);
    const response = new Response(JSON.stringify(indexData), {
      headers: { 'Content-Type': 'application/json', 'X-Cache-Date': Date.now().toString() }
    });
    cache.put(SEARCH_INDEX_KEY, response);
  } catch { /* cache unavailable */ }
}

export async function loadSearchIndex() {
  try {
    const cache = await caches.open(CACHE_KEY);
    const response = await cache.match(SEARCH_INDEX_KEY);
    if (!response) return null;
    return await response.json();
  } catch { return null; }
}

// --- Trending data persistence (localStorage) ---

export function saveTrendingData(data) {
  try {
    localStorage.setItem(TRENDING_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

export function loadTrendingData() {
  try {
    const raw = localStorage.getItem(TRENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// --- Classifier data persistence (localStorage) ---

export function saveClassifierData(data) {
  try {
    localStorage.setItem(CLASSIFIER_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

export function loadClassifierData() {
  try {
    const raw = localStorage.getItem(CLASSIFIER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// --- Refresh interval persistence (localStorage) ---

const REFRESH_INTERVAL_KEY = 'news-refresh-interval';
const REFRESH_PAUSED_KEY = 'news-refresh-paused';

export function saveRefreshInterval(seconds) {
  try { localStorage.setItem(REFRESH_INTERVAL_KEY, String(seconds)); } catch {}
}

export function loadRefreshInterval() {
  try {
    const val = localStorage.getItem(REFRESH_INTERVAL_KEY);
    if (val !== null) {
      const parsed = parseInt(val, 10);
      if (!Number.isNaN(parsed) && [30, 60, 120, 300].includes(parsed)) return parsed;
    }
  } catch {}
  return 120; // default 2 minutes
}

export function saveRefreshPaused(paused) {
  try { localStorage.setItem(REFRESH_PAUSED_KEY, paused ? '1' : '0'); } catch {}
}

export function loadRefreshPaused() {
  try { return localStorage.getItem(REFRESH_PAUSED_KEY) === '1'; } catch {}
  return false;
}
