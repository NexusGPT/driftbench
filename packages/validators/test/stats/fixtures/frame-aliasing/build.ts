import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How the copy's `bootstrapCI` hands out its results. */
export type Aliasing = 'fresh' | 'shared' | 'overwrite' | 'shared-padded' | 'overwrite-padded';

const SIGNATURE =
  'export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {';

// An unused field far over any size a watch could afford to compare: the result is padded with it.
const PAD = "pad: 'x'.repeat(200_000)";

const WRAPPERS: Record<Aliasing, string> = {
  // The shared object, padded.
  'shared-padded': `const shared = {} as BootstrapInterval;
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  return Object.assign(shared, { ...realBootstrapCI(values, options), ${PAD} });
}
`,
  // The overwriting package, padded.
  'overwrite-padded': `let previous: BootstrapInterval | undefined;
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const result = { ...realBootstrapCI(values, options), ${PAD} };
  if (previous) Object.assign(previous, result);
  previous = result;
  return result;
}
`,
  // A new object on every call: what an honest package does.
  fresh: `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  return { ...realBootstrapCI(values, options) };
}
`,
  // One object, filled again on every call.
  shared: `const shared = {} as BootstrapInterval;
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  return Object.assign(shared, realBootstrapCI(values, options));
}
`,
  // A new object on every call, and the result of the call before it overwritten with the new numbers.
  overwrite: `let previous: BootstrapInterval | undefined;
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const result = { ...realBootstrapCI(values, options) };
  if (previous) Object.assign(previous, result);
  previous = result;
  return result;
}
`,
};

/** A copy of the statistics package at `root` whose `bootstrapCI` aliases its results as `kind` says. Returns its index. */
export function aliasingPackage(root: string, kind: Aliasing, into: string): string {
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  const intervals = join(src, 'intervals.ts');
  const text = readFileSync(intervals, 'utf8');
  if (!text.includes(SIGNATURE))
    throw new Error('the bootstrapCI signature changed: update the aliasing builder');
  writeFileSync(
    intervals,
    `${text.replace(SIGNATURE, 'function realBootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {')}\n${WRAPPERS[kind]}`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}
