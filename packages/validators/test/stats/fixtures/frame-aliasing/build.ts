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
  | 'proxy-nested'
  | 'getter'
  | 'setter'
  | 'getter-array'
  | 'setter-array'
  | 'extra-typed'
  | 'extra-map'
  | 'extra-array'
  | 'extra-date'
  | 'extra-set'
  | 'marked-isarray'
  | 'marked-isview'
  | 'marked-is'
  | 'marked-weakset';

const SIGNATURE =
  'export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {';

// An unused field far over any size a watch could afford to compare: the result is padded with it.
const PAD = "pad: 'x'.repeat(200_000)";

// What a package does at load to blind a watch that hashes or serialises results in its process: the shared padded
// package plus one patch of an intrinsic the watch could use. The frame must keep every one of them caught.
// A marked honest package returns a fresh object with a marker field. The frame's own encoding of the answer calls
// Array.isArray and ArrayBuffer.isView once on each object; the patched helper throws on the second call on the same
// object, which only a watch that looks the helper up when it runs would make (a captured helper is not the patched one).
const MARK = 123456.789;
const SECOND = `const calledOn = new WeakMap<object, number>();
const second = (v: unknown) => {
  if (v === null || typeof v !== 'object' || (v as { marker?: number }).marker !== ${MARK}) return;
  const n = (calledOn.get(v) ?? 0) + 1;
  calledOn.set(v, n);
  if (n > 1) throw new Error('looked up by the watch');
};
`;

const PATCHES: Record<string, string> = {
  'marked-isarray': `${SECOND}const realIsArray = Array.isArray;
Array.isArray = (v: unknown): v is unknown[] => { second(v); return realIsArray(v); };
`,
  'marked-weakset': `${SECOND}const realHas = WeakSet.prototype.has;
WeakSet.prototype.has = function (v: object) { second(v); return realHas.call(this, v); };
`,
  // The encoding of each answer calls Object.is once on the marker number; the wrapper counts the answers made, and
  // a call beyond that count is the watch's.
  'marked-is': `const realIs = Object.is;
let seenMarker = 0;
(globalThis as { madeAnswers?: number }).madeAnswers = 0;
Object.is = (a: unknown, c: unknown) => {
  if (a === ${MARK}) {
    seenMarker += 1;
    if (seenMarker > ((globalThis as { madeAnswers?: number }).madeAnswers ?? 0)) throw new Error('looked up by the watch');
  }
  return realIs(a, c);
};
`,
  'marked-isview': `${SECOND}const realIsView = ArrayBuffer.isView;
ArrayBuffer.isView = (v: unknown): v is ArrayBufferView => { second(v); return realIsView(v); };
`,
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
  'marked-isarray': '',
  'marked-isview': '',
  'marked-is': '',
  'marked-weakset': '',
  // One shared container returned every time, with an extra property holding the current number.
  'extra-typed': `const shared = new Float64Array(2);
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  (shared as unknown as Record<string, number>).lowerShared = real.lower;
  return { ...real, shared } as unknown as BootstrapInterval;
}
`,
  // One shared container returned every time, with an extra property holding the current number.
  'extra-map': `const shared = new Map();
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  (shared as unknown as Record<string, number>).lowerShared = real.lower;
  return { ...real, shared } as unknown as BootstrapInterval;
}
`,
  // One shared container returned every time, with an extra property holding the current number.
  'extra-array': `const shared = [1, 2];
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  (shared as unknown as Record<string, number>).lowerShared = real.lower;
  return { ...real, shared } as unknown as BootstrapInterval;
}
`,
  // One shared container returned every time, with an extra property holding the current number.
  'extra-date': `const shared = new Date(0);
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  (shared as unknown as Record<string, number>).lowerShared = real.lower;
  return { ...real, shared } as unknown as BootstrapInterval;
}
`,
  // One shared container returned every time, with an extra property holding the current number.
  'extra-set': `const shared = new Set([1]);
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  (shared as unknown as Record<string, number>).lowerShared = real.lower;
  return { ...real, shared } as unknown as BootstrapInterval;
}
`,

  // An array field whose element 1 is a getter answering the real number once and zero afterwards.
  'getter-array': `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  let reads = 0;
  const series = [1, 2, 3];
  Object.defineProperty(series, 1, { enumerable: true, get: () => { reads += 1; return reads <= 1 ? 2 : 0; } });
  return { ...real, series } as BootstrapInterval;
}
`,
  // An array field whose element 1 is a setter alone.
  'setter-array': `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  const series = [1, 2, 3];
  Object.defineProperty(series, 1, { enumerable: true, set() {} });
  return { ...real, series } as BootstrapInterval;
}
`,
  // A getter on a field of a correct result: the first read is the real number, later reads are zero.
  getter: `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  let reads = 0;
  const lower = real.lower;
  return Object.defineProperty(real, 'lower', {
    enumerable: true,
    get() {
      reads += 1;
      return reads <= 1 ? lower : 0;
    },
  });
}
`,
  // A setter-only accessor in a field of a correct result.
  setter: `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const real = { ...realBootstrapCI(values, options) };
  return Object.defineProperty(real, 'note', { enumerable: true, set() {} });
}
`,
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
  const wrapper = kind.startsWith('marked-')
    ? `export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  (globalThis as { madeAnswers?: number }).madeAnswers = ((globalThis as { madeAnswers?: number }).madeAnswers ?? 0) + 1;
  return { ...realBootstrapCI(values, options), marker: ${MARK} } as BootstrapInterval;
}
`
    : patched
      ? WRAPPERS['shared-padded']
      : WRAPPERS[kind];
  writeFileSync(
    intervals,
    `${PATCHES[kind] ?? ''}${text.replace(SIGNATURE, 'function realBootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {')}\n${wrapper}`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}
