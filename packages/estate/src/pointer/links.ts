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
      /** What the scans decided for the unit; a last event `ambiguous` marks a text that matched in several places. */
      lineage?: ReadonlyArray<{ event: string }>;
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
  /** The fingerprint of the neighbours of the span, and its heading path, at the last accept. */
  ctxFp?: string;
  sectionPath?: string[];
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
  return {
    owner,
    span,
    fp: entry.fp,
    ctxFp: entry.ctxFp,
    sectionPath: [...entry.sectionPath],
    relation,
    createdBy,
    accepted: createdBy === 'verified',
  };
}

/**
 * The state of each link against the ledger after an edit, in the order of the links. A state depends on the link
 * and the ledger only, never on the other links or their order; `previous` serves a link that holds no context of
 * its own, which then takes the context of the ledger before the edit.
 */
export function classifyLinks(
  previous: LinkedLedger | null,
  current: LinkedLedger,
  links: readonly Link[],
): LinkState[] {
  const now = new Map(current.entries.map((entry) => [entry.id, entry]));
  const before = previous ? byId(previous) : new Map<string, LinkedLedger['entries'][number]>();
  return links.map((link): LinkState => {
    const entry = now.get(link.span);
    if (!entry || entry.status !== 'live' || entry.fp !== link.fp) return 'suspect';
    if (entry.lineage?.at(-1)?.event === 'ambiguous') return 'ambiguous';
    const prior = before.get(link.span);
    const ctxFp = link.ctxFp ?? prior?.ctxFp;
    const sectionPath = link.sectionPath ?? prior?.sectionPath;
    if (
      (ctxFp !== undefined && ctxFp !== entry.ctxFp) ||
      (sectionPath !== undefined && sectionPath.join('\0') !== entry.sectionPath.join('\0'))
    ) {
      return 'advisory';
    }
    return 'ok';
  });
}

/** The span as a person just reviewed it: what a cleared link holds from then on. */
export type LinkReview = { fp: string; ctxFp?: string; sectionPath?: readonly string[] };

/**
 * Clears a suspect link with one of the three reasons: the link then holds the span's current fingerprint and the
 * reason. Any other reason, and a span the ledger no longer holds, is refused and the link stays as it was.
 */
export function clearLink(
  link: Link,
  reason: string,
  review: LinkedLedger | LinkReview,
): { ok: true; link: Link } | { ok: false; error: string } {
  if (!(CLEAR_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: `a link is cleared with one of ${CLEAR_REASONS.join(', ')}, not "${reason}"` };
  }
  const entry = 'entries' in review ? byId(review).get(link.span) : review;
  if (!entry)
    return { ok: false, error: `the ledger holds no live span ${link.span}: delete the link or re-point it` };
  const { ctxFp: _ctx, sectionPath: _section, ...rest } = link;
  return {
    ok: true,
    link: {
      ...rest,
      fp: entry.fp,
      ...(entry.ctxFp === undefined ? {} : { ctxFp: entry.ctxFp }),
      ...(entry.sectionPath === undefined ? {} : { sectionPath: [...entry.sectionPath] }),
      accepted: reason,
      reason,
    },
  };
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
  const verified = new Map<string, Set<string | undefined>>();
  for (const link of links) {
    if (link.createdBy !== 'verified') continue;
    const fps = verified.get(link.span) ?? new Set<string | undefined>();
    fps.add(link.fp);
    verified.set(link.span, fps);
  }
  const uncovered: string[] = [];
  let covered = 0;
  for (const entry of liveEntries(current)) {
    if (!Object.values(entry.labels).some((label) => mapped.has(label.label))) continue;
    if ([...(verified.get(entry.id) ?? [])].some((fp) => fp === undefined || fp === entry.fp)) covered++;
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

/** The spans a claim may name: those a verified link names, sorted, each once. A proposal counts for nothing. */
export function verifiedSpans(links: ReadonlyArray<Pick<Link, 'span' | 'createdBy'>>): string[] {
  return sorted(links.filter((link) => link.createdBy === 'verified').map((link) => link.span));
}

/**
 * The radius of an edit from links already classified. The tests to rerun are the owners of suspect links, whoever
 * made them: a proposal that went suspect reruns its test. The advisory tests are the owners of the links to a
 * section as a whole that the edit touched, which a precise link cannot name. Both lists are sorted and unique.
 */
export function impactOf(
  precise: ReadonlyArray<{ owner: string; state: LinkState }>,
  sectionLinks: ReadonlyArray<{ owner: string; section: { path: string; sectionPath: readonly string[] } }>,
  editedSections: ReadonlyArray<{ path: string; sectionPath: readonly string[] }>,
): { rerun: string[]; advisory: string[] } {
  const place = (at: { path: string; sectionPath: readonly string[] }) =>
    `${at.path}\0${at.sectionPath.join('\0')}`;
  const edited = new Set(editedSections.map(place));
  return {
    rerun: sorted(precise.filter((link) => link.state === 'suspect').map((link) => link.owner)),
    advisory: sorted(
      sectionLinks.filter((link) => edited.has(place(link.section))).map((link) => link.owner),
    ),
  };
}
