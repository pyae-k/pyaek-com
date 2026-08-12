// SearchIndex — client-side full-text search via MiniSearch (BM25 scoring, fuzzy matching, autocomplete)
import MiniSearch from './vendor/minisearch.esm.js';

export class SearchIndex {
  constructor() {
    this.index = new MiniSearch({
      fields: ['title', 'description', 'content', 'source', 'category'],
      storeFields: ['title', 'description', 'url', 'image', 'source', 'publishedAt', 'category', 'id', 'clusterId', 'relatedCount'],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: { title: 3, description: 2, content: 1, source: 1, category: 1 },
      },
      idField: 'id',
    });
    this.articleCount = 0;
    this.categoryCounts = {};
  }

  /**
   * Add articles to the search index.
   * @param {Array} articles - Normalized article objects
   * @param {string} category - Category label (e.g. 'technology')
   */
  addArticles(articles, category) {
    if (!articles || !articles.length) return;
    const docs = articles.map(a => ({
      id: a.id,
      title: a.title || '',
      description: a.description || '',
      content: a.content || '',
      source: a.source || '',
      category: category || 'world',
      url: a.url || '',
      image: a.image || '',
      publishedAt: a.publishedAt || '',
      clusterId: a.clusterId || '',
      relatedCount: a.relatedCount || 0,
    }));
    // Skip documents whose ID is already indexed (MiniSearch throws on duplicate IDs,
    // which happens when the same article appears in multiple categories)
    const fresh = docs.filter(d => !this.index.has(d.id));
    if (!fresh.length) return;
    this.index.addAll(fresh);
    this.articleCount += fresh.length;
    this.categoryCounts[category] = (this.categoryCounts[category] || 0) + fresh.length;
  }

  /**
   * Search the index with BM25 scoring and fuzzy matching.
   * @param {string} query - Search query
   * @param {object} [opts] - Options
   * @param {string} [opts.category] - Filter by category
   * @param {number} [opts.limit=20] - Max results
   * @returns {Array} Ranked results with score
   */
  search(query, { category, limit = 20 } = {}) {
    if (!query || !query.trim()) return [];
    let results = this.index.search(query, { fuzzy: 0.2, prefix: true });
    if (category) {
      results = results.filter(r => r.category === category);
    }
    return results.slice(0, limit).map(r => ({
      ...r,
      score: Math.round(r.score * 100) / 100,
    }));
  }

  /**
   * Get autocomplete suggestions for a partial query.
   * @param {string} query - Partial query
   * @returns {Array} Suggestion objects with text and score
   */
  suggest(query) {
    if (!query || !query.trim()) return [];
    return this.index.autoSuggest(query, { fuzzy: 0.2 });
  }

  /**
   * Serialize the index for persistence.
   * @returns {object} JSON-serializable index data
   */
  toJSON() {
    return {
      index: this.index.toJSON(),
      articleCount: this.articleCount,
      categoryCounts: this.categoryCounts,
    };
  }

  /**
   * Restore a serialized index.
   * @param {object} json - Data from toJSON()
   * @returns {SearchIndex} Restored instance
   */
  static fromJSON(json) {
    const si = new SearchIndex();
    si.index = MiniSearch.fromJSON(json.index);
    si.articleCount = json.articleCount || 0;
    si.categoryCounts = json.categoryCounts || {};
    return si;
  }

  /**
   * Clear the index and reset counts.
   */
  clear() {
    this.index = new MiniSearch({
      fields: ['title', 'description', 'content', 'source', 'category'],
      storeFields: ['title', 'description', 'url', 'image', 'source', 'publishedAt', 'category', 'id', 'clusterId', 'relatedCount'],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: { title: 3, description: 2, content: 1, source: 1, category: 1 },
      },
      idField: 'id',
    });
    this.articleCount = 0;
    this.categoryCounts = {};
  }
}
