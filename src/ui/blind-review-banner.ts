/**
 * Blind review banner.
 *
 * Shown on documents with blind mode enabled. Tells reviewers that other
 * people's comments are hidden until the reveal, gives the owner a
 * "Reveal all comments" button, and offers a refresh when the reveal
 * happens while the page is open.
 */

import { getBlindReviewState, isBlindHidingActive } from '../shared/blind-review';

const BANNER_ID = 'blind-review-banner';

interface BlindReviewBannerOptions {
  getSlug: () => string | null;
  getAuthHeaders: () => Record<string, string>;
}

function bannerElement(): HTMLElement {
  let banner = document.getElementById(BANNER_ID);
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:1000',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:8px 16px',
    'border-radius:8px',
    'background:var(--color-surface-raised, #1f2733)',
    'color:var(--color-text, #e8edf4)',
    'border:1px solid var(--color-border, #3a4656)',
    'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
    'font-size:13px',
    'max-width:min(92vw, 640px)',
  ].join(';');
  document.body.appendChild(banner);
  return banner;
}

function renderButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.style.cssText = [
    'padding:4px 12px',
    'border-radius:6px',
    'border:1px solid var(--color-border, #3a4656)',
    'background:var(--color-accent, #3b82f6)',
    'color:#fff',
    'cursor:pointer',
    'font-size:13px',
    'white-space:nowrap',
  ].join(';');
  button.addEventListener('click', onClick);
  return button;
}

export function initBlindReviewBanner(options: BlindReviewBannerOptions): void {
  // Marks were rendered under the blind-mode rules in effect at page load, so
  // if the mode flips while the page is open, the safe move is a refresh.
  const blindModeAtLoad = getBlindReviewState().blindMode;

  const render = (): void => {
    const current = getBlindReviewState();

    if (current.blindMode !== blindModeAtLoad) {
      const banner = bannerElement();
      banner.replaceChildren();
      const message = document.createElement('span');
      message.textContent = current.blindMode
        ? 'The owner turned on blind review — refresh to hide other reviewers’ comments.'
        : 'The owner turned off blind review — refresh to see all comments.';
      banner.append(message, renderButton('Refresh', () => window.location.reload()));
      return;
    }

    if (!current.blindMode) {
      document.getElementById(BANNER_ID)?.remove();
      return;
    }

    const banner = bannerElement();
    banner.replaceChildren();

    const message = document.createElement('span');
    if (current.revealedAt) {
      message.textContent = 'Comments have been revealed — everyone can now see all comments.';
      banner.append(message, renderButton('Refresh', () => window.location.reload()));
      return;
    }

    if (current.isOwner) {
      message.textContent = 'Blind review: reviewers only see their own comments. You see everything.';
      banner.append(message, renderButton('Reveal all comments', () => {
        void revealComments();
      }));
    } else {
      message.textContent = 'Blind review: other reviewers’ comments are hidden until the owner reveals them.';
      banner.append(message);
    }
  };

  const revealComments = async (): Promise<void> => {
    const slug = options.getSlug();
    if (!slug) return;
    try {
      const response = await fetch(`/api/documents/${slug}/reveal`, {
        method: 'POST',
        headers: {
          ...options.getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        console.error('[blind-review] reveal failed', response.status, body);
        return;
      }
      window.location.reload();
    } catch (error) {
      console.error('[blind-review] reveal request failed', error);
    }
  };

  window.addEventListener('proof:blind-review-revealed', render);
  window.addEventListener('proof:blind-review-changed', render);
  render();
}
