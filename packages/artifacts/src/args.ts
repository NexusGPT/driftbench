import type { Count } from '@agent-nexus/driftbench-core';

/**
 * Reading the argument of a check. A check whose argument has the wrong shape fails, and its evidence
 * says what is wrong and how the check is written; it never throws out of `check()`.
 */

/** A check argument the check cannot read. The message completes "<check name> ...". */
export class CheckArgumentError extends Error {}

export function invalid(message: string): never {
  throw new CheckArgumentError(message);
}

/**
 * The file lacks what the check names (a sheet, a column header, a slide): a failed check, not a wrong
 * argument. The message is the whole evidence.
 */
export class Missing extends Error {}

export function missing(message: string): never {
  throw new Missing(message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a mapping argument and refuses the keys the check does not take, so a typo never passes. */
export function mapping(arg: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(arg)) invalid(`takes a mapping with the keys ${allowed.join(', ')}`);
  const unknown = Object.keys(arg).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    invalid(`does not take ${unknown.map((key) => `"${key}"`).join(', ')}; it takes ${allowed.join(', ')}`);
  }
  return arg;
}

export function optionalString(map: Record<string, unknown>, key: string): string | undefined {
  const value = map[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) invalid(`needs ${key} to be a text`);
  return value;
}

export function requiredString(map: Record<string, unknown>, key: string): string {
  const value = optionalString(map, key);
  if (value === undefined) invalid(`needs ${key}`);
  return value;
}

export function optionalInteger(map: Record<string, unknown>, key: string, min: number): number | undefined {
  const value = map[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    invalid(`needs ${key} to be a whole number from ${min}`);
  }
  return value;
}

export function requiredList(map: Record<string, unknown>, key: string): unknown[] {
  const value = map[key];
  if (!Array.isArray(value)) invalid(`needs ${key} as a list`);
  return value;
}

/** A text or a list of texts, none empty: the needles of contains and the patterns of regex. */
export function textList(value: unknown, what: string): string[] {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0) invalid(`takes a ${what} or a list of them`);
  for (const item of list) {
    if (typeof item !== 'string' || item.trim().length === 0) invalid(`takes a ${what} or a list of them`);
  }
  return list as string[];
}

/** A count as the spec writes it: a whole number, or `{ min, max }` with either bound. */
export function parseCount(value: unknown, what: string): Count {
  const whole = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (whole(value)) return value as number;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const bounded = keys.length > 0 && keys.every((key) => key === 'min' || key === 'max');
    if (bounded && keys.every((key) => whole(value[key]))) {
      const min = value.min as number | undefined;
      const max = value.max as number | undefined;
      if (min !== undefined && max !== undefined && min > max) invalid(`has ${what} with min above max`);
      return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
    }
  }
  return invalid(`needs ${what} as a whole number or { min, max }`);
}

/** True when the count is a bounds mapping rather than the argument mapping of a check. */
export function isCountBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => key === 'min' || key === 'max')
  );
}

export function countHolds(count: Count, n: number): boolean {
  if (typeof count === 'number') return n === count;
  return (count.min === undefined || n >= count.min) && (count.max === undefined || n <= count.max);
}

export function describeCount(count: Count): string {
  if (typeof count === 'number') return String(count);
  if (count.min !== undefined && count.max !== undefined) {
    return count.min === count.max ? String(count.min) : `${count.min} to ${count.max}`;
  }
  if (count.min !== undefined) return `at least ${count.min}`;
  return `at most ${count.max}`;
}

/** How an expected list lines up with what was found, with the three match types of the tool check. */
export type Order = 'exact' | 'in_order' | 'any_order';

export function parseOrder(value: unknown, fallback: Order): Order {
  if (value === undefined) return fallback;
  if (value === 'exact' || value === 'in_order' || value === 'any_order') return value;
  return invalid('needs order to be exact, in_order or any_order');
}
