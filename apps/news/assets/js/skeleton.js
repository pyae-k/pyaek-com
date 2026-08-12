// Skeleton loading placeholders — renders CSS shimmer cards matching existing .skeleton-card classes

/**
 * Render skeleton placeholder cards in a container.
 * @param {HTMLElement} container - The element to append skeletons to
 * @param {number} count - Number of skeleton cards to render (default 5)
 */
export function renderSkeletonCards(container, count = 5) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = `
      <div class="skeleton-card-thumbnail skeleton-pulse"></div>
      <div class="skeleton-card-content">
        <div class="skeleton-card-title skeleton-pulse"></div>
        <div class="skeleton-card-description skeleton-pulse"></div>
        <div class="skeleton-card-meta skeleton-pulse"></div>
      </div>
    `;
    container.appendChild(card);
  }
}

/**
 * Remove all skeleton placeholder cards from a container.
 * @param {HTMLElement} container - The element to clear skeletons from
 */
export function removeSkeletons(container) {
  const skeletons = container.querySelectorAll('.skeleton-card');
  skeletons.forEach(el => el.remove());
}
