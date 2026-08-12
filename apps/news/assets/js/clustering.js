// Story clustering — deduplicate and group articles covering the same story.
// Replaces the exact-URL dedup in sources.js. Each cluster yields one primary
// article (shown in the feed) plus related articles (shown on expand).
//
// Two signals:
//   1. Exact normalized URL (catches tracking-param / www / protocol variants).
//   2. Title similarity (catches the same story from different outlets).
// Title comparison is bucketed by the top-2 significant words to avoid O(n²).

import { STOP_WORDS } from './trending-engine.js';

// ─── Tracking params ─────────────────────────────────────────────────────────
// Query params that identify the same article but differ across share links.
// Anything not in the allowlist is dropped during URL normalization.

export const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'yclid', 'twclid', 'gbraid', 'wbraid',
  'ref', 'ref_src', 'ref_url', 'source', 'src', 's_cid', 'scid', 'cid', 'ncid', 'smid',
  'cmpid', 'ocid', 'mc_cid', 'mc_eid', 'igshid', 'mkt_tok', 'spm', 'from',
  'oly_enc_id', 'oly_anon_id', 'vero_conv', 'vero_id', 'wickedid',
  'wt_mc', 'wt_zmc', 'wt_zs', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp',
]);

// Params that carry real article identity and are kept.
const KEEP_PARAMS = new Set(['id', 'p', 'article_id', 'story', 'slug', 'v', 'q']);

// Site-name suffixes stripped from titles before comparison.
const SITE_SUFFIX_RE = /\s*[|\-–—:]\s*(BBC News|Reuters|The Guardian|The Verge|TechCrunch|Ars Technica|Al Jazeera|ESPN|NPR|ScienceDaily|CoinDesk|Billboard|CNN|AP|AFP|Bloomberg|CNBC|The New York Times|The Washington Post|The Independent|The Telegraph|Sky News|Fox News|NBC News|ABC News|CBS News|USA Today|Business Insider|Forbes|Fortune|Wired|Engadget|Gizmodo|Mashable|The Hill|Politico|Axios|Vox|Slate|Salon|HuffPost|BuzzFeed|Daily Mail|The Sun|Metro|Mirror|Express|Time|Newsweek|The Economist|Financial Times|Wall Street Journal|Yahoo News|Google News|Microsoft News|Apple News)\s*$/i;

// ─── URL normalization ──────────────────────────────────────────────────────

/**
 * Canonicalize a URL: strip tracking params, fragment, www, protocol, trailing slash.
 * @param {string} url
 * @returns {string} Canonical key (empty string on failure)
 */
export function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = new URLSearchParams();
    for (const [key, value] of u.searchParams) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || k.startsWith('utm_') || k.startsWith('pk_') || k.startsWith('wt_') || k.startsWith('share')) continue;
      if (KEEP_PARAMS.has(k)) params.set(k, value);
    }
    u.search = params.toString();
    return u.toString().replace(/\/$/, '').replace(/^https?:\/\//, '');
  } catch {
    // Fallback: same key logic as the old deduplicateArticles
    return url.toLowerCase().replace(/\/$/, '').replace(/^https?:\/\//, '');
  }
}

// ─── Title normalization ─────────────────────────────────────────────────────

/**
 * Normalize a title for comparison: strip site-name suffix, lowercase, drop
 * punctuation, stopwords, and ≤2-char tokens.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  if (!title) return '';
  return title
    .replace(SITE_SUFFIX_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .join(' ');
}

/**
 * Tokenize a title into significant words (for Jaccard/Dice + hash buckets).
 * @param {string} title
 * @returns {string[]}
 */
export function tokenizeTitle(title) {
  if (!title) return [];
  return title
    .replace(SITE_SUFFIX_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ─── Similarity ──────────────────────────────────────────────────────────────

function similarTitles(nt1, w1, nt2, w2) {
  if (!nt1 || !nt2) return false;
  if (nt1 === nt2) return true;
  // Substring containment: the shorter side must be a real phrase (≥3 words, ≥4 chars)
  const [short, long] = nt1.length <= nt2.length ? [nt1, nt2] : [nt2, nt1];
  if (short.length >= 4 && short.split(' ').length >= 3 && long.includes(short)) return true;
  // Dice coefficient on word sets
  const set1 = new Set(w1);
  const set2 = new Set(w2);
  if (!set1.size || !set2.size) return false;
  let inter = 0;
  for (const w of set1) if (set2.has(w)) inter++;
  return (2 * inter) / (set1.size + set2.size) >= 0.6;
}

// ─── Clustering ─────────────────────────────────────────────────────────────

/**
 * Group articles into story clusters. Returns one primary article per cluster
 * with `clusterId`, `related[]`, and `relatedCount` attached.
 * @param {Array} articles - Normalized articles
 * @param {object} [options]
 * @param {string[]} [options.priority] - Source names, earlier = kept as primary on ties
 * @returns {Array} Primary articles (cluster-deduped)
 */
export function clusterArticles(articles, options = {}) {
  const priority = options.priority || [];
  if (!articles || !articles.length) return [];

  const items = articles.map(a => ({
    article: a,
    nurl: normalizeUrl(a.url),
    ntitle: normalizeTitle(a.title),
    words: tokenizeTitle(a.title),
  }));

  const clusters = []; // { members: [item] }
  const assigned = new Set();

  // 1. Exact-URL groups
  const urlGroups = new Map();
  items.forEach(item => {
    if (!item.nurl) return;
    if (!urlGroups.has(item.nurl)) urlGroups.set(item.nurl, []);
    urlGroups.get(item.nurl).push(item);
  });
  urlGroups.forEach(group => {
    clusters.push({ members: group });
    group.forEach(item => assigned.add(item));
  });

  // 2. Hash-bucket pre-filter for unassigned items (empty nurl)
  const buckets = new Map();
  items.forEach(item => {
    if (assigned.has(item)) return;
    if (item.words.length < 2) return; // too few words to cluster safely
    const key = item.words.slice(0, 2).sort().join(' ');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  // 3. Greedy merge within buckets
  buckets.forEach(bucketItems => {
    bucketItems.forEach(item => {
      let merged = false;
      for (const cluster of clusters) {
        const rep = cluster.members[0];
        if (rep && similarTitles(rep.ntitle, rep.words, item.ntitle, item.words)) {
          cluster.members.push(item);
          merged = true;
          break;
        }
      }
      if (!merged) {
        clusters.push({ members: [item] });
      }
    });
  });

  // 4. Merge title-similar clusters (same story from different URLs/outlets)
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i].members[0];
        const b = clusters[j].members[0];
        if (a && b && similarTitles(a.ntitle, a.words, b.ntitle, b.words)) {
          clusters[i].members.push(...clusters[j].members);
          clusters.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  // 5. Select primary per cluster (priority → recency → completeness)
  return clusters.map((cluster, i) => {
    const members = cluster.members.slice().sort((a, b) => {
      const pa = priority.indexOf(a.article.sourceName);
      const pb = priority.indexOf(b.article.sourceName);
      const ra = pa < 0 ? 999 : pa;
      const rb = pb < 0 ? 999 : pb;
      if (ra !== rb) return ra - rb;
      const ta = Date.parse(a.article.publishedAt) || 0;
      const tb = Date.parse(b.article.publishedAt) || 0;
      if (tb !== ta) return tb - ta;
      const ca = (a.article.image ? 1 : 0) + (a.article.description ? 1 : 0);
      const cb = (b.article.image ? 1 : 0) + (b.article.description ? 1 : 0);
      return cb - ca;
    });
    const primary = members[0].article;
    const related = members.slice(1).map(m => m.article);
    return {
      ...primary,
      clusterId: 'c' + i,
      related,
      relatedCount: related.length,
    };
  });
}
