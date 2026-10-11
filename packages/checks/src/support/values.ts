/**
 * Value helpers shared by the checks: how a value prints in evidence, counts, keys. Equality and the
 * assertion forms are core's (`deepEqual`, `matchAssertion`).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MAX_SHOWN = 120;

/** A value as evidence prints it: JSON, cut at 120 characters; `absent` for undefined. */
export function show(value: unknown): string {
  if (value === undefined) return 'absent';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}...` : text;
}

/** `1 time`, `2 times`. */
export function times(count: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'}`;
}

/** `1 call`, `3 calls`: a count with its noun, plural when it is not one. */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** A list for evidence: `none` when empty. */
export function listed(items: readonly string[]): string {
  return items.length === 0 ? 'none' : items.join(', ');
}

/**
 * Keys that tell repeated names apart: the name itself, then `name#2`, `name#3` for later entries with the
 * same name. Verdict ids use them so two expectations on one tool or one file never share an id.
 */
export function entryKeys(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}#${count}`;
  });
}

/** A workspace path as the checks compare it: forward slashes, no leading `./`. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}
