import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How the copy's `bootstrapCI` hands out its results. */
export type Aliasing =
  | 'fresh'
  | 'shared'
  | 'overwrite'
  | 'shared-padded'
  | 'overwrite-padded'
  | 'patch-digest'
  | 'patch-update'
  | 'patch-stringify'
  | 'patch-reflect'
  | 'proxy'
  | 'proxy-nested';

const SIGNATURE =
  'export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {';

// An unused field far over any size a watch could afford to compare: the result is padded with it.
const PAD = "pad: 'x'.repeat(200_000)";

// What a package does at load to blind a watch that hashes or serialises results in its process: the shared padded
// package plus one patch of an intrinsic the watch could use. The frame must keep every one of them caught.
const PATCHES: Record<string, string> = {
  'patch-digest': `import { createHash as patchHash } from 'node:crypto';
Object.getPrototypeOf(patchHash('sha256')).digest = () => 'constant';
`,
  'patch-update': `import { createHash as patchHash } from 'node:crypto';
Object.getPrototypeOf(patchHash('sha256')).update = function patched() { return this; };
`,
  'patch-stringify': `JSON.stringify = () => '{}';
`,
  'patch-reflect': `Reflect.ownKeys = () => [];
Reflect.getOwnPropertyDescriptor = () => undefined;
Reflect.getPrototypeOf = () => null;
Reflect.apply = () => undefined;
`,
};

const WRAPPERS: Record<Aliasing, string> = {
  // A Proxy over a correct result that answers the first reads (the frame's own encoding of the answer) as the
  // real result and every later read with zeros: whatever reads it afterwards sees other numbers.
  proxy: `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  let reads = 0;
  return new Proxy(real, {
    get(target, key) {
      reads += 1;
      const value = (target as Record<string | symbol, unknown>)[key];
      return reads <= 7 || typeof value !== 'number' ? value : 0;
    },
  });
}
`,
  // The same Proxy one level down, in a field of a plain result.
  'proxy-nested': `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  let reads = 0;
  const inner = new Proxy(
    { note: 'x' },
    { get: (target, key) => { reads += 1; return (target as Record<string | symbol, unknown>)[key]; } },
  );
  return { ...real, inner } as BootstrapInterval;
}
`,
  'patch-digest': '',
  'patch-update': '',
  'patch-stringify': '',
  'patch-reflect': '',
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
  const patched = kind in PATCHES;
  const wrapper = patched ? WRAPPERS['shared-padded'] : WRAPPERS[kind];
  writeFileSync(
    intervals,
    `${PATCHES[kind] ?? ''}${text.replace(SIGNATURE, 'function realBootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {')}\n${wrapper}`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}
