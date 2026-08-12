// News API client — delegates to multi-source data layer
// Provides backward-compatible exports for app.js, trending.js, story-card.js

import { fetchFromAllSources, fetchTrendingFromAllSources, extractDomain, timeAgo, formatDate } from './sources.js';
import { extractKeywords, extractTrendingByCategory } from './trending-engine.js';
import { NEWS_CONFIG } from './config.js';

// ─── Fetch Articles (multi-source) ──────────────────────────────────────────

/**
 * Fetch top headlines by category from all available sources.
 * @param {string} category - One of: world, technology, business, science, health, sports, entertainment
 * @param {number} pageSize - Number of articles per source
 * @returns {Promise<Array>} Normalized, cluster-deduped article objects
 */
export async function fetchArticles(category = 'world', pageSize = 30) {
  return fetchFromAllSources(category, pageSize);
}

/**
 * Fetch articles from all categories in parallel.
 * @param {number} pageSize - Articles per category
 * @returns {Promise<object>} { category: [articles] }
 */
export async function fetchAllCategories(pageSize = 10) {
  const categories = ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'];
  const results = await Promise.allSettled(
    categories.map(cat => fetchFromAllSources(cat, pageSize))
  );
  const byCategory = {};
  categories.forEach((cat, i) => {
    const r = results[i];
    byCategory[cat] = r.status === 'fulfilled' ? r.value : [];
  });
  return byCategory;
}

// ─── Search Articles (all sources, for related articles in expanded cards) ───

/**
 * Search articles by keyword query across all sources.
 * @param {string} query - Search keywords
 * @param {number} pageSize - Number of results
 * @returns {Promise<Array>} Normalized article objects
 */
export async function searchArticles(query, pageSize = 20) {
  if (!query) return [];
  const categories = ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'];
  const perCategory = Math.max(1, Math.ceil(pageSize / categories.length));
  const results = await Promise.allSettled(
    categories.map(cat => fetchFromAllSources(cat, perCategory))
  );
  const articles = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      articles.push(...result.value);
    }
  });
  const kw = query.toLowerCase();
  const filtered = articles.filter(a =>
    (a.title && a.title.toLowerCase().includes(kw)) ||
    (a.description && a.description.toLowerCase().includes(kw))
  );
  return filtered.slice(0, pageSize);
}

// ─── Trending Topics ─────────────────────────────────────────────────────────

/**
 * Fetch trending topics by aggregating keywords across all categories and sources.
 * @returns {Promise<Array<{word: string, count: number, sources: string[], score: number}>>}
 */
export async function fetchTrendingTopics() {
  const allArticles = await fetchTrendingFromAllSources();
  return extractKeywords(allArticles);
}

// Re-export trending extraction from the trending engine (backward compatible)
export { extractKeywords, extractTrendingByCategory };

// ─── Category classification ───────────────────────────────────────────────

/**
 * Determine the best category for an article using the classifier.
 * @param {object} article - Normalized article
 * @param {object} classifier - CategoryClassifier instance
 * @returns {{ category: string, confidence: number }}
 */
export function getCategoryForArticle(article, classifier) {
  if (!classifier || !classifier.trained) {
    return { category: 'world', confidence: 0 };
  }
  const text = `${article.title || ''} ${article.description || ''}`;
  const result = classifier.classify(text);
  return { category: result.category, confidence: result.confidence };
}

// Re-export utilities for backward compatibility
export { extractDomain, timeAgo, formatDate };
