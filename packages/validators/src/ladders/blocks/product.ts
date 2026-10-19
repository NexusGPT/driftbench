import { fileURLToPath } from 'node:url';
import { FrameSession } from './child/session';

/**
 * The product the blocks bank measures, as the packages it exports and its command line. Items reach the
 * product only through this record, never by importing a package themselves, so a test can hand the bank a
 * product that cheats (every block passes, nothing runs, everything is in the blast radius) and see the items
 * fail. A capability that is not on the product yet is an export or a command it does not have: `need` turns
 * that into a failure that names the missing export.
 *
 * The real product never loads in the bank's process (docs/validators.md section 13, "The bank runs the product
 * through the frame"): each package is a proxy whose every read and call crosses to the frame's two child
 * processes (child/session.ts), and the command line runs as a command under the frame.
 */

export type Module = Readonly<Record<string, unknown>>;

export type CliResult = { code: number; out: string; err: string };

/** How the bank opens and closes the frame of one item. */
export type FrameControl = {
  /** Starts the item's frame: drawn from its seed and id, rooted at the repository it runs in. */
  begin(item: { seed: number; tag: string; root: string }): void;
  /** Ends the item's frame: the first call whose two runs answered differently, as a message, or undefined. */
  end(): string | undefined;
  /** A CODE planted agent built in the product's processes from its plan (kinds.ts): its adapter and log. */
  codeAgent?(options: Record<string, unknown>): { adapter: Record<string, unknown>; log: string };
  /** The text of a planted code agent's log, read where it ran. */
  delivered?(log: string): string;
};

export type BlocksProduct = {
  /** `real`, or the name of a cheating product in the tests. */
  name: string;
  core: Module;
  checks: Module;
  stats: Module;
  report: Module;
  users: Module;
  adapters: Module;
  store: Module;
  sandbox: Module;
  artifacts: Module;
  /** The command line `driftbench <argv>`, run with `cwd` as its working folder. */
  cli(argv: readonly string[], cwd: string): Promise<CliResult>;
  /** The frame the product runs under, when it runs apart from the bank. */
  frame?: FrameControl;
};

/** An export the product lacks: the item fails and says which. */
export class Missing extends Error {}

/** The export `name` of the package `pkg`, or a throw naming it. */
export function need<T>(mod: Module, pkg: string, name: string): T {
  const value = mod[name];
  if (value === undefined) throw new Missing(`the product has no export ${name} in ${pkg}`);
  return value as T;
}

/** The export `name` of the package `pkg`, or undefined: for a capability an item checks the absence of. */
export function maybe<T>(mod: Module, name: string): T | undefined {
  return mod[name] as T | undefined;
}

const CONSTANTS = new WeakMap<object, () => unknown>();

let meter: (() => number) | undefined;

/**
 * The CPU time the product has used so far, in milliseconds, where it runs apart from the bank (the frame's run
 * A and its command lines): a timing item adds the difference to its own process's CPU time, so it measures the
 * product as it did when the product ran in its process. Zero when no product runs apart.
 */
export function productCpuMs(): number {
  return meter?.() ?? 0;
}

/**
 * A function that returns `value` (a fresh copy each call), for a function the product calls synchronously: a
 * clock, a fixed random draw, a capability table. Such a function crosses to the product as its value, since the
 * product cannot wait for the bank to answer it.
 */
export function constant<T>(value: T): () => T {
  const fn = () => structuredClone(value);
  CONSTANTS.set(fn, fn);
  return fn;
}

/** The value a function made by `constant` returns, or undefined for any other function. */
export function constantOf(fn: object): (() => unknown) | undefined {
  return CONSTANTS.get(fn);
}

declare const __BLOCKS_CHILD__: { host: string; cli: string; worker: string } | undefined;

/** The modules the frame runs: from this folder, or beside the isolated bundle (isolated/build.ts). */
function childFiles(): { host: string; cli: string; worker: string } {
  if (typeof __BLOCKS_CHILD__ === 'object' && __BLOCKS_CHILD__ !== undefined) return __BLOCKS_CHILD__;
  return {
    host: fileURLToPath(new URL('./child/host.ts', import.meta.url)),
    cli: fileURLToPath(new URL('./child/cli.ts', import.meta.url)),
    worker: fileURLToPath(new URL('./child/cli-worker.ts', import.meta.url)),
  };
}

const PACKAGES = [
  'core',
  'checks',
  'stats',
  'report',
  'users',
  'adapters',
  'store',
  'sandbox',
  'artifacts',
] as const;

/** The product as it is in this repository, run apart from the bank under the frame. */
export function realProduct(): BlocksProduct {
  const session = new FrameSession(childFiles(), CONSTANTS);
  const own = () => session.cpuMs();
  const modules = Object.fromEntries(PACKAGES.map((name) => [name, session.module(name)])) as Record<
    (typeof PACKAGES)[number],
    Module
  >;
  return {
    name: 'real',
    ...modules,
    cli: (argv, cwd) => session.cli(argv, cwd),
    frame: {
      begin: (item) => {
        meter = own;
        session.begin(item);
      },
      end: () => session.end(),
      codeAgent: (options) => session.codeAgent(options),
      delivered: (log) => session.delivered(log),
    },
  };
}

export type ProductPatch = {
  name: string;
  core?: Record<string, unknown>;
  checks?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  report?: Record<string, unknown>;
  users?: Record<string, unknown>;
  adapters?: Record<string, unknown>;
  store?: Record<string, unknown>;
  sandbox?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  cli?: BlocksProduct['cli'];
};

/**
 * A module that answers `patch` first, then `base`: the exports a patch names are replaced, every other export
 * is the base's, read when it is asked for (the base of the real product is a proxy of the frame).
 */
function overlay(base: Module, patch: Record<string, unknown> | undefined): Module {
  if (!patch || Object.keys(patch).length === 0) return base;
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, key) =>
      typeof key === 'string' && Object.hasOwn(patch, key) ? patch[key] : Reflect.get(base, key),
    has: (_target, key) => (typeof key === 'string' && Object.hasOwn(patch, key)) || key in base,
    ownKeys: () => [...new Set([...Reflect.ownKeys(base), ...Reflect.ownKeys(patch)])],
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key === 'string' && Object.hasOwn(patch, key))
        return { value: patch[key], writable: true, enumerable: true, configurable: true };
      const described = Reflect.getOwnPropertyDescriptor(base, key);
      return described ? { ...described, configurable: true } : undefined;
    },
  });
}

/** A product that is `base` with some exports, or its command line, replaced. */
export function patched(base: BlocksProduct, patch: ProductPatch): BlocksProduct {
  return {
    name: patch.name,
    core: overlay(base.core, patch.core),
    checks: overlay(base.checks, patch.checks),
    stats: overlay(base.stats, patch.stats),
    report: overlay(base.report, patch.report),
    users: overlay(base.users, patch.users),
    adapters: overlay(base.adapters, patch.adapters),
    store: overlay(base.store, patch.store),
    sandbox: overlay(base.sandbox, patch.sandbox),
    artifacts: overlay(base.artifacts, patch.artifacts),
    cli: patch.cli ?? base.cli,
    ...(base.frame ? { frame: base.frame } : {}),
  };
}
