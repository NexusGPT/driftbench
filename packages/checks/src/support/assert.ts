import { type Assertion, matchAssertion } from '@agent-nexus/driftbench-core';
import { show } from './values';

/**
 * One spec assertion against one value. Core's `matchAssertion` decides it: one rule for the checks and
 * the runner's end-state compare. This wrapper only adds what evidence prints: what the assertion asks
 * for, and a pattern that does not compile named instead of thrown.
 */
export type AssertionResult = {
  ok: boolean;
  /** What the assertion asks for, as evidence prints it: `equal to "fiber-1000"`, `matching /^88/`. */
  expected: string;
  /** Set when the assertion itself is broken, such as a regex that does not compile. */
  problem?: string;
};

export function checkAssertion(value: unknown, assertion: Assertion): AssertionResult {
  const expected = describeAssertion(assertion);
  try {
    return { ok: matchAssertion(value, assertion), expected };
  } catch (cause) {
    const what = isPattern(assertion) ? 'the pattern does not compile' : 'the assertion cannot be applied';
    return { ok: false, expected, problem: `${what}: ${message(cause)}` };
  }
}

/** What an assertion asks for, in the words evidence uses. */
export function describeAssertion(assertion: Assertion): string {
  if (assertion === null || typeof assertion !== 'object') return `equal to ${show(assertion)}`;
  if ('exact' in assertion) return `exactly ${show(assertion.exact)}`;
  if ('regex' in assertion) return `matching /${assertion.regex}/`;
  if ('contains' in assertion) return `containing ${show(assertion.contains)}`;
  if ('one_of' in assertion) return `one of ${show(assertion.one_of)}`;
  if ('nonempty' in assertion) return 'present and not empty';
  if ('absent' in assertion) return 'absent';
  return `holding at least ${show(assertion.subset)}`;
}

function isPattern(assertion: Assertion): boolean {
  return assertion !== null && typeof assertion === 'object' && 'regex' in assertion;
}

export function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
