import type { LedgerEntry } from './ledger';

/**
 * Layer C: links from a test or a block to a span of the prose. A link names the span by its ledger id and holds
 * the fingerprint the span had when a person last accepted the link; it holds no offset, because an offset breaks
 * with the first edit above it. Each scan classifies every link against the ledger before the edit and the ledger
 * after it. Only a link a mutation verified counts toward a claim, and the blast radius of an edit is the set of
 * owners with a suspect link.
 */

/** The part of a ledger the links read; the scan's `Ledger` and a view of it both fit. */
export type LinkedLedger = {
  entries: ReadonlyArray<
    Pick<LedgerEntry, 'id' | 'path' | 'fp' | 'ctxFp' | 'sectionPath' | 'status'> & {
      labels: Readonly<Record<string, { label: string }>>;
    }
  >;
};

export type Link = {
  /** The test or block that holds the link. */
  owner: string;
  /** The ledger id of the span. */
  span: string;
  /** The fingerprint of the span at the last accept. */
  fp: string;
  /** How the owner stands to the span, as the owner wrote it. */
  relation: string;
  /** `verified` once a mutation flipped the owner's test; anything else counts toward no claim. */
  createdBy: string;
  /** True once a person accepted the link at `fp`; after clearing, the reason. */
  accepted: boolean | string;
  /** Set by clearing. */
  reason?: string;
};

/**
 * - `ok`: the span's fingerprint matches.
 * - `suspect`: the span is changed, split, merged or deleted.
 * - `advisory`: only the context fingerprint or the heading path changed.
 * - `ambiguous`: the span's text now matches in several places where it matched in one.
 */
export type LinkState = 'ok' | 'suspect' | 'advisory' | 'ambiguous';

export const CLEAR_REASONS = ['cosmetic', 'semantic-still-covered', 'test-updated'] as const;
export type ClearReason = (typeof CLEAR_REASONS)[number];

const liveEntries = (ledger: LinkedLedger) => ledger.entries.filter((entry) => entry.status === 'live');

const byId = (ledger: LinkedLedger) => new Map(liveEntries(ledger).map((entry) => [entry.id, entry]));

/** A link to a live span of the ledger, with the span's fingerprint at this moment. */
export function createLink(
  ledger: LinkedLedger,
  owner: string,
  span: string,
  relation: string,
  createdBy = 'proposed',
): Link {
  const entry = byId(ledger).get(span);
  if (!entry) throw new RangeError(`the ledger holds no live span ${span}`);
  return { owner, span, fp: entry.fp, relation, createdBy, accepted: createdBy === 'verified' };
}

/** How many live units of a ledger have each fingerprint. */
function copies(ledger: LinkedLedger | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (!ledger) return counts;
  for (const entry of liveEntries(ledger)) counts.set(entry.fp, (counts.get(entry.fp) ?? 0) + 1);
  return counts;
}

/**
 * The state of each link against the ledger after an edit, in the order of the links. A state depends on the link
 * and the two ledgers only, never on the other links or their order.
 */
export function classifyLinks(
  previous: LinkedLedger | null,
  current: LinkedLedger,
  links: readonly Link[],
): LinkState[] {
  const now = byId(current);
  const before = previous ? byId(previous) : new Map<string, LinkedLedger['entries'][number]>();
  const nowCopies = copies(current);
  const beforeCopies = copies(previous);
  return links.map((link): LinkState => {
    const entry = now.get(link.span);
    if (!entry || entry.fp !== link.fp) return 'suspect';
    // The text now stands in several places where it stood in one: which copy the link meant is not known.
    if ((nowCopies.get(entry.fp) ?? 0) > 1 && (beforeCopies.get(entry.fp) ?? 0) <= 1) return 'ambiguous';
    const prior = before.get(link.span);
    if (
      prior &&
      (prior.ctxFp !== entry.ctxFp || prior.sectionPath.join('\0') !== entry.sectionPath.join('\0'))
    ) {
      return 'advisory';
    }
    return 'ok';
  });
}

/**
 * Clears a suspect link with one of the three reasons: the link then holds the span's current fingerprint and the
 * reason. Any other reason, and a span the ledger no longer holds, is refused and the link stays as it was.
 */
export function clearLink(
  link: Link,
  reason: string,
  current: LinkedLedger,
): { ok: true; link: Link } | { ok: false; error: string } {
  if (!(CLEAR_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: `a link is cleared with one of ${CLEAR_REASONS.join(', ')}, not "${reason}"` };
  }
  const entry = byId(current).get(link.span);
  if (!entry)
    return { ok: false, error: `the ledger holds no live span ${link.span}: delete the link or re-point it` };
  return { ok: true, link: { ...link, fp: entry.fp, accepted: reason, reason } };
}

/** A link becomes verified only when a mutation of its span (a delete or a negation) flipped the owner's test. */
export function verifyLink(link: Link, evidence: { mutation: 'delete' | 'negate'; flipped: boolean }): Link {
  return evidence.flipped ? { ...link, createdBy: 'verified' } : link;
}

/**
 * The spans a claim is made over and the ones it covers. A span is mapped when one of its labels is a label the
 * caller names (the labels that build an atom); it is covered when a verified link names it at its current
 * fingerprint.
 */
export function linkCoverage(
  current: LinkedLedger,
  mappedLabels: readonly string[],
  links: readonly Link[],
): { uncovered: string[]; covered: number } {
  const mapped = new Set(mappedLabels);
  const verified = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.createdBy !== 'verified') continue;
    const fps = verified.get(link.span) ?? new Set<string>();
    fps.add(link.fp);
    verified.set(link.span, fps);
  }
  const uncovered: string[] = [];
  let covered = 0;
  for (const entry of liveEntries(current)) {
    if (!Object.values(entry.labels).some((label) => mapped.has(label.label))) continue;
    if (verified.get(entry.id)?.has(entry.fp)) covered++;
    else uncovered.push(entry.id);
  }
  return { uncovered: uncovered.sort(), covered };
}

const sorted = (owners: Iterable<string>): string[] => [...new Set(owners)].sort();

/**
 * The owners to rerun after an edit: those with a suspect link. Reported apart, the advisory set: the owners of
 * links the edit left advisory, and the owners of links to other spans of the sections where a span went suspect,
 * which a precise link can hide ("except as described above"). Both lists are sorted and hold no duplicate.
 */
export function blastRadius(
  previous: LinkedLedger | null,
  current: LinkedLedger,
  links: readonly Link[],
): { rerun: string[]; advisory: string[] } {
  const states = classifyLinks(previous, current, links);
  const placeOf = new Map<string, string>();
  for (const ledger of [previous, current]) {
    if (!ledger) continue;
    for (const entry of ledger.entries)
      placeOf.set(entry.id, `${entry.path}\0${entry.sectionPath.join('\0')}`);
  }
  // A span that is gone from the ledger keeps its place from the ledger before the edit.
  const rerun = new Set<string>();
  const changedPlaces = new Set<string>();
  const advisory = new Set<string>();
  for (const [at, link] of links.entries()) {
    if (states[at] === 'suspect') {
      rerun.add(link.owner);
      const place = placeOf.get(link.span);
      if (place !== undefined) changedPlaces.add(place);
    } else if (states[at] === 'advisory' || states[at] === 'ambiguous') advisory.add(link.owner);
  }
  for (const link of links) {
    const place = placeOf.get(link.span);
    if (place !== undefined && changedPlaces.has(place)) advisory.add(link.owner);
  }
  return { rerun: sorted(rerun), advisory: sorted(advisory) };
}
