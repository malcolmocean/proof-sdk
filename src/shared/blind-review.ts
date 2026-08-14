/**
 * Blind review mode — shared identity/visibility rules.
 *
 * Used by the server (REST read filtering) and the editor (render-time
 * filtering). When a document is in blind mode and not yet revealed, review
 * marks are only visible to their author and to the document owner.
 *
 * Render-time filtering on the client is a UX affordance, not a security
 * boundary: live collab still syncs the full marks map. The reviewers this
 * feature targets are trusted collaborators who shouldn't be *shown* each
 * other's comments before the reveal, not adversaries.
 */

/** Mark kinds that carry review feedback and are hidden pre-reveal. */
export const BLIND_REVIEW_MARK_KINDS: ReadonlySet<string> = new Set([
  'comment',
  'flagged',
  'approved',
  'insert',
  'delete',
  'replace',
]);

/**
 * Normalize an actor string for identity comparison. The "human:"/"ai:"
 * prefix is informational, so "ai:claude", "claude", and "Claude" all
 * refer to the same reviewer.
 */
export function normalizeBlindActor(actor: string | null | undefined): string | null {
  if (typeof actor !== 'string') return null;
  const trimmed = actor.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^(human|ai):/, '');
}

export function sameBlindActor(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBlindActor(a);
  const nb = normalizeBlindActor(b);
  return na !== null && nb !== null && na === nb;
}

// ---------------------------------------------------------------------------
// Client-side viewer state (unused on the server)
// ---------------------------------------------------------------------------

export interface BlindReviewState {
  blindMode: boolean;
  revealedAt: string | null;
  isOwner: boolean;
}

let clientState: BlindReviewState = {
  blindMode: false,
  revealedAt: null,
  isOwner: false,
};

export function setBlindReviewState(next: Partial<BlindReviewState>): BlindReviewState {
  clientState = { ...clientState, ...next };
  return clientState;
}

export function getBlindReviewState(): BlindReviewState {
  return clientState;
}

/** True when this client should be hiding other reviewers' marks. */
export function isBlindHidingActive(): boolean {
  return clientState.blindMode && !clientState.revealedAt && !clientState.isOwner;
}

/** Render-time check: should this mark be hidden from the current viewer? */
export function isMarkHiddenByBlindReview(
  kind: string | undefined,
  by: string | undefined,
  viewerActor: string,
): boolean {
  if (!isBlindHidingActive()) return false;
  if (!BLIND_REVIEW_MARK_KINDS.has(kind ?? 'comment')) return false;
  return !sameBlindActor(by, viewerActor);
}
