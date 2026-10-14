import type { z } from 'zod';
import type { BlockProvenance } from '../schema/provenance';

export type EndStateSnapshot = NonNullable<z.infer<typeof BlockProvenance>['endState']>;

/** The existing T composition rule: last non-null value per source, ordered concatenation for '*'. */
export function composeStates(sources: string[], before: unknown[] | undefined, read: unknown[]): unknown[] {
  return sources.map((source, index) => {
    const earlier = before?.[index];
    const now = read[index];
    if (source === '*')
      return [...(Array.isArray(earlier) ? earlier : []), ...(Array.isArray(now) ? now : [])];
    return now === undefined || now === null ? earlier : now;
  });
}

/** Missing snapshot means the returned value cannot round-trip through the JSON results store. */
export function endStateSnapshot(
  sources: string[],
  read: { kind: string; states?: unknown[] },
): EndStateSnapshot | undefined {
  if (read.kind !== 'read') return { kind: 'unavailable' };
  const states = read.states ?? [];
  if (states.some((value) => value !== undefined && !jsonValue(value))) return undefined;
  return {
    kind: 'read',
    values: sources.map((source, i) =>
      states[i] === undefined
        ? { source, kind: 'undefined' }
        : { source, kind: 'value', value: structuredClone(states[i]) },
    ),
  };
}
export function snapshotValues(snapshot: EndStateSnapshot, sources: string[]): unknown[] | undefined {
  if (snapshot.kind === 'unavailable') return undefined;
  if (
    snapshot.values.length !== sources.length ||
    snapshot.values.some((entry, i) => entry.source !== sources[i])
  )
    throw new Error('End-state snapshot sources differ; rerun the full cell');
  return snapshot.values.map((entry) => (entry.kind === 'undefined' ? undefined : entry.value));
}
function jsonValue(value: unknown, parents = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || parents.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  const next = new Set(parents).add(value);
  return Object.values(value).every((child) => jsonValue(child, next));
}
