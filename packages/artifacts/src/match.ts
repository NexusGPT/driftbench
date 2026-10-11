import type { Order } from './args';
import { type Assertion, describeAssertion } from './assertion';

/**
 * Lines up an expected list with a found list under one of the three match types the tool check uses:
 * `exact` (same items, same order, nothing else), `in_order` (the expected items appear in this order,
 * others may sit between them) and `any_order` (the expected items appear, each matched by a distinct
 * found item). Returns the first problems found, or none.
 */
export function matchList<T>(
  expected: readonly Assertion[],
  found: readonly T[],
  order: Order,
  test: (assertion: Assertion, item: T) => boolean,
  show: (item: T) => string,
): string[] {
  if (order === 'exact') return matchExact(expected, found, test, show);
  if (order === 'in_order') return matchInOrder(expected, found, test);
  return matchAnyOrder(expected, found, test);
}

/**
 * Lists of the same length compare item by item. Otherwise the expected items are lined up in order
 * and the evidence names what is missing and what is extra, so one leftover item is named once instead
 * of shifting every position after it.
 */
function matchExact<T>(
  expected: readonly Assertion[],
  found: readonly T[],
  test: (assertion: Assertion, item: T) => boolean,
  show: (item: T) => string,
): string[] {
  if (expected.length === found.length) {
    return expected.flatMap((want, index) => {
      const item = found[index] as T;
      return test(want, item)
        ? []
        : [`item ${index + 1} is ${show(item)}, expected ${describeAssertion(want)}`];
    });
  }
  const used = new Set<number>();
  const missing: Assertion[] = [];
  let next = 0;
  for (const want of expected) {
    let index = next;
    while (index < found.length && !test(want, found[index] as T)) index++;
    if (index === found.length) {
      missing.push(want);
      continue;
    }
    used.add(index);
    next = index + 1;
  }
  const extra = found.filter((_, index) => !used.has(index));
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing ${missing.map(describeAssertion).join(', ')}`);
  if (extra.length > 0) problems.push(`${extra.length} more than expected: ${extra.map(show).join(', ')}`);
  return problems;
}

function matchInOrder<T>(
  expected: readonly Assertion[],
  found: readonly T[],
  test: (assertion: Assertion, item: T) => boolean,
): string[] {
  let next = 0;
  let previous: Assertion | undefined;
  const used = new Set<number>();
  for (const want of expected) {
    let index = next;
    while (index < found.length && !test(want, found[index] as T)) index++;
    if (index === found.length) {
      const earlier = found.some((item, at) => at < next && !used.has(at) && test(want, item));
      if (!earlier || previous === undefined) return [`missing ${describeAssertion(want)}`];
      return [`${describeAssertion(want)} is out of order: expected after ${describeAssertion(previous)}`];
    }
    used.add(index);
    next = index + 1;
    previous = want;
  }
  return [];
}

/** Maximum bipartite matching, so overlapping patterns never steal each other's item. */
function matchAnyOrder<T>(
  expected: readonly Assertion[],
  found: readonly T[],
  test: (assertion: Assertion, item: T) => boolean,
): string[] {
  const owner: (number | undefined)[] = found.map(() => undefined);
  const assign = (want: number, seen: boolean[]): boolean => {
    for (let index = 0; index < found.length; index++) {
      if (seen[index] || !test(expected[want] as Assertion, found[index] as T)) continue;
      seen[index] = true;
      const current = owner[index];
      if (current === undefined || assign(current, seen)) {
        owner[index] = want;
        return true;
      }
    }
    return false;
  };
  const missing = expected.filter((_, want) => !assign(want, new Array<boolean>(found.length).fill(false)));
  return missing.length === 0 ? [] : [`missing ${missing.map(describeAssertion).join(', ')}`];
}
