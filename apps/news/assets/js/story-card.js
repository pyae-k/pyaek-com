// Story card component with expandable related articles
import { extractDomain, timeAgo } from './api.js';
import { searchArticles } from './api.js';
import { getSourceMeta } from './sources.js';

export function createStoryCard(article, isExpanded, onToggle) {
  const card = document.createElement('article');
  card.className = 'story-card';
  card.setAttribute('role', 'article');
  card.setAttribute('tabindex', '0');
  card.dataset.id = article.id;

  const domain = extractDomain(article.url);
  const src = getSourceMeta(article);
  const sourceBadge = `<span class="story-card-source-badge" style="background:${src.color}">${src.label}</span>`;
  const relatedBadge = article.relatedCount > 0
    ? `<span class="story-card-related-badge">${article.relatedCount} related</span>`
    : '';

  card.innerHTML = `
    <div class="story-card-header">
      ${article.image ? `<img class="story-card-thumbnail" src="${article.image}" alt="" loading="lazy" width="80" height="60" onerror="this.style.display='none'">` : ''}
      <div>
        <h2 class="story-card-title"><a href="${article.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h2>
        ${article.description ? `<p class="story-card-description">${escapeHtml(article.description)}</p>` : ''}
        <div class="story-card-meta">
          ${sourceBadge}
          <span class="story-card-source">${escapeHtml(article.source)}</span>
          <span>${timeAgo(article.publishedAt)}</span>
          ${domain ? `<span class="story-card-domain">${domain}</span>` : ''}
          ${relatedBadge}
        </div>
      </div>
    </div>
    ${isExpanded ? `<div class="story-card-expanded" id="expanded-${article.id}"><div class="timeline-loading">Loading related articles...</div></div>` : ''}
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    onToggle(article.id);
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(article.id);
    }
  });

  return card;
}

/**
 * Render the expanded content of a story card.
 * Prefers cluster-related articles (same story from other outlets); falls back
 * to the in-memory search index, then a network search.
 * @param {HTMLElement} container
 * @param {object} article - Primary article
 * @param {object} searchIndex - SearchIndex instance (may be null)
 * @param {Array} [allArticles] - All primaries across categories (for clusterId lookup)
 */
export async function renderExpandedContent(container, article, searchIndex, allArticles = []) {
  container.innerHTML = '<div class="timeline-loading">Loading related articles...</div>';

  let html = '';

  // 1. Cluster related (preferred): same story from other outlets
  let related = article.related || [];
  if (!related.length && article.clusterId && allArticles.length) {
    const primary = allArticles.find(a => a.clusterId === article.clusterId);
    if (primary && primary.related) related = primary.related;
  }

  if (related.length) {
    html = `
      <div class="timeline-section">
        <h3>Related articles</h3>
        <div class="related-articles-list">
          ${related.slice(0, 5).map(item => {
            const meta = getSourceMeta(item);
            return `
              <div class="related-article-item">
                <span class="story-card-source-badge" style="background:${meta.color}">${meta.label}</span>
                <a class="related-article-title" href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
                <span class="related-article-time">${timeAgo(item.publishedAt)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // 2. Fallback: search index / network search
  if (!html) {
    const keywords = (article.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    const query = keywords.join(' ');

    // Try in-memory search index first (fast, no network)
    if (query && searchIndex && searchIndex.articleCount > 0) {
      try {
        const related = searchIndex.search(query, { limit: 10 });
        if (related && related.length) {
          html = `
            <div class="timeline-section">
              <h3>Related articles</h3>
              ${related.filter(r => r.id !== article.id).slice(0, 5).map(item => `
                <div class="timeline-item">
                  <span class="timeline-item-time">${timeAgo(item.publishedAt)}</span>
                  <a class="timeline-item-title" href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
                  <span class="story-card-source">${escapeHtml(item.source)}</span>
                </div>
              `).join('')}
            </div>
          `;
        }
      } catch { /* search failed */ }
    }

    // Fallback: try network-based search
    if (!html && query) {
      try {
        const related = await searchArticles(query, 10);
        if (related && related.length) {
          html = `
            <div class="timeline-section">
              <h3>Related articles</h3>
              ${related.filter(r => r.id !== article.id).slice(0, 5).map(item => `
                <div class="timeline-item">
                  <span class="timeline-item-time">${timeAgo(item.publishedAt)}</span>
                  <a class="timeline-item-title" href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
                  <span class="story-card-source">${escapeHtml(item.source)}</span>
                </div>
              `).join('')}
            </div>
          `;
        }
      } catch { /* fallback failed */ }
    }
  }

  if (!html) {
    html = '<div class="timeline-section"><p class="timeline-loading">No related articles found.</p></div>';
  }

  container.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
