import { expect } from 'vitest';
import type { Observed, ObservedLink, Outcome } from './observe';
import type { LinkKind } from './vocabulary';

/** The links that start at a part, of a kind when one is given. */
export function from(observed: Observed, id: string, kind?: LinkKind): ObservedLink[] {
  return observed.links.filter((link) => link.from === id && (kind === undefined || link.kind === kind));
}

export function resolvedLink(observed: Observed, kind: LinkKind, fromId: string, toId: string): boolean {
  return observed.links.some(
    (link) => link.kind === kind && link.from === fromId && link.to === toId && link.resolved,
  );
}

/** A link of this kind from the part that leads to no file of the estate and is not written outside it. */
export function unresolvedLinks(observed: Observed, kind: LinkKind, fromId: string): ObservedLink[] {
  return from(observed, fromId, kind).filter((link) => !link.resolved && !link.external);
}

export function externalLinks(observed: Observed, kind: LinkKind, fromId: string): ObservedLink[] {
  return from(observed, fromId, kind).filter((link) => link.external);
}

/**
 * The links among the parts a generator made, as a sorted list of lines. Two reads of the same estate in a different
 * layout, line ending, case or size must give the same list; a metamorphic test compares two of them.
 */
export function shape(observed: Observed, ids: readonly string[]): string[] {
  const known = new Set(ids);
  return [
    ...new Set(
      observed.links
        // A link to a file the generator did not name (a package's init file) is not part of the shape.
        .filter((link) => known.has(link.from) && (link.to === null || !link.to.startsWith('?')))
        .map(
          (link) =>
            `${link.kind} ${link.from} -> ${link.to === null ? (link.external ? 'outside' : 'nothing') : link.to} ${link.resolved ? 'resolved' : 'unresolved'}`,
        ),
    ),
  ].sort();
}

export function outcome(observed: Observed, check: Outcome['name']): Outcome {
  const found = observed.outcomes.find((entry) => entry.name === check);
  if (!found) throw new Error(`the read reports no ${check} check`);
  return found;
}

/** Part ids a check names as unreferenced. */
export function orphans(observed: Observed): string[] {
  return outcome(observed, 'orphans').findings;
}

export function expectNoLinkBetween(observed: Observed, fromId: string, toId: string): void {
  expect(observed.links.filter((link) => link.from === fromId && link.to === toId)).toEqual([]);
}
