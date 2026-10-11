import type { Assertion } from '@driftbench/core';
import { deepEqual, isEmpty, isRecord, show } from './values';

/**
 * One spec assertion against one value, the forms of the checks reference: a bare scalar or `exact` is
 * equality, `regex` matches a string with the `m` flag, `contains` finds text in a string or an item in a
 * list, `one_of` is equality with one option, `nonempty` is present and not empty, `absent` is undefined,
 * and `subset` holds at least the listed keys with their values, nested mappings included.
 */
export type AssertionResult = {
  ok: boolean;
  /** What the assertion asks for, as evidence prints it: `equal to "fiber-1000"`, `matching /^88/`. */
  expected: string;
  /** Set when the assertion itself is broken, such as a regex that does not compile. */
  problem?: string;
};

export function checkAssertion(value: unknown, assertion: Assertion): AssertionResult {
  if (assertion === null || typeof assertion !== 'object') {
    return { ok: deepEqual(value, assertion), expected: `equal to ${show(assertion)}` };
  }
  if ('exact' in assertion) {
    return { ok: deepEqual(value, assertion.exact), expected: `exactly ${show(assertion.exact)}` };
  }
  if ('regex' in assertion) {
    const expected = `matching /${assertion.regex}/`;
    let pattern: RegExp;
    try {
      pattern = new RegExp(assertion.regex, 'm');
    } catch (cause) {
      return { ok: false, expected, problem: `the pattern does not compile: ${message(cause)}` };
    }
    return { ok: typeof value === 'string' && pattern.test(value), expected };
  }
  if ('contains' in assertion) {
    const expected = `containing ${show(assertion.contains)}`;
    if (typeof value === 'string') return { ok: value.includes(assertion.contains), expected };
    return {
      ok: Array.isArray(value) && value.some((item) => deepEqual(item, assertion.contains)),
      expected,
    };
  }
  if ('one_of' in assertion) {
    return {
      ok: assertion.one_of.some((option) => deepEqual(value, option)),
      expected: `one of ${show(assertion.one_of)}`,
    };
  }
  if ('nonempty' in assertion) return { ok: !isEmpty(value), expected: 'present and not empty' };
  if ('absent' in assertion) return { ok: value === undefined, expected: 'absent' };
  return {
    ok: isSubset(value, assertion.subset),
    expected: `holding at least ${show(assertion.subset)}`,
  };
}

/** True when `value` holds every key of `expected` with its value; nested mappings compare the same way. */
export function isSubset(value: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    return isRecord(value) && Object.entries(expected).every(([key, part]) => isSubset(value[key], part));
  }
  return deepEqual(value, expected);
}

export function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
