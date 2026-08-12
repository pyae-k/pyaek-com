// Trending engine — accurate keyword/phrase extraction with 0-100 scoring
// Replaces the old extractKeywords in api.js. Operates on cluster-deduped
// articles (primaries) so duplicate stories don't inflate counts.
//
// Strategy:
//   - Extract unigrams + bigrams + trigrams, weighting title words over description.
//   - Filter by minimum document/source frequency to drop one-off noise.
//   - Prefer multi-word collocations via PMI so "artificial intelligence"
//     ranks as a phrase instead of two generic words.
//   - Score 0-100: frequency (log) + recency decay + cross-source + cross-category
//     + title boost + proper-noun boost + phrase bonus.

// ─── Stop words ───────────────────────────────────────────────────────────────
// Base set from the old api.js plus news-generic words that add no signal.

export const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','it','as','be','has','have','are','was','were','been','this','that','these','those',
  'we','you','they','he','she','i','not','no','will','can','all','its','our','their',
  'what','which','who','how','when','where','why','do','does','did','about','up','out',
  'if','so','just','also','more','new','after','over','into','than','then','now','get',
  'got','make','made','use','used','using','being','had','here','there','very',
  'your','some','such','only','own','same','too','say','says','said','see','seen','know',
  'like','look','first','last','back','well','way','even','still','much','many','most',
  'one','two','three','year','years','time','world','people','day','days','week','months',
  'old','ago','since','before','while','going','come','came','take','took','think','thought',
  'could','would','should','may','might','yet','every',
  'long','high','low','big','small','top','set','next','best','due','per','via',
  // News-generic words — no trending signal
  'report','reports','reported','reporting','update','updates','updated','breaking',
  'watch','video','analysis','explained','explain','live','officials','according',
  'amid','during','against','between','under','within','without','across','through',
  'around','despite','except','inside','outside','past','throughout','toward','towards',
  'upon','including','among','amongst','plus','minus','further','once','again',
  'us','uk','u.s','u.k','s','t','d','ll','m','re','ve','y',
  'don','ain','aren','couldn','didn','doesn','hadn','hasn','haven','isn','ma',
  'mightn','mustn','needn','shan','shouldn','wasn','weren','won','wouldn',
]);

// ─── Tokenization ────────────────────────────────────────────────────────────

/**
 * Split text into significant lowercase tokens (stopwords and ≤2-char tokens dropped).
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extract sliding n-grams from a token array.
 * @param {string[]} words
 * @param {number} n
 * @returns {string[]}
 */
export function extractNgrams(words, n) {
  const grams = [];
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(' '));
  }
  return grams;
}

/**
 * Pointwise mutual information with add-1 smoothing.
 * Positive values mean the words co-occur more than chance.
 * @param {string} gram - Space-joined phrase
 * @param {Object} gramData - { gram: { count } }
 * @param {number} totalDocs
 * @returns {number}
 */
export function computePMI(gram, gramData, totalDocs) {
  const parts = gram.split(' ');
  const gramCount = (gramData[gram] && gramData[gram].count) || 0;
  const pGram = (gramCount + 1) / (totalDocs + 1);
  let pParts = 1;
  for (const part of parts) {
    const partCount = (gramData[part] && gramData[part].count) || 0;
    pParts *= (partCount + 1) / (totalDocs + 1);
  }
  return Math.log(pGram / pParts);
}

// ─── Keyword extraction ──────────────────────────────────────────────────────

/**
 * Extract trending keywords/phrases with a 0-100 score.
 * @param {Array} articles - Cluster-deduped articles with title, description, sourceName, publishedAt, optional _category
 * @returns {Array<{word: string, count: number, sources: string[], categories: string[], score: number}>} Top 20
 */
export function extractKeywords(articles) {
  const totalDocs = articles.length || 1;
  const gramData = {}; // { gram: { count, docCount, sources:Set, categories:Set, titleDocs, properNounHits, timestamps:[] } }

  articles.forEach((a) => {
    if (!a.title) return;
    const titleTokens = tokenize(a.title);
    const descTokens = tokenize(a.description || '');

    // Proper-noun heuristic: capitalized words in the original title, not the
    // first word (sentence-initial capitalization is not a signal).
    const origTitleWords = (a.title || '').split(/\s+/);
    const properNouns = new Set();
    origTitleWords.forEach((w, i) => {
      if (i === 0) return;
      const clean = w.replace(/[^a-zA-Z]/g, '');
      if (clean.length > 2 && clean[0] === clean[0].toUpperCase() && clean[0] !== clean[0].toLowerCase()) {
        properNouns.add(clean.toLowerCase());
      }
    });

    const seen = new Set();      // per-doc dedup for docCount
    const seenTitle = new Set(); // per-doc dedup for titleDocs

    const addGram = (gram, isTitle) => {
      if (!gramData[gram]) {
        gramData[gram] = {
          count: 0, docCount: 0, sources: new Set(), categories: new Set(),
          titleDocs: 0, properNounHits: 0, timestamps: [],
        };
      }
      const d = gramData[gram];
      d.count++;
      if (a.sourceName) d.sources.add(a.sourceName);
      if (a._category) d.categories.add(a._category);
      if (a.publishedAt) {
        const ts = Date.parse(a.publishedAt);
        if (ts) d.timestamps.push(ts);
      }
      if (isTitle && !seenTitle.has(gram)) {
        seenTitle.add(gram);
        d.titleDocs++;
      }
      if (!seen.has(gram)) {
        seen.add(gram);
        d.docCount++;
      }
      if (gram.split(' ').some(w => properNouns.has(w))) d.properNounHits++;
    };

    // Title words weigh more (weight 3 vs 1) — implemented by counting title
    // grams once each plus description grams once each; titleDocs drives the
    // title boost in scoring.
    titleTokens.forEach(w => addGram(w, true));
    descTokens.forEach(w => addGram(w, false));
    extractNgrams(titleTokens, 2).forEach(g => addGram(g, true));
    extractNgrams(titleTokens, 3).forEach(g => addGram(g, true));
  });

  // Filter: min document/source frequency; drop stopword unigrams and phrases
  // containing a stopword component.
  const entries = Object.entries(gramData).filter(([gram, d]) => {
    if (d.docCount < 2 && d.sources.size < 2) return false;
    const words = gram.split(' ');
    if (words.length === 1) {
      if (STOP_WORDS.has(gram) || gram.length <= 2) return false;
    } else if (words.some(w => STOP_WORDS.has(w))) {
      return false;
    }
    return true;
  });

  if (!entries.length) return [];

  // PMI phrase preference: keep collocations that co-occur more than chance.
  const gramMap = Object.fromEntries(entries);
  const keptPhrases = new Set();
  entries.forEach(([gram, d]) => {
    const words = gram.split(' ');
    if (words.length < 2 || d.count < 2) return;
    const pmi = computePMI(gram, gramMap, totalDocs);
    const threshold = words.length === 2 ? 1.5 : 2.0;
    if (pmi >= threshold) keptPhrases.add(gram);
  });

  // Suppress a unigram that is a component of a kept phrase when its standalone
  // count is not much higher than the phrase count ("intelligence" alone still
  // survives if it appears elsewhere on its own).
  const suppressed = new Set();
  entries.forEach(([gram, d]) => {
    if (gram.includes(' ')) return;
    for (const phrase of keptPhrases) {
      if (phrase.split(' ').includes(gram) && d.count <= 1.5 * (gramMap[phrase].count || 0)) {
        suppressed.add(gram);
        break;
      }
    }
  });

  const maxCount = Math.max(...entries.map(([, d]) => d.count), 1);
  const now = Date.now();

  return entries
    .filter(([gram]) => !suppressed.has(gram))
    .map(([gram, d]) => {
      // Frequency (0-30): log-scaled, normalized by max count
      const frequencyScore = 30 * Math.log(1 + d.count) / Math.log(1 + maxCount);

      // Recency (0-25): decays over ~3 days
      let recencyScore = 0;
      if (d.timestamps.length > 0) {
        const avgAge = d.timestamps.reduce((s, t) => s + (now - t), 0) / d.timestamps.length;
        const avgAgeHours = avgAge / (1000 * 60 * 60);
        recencyScore = 25 * Math.max(0, 1 - avgAgeHours / 72);
      }

      // Cross-source (0-20): 5 per distinct source
      const crossSourceScore = Math.min(20, d.sources.size * 5);

      // Cross-category (0-15): 3 per distinct category
      const crossCategoryScore = Math.min(15, d.categories.size * 3);

      // Title boost (0-10): share of docs where the gram appeared in the title
      const titleBoost = 10 * (d.titleDocs / Math.max(1, d.docCount));

      // Proper-noun boost (0-5): entities (people, places, orgs) trend harder
      const properNounBoost = Math.min(5, d.properNounHits);

      // Phrase bonus: multi-word topics are more specific than single words
      const phraseBonus = gram.includes(' ') ? 5 : 0;

      const totalScore = Math.round(
        frequencyScore + recencyScore + crossSourceScore + crossCategoryScore +
        titleBoost + properNounBoost + phraseBonus
      );

      return {
        word: gram,
        count: d.count,
        sources: Array.from(d.sources),
        categories: Array.from(d.categories),
        score: Math.min(totalScore, 100),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Extract trending topics per category and globally.
 * @param {object} articlesByCategory - { category: [articles] }
 * @returns {{ global: Array, byCategory: object }}
 */
export function extractTrendingByCategory(articlesByCategory) {
  const byCategory = {};
  const allArticles = [];

  for (const [category, articles] of Object.entries(articlesByCategory)) {
    if (!articles || !articles.length) continue;
    byCategory[category] = extractKeywords(articles.map(a => ({ ...a, _category: category })));
    allArticles.push(...articles.map(a => ({ ...a, _category: category })));
  }

  // Global trending: dedup across categories by clusterId (or id) so the same
  // story primary in two categories isn't double-counted.
  const seen = new Set();
  const deduped = allArticles.filter(a => {
    const key = a.clusterId || a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const globalKeywords = extractKeywords(deduped);
  const global = globalKeywords.map(kw => {
    const categories = new Set(kw.categories || []);
    deduped.forEach(a => {
      if ((a.title || '').toLowerCase().includes(kw.word)) {
        categories.add(a._category || 'world');
      }
    });
    return { ...kw, categories: [...categories] };
  });

  return { global, byCategory };
}
