import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  type CommandOptions,
  type CommandRun,
  type Frame,
  FrameError,
  isolate,
  neutralName,
} from '../../../frame';
import { findRoot } from '../../../root';
import { liveAgents } from './agents';
import { isPlain, steadyText, TAG, tag, tagged, type Wire } from './wire';

/**
 * The bank's side of the frame (docs/validators.md section 13, "The bank runs the product through the frame").
 * One session per item: the frame's two child processes start at the item's first product call and end with the
 * item. Every product module is a proxy here; a read, a call or a `new` crosses to the children as data
 * (wire.ts) and comes back as data, or as a proxy of a value the children hold. A function of the bank the product
 * calls (a scripted agent, a custom check, an event sink) runs here when the child asks for it, with the call it
 * belongs to suspended in the child until the bank answers.
 *
 * The twin that runs apart works on a copy of each folder of the bank's it is handed (every path under the
 * temporary folder an argument names): before each call the copy takes what the bank changed in the folder since
 * the last call, so both twins see the same files.
 */

type Step = { done: Wire } | { threw: Wire } | { op: number; n: number; cb: number; args: Wire };

type Host = {
  init(given: { root: string; privateRoot: string }): void;
  folders(pairs: [string, string][]): void;
  get(where: Wire, key: string): Wire;
  keys(where: Wire): string[];
  has(where: Wire, key: string): boolean;
  put(where: Wire, key: string, value: Wire): void;
  remove(where: Wire, key: string): boolean;
  instance(value: number, cls: number): boolean;
  call(where: Wire, key: string | null, self: Wire, args: Wire): Step;
  construct(where: Wire, args: Wire): Step;
  resume(op: number, n: number, outcome: { value?: Wire; threw?: Wire }): Step;
  functionAgent(options: Wire, create: Wire, respond: Wire): Step;
  codeAgent(given: Wire): Step;
  delivered(path: string): string;
  cpu(): number;
};

type Signature = Map<string, string>;
type Folder = { mirror: string; real: string; realMirror: string; after: Signature };
type Seen = { id: number; keys: string[]; values: unknown[] };

const CLI_MS = 600_000;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Every file, folder and link under `root`, with what tells a change: type, size, time and inode. */
function signature(root: string): Signature {
  const out: Signature = new Map();
  const walk = (folder: string, rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(folder, name);
      const at = rel === '' ? name : `${rel}/${name}`;
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(path, { bigint: true });
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) out.set(at, `l:${readlinkSync(path)}`);
      else if (stat.isDirectory()) {
        out.set(at, 'd');
        walk(path, at);
      } else out.set(at, `f:${stat.size}:${stat.mtimeNs}:${stat.ino}:${stat.mode}`);
    }
  };
  if (existsSync(root) && lstatSync(root).isDirectory()) walk(root, '');
  else if (existsSync(root)) {
    const stat = lstatSync(root, { bigint: true });
    out.set('', `f:${stat.size}:${stat.mtimeNs}:${stat.ino}:${stat.mode}`);
  }
  return out;
}

/** Brings the copy of a folder up to the folder, for the entries that changed between two signatures. */
function apply(folder: string, mirror: string, before: Signature, now: Signature): void {
  const target = (rel: string) => (rel === '' ? mirror : join(mirror, rel));
  const source = (rel: string) => (rel === '' ? folder : join(folder, rel));
  const gone = [...before.keys()].filter((rel) => !now.has(rel)).sort((a, b) => b.length - a.length);
  for (const rel of gone) rmSync(target(rel), { recursive: true, force: true });
  const changed = [...now.entries()]
    .filter(([rel, sig]) => before.get(rel) !== sig)
    .sort(([a], [b]) => a.split('/').length - b.split('/').length);
  for (const [rel, sig] of changed) {
    const to = target(rel);
    if (sig === 'd') {
      if (existsSync(to) && !lstatSync(to).isDirectory()) rmSync(to, { force: true });
      mkdirSync(to, { recursive: true });
      continue;
    }
    if (existsSync(to) || isLink(to)) rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    if (sig.startsWith('l:')) {
      const link = sig.slice(2);
      const mapped =
        link === folder || link.startsWith(`${folder}${sep}`) ? mirror + link.slice(folder.length) : link;
      symlinkSync(mapped, to);
    } else copyFileSync(source(rel), to);
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Every file under a folder, as base64 by relative path; links as `{ link }`. */
function pack(
  folder: string,
  skip: (rel: string) => boolean = () => false,
): Record<string, string | { link: string }> {
  const files: Record<string, string | { link: string }> = {};
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const next = rel === '' ? name : `${rel}/${name}`;
      if (skip(next)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) files[next] = { link: readlinkSync(path) };
      else if (stat.isDirectory()) {
        files[`${next}/`] = '';
        walk(path, next);
      } else files[next] = readFileSync(path).toString('base64');
    }
  };
  if (existsSync(folder)) walk(folder, '');
  return files;
}

/** The first path where two recorded answers differ, with both values, or undefined when they are equal. */
export function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (a === b) return undefined;
  const show = (value: unknown) => {
    const text = JSON.stringify(value) ?? 'undefined';
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  };
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return `${path || 'the answer'}: run A ${show(a)}, run B ${show(b)}`;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    const found = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}${Array.isArray(a) ? `[${key}]` : key === TAG ? '' : `.${key}`}`,
    );
    if (found) return found;
  }
  return undefined;
}

const CLOCK_KEY = /(Ms|At|^ms|^at|[dD]uration|[eE]lapsed|[lL]atency|[tT]imestamp)$/;

/**
 * What the two runs of the frame may answer differently: a clock (a time of day, a duration, a latency) and a
 * random id. Both are read from the machine, not from how the product is run, and they differ between any two
 * runs; every other part of an answer must be the same in both.
 */
export function steady(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return steadyText(value);
  if (typeof value === 'number') return CLOCK_KEY.test(key) ? '<clock>' : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((each) => steady(each, key));
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [steady(k), steady(v, String(k))]));
  if (value instanceof Set) return new Set([...value].map((each) => steady(each)));
  if (value instanceof Date) return '<time>';
  const out: Record<string, unknown> = {};
  for (const [name, each] of Object.entries(value)) out[name] = steady(each, name);
  return out;
}

const STEADY = Object.fromEntries(
  ['get', 'call', 'construct', 'resume', 'functionAgent', 'codeAgent', 'delivered'].map((name) => [
    name,
    (value: unknown) => steady(value),
  ]),
);
// Each run reports its own CPU time: the frame compares nothing of it.
(STEADY as Record<string, (value: unknown) => unknown>).cpu = () => 0;

/** Where the two runs of a command differ: in the steady answer each wrote, else as the frame says. */
function commandDifference(run: CommandRun, outName: string): string | undefined {
  const entry = run.tape[0];
  const twin = entry?.twin as { ret?: unknown } | undefined;
  if (!entry || !twin) return undefined;
  const files = (x: unknown) => (x as { files?: Record<string, unknown> } | undefined)?.files?.[outName];
  const a = files(entry.ret);
  const b = files(twin.ret);
  if (typeof a !== 'string' || typeof b !== 'string') return undefined;
  const textDifference = (x: string, y: string, path: string) => {
    let at = 0;
    while (at < x.length && at < y.length && x[at] === y[at]) at += 1;
    return `${path} at ${at}: run A ${JSON.stringify(x.slice(Math.max(0, at - 30), at + 60))}, run B ${JSON.stringify(y.slice(Math.max(0, at - 30), at + 60))}`;
  };
  try {
    const left = JSON.parse(a) as Record<string, unknown>;
    const right = JSON.parse(b) as Record<string, unknown>;
    for (const key of ['code', 'out', 'err', 'threw']) {
      const x = left[key];
      const y = right[key];
      if (x === y) continue;
      if (typeof x === 'string' && typeof y === 'string') return textDifference(x, y, key);
      return `${key}: run A ${JSON.stringify(x)}, run B ${JSON.stringify(y)}`;
    }
    const lf = left.files as Record<string, string>;
    const rf = right.files as Record<string, string>;
    for (const name of [...new Set([...Object.keys(lf), ...Object.keys(rf)])].sort()) {
      if (lf[name] === rf[name]) continue;
      if (typeof lf[name] === 'string' && typeof rf[name] === 'string')
        return textDifference(lf[name] as string, rf[name] as string, `the file ${name}`);
      return `the file ${name}: ${lf[name] === undefined ? 'only run B wrote it' : 'only run A wrote it'}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let guarded = false;

/**
 * Keeps the bank's inspector shut. A product runs in a child of the bank's process, so `process.ppid` names the
 * bank; a SIGUSR1 to it would open the bank's inspector on loopback, and the product could then walk the bank's
 * heap from outside (the N7 cheat of the round-2 audit, moved one process up). A listener of its own on the
 * signal keeps node from opening it.
 */
function guardInspector(): void {
  if (guarded) return;
  guarded = true;
  process.on('SIGUSR1', () => undefined);
}

export class FrameSession {
  private frame?: Frame<Host>;
  private item: { seed: number; tag: string; root: string } | undefined;
  private privateRoot?: string;
  private readonly folders = new Map<string, Folder>();
  private toldFolders = '';
  private readonly callbacks = new Map<number, { fn: (...args: unknown[]) => unknown; owner?: object }>();
  private readonly callbackIds = new WeakMap<object, number>();
  private nextCallback = 0;
  private readonly held = new WeakMap<object, number>();
  private readonly proxies = new Map<string, unknown>();
  private readonly seen = new WeakMap<object, Seen>();
  private readonly errors = new WeakMap<object, number>();
  private readonly exports = new Map<string, unknown>();
  private firstDivergence?: string;
  private commands = 0;
  private commandCpu = 0;
  private generation = 0;
  private readonly tmpRoots: string[];
  private readonly tmpPattern: RegExp;

  constructor(
    private readonly files: { host: string; cli: string; worker: string },
    private readonly constants: WeakMap<object, () => unknown>,
  ) {
    const tmp = tmpdir();
    this.tmpRoots = [...new Set([tmp, realOf(tmp)])].sort((a, b) => b.length - a.length);
    this.tmpPattern = new RegExp(
      `(${this.tmpRoots.map(escapeRegExp).join('|')})/([^/\\s"'\`,;:()\\[\\]{}<>]+)`,
      'g',
    );
  }

  /** Starts an item: the next product call opens a frame drawn from its seed and id. */
  begin(item: { seed: number; tag: string; root: string }): void {
    this.close();
    this.item = item;
  }

  /** Ends the item: closes the frame and returns the first divergence of its two runs. */
  end(): string | undefined {
    const divergence = this.firstDivergence ?? this.where();
    this.close();
    this.item = undefined;
    return divergence;
  }

  /** The frame's divergence, with the first place its two answers differ. */
  private where(): string | undefined {
    const frame = this.frame;
    const said = frame?.divergence();
    if (!frame || said === undefined) return said;
    for (const entry of frame.tape) {
      const outcome = (x: { ret?: unknown; throws?: unknown }) =>
        'throws' in x && x.throws !== undefined ? { throws: x.throws } : { ret: x.ret };
      if (!entry.twin) continue;
      const a = steady(outcome(entry));
      const b = steady(outcome(entry.twin as { ret?: unknown; throws?: unknown }));
      const at = firstDifference(a, b, '');
      if (at) return `${entry.call}: ${at} (${said.slice(0, 200)})`;
    }
    return said;
  }

  private close(): void {
    this.frame?.close();
    this.frame = undefined;
    for (const folder of this.folders.values()) rmSync(folder.mirror, { recursive: true, force: true });
    this.folders.clear();
    this.toldFolders = '';
    if (this.privateRoot) rmSync(this.privateRoot, { recursive: true, force: true });
    this.privateRoot = undefined;
    this.callbacks.clear();
    this.proxies.clear();
    this.exports.clear();
    this.firstDivergence = undefined;
    this.commands = 0;
    this.commandCpu = 0;
    this.generation += 1;
  }

  private root(): string {
    return this.item?.root ?? findRoot(dirname(fileURLToPath(import.meta.url)));
  }

  private host(): Host {
    if (this.frame) return this.frame.product;
    guardInspector();
    const item = this.item ?? { seed: 0, tag: 'blocks', root: this.root() };
    this.privateRoot = mkdtempSync(join(tmpdir(), 'dbf-'));
    this.frame = isolate<Host>({ module: this.files.host, seed: item.seed, tag: item.tag, keep: STEADY });
    this.frame.product.init({ root: this.root(), privateRoot: this.privateRoot });
    return this.frame.product;
  }

  /** One call to the children: the twin's copies brought up to the bank's folders first. */
  private ask<K extends keyof Host>(name: K, ...args: Parameters<Host[K]>): ReturnType<Host[K]> {
    const host = this.host();
    this.syncFolders(host);
    try {
      return (host[name] as (...a: unknown[]) => ReturnType<Host[K]>)(...args);
    } finally {
      for (const folder of this.folders.values()) folder.after = signature(folder.real);
    }
  }

  /* ---------------------------------------------------------------------------------------------------------
   * Folders of the bank the twin works on copies of
   * ------------------------------------------------------------------------------------------------------- */

  private notice(text: string): void {
    if (!this.tmpRoots.some((root) => text.includes(root))) return;
    for (const match of text.matchAll(this.tmpPattern)) {
      const path = `${match[1]}/${match[2]}`;
      if (this.folders.has(path)) continue;
      if (this.privateRoot && (path === this.privateRoot || realOf(path) === realOf(this.privateRoot)))
        continue;
      if ([...this.folders.values()].some((folder) => folder.mirror === path || folder.realMirror === path))
        continue;
      if (!existsSync(path)) continue;
      const real = realOf(path);
      const known = [...this.folders.entries()].find(([, folder]) => folder.real === real);
      if (known) {
        this.folders.set(path, known[1]);
        continue;
      }
      const mirror = mkdtempSync(join(tmpdir(), 'dbm-'));
      rmSync(mirror, { recursive: true, force: true });
      const folder: Folder = { mirror, real, realMirror: '', after: new Map() };
      apply(real, mirror, new Map(), signature(real));
      if (!existsSync(mirror)) mkdirSync(mirror, { recursive: true });
      folder.realMirror = realOf(mirror);
      folder.after = signature(real);
      this.folders.set(path, folder);
    }
  }

  private syncFolders(host: Host): void {
    for (const [path, folder] of this.folders) {
      if (!existsSync(folder.real)) {
        rmSync(folder.mirror, { recursive: true, force: true });
        this.folders.delete(path);
        continue;
      }
      const now = signature(folder.real);
      if (now.size === folder.after.size && [...now].every(([rel, sig]) => folder.after.get(rel) === sig))
        continue;
      apply(folder.real, folder.mirror, folder.after, now);
      folder.after = now;
    }
    const pairs: [string, string][] = [];
    for (const [path, folder] of this.folders) {
      pairs.push([path, folder.mirror]);
      if (folder.real !== path || folder.realMirror !== folder.mirror)
        pairs.push([folder.real, folder.realMirror]);
    }
    const told = JSON.stringify(pairs);
    if (told !== this.toldFolders) {
      this.toldFolders = told;
      host.folders(pairs);
    }
  }

  /* ---------------------------------------------------------------------------------------------------------
   * The bank's values as wire data
   * ------------------------------------------------------------------------------------------------------- */

  private callbackId(fn: (...args: unknown[]) => unknown, owner?: object): number {
    let id = this.callbackIds.get(fn);
    if (id === undefined) {
      this.nextCallback += 1;
      id = this.nextCallback;
      this.callbackIds.set(fn, id);
    }
    this.callbacks.set(id, { fn, ...(owner ? { owner } : {}) });
    return id;
  }

  toWire(value: unknown, owner?: object, path = 'the value', stack: Set<object> = new Set()): Wire {
    if (typeof value === 'string') {
      this.notice(value);
      return value;
    }
    if (typeof value === 'symbol')
      throw new FrameError(`${path} is a symbol: it cannot cross to the product`);
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const id = this.held.get(value);
    if (id !== undefined) return tag('r', id);
    if (typeof value === 'function') {
      const fixed = this.constants.get(value);
      if (fixed) return tag('k', this.toWire(fixed(), undefined, `${path}()`, stack));
      return tag('c', this.callbackId(value as (...args: unknown[]) => unknown, owner));
    }
    if (stack.has(value)) throw new FrameError(`${path} holds a cycle`);
    if (value instanceof Error) {
      const fields: Record<string, unknown> = {};
      for (const [key, each] of Object.entries(value))
        if (key !== 'stack') fields[key] = this.toWire(each, undefined, `${path}.${key}`, stack);
      const known = this.errors.get(value);
      if (known !== undefined) return tag('r', known, fields);
      return tag('e', value.name, value.message, '', fields);
    }
    if (Buffer.isBuffer(value)) return tag('b', value.toString('base64'));
    if (ArrayBuffer.isView(value)) {
      if (value instanceof Uint8Array && value.constructor === Uint8Array) return value;
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      return tag('t', value.constructor.name, bytes.toString('base64'));
    }
    if (value instanceof ArrayBuffer) return tag('ab', Buffer.from(value).toString('base64'));
    if (value instanceof Date) return value;
    if (value instanceof RegExp) return tag('x', value.source, value.flags);
    stack.add(value);
    try {
      if (value instanceof Map)
        return new Map(
          [...value].map(([k, v], i) => [
            this.toWire(k, undefined, `${path}.key[${i}]`, stack),
            this.toWire(v, undefined, `${path}.get(${i})`, stack),
          ]),
        );
      if (value instanceof Set)
        return new Set([...value].map((each, i) => this.toWire(each, undefined, `${path}[${i}]`, stack)));
      const seen = this.seen.get(value);
      if (Array.isArray(value)) {
        const items = value.map((each, i) => this.toWire(each, undefined, `${path}[${i}]`, stack));
        if (seen && this.unchanged(value, seen, items)) return tag('r', seen.id);
        return items;
      }
      if (!isPlain(value)) {
        const name = (Object.getPrototypeOf(value) as { constructor?: { name?: string } })?.constructor?.name;
        throw new FrameError(
          `${path} is an instance of ${name ?? 'a class'}: it cannot cross to the product`,
        );
      }
      const object: Record<string, unknown> = {};
      const keys = Object.keys(value);
      for (const key of keys) {
        if (key === TAG) throw new FrameError(`${path} has a key the frame reserves`);
        object[key] = this.toWire((value as Record<string, unknown>)[key], value, `${path}.${key}`, stack);
      }
      if (
        seen &&
        this.unchanged(
          value,
          seen,
          keys.map((key) => object[key]),
        )
      )
        return tag('r', seen.id);
      return object;
    } finally {
      stack.delete(value);
    }
  }

  /** Whether a copy the child gave is as it was given: same keys, same values, nested copies unchanged. */
  private unchanged(value: object, seen: Seen, encoded: unknown[]): boolean {
    const keys = Object.keys(value);
    if (keys.length !== seen.keys.length || keys.some((key, i) => key !== seen.keys[i])) return false;
    const current = keys.map((key) => (value as Record<string, unknown>)[key]);
    return current.every((each, i) => {
      if (each !== seen.values[i]) return false;
      if (each === null || typeof each !== 'object') return true;
      const parts = tagged(encoded[i]);
      return parts?.[0] === 'r';
    });
  }

  fromWire(value: Wire, self?: number): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((each) => this.fromWire(each));
    if (value instanceof Map)
      return new Map([...value].map(([k, v]) => [this.fromWire(k), this.fromWire(v)]));
    if (value instanceof Set) return new Set([...value].map((each) => this.fromWire(each)));
    if (value instanceof Date || value instanceof Uint8Array) return value;
    const parts = tagged(value);
    if (!parts) {
      const object: Record<string, unknown> = {};
      for (const [key, each] of Object.entries(value)) object[key] = this.fromWire(each);
      return object;
    }
    const [kind, a, b, c, d, e] = parts as [string, unknown, unknown, unknown, unknown, unknown];
    switch (kind) {
      case 'p': {
        const copy = Array.isArray(b)
          ? b.map((each) => this.fromWire(each))
          : (this.fromWire(b) as Record<string, unknown>);
        const keys = Object.keys(copy);
        this.seen.set(copy, {
          id: a as number,
          keys,
          values: keys.map((key) => (copy as Record<string, unknown>)[key]),
        });
        return copy;
      }
      case 'f':
        return this.stub(a as number, String(b), Number(c), self);
      case 'o':
        return this.objectProxy(a as number, String(b));
      case 'e': {
        const error = new Error(String(c));
        error.name = String(b);
        Object.assign(error, this.fromWire(e));
        void d;
        if (a !== null) this.errors.set(error, a as number);
        return error;
      }
      case 'x':
        return new RegExp(String(a), String(b));
      case 'b':
        return Buffer.from(String(a), 'base64');
      case 't': {
        const bytes = new Uint8Array(Buffer.from(String(b), 'base64')).buffer;
        const Typed = (globalThis as unknown as Record<string, unknown>)[String(a)] as
          | (new (
              buffer: ArrayBuffer,
              offset: number,
              length: number,
            ) => unknown)
          | undefined;
        if (typeof Typed !== 'function') return new Uint8Array(bytes);
        const width = (Typed as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
        return new Typed(bytes, 0, bytes.byteLength / width);
      }
      case 'ab':
        return new Uint8Array(Buffer.from(String(a), 'base64')).buffer;
      case 'y':
        return Symbol(String(a));
      default:
        throw new FrameError(`the product sent a value of an unknown kind ${kind}`);
    }
  }

  /* ---------------------------------------------------------------------------------------------------------
   * Proxies of the values the children hold
   * ------------------------------------------------------------------------------------------------------- */

  private stale(generation: number): void {
    if (generation !== this.generation)
      throw new FrameError('a value of the product from an earlier item was used: its frame is closed');
  }

  private stub(id: number, name: string, length: number, self?: number): unknown {
    const key = self === undefined ? `f${id}` : `f${id}.${self}`;
    const cached = this.proxies.get(key);
    if (cached) return cached;
    const generation = this.generation;
    const session = this;
    const shape = function (this: unknown) {};
    Object.defineProperty(shape, 'name', { value: name });
    Object.defineProperty(shape, 'length', { value: length });
    const proxy: unknown = new Proxy(shape, {
      apply(_target, thisArg, args) {
        session.stale(generation);
        const holder =
          self !== undefined
            ? tag('r', self)
            : thisArg !== null &&
                (typeof thisArg === 'object' || typeof thisArg === 'function') &&
                session.held.has(thisArg)
              ? tag('r', session.held.get(thisArg) as number)
              : null;
        return session.callWire(['r', id], null, holder, args);
      },
      construct(_target, args) {
        session.stale(generation);
        return session.drive(session.ask('construct', ['r', id], session.toWire(args))) as object;
      },
      get(target, key) {
        if (key === Symbol.hasInstance)
          return (value: unknown) =>
            value !== null &&
            typeof value === 'object' &&
            session.held.has(value) &&
            session.ask('instance', session.held.get(value) as number, id);
        if (key === 'name' || key === 'length') return Reflect.get(target, key);
        if (typeof key === 'symbol' || key === 'then') return undefined;
        session.stale(generation);
        return session.fromWire(session.ask('get', ['r', id], key));
      },
    });
    this.held.set(proxy as object, id);
    this.proxies.set(key, proxy);
    return proxy;
  }

  private objectProxy(id: number, className: string): unknown {
    const key = `o${id}`;
    const cached = this.proxies.get(key);
    if (cached) return cached;
    const generation = this.generation;
    const session = this;
    const where = ['r', id];
    const proxy: unknown = new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        if (key === Symbol.toStringTag) return className;
        if (typeof key === 'symbol' || key === 'then') return undefined;
        session.stale(generation);
        return session.fromWire(session.ask('get', where, key), id);
      },
      set(_target, key, value) {
        if (typeof key === 'symbol') return false;
        session.stale(generation);
        session.ask('put', where, key, session.toWire(value));
        return true;
      },
      deleteProperty(_target, key) {
        if (typeof key === 'symbol') return false;
        session.stale(generation);
        session.ask('remove', where, key);
        return true;
      },
      has(_target, key) {
        if (typeof key === 'symbol') return false;
        session.stale(generation);
        return session.ask('has', where, key);
      },
      ownKeys() {
        session.stale(generation);
        return session.ask('keys', where);
      },
      getOwnPropertyDescriptor(_target, key) {
        if (typeof key === 'symbol') return undefined;
        session.stale(generation);
        if (!session.ask('keys', where).includes(key)) return undefined;
        return {
          value: session.fromWire(session.ask('get', where, key), id),
          writable: true,
          enumerable: true,
          configurable: true,
        };
      },
      defineProperty(_target, key, descriptor) {
        if (typeof key === 'symbol') return false;
        session.stale(generation);
        session.ask('put', where, key, session.toWire(descriptor.value));
        return true;
      },
    });
    this.held.set(proxy as object, id);
    this.proxies.set(key, proxy);
    return proxy;
  }

  /** A product package: each export read from the children, a function kept for the item. */
  module(name: string): Record<string, unknown> {
    const session = this;
    const where = ['m', name];
    const read = (key: string): unknown => {
      const cacheKey = `${session.generation}:${name}.${key}`;
      if (session.exports.has(cacheKey)) return session.exports.get(cacheKey);
      const value =
        name === 'adapters' && key === 'functionAdapter'
          ? session.functionAdapter()
          : session.fromWire(session.ask('get', where, key));
      if (typeof value === 'function') session.exports.set(cacheKey, value);
      return value;
    };
    return new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined;
        return read(key);
      },
      has(_target, key) {
        return typeof key === 'string' && session.ask('has', where, key);
      },
      ownKeys() {
        return session.ask('keys', where);
      },
      getOwnPropertyDescriptor(_target, key) {
        if (typeof key === 'symbol' || !session.ask('has', where, key)) return undefined;
        return { value: read(key), writable: false, enumerable: true, configurable: true };
      },
    });
  }

  /* ---------------------------------------------------------------------------------------------------------
   * Calls
   * ------------------------------------------------------------------------------------------------------- */

  private callWire(where: Wire, key: string | null, self: Wire, args: unknown[]): unknown {
    return this.drive(this.ask('call', where, key, self, this.toWire(args, undefined, 'the arguments')));
  }

  /** Runs a call to its end: each request of a function of the bank answered here, synchronously while it can. */
  private drive(first: Step): unknown {
    let step = first;
    for (;;) {
      if ('done' in step) return this.fromWire(step.done);
      if ('threw' in step) throw this.fromWire(step.threw);
      let result: unknown;
      let failure: { error: unknown } | undefined;
      try {
        result = this.invoke(step.cb, step.args);
      } catch (error) {
        failure = { error };
      }
      if (!failure && isThenable(result)) return this.driveLater(step, result);
      step = this.answer(step, failure, result);
    }
  }

  private async driveLater(step: { op: number; n: number }, pending: PromiseLike<unknown>): Promise<unknown> {
    let result: unknown;
    let failure: { error: unknown } | undefined;
    try {
      result = await pending;
    } catch (error) {
      failure = { error };
    }
    return this.drive(this.answer(step, failure, result));
  }

  private answer(
    step: { op: number; n: number },
    failure: { error: unknown } | undefined,
    result: unknown,
  ): Step {
    let outcome: { value?: Wire; threw?: Wire };
    try {
      outcome = failure ? { threw: this.toWire(failure.error) } : { value: this.toWire(result) };
    } catch (error) {
      outcome = { threw: this.toWire(error) };
    }
    return this.ask('resume', step.op, step.n, outcome);
  }

  private invoke(id: number, args: Wire): unknown {
    const entry = this.callbacks.get(id);
    if (!entry)
      throw new FrameError(`the product called a function of the validator it was not handed (${id})`);
    return Reflect.apply(entry.fn, entry.owner, this.fromWire(args) as unknown[]);
  }

  /**
   * The product's function adapter with the agent's state kept here: `create` and `respond` run in the bank, and
   * the payload log the product reads synchronously crosses with each reply.
   */
  private functionAdapter(): (options: Record<string, unknown>) => unknown {
    return (options: Record<string, unknown>) => {
      const { create, payloads, respond, ...rest } = options as {
        create?: (given: unknown) => unknown;
        payloads?: (state: unknown) => unknown[];
        respond: (...args: unknown[]) => unknown;
      } & Record<string, unknown>;
      const states = new Map<number, unknown>();
      let next = 0;
      const open = async (given: unknown) => {
        next += 1;
        states.set(next, create ? await create(given) : undefined);
        return next;
      };
      const reply = async (messages: unknown, world: unknown, vars: unknown, sid: number, ctx: unknown) => {
        const state = states.get(sid);
        const answer = await respond(messages, world, vars, state, ctx);
        return { reply: answer, ...(payloads ? { payloads: payloads(state) } : {}) };
      };
      return this.drive(
        this.ask(
          'functionAgent',
          this.toWire({ ...rest, payloads: payloads !== undefined }),
          this.toWire(open),
          this.toWire(reply),
        ),
      );
    };
  }

  /** A CODE planted agent built in the children (kinds.ts): its adapter and the path of its log. */
  codeAgent(options: Record<string, unknown>): { adapter: Record<string, unknown>; log: string } {
    return this.drive(this.ask('codeAgent', this.toWire(options))) as {
      adapter: Record<string, unknown>;
      log: string;
    };
  }

  /**
   * The CPU time the product has used for this item, in milliseconds: run A's process (its packages loaded first)
   * and the command lines it ran. A timing item adds it to its own.
   */
  cpuMs(): number {
    return this.ask('cpu') + this.commandCpu;
  }

  /** The log of a planted code agent, as its twin A wrote it. */
  delivered(log: string): string {
    if (!this.frame) return '';
    return this.ask('delivered', log);
  }

  /* ---------------------------------------------------------------------------------------------------------
   * The command line
   * ------------------------------------------------------------------------------------------------------- */

  /**
   * `driftbench <argv>` in `cwd`, as a command under the frame: the folder's files go to each run's own working
   * folder, the command runs there, and run A's files come back to the folder. The two runs go off the main thread
   * (cli-worker.ts), which answers the item's planted agents meanwhile (agents.ts).
   */
  async cli(argv: readonly string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
    const item = this.item ?? { seed: 0, tag: 'blocks', root: this.root() };
    this.commands += 1;
    // The folder the command works in: `cwd`, widened to hold every path under the same temporary root that an
    // argument names, so each run of the frame gets all of it in a folder of its own.
    let base = cwd;
    const top = this.tmpRoots.find((root) => cwd.startsWith(`${root}/`));
    if (top)
      for (const arg of argv)
        for (const match of arg.matchAll(
          new RegExp(`${escapeRegExp(top)}/[^\\s"'\`,;:()\\[\\]{}<>]+`, 'g'),
        )) {
          const path = match[0];
          while (base !== top && !(path === base || path.startsWith(`${base}/`))) base = dirname(base);
        }
    if (base === top) base = cwd;
    const inName = `${neutralName(item.seed, `${item.tag}#cli-in#${this.commands}`)}.in`;
    const outName = `${neutralName(item.seed, `${item.tag}#cli-out#${this.commands}`)}.out`;
    const answers = mkdtempSync(join(tmpdir(), 'dba-'));
    const before = pack(base);
    try {
      const run = await this.offThread({
        command: [this.files.cli, inName, outName],
        seed: item.seed,
        tag: `${item.tag}#cli#${this.commands}`,
        files: {
          [inName]: JSON.stringify({
            root: this.root(),
            dir: base,
            realDir: realOf(base),
            cwd: relative(base, cwd),
            argv,
            files: before,
            agents: liveAgents(),
            answers: join(answers, 'answers.jsonl'),
          }),
        },
        collect: [outName],
        timeoutMs: CLI_MS,
      });
      if (run.divergence && this.firstDivergence === undefined)
        this.firstDivergence = `driftbench ${argv.join(' ').slice(0, 80)}: ${commandDifference(run, outName) ?? run.divergence}`;
      const lines = existsSync(join(answers, 'answers.jsonl'))
        ? readFileSync(join(answers, 'answers.jsonl'), 'utf8').split('\n')
        : [];
      const first = lines[0];
      if (typeof run.files[outName] !== 'string' || !first)
        throw new Error(
          `the command line did not finish (status ${run.status}): ${run.stderr.split('\n').slice(-6).join(' ').slice(0, 400)}`,
        );
      const result = JSON.parse(first) as {
        code: number;
        out: string;
        err: string;
        threw?: string;
        files: Record<string, string | { link: string }>;
        cpuMs?: number;
      };
      this.commandCpu += result.cpuMs ?? 0;
      for (const rel of Object.keys(before).sort((a, b) => b.length - a.length))
        if (!(rel in result.files)) rmSync(join(base, rel), { recursive: true, force: true });
      for (const [rel, body] of Object.entries(result.files).sort(([a], [b]) => a.length - b.length)) {
        const path = join(base, rel);
        const prior = before[rel];
        if (rel.endsWith('/')) {
          mkdirSync(path, { recursive: true });
          continue;
        }
        if (prior !== undefined && JSON.stringify(prior) === JSON.stringify(body)) continue;
        if (existsSync(path) || isLink(path)) rmSync(path, { recursive: true, force: true });
        mkdirSync(dirname(path), { recursive: true });
        if (typeof body === 'string') writeFileSync(path, Buffer.from(body, 'base64'));
        else symlinkSync(body.link, path);
      }
      if (result.threw !== undefined) throw new Error(result.threw);
      return { code: result.code, out: result.out, err: result.err };
    } finally {
      rmSync(answers, { recursive: true, force: true });
    }
  }

  /** The frame's command runner, in a worker of its own: the main thread keeps answering meanwhile. */
  private offThread(options: CommandOptions): Promise<CommandRun> {
    const worker = this.files.worker.endsWith('.ts')
      ? new Worker(pathToFileURL(this.files.worker), {
          workerData: { options },
          execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],
        })
      : new Worker(pathToFileURL(this.files.worker), { workerData: { options } });
    return new Promise((resolve, reject) => {
      let answered = false;
      worker.once('message', (run: CommandRun) => {
        answered = true;
        resolve(run);
        void worker.terminate();
      });
      worker.once('error', (error) => {
        answered = true;
        reject(error);
      });
      worker.once('exit', (code) => {
        if (!answered) reject(new Error(`the command's worker ended (${code}) with no answer`));
      });
    });
  }
}
