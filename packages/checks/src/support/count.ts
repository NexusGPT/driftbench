import type { Count } from '@agent-nexus/driftbench-core';

/**
 * Count semantics, shared by tools, cards, skills and guards. No count means at least one; a number is an
 * exact count; `{ min, max }` is a range with either bound.
 */
export function countAllows(count: Count | undefined, seen: number): boolean {
  if (count === undefined) return seen >= 1;
  if (typeof count === 'number') return seen === count;
  return (count.min === undefined || seen >= count.min) && (count.max === undefined || seen <= count.max);
}

/** The count as evidence reads it: `exactly 1`, `at least 1`, `1 to 2`, `at most 3`. */
export function describeCount(count: Count | undefined): string {
  if (count === undefined) return 'at least 1';
  if (typeof count === 'number') return `exactly ${count}`;
  if (count.min !== undefined && count.max !== undefined) {
    return count.min === count.max ? `exactly ${count.min}` : `${count.min} to ${count.max}`;
  }
  if (count.min !== undefined) return `at least ${count.min}`;
  if (count.max !== undefined) return `at most ${count.max}`;
  return 'any number';
}

/** The fewest occurrences a count requires: one when absent, the min of a range, zero for `{ max }`. */
export function minimumOf(count: Count | undefined): number {
  if (count === undefined) return 1;
  if (typeof count === 'number') return count;
  return count.min ?? 0;
}
