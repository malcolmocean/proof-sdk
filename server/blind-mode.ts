/**
 * Blind review mode.
 *
 * When a document has blind_mode enabled and has not been revealed, review
 * marks (comments, suggestions, flags, approvals) are only returned to the
 * viewer that authored them. The document owner sees everything. Flipping
 * the reveal switch (revealed_at) makes all marks visible to everyone.
 *
 * This is a workflow feature for independent review, not a security
 * boundary: live collab still syncs the full marks map to browser clients,
 * which filter at render time.
 */

import { BLIND_REVIEW_MARK_KINDS, sameBlindActor } from '../src/shared/blind-review.js';

export interface BlindModeDocState {
  blind_mode?: number | null;
  revealed_at?: string | null;
}

export interface BlindViewer {
  /** Actor string as presented by the caller, e.g. "human:alice" or "ai:claude". */
  actor: string | null;
  /** Owners (admins) see all marks pre-reveal. */
  isOwner: boolean;
}

export function isBlindActive(doc: BlindModeDocState | undefined | null): boolean {
  if (!doc) return false;
  return Boolean(doc.blind_mode) && !doc.revealed_at;
}

function isHiddenFromViewer(
  mark: { kind?: string; by?: string } | undefined | null,
  viewer: BlindViewer,
): boolean {
  if (viewer.isOwner) return false;
  if (!mark || typeof mark !== 'object') return false;
  const kind = typeof mark.kind === 'string' ? mark.kind : 'comment';
  if (!BLIND_REVIEW_MARK_KINDS.has(kind)) return false;
  return !sameBlindActor(mark.by, viewer.actor);
}

/**
 * Filter a marks map (markId -> StoredMark) down to what the viewer may see.
 * Returns the input object unchanged when blind mode is not active.
 */
export function filterMarksForViewer<T extends Record<string, { kind?: string; by?: string }>>(
  marks: T,
  doc: BlindModeDocState | undefined | null,
  viewer: BlindViewer,
): T {
  if (!isBlindActive(doc) || viewer.isOwner) return marks;
  if (!marks || typeof marks !== 'object') return marks;
  const filtered: Record<string, { kind?: string; by?: string }> = {};
  for (const [id, mark] of Object.entries(marks)) {
    if (!isHiddenFromViewer(mark, viewer)) filtered[id] = mark;
  }
  return filtered as T;
}

/**
 * Filter a document-event list so pre-reveal viewers don't learn other
 * reviewers' comment/suggestion contents through the event feed.
 */
export function filterEventsForViewer<T extends { event_type?: string; type?: string; event_data?: unknown; data?: unknown }>(
  events: T[],
  doc: BlindModeDocState | undefined | null,
  viewer: BlindViewer,
): T[] {
  if (!isBlindActive(doc) || viewer.isOwner) return events;
  return events.filter((event) => {
    const type = event.event_type ?? event.type ?? '';
    if (!/^(comment|suggestion|mark)\./.test(String(type))) return true;
    const data = (event.event_data ?? event.data) as { by?: string } | string | null | undefined;
    let by: string | undefined;
    if (typeof data === 'string') {
      try {
        by = (JSON.parse(data) as { by?: string })?.by;
      } catch {
        by = undefined;
      }
    } else if (data && typeof data === 'object') {
      by = data.by;
    }
    // Events without attributable authorship stay hidden pre-reveal.
    return sameBlindActor(by, viewer.actor);
  });
}

/**
 * Protect hidden marks from bulk writes. A writer replacing the whole marks
 * map can only affect marks it is allowed to see; hidden marks are carried
 * over from the existing map untouched.
 */
export function preserveHiddenMarks<T extends Record<string, { kind?: string; by?: string }>>(
  incoming: T,
  existing: Record<string, { kind?: string; by?: string }> | null | undefined,
  doc: BlindModeDocState | undefined | null,
  viewer: BlindViewer,
): T {
  if (!isBlindActive(doc) || viewer.isOwner) return incoming;
  if (!existing || typeof existing !== 'object') return incoming;
  const merged: Record<string, { kind?: string; by?: string }> = { ...(incoming ?? {}) };
  for (const [id, mark] of Object.entries(existing)) {
    if (isHiddenFromViewer(mark, viewer)) merged[id] = mark;
  }
  return merged as T;
}
