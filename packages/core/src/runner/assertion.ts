import type { Assertion } from '../schema/common';
import type { EndStateSpec } from '../schema/spec';
import { isPlainObject as isRecord } from '../spec/normalize';

/**
 * Assertion semantics, shared by the runner's end-state compare and any check that asserts values.
 * A bare scalar means exact equality; patterns compile with the `m` flag, as every spec pattern does.
 */
export function matchAssertion(value: unknown, assertion: Assertion): boolean {
  if (assertion === null || typeof assertion !== 'object') return deepEqual(value, assertion);
  if ('exact' in assertion) return deepEqual(value, assertion.exact);
  if ('regex' in assertion) return typeof value === 'string' && new RegExp(assertion.regex, 'm').test(value);
  if ('contains' in assertion) {
    if (typeof value === 'string') return value.includes(assertion.contains);
    return Array.isArray(value) && value.some((item) => deepEqual(item, assertion.contains));
  }
  if ('one_of' in assertion) return assertion.one_of.some((option) => deepEqual(value, option));
  if ('nonempty' in assertion) return !isEmpty(value);
  if ('absent' in assertion) return value === undefined;
  return isRecord(value) && Object.entries(assertion.subset).every(([key, part]) => holds(value[key], part));
}

/** Structural equality on JSON-like values. A key whose value is undefined counts as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const other = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === other.length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return Object.is(a, b);
}

export type EndStateDiff = { field: string; expected: unknown; observed: unknown };
export type EndStateMatch = { match: boolean; diff: EndStateDiff[] };

/**
 * Compares what the adapter read from each end-state source with the spec's expectations. `subset`
 * (the default) checks the listed fields; `exact` also fails every other field present in the state.
 * One diff entry per field that does not hold. With several sources, a field is named `<source>.<field>`.
 */
export function compareEndState(entries: readonly EndStateSpec[], states: readonly unknown[]): EndStateMatch {
  const diff: EndStateDiff[] = [];
  entries.forEach((entry, index) => {
    const state = states[index];
    const record = isRecord(state) ? state : undefined;
    const name = (field: string) => (entries.length > 1 ? `${entry.source}.${field}` : field);
    for (const [field, assertion] of Object.entries(entry.expect)) {
      const observed = record?.[field];
      if (!matchAssertion(observed, assertion))
        diff.push({ field: name(field), expected: assertion, observed });
    }
    if (entry.mode === 'exact' && record) {
      for (const [field, observed] of Object.entries(record)) {
        if (observed !== undefined && !Object.hasOwn(entry.expect, field)) {
          diff.push({ field: name(field), expected: { absent: true }, observed });
        }
      }
    }
  });
  return { match: diff.length === 0, diff };
}

function holds(value: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    return isRecord(value) && Object.entries(expected).every(([key, part]) => holds(value[key], part));
  }
  return deepEqual(value, expected);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}
