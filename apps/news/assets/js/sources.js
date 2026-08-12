// Multi-source news data layer — orchestrates OKSURF, Noozra, GNews, Hacker News,
// Spaceflight News, BBC, RSS (via rss2json), dev.to, and key-based NewsData /
// Currents / Mediastack. Each source fetcher normalizes to a common Article
// shape, then story clustering merges duplicates across sources (exact URL +
// title similarity) with priority tiebreaking. Only CORS-enabled APIs are used —
// this app runs in the browser.

import { NEWS_CONFIG } from './config.js';
import { clusterArticles } from './clustering.js';

// ─── Source Configuration ────────────────────────────────────────────────────
// `categories` lists which dashboard categories a source can serve; fetchers for
// unsupported categories are skipped entirely (no wasted requests).
// `needsKey` sources short-circuit to [] when their key slot is a placeholder.

export const SOURCES = {
  oksurf: {
    name: 'oksurf',
    label: 'OKSURF',
    color: '#0071E3',
    baseUrl: 'https://ok.surf/api/v1/cors',
    needsKey: false,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    // Section names are case-sensitive — the API only accepts these exact strings.
    categoryMap: {
      world: 'World',
      technology: 'Technology',
      business: 'Business',
      science: 'Science',
      health: 'Health',
      sports: 'Sports',
      entertainment: 'Entertainment',
    },
  },
  noozra: {
    name: 'noozra',
    label: 'Noozra',
    color: '#34C759',
    baseUrl: 'https://noozra.com/api',
    needsKey: false,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    categoryMap: {
      world: 'general',
      technology: 'tech',
      business: 'business',
      science: 'science',
      health: 'health',
      sports: 'sports',
      entertainment: 'entertainment',
    },
  },
  gnews: {
    name: 'gnews',
    label: 'GNews',
    color: '#FF9F0A',
    baseUrl: 'https://gnews.io/api/v4',
    needsKey: true,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    categoryMap: {
      world: 'world',
      technology: 'technology',
      business: 'business',
      science: 'science',
      health: 'health',
      sports: 'sports',
      entertainment: 'entertainment',
    },
  },
  newsdata: {
    name: 'newsdata',
    label: 'NewsData',
    color: '#2563EB',
    baseUrl: 'https://newsdata.io',
    needsKey: true,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    categoryMap: {
      world: 'world',
      technology: 'technology',
      business: 'business',
      science: 'science',
      health: 'health',
      sports: 'sports',
      entertainment: 'entertainment',
    },
  },
  currents: {
    name: 'currents',
    label: 'Currents',
    color: '#0EA5E9',
    baseUrl: 'https://api.currentsapi.services',
    needsKey: true,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    categoryMap: {
      world: 'world',
      technology: 'technology',
      business: 'business',
      science: 'science',
      health: 'health',
      sports: 'sports',
      entertainment: 'entertainment',
    },
  },
  mediastack: {
    name: 'mediastack',
    label: 'Mediastack',
    color: '#F59E0B',
    baseUrl: 'https://api.mediastack.com',
    needsKey: true,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    categoryMap: {
      world: 'general',
      technology: 'technology',
      business: 'business',
      science: 'science',
      health: 'health',
      sports: 'sports',
      entertainment: 'entertainment',
    },
  },
  hn: {
    name: 'hn',
    label: 'Hacker News',
    color: '#FF6600',
    baseUrl: 'https://hn.algolia.com/api/v1',
    needsKey: false,
    categories: ['technology'],
  },
  spaceflight: {
    name: 'spaceflight',
    label: 'Space News',
    color: '#8E44AD',
    baseUrl: 'https://api.spaceflightnewsapi.net/v4',
    needsKey: false,
    categories: ['science'],
  },
  devto: {
    name: 'devto',
    label: 'DEV',
    color: '#0A0A0A',
    baseUrl: 'https://dev.to/api',
    needsKey: false,
    categories: ['technology'],
    categoryMap: { technology: 'technology' },
  },
  bbc: {
    name: 'bbc',
    label: 'BBC',
    color: '#BB1919',
    baseUrl: 'https://api.rss2json.com/v1/api.json',
    needsKey: false,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    // BBC RSS feeds served through rss2json, which adds CORS headers for browser use.
    feedMap: {
      world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
      technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
      business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
      science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
      health: 'https://feeds.bbci.co.uk/news/health/rss.xml',
      sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
      entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
    },
  },
  rss: {
    name: 'rss',
    label: 'RSS',
    color: '#6B7280',
    baseUrl: 'https://api.rss2json.com/v1/api.json',
    needsKey: false,
    categories: ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'],
    // Curated RSS feeds via rss2json. Free tier: 10,000 req/day, 25 unique feeds,
    // 10 items/feed, hourly cache. BBC uses 8 feeds; this adds 15 → 23 total.
    // Each feed carries its own outlet label/color so badges show the real name.
    feedMap: {
      world: [
        { url: 'https://www.theguardian.com/world/rss', label: 'The Guardian', color: '#052962' },
        { url: 'https://www.aljazeera.com/xml/rss/all.xml', label: 'Al Jazeera', color: '#C70000' },
      ],
      technology: [
        { url: 'https://www.theverge.com/rss/index.xml', label: 'The Verge', color: '#0085FF' },
        { url: 'https://feeds.arstechnica.com/arstechnica/index', label: 'Ars Technica', color: '#FF4E00' },
        { url: 'https://techcrunch.com/feed/', label: 'TechCrunch', color: '#0A9E01' },
      ],
      business: [
        { url: 'https://www.theguardian.com/business/rss', label: 'The Guardian', color: '#052962' },
        { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', label: 'CoinDesk', color: '#F7931A' },
      ],
      science: [
        { url: 'https://www.sciencedaily.com/rss/all.xml', label: 'ScienceDaily', color: '#1E6FBA' },
        { url: 'https://www.theguardian.com/science/rss', label: 'The Guardian', color: '#052962' },
      ],
      health: [
        { url: 'https://www.theguardian.com/lifeandstyle/health-and-wellbeing/rss', label: 'The Guardian', color: '#052962' },
        { url: 'https://feeds.npr.org/1027/rss.xml', label: 'NPR', color: '#E60000' },
      ],
      sports: [
        { url: 'https://www.espn.com/espn/rss/news', label: 'ESPN', color: '#D71920' },
        { url: 'https://www.theguardian.com/sport/rss', label: 'The Guardian', color: '#052962' },
      ],
      entertainment: [
        { url: 'https://www.billboard.com/feed/', label: 'Billboard', color: '#00A0DF' },
        { url: 'https://feeds.npr.org/1008/rss.xml', label: 'NPR', color: '#E60000' },
      ],
    },
  },
};

// Cross-source duplicate wins: earlier index = kept as cluster primary on ties.
export const SOURCE_PRIORITY = ['gnews', 'newsdata', 'currents', 'mediastack', 'bbc', 'rss', 'noozra', 'oksurf', 'devto', 'hn', 'spaceflight'];

// Cap per-category fan-out so a category with many active sources stays fast.
const MAX_SOURCES_PER_CATEGORY = 8;

// ─── Source metadata helpers ──────────────────────────────────────────────────

/**
 * Resolve the display label/color for an article's source badge.
 * RSS articles carry per-feed sourceLabel/sourceColor; everything else falls
 * back to the SOURCES config, then to the raw source string.
 * @param {object} article
 * @returns {{label: string, color: string}}
 */
export function getSourceMeta(article) {
  if (!article) return { label: 'News', color: '#6B7280' };
  if (article.sourceLabel) return { label: article.sourceLabel, color: article.sourceColor || SOURCES.rss.color };
  const src = SOURCES[article.sourceName];
  if (src) return { label: src.label, color: src.color };
  return { label: article.source || 'News', color: '#6B7280' };
}

/**
 * Whether a source is active: no-key sources always are; key-based sources only
 * when a real key is present in NEWS_CONFIG (not a YOUR_… placeholder).
 * @param {string} name - Source key
 * @returns {boolean}
 */
function isSourceActive(name) {
  const src = SOURCES[name];
  if (!src) return false;
  if (!src.needsKey) return true;
  const key = NEWS_CONFIG[`${name.toUpperCase()}_API_KEY`];
  return !!key && !key.startsWith('YOUR_');
}

// ─── Noozra rate-limit tracking ─────────────────────────────────────────────
// Noozra caps at 100 requests/hour per IP; the counter resets hourly (the API
// itself enforces the real cap, this is just a polite client-side guard).

let noozraRequestCount = 0;
const NOOZRA_HOURLY_LIMIT = 100;

function resetNoozraCount() {
  noozraRequestCount = 0;
}
setInterval(resetNoozraCount, 3600000); // reset the counter once per hour

// ─── Fetch with timeout ─────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── OKSURF Fetcher ─────────────────────────────────────────────────────────
// POST /news-section with a capitalized section name returns an object keyed by
// section, e.g. {"World": [...]} — flatten values before normalizing.

async function fetchOksurf(category, pageSize) {
  const cat = SOURCES.oksurf.categoryMap[category] || 'World';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.oksurf.baseUrl}/news-section`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sections: [cat] }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const articles = Array.isArray(data) ? data : Object.values(data).flat();
    if (!Array.isArray(articles)) return [];
    return articles.slice(0, pageSize).map(normalizeOksurfArticle);
  } catch {
    return [];
  }
}

function normalizeOksurfArticle(raw) {
  const url = raw.link || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.og || '',
    source: raw.source || 'Unknown',
    sourceName: 'oksurf',
    publishedAt: new Date().toISOString(), // OKSURF provides no timestamps
    content: '',
  };
}

// ─── Noozra Fetcher ──────────────────────────────────────────────────────────

async function fetchNoozra(category, pageSize) {
  // Check rate limit
  if (noozraRequestCount >= NOOZRA_HOURLY_LIMIT) return [];
  noozraRequestCount++;

  const cat = SOURCES.noozra.categoryMap[category] || 'general';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.noozra.baseUrl}/articles?category=${encodeURIComponent(cat)}&limit=${pageSize}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    // Noozra wraps results in { articles: [...] } — tolerate both shapes
    const articles = Array.isArray(data) ? data : (data.articles || []);
    if (!Array.isArray(articles)) return [];
    return articles.slice(0, pageSize).map(normalizeNoozraArticle);
  } catch {
    return [];
  }
}

function normalizeNoozraArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.headline || raw.title),
    title: raw.headline || raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.image_url || raw.image || '',
    source: raw.source || 'Unknown',
    sourceName: 'noozra',
    publishedAt: raw.published_at || raw.publishedAt || new Date().toISOString(),
    content: raw.content || '',
  };
}

// ─── GNews Fetcher ───────────────────────────────────────────────────────────

async function fetchGnews(category, pageSize) {
  const apiKey = NEWS_CONFIG?.GNEWS_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) return [];

  const cat = SOURCES.gnews.categoryMap[category] || 'world';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.gnews.baseUrl}/top-headlines?category=${encodeURIComponent(cat)}&lang=en&max=${pageSize}&apikey=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.articles || !Array.isArray(data.articles)) return [];
    return data.articles.slice(0, pageSize).map(normalizeGnewsArticle);
  } catch {
    return [];
  }
}

function normalizeGnewsArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.image || '',
    source: raw.source?.name || 'Unknown',
    sourceName: 'gnews',
    publishedAt: raw.publishedAt || new Date().toISOString(),
    content: raw.content || '',
  };
}

// ─── NewsData Fetcher (key-based) ────────────────────────────────────────────

async function fetchNewsdata(category, pageSize) {
  const apiKey = NEWS_CONFIG?.NEWSDATA_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) return [];

  const cat = SOURCES.newsdata.categoryMap[category] || 'world';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.newsdata.baseUrl}/api/1/latest?apikey=${encodeURIComponent(apiKey)}&category=${encodeURIComponent(cat)}&language=en&size=${Math.min(pageSize, 10)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'success' || !Array.isArray(data.results)) return [];
    return data.results.slice(0, pageSize).map(normalizeNewsdataArticle);
  } catch {
    return [];
  }
}

function normalizeNewsdataArticle(raw) {
  const url = raw.link || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.image_url || '',
    source: raw.source_name || raw.source_id || 'NewsData',
    sourceName: 'newsdata',
    publishedAt: (raw.pubDate || '').replace(' ', 'T') || new Date().toISOString(),
    content: raw.content || '',
  };
}

// ─── Currents Fetcher (key-based) ────────────────────────────────────────────

async function fetchCurrents(category, pageSize) {
  const apiKey = NEWS_CONFIG?.CURRENTS_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) return [];

  const cat = SOURCES.currents.categoryMap[category] || 'world';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.currents.baseUrl}/v1/latest-news?apiKey=${encodeURIComponent(apiKey)}&category=${encodeURIComponent(cat)}&language=en`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !Array.isArray(data.news)) return [];
    return data.news.slice(0, pageSize).map(normalizeCurrentsArticle);
  } catch {
    return [];
  }
}

function normalizeCurrentsArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.image || '',
    source: raw.author || 'Currents',
    sourceName: 'currents',
    publishedAt: raw.published || new Date().toISOString(),
    content: '',
  };
}

// ─── Mediastack Fetcher (key-based) ─────────────────────────────────────────

async function fetchMediastack(category, pageSize) {
  const apiKey = NEWS_CONFIG?.MEDIASTACK_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) return [];

  const cat = SOURCES.mediastack.categoryMap[category] || 'general';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.mediastack.baseUrl}/v1/news?access_key=${encodeURIComponent(apiKey)}&categories=${encodeURIComponent(cat)}&languages=en&limit=${Math.min(pageSize, 10)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.data)) return [];
    return data.data.slice(0, pageSize).map(normalizeMediastackArticle);
  } catch {
    return [];
  }
}

function normalizeMediastackArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.image || '',
    source: raw.source || 'Mediastack',
    sourceName: 'mediastack',
    publishedAt: raw.published_at || new Date().toISOString(),
    content: '',
  };
}

// ─── Hacker News Fetcher (Algolia API) ───────────────────────────────────────
// Front-page stories, newest first. Stories without a link (Ask HN) fall back
// to their item page on news.ycombinator.com.

async function fetchHn(category, pageSize) {
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.hn.baseUrl}/search_by_date?tags=front_page&hitsPerPage=${pageSize}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.hits)) return [];
    return data.hits.slice(0, pageSize).map(normalizeHnArticle);
  } catch {
    return [];
  }
}

function normalizeHnArticle(raw) {
  const url = raw.url || `https://news.ycombinator.com/item?id=${raw.objectID}`;
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: `${raw.points ?? 0} points · ${raw.num_comments ?? 0} comments`,
    url: url,
    image: '',
    source: 'Hacker News',
    sourceName: 'hn',
    publishedAt: raw.created_at || new Date().toISOString(),
    content: '',
  };
}

// ─── Spaceflight News Fetcher ────────────────────────────────────────────────

async function fetchSpaceflight(category, pageSize) {
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.spaceflight.baseUrl}/articles/?limit=${Math.min(pageSize, 25)}&ordering=-published_at`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.results)) return [];
    return data.results.slice(0, pageSize).map(normalizeSpaceflightArticle);
  } catch {
    return [];
  }
}

function normalizeSpaceflightArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.id),
    title: raw.title || 'Untitled',
    description: raw.summary || '',
    url: url,
    image: raw.image_url || '',
    source: raw.news_site || 'Spaceflight News',
    sourceName: 'spaceflight',
    publishedAt: raw.published_at || new Date().toISOString(),
    content: '',
  };
}

// ─── dev.to Fetcher ──────────────────────────────────────────────────────────
// CORS-enabled, no key. Returns a bare array of articles.

async function fetchDevto(category, pageSize) {
  const tag = SOURCES.devto.categoryMap[category] || 'technology';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.devto.baseUrl}/articles?tag=${encodeURIComponent(tag)}&per_page=${Math.min(pageSize, 30)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, pageSize).map(normalizeDevtoArticle);
  } catch {
    return [];
  }
}

function normalizeDevtoArticle(raw) {
  const url = raw.url || '';
  return {
    id: simpleHash(url || raw.title),
    title: raw.title || 'Untitled',
    description: raw.description || '',
    url: url,
    image: raw.cover_image || raw.social_image || '',
    source: raw.user?.username ? `@${raw.user.username}` : 'dev.to',
    sourceName: 'devto',
    publishedAt: raw.published_at || new Date().toISOString(),
    content: '',
  };
}

// ─── BBC Fetcher (RSS via rss2json) ──────────────────────────────────────────
// rss2json adds CORS headers to plain RSS feeds. Free tier returns 10 items
// per feed — plenty for a category feed.

async function fetchBbc(category, pageSize) {
  const feed = SOURCES.bbc.feedMap[category];
  if (!feed) return [];
  const apiKey = NEWS_CONFIG?.RSS2JSON_API_KEY;
  const keyParam = apiKey && !apiKey.startsWith('YOUR_') ? `&api_key=${encodeURIComponent(apiKey)}` : '';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.bbc.baseUrl}?rss_url=${encodeURIComponent(feed)}${keyParam}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !Array.isArray(data.items)) return [];
    return data.items.slice(0, pageSize).map(normalizeBbcArticle);
  } catch {
    return [];
  }
}

function normalizeBbcArticle(raw) {
  const url = raw.link || raw.guid || '';
  // BBC pubDates look like "2026-08-07 22:13:55" — normalize the separator so
  // Date.parse works in every engine.
  const pubDate = (raw.pubDate || '').replace(' ', 'T');
  const enclosure = raw.enclosure && typeof raw.enclosure === 'object' ? raw.enclosure : {};
  return {
    id: simpleHash(url || raw.title),
    title: stripHtml(raw.title) || 'Untitled',
    description: stripHtml(raw.description),
    url: url,
    image: raw.thumbnail || enclosure.thumbnail || '',
    source: 'BBC',
    sourceName: 'bbc',
    publishedAt: pubDate || new Date().toISOString(),
    content: '',
  };
}

// ─── Generic RSS Fetcher (via rss2json) ─────────────────────────────────────
// Same mechanism as BBC but for the curated feedMap; each feed carries its own
// outlet label/color so badges show the real publication.

async function fetchRss(category, pageSize) {
  const feeds = SOURCES.rss.feedMap[category] || [];
  if (!feeds.length) return [];
  const results = await Promise.allSettled(
    feeds.map(feed => fetchRssFeed(feed, pageSize))
  );
  const articles = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      articles.push(...result.value);
    }
  });
  return articles.slice(0, pageSize);
}

async function fetchRssFeed(feed, pageSize) {
  const apiKey = NEWS_CONFIG?.RSS2JSON_API_KEY;
  const keyParam = apiKey && !apiKey.startsWith('YOUR_') ? `&api_key=${encodeURIComponent(apiKey)}` : '';
  try {
    const res = await fetchWithTimeout(
      `${SOURCES.rss.baseUrl}?rss_url=${encodeURIComponent(feed.url)}${keyParam}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !Array.isArray(data.items)) return [];
    return data.items.slice(0, pageSize).map(raw => normalizeRssArticle(raw, feed));
  } catch {
    return [];
  }
}

function normalizeRssArticle(raw, feed) {
  const url = raw.link || raw.guid || '';
  const pubDate = (raw.pubDate || '').replace(' ', 'T');
  const enclosure = raw.enclosure && typeof raw.enclosure === 'object' ? raw.enclosure : {};
  return {
    id: simpleHash(url || raw.title),
    title: stripHtml(raw.title) || 'Untitled',
    description: stripHtml(raw.description),
    url: url,
    image: raw.thumbnail || enclosure.thumbnail || '',
    source: feed.label,
    sourceName: 'rss',
    sourceLabel: feed.label,
    sourceColor: feed.color,
    publishedAt: pubDate || new Date().toISOString(),
    content: '',
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

const FETCHERS = {
  oksurf: fetchOksurf,
  noozra: fetchNoozra,
  gnews: fetchGnews,
  newsdata: fetchNewsdata,
  currents: fetchCurrents,
  mediastack: fetchMediastack,
  hn: fetchHn,
  spaceflight: fetchSpaceflight,
  devto: fetchDevto,
  bbc: fetchBbc,
  rss: fetchRss,
};

/**
 * Fetch articles from all available sources for a given category.
 * Sources that don't cover the category (or are inactive key-based sources)
 * are skipped. Returns cluster-deduped primary articles sorted by recency.
 */
export async function fetchFromAllSources(category = 'world', pageSize = 30) {
  const activeFetchers = Object.entries(FETCHERS)
    .filter(([name]) => SOURCES[name].categories.includes(category))
    .filter(([name]) => isSourceActive(name))
    .sort(([a], [b]) => {
      const ia = SOURCE_PRIORITY.indexOf(a);
      const ib = SOURCE_PRIORITY.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .slice(0, MAX_SOURCES_PER_CATEGORY);

  const results = await Promise.allSettled(
    activeFetchers.map(([, fetcher]) => fetcher(category, pageSize))
  );

  const articles = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
      articles.push(...result.value);
    }
  });

  // Cluster duplicates (exact URL + title similarity), one primary per story.
  const clustered = clusterArticles(articles, { priority: SOURCE_PRIORITY });

  // Sort by recency (newest first)
  clustered.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return tb - ta;
  });

  return clustered.slice(0, pageSize);
}

/**
 * Fetch a small sample of articles across all categories from all sources.
 * Used for trending topic extraction.
 */
export async function fetchTrendingFromAllSources() {
  const categories = ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'];
  const allArticles = [];

  for (const cat of categories) {
    const articles = await fetchFromAllSources(cat, 5);
    allArticles.push(...articles);
  }

  return allArticles;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function stripHtml(str) {
  if (!str) return '';
  const doc = new DOMParser().parseFromString(str, 'text/html');
  return doc.body.textContent || '';
}

export function simpleHash(str) {
  if (!str) return Math.random().toString(36).slice(2, 8);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function extractDomain(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const timestamp = typeof dateStr === 'number' ? dateStr * 1000 : Date.parse(dateStr);
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const timestamp = typeof dateStr === 'number' ? dateStr * 1000 : Date.parse(dateStr);
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
