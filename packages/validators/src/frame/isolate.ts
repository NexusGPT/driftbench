import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { findRoot } from '../root';
import {
  checkMark,
  confine,
  markPath,
  realOf,
  type SealDescriptor,
  sealOnce,
  setMark,
  TreeWatch,
  tsxPath,
} from './confine';
import { plainBatchEntry, plainCodec, RELAY, twinDriver, wrapperModule } from './driver';
import { runTag, spawnGrouped } from './group';
import {
  canonical,
  decode,
  type Entry,
  encode,
  FrameError,
  type Json,
  type Outcome,
  shortText,
  type Tape,
} from './tape';
import { TRACE, traceLine } from './trace';
import { rngOf, type TwinPlan, twinPlans, userEnv } from './twins';

/**
 * The frame: the product runs apart, the parent decides (docs/validators.md, the section of that name). The
 * cheater audits of the system, blocks and estate ladders found products that gave the right answer only when they
 * saw a validator run them: by its process arguments, its loader, its working folder, its environment, its call
 * stack or its uptime. No check that runs the product in the validator's own process can hide those. The frame
 * runs the product in two child processes that differ in each of them (twins.ts), records every call and both
 * answers on a tape, and gives the item the answers as data, so the item's verdict is computed in the parent from
 * recorded outputs only. A call whose two answers differ is the frame's own finding: the product's answer depends
 * on how it is run.
 *
 * Both twins are still programs the frame wrote, and a review of this frame found products keyed on what the twins
 * share (an .mjs entry, a stdin that is no terminal, no node options). So each call is made a third time, in run C:
 * a fresh process per call that loads the product through a plain entry file, as a user's own script does (a
 * TypeScript entry under the tsx loader, no stdin protocol, the answer written to a file). Run C answering
 * differently from run A is a finding too. No run makes the validator indistinguishable from a user; run C narrows
 * the gap (docs/validators.md section 12.9).
 */

const START_MS = 120_000;
const CALL_MS = 300_000;
/** The time run C may take to make all the calls of a frame. */
const BATCH_MS = 1_800_000;

function projectCache(): string {
  return join(findRoot(dirname(new URL(import.meta.url).pathname)), 'node_modules', '.cache');
}

/** Seeded names are only prefixes: each live frame owns the files it writes and removes. */
function ownFolder(prefix: string): string {
  mkdirSync(dirname(prefix), { recursive: true });
  return mkdtempSync(prefix);
}

/** Keep the drawn traits, but move every path of a twin into its own atomically allocated folder. */
function ownPlan(plan: TwinPlan): TwinPlan {
  const driverDir = ownFolder(plan.driverDir);
  const move = (path: string) => join(driverDir, relative(plan.driverDir, path));
  const home = plan.home ? move(plan.home) : undefined;
  return {
    ...plan,
    driverDir,
    ...(plan.cwd ? { cwd: move(plan.cwd) } : {}),
    ...(home
      ? { home, env: { ...plan.env, HOME: home, ...(plan.env?.USERPROFILE ? { USERPROFILE: home } : {}) } }
      : {}),
  };
}

/** Publish complete bytes, and remove only this writer's unpublished temporary file on failure. */
function writeAtomic(file: string, bytes: string): void {
  const temporary = `${file}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** What the validator keeps of an answer before the two runs are compared, by export name. */
export type Keep = Record<string, (value: unknown) => unknown>;

export type IsolateOptions = {
  /** The absolute path of the product module (a .ts source is loaded through tsx). */
  module: string;
  /** The item's seed: it draws the two runs. */
  seed: number;
  /** A tag that separates the frames of one seed (the item id). */
  tag?: string;
  /** What to keep of an answer before the runs are compared: drop what is allowed to differ, such as a clock. */
  keep?: Keep;
  /**
   * Make each call in run C too (default true). Run C is one fresh process that makes every call of the frame once,
   * in order, when the frame is read (`divergence()`, `tainted()`) or closed. A call that differs is a finding that
   * holds for the whole frame (`tainted()`), since a product that answers by how it is run does so on any call.
   */
  plain?: boolean;
  /**
   * What a function in an argument becomes (the default refuses it). `'source'` sends its source text, which the
   * confined run rebuilds: for a pure function of the validator, such as a statistic handed to the product. A
   * function the product returned is always a handle and is sent back as one.
   */
  functions?: 'source';
  /**
   * Each confined run keeps the live results of its last calls and reports a call after which one of them reads
   * otherwise than when it was returned (one object filled again, an earlier result overwritten). The report is a
   * finding of the frame (`aliasSince()`); no live object crosses to the validator. Default false.
   */
  aliasing?: boolean;
  /**
   * The bundle the invocation sealed (confine.ts `describeSeal`), when this frame runs in a child process of the
   * invocation: the frame runs that bundle, after checking its hash, and builds none.
   */
  sealed?: SealDescriptor;
  /**
   * Source folders besides the product's own that the bundle may be built from (a workspace package the product
   * imports). A file outside the product's tree and these folders is refused when the product is bundled.
   */
  sources?: string[];
  /**
   * Files or folders the confined runs may read besides the bundled product (confine.ts), by absolute path: a data
   * file the product reads through `import.meta.url`. Never a folder that holds the expected values.
   */
  reads?: string[];
  /**
   * Variables every run gets, the same in each (run A, B, D and C): a setting the product reads, such as the path of
   * a file granted in `reads`. Never a value that tells the runs apart.
   */
  env?: Record<string, string>;
  /**
   * Variables no run gets, removed from the validator's environment too (run A and run C start from it): a setting of
   * the validator's own that the product must not act on.
   */
  unset?: string[];
  /**
   * Each run gets a fresh folder of its own that it may read and write, as its temporary folder (TMPDIR, TMP and
   * TEMP): for a product that writes files only to read them back. It is removed with the run's folder.
   */
  scratch?: boolean;
  /**
   * The number of new result objects one call may make before the frame fails it (default 2^24): the ids of a call's
   * new objects take that many numbers. A test sets a small number to take that path; the validator never sets it.
   */
  idSpan?: number;
};

/** Ambient conditions of a call (`Frame.ambient`). */
export type Ambient = { random?: boolean; clock?: number; crypto?: boolean };

export type Frame<T> = {
  /** The product, as the item calls it: each call goes to both runs and answers what run A answered. */
  product: T;
  /** Every call so far, with the answers of all runs. Reading it makes the calls in run C first, if any are held. */
  readonly tape: Tape;
  /** Where the time of the frame went, in milliseconds: encoding, waiting for the confined runs, decoding, run C. */
  spent(): {
    calls: number;
    encodeMs: number;
    relayMs: number;
    decodeMs: number;
    plainMs: number;
    top: Array<{ name: string; calls: number; ms: number; slow: number }>;
  };
  /** The number of calls so far: a mark for `cpuSince` and `divergenceSince`; it does not run run C. */
  position(): number;
  /** The first call whose runs answered differently, as a message, or undefined. */
  divergence(): string | undefined;
  /** The processor time the product used for the calls from the tape position `from` on, in milliseconds (run A). */
  cpuSince(from: number): number;
  /** The first divergence among the calls from the tape position `from` on, or undefined. */
  divergenceSince(from: number): string | undefined;
  /**
   * From now on, until switched off, every call is strict: its arguments reach the product frozen at every depth, in
   * every run, and a digest of them before and after the call reports a write the freeze cannot stop. For an item that
   * declares a purity check; the frame adds no rule to any other call.
   */
  strictArguments(on: boolean): void;
  /**
   * From now on, until switched off (undefined), every call runs under these ambient conditions in every run: a
   * Math.random that throws, a clock that stands still at `clock` (ms), crypto random functions that throw. For an
   * item that sets them around its calls in its own process; they hold for each call only.
   */
  ambient(spec: Ambient | undefined): void;
  /**
   * Switches the identity watch on (true: a fresh watch) or off. While it is on, each run counts the objects of a
   * result that are also objects of the call's arguments or of a result returned since the watch began, and the frame
   * reports such a call (`sharedSince`). For an item that checks that its results are fresh: a copy of the answer
   * hides both from the caller.
   */
  identity(on: boolean): void;
  /** The first call from the tape position `from` on whose result shares objects (option `identity`), or undefined. */
  sharedSince(from: number): string | undefined;
  /** The first aliased result among the calls from the tape position `from` on, or undefined (option `aliasing`). */
  aliasSince(from: number): string | undefined;
  /**
   * The first call from the tape position `from` on after which a confined run found a built-in object changed since
   * before the product loaded (a method replaced, a property added or removed, a descriptor, a prototype, the
   * extensibility, a standard global name rebound), as a message naming it, or undefined. Always watched.
   */
  alteredSince(from: number): string | undefined;
  /** The message of the first sampled run C call that differed from run A, or undefined: it taints every call. */
  tainted(): string | undefined;
  /** Ends both runs and removes their files. */
  close(): void;
};

type Relay = { worker: Worker; port: MessagePort; flag: Int32Array };

/**
 * The reply of the relay to the call with this number: the relay numbers the calls from 1 in the order they arrive, and
 * puts the number in its reply. A reply with another number is a reply to another call (one left in the queue by an
 * earlier call that gave up, or one that is late): named with both numbers and both call names, never taken for the
 * answer. A run that answered another request is named the same way.
 */
export function checkReply(reply: Record<string, unknown>, expected: number, name: string): void {
  if (reply.id !== undefined && reply.id !== expected)
    throw new FrameError(
      `the relay answered call ${String(reply.id)} (${String(reply.call)}) while call ${expected} (${name}) was waiting: the frame is out of step`,
    );
  const answers = reply.answers as Array<Record<string, unknown>> | undefined;
  const desync = answers?.find((each) => typeof each.desync === 'string');
  if (desync) throw new FrameError(`${String(desync.desync)} (call ${expected}, ${name})`);
}

function wait(relay: Relay, ms: number, what: string): Record<string, unknown> {
  const waited = Atomics.wait(relay.flag, 0, 0, ms);
  const reply = receiveMessageOnPort(relay.port)?.message as Record<string, unknown> | undefined;
  Atomics.store(relay.flag, 0, 0);
  if (waited === 'timed-out' || reply === undefined)
    throw new FrameError(`no answer to ${what} within ${ms / 1000} s`);
  return reply;
}

const describeRun = (plan: TwinPlan | 'C') =>
  plan === 'C'
    ? "run C (user-shaped: a plain entry file per call under the tsx loader, the user's environment)"
    : plan.run === 'A'
      ? 'run A (confined: the validator folder and environment)'
      : plan.run === 'B'
        ? `run B (confined: a fresh folder, a bare environment, uptime +${plan.uptimeShift} s)`
        : 'run D (confined: behind a neutral wrapper module, a fresh folder, neutral arguments)';

/** The tsx loader as a node option for run C, when tsx is installed (found from the product's checkout too). */
function loaderOption(module: string): string[] {
  const tsx = tsxPath(module);
  return tsx ? ['--import', pathToFileURL(tsx).href] : [];
}

/** A folder name drawn from the seed and the tag: letters only, six to thirteen of them. */
function drawnFolder(seed: number, tag: string): string {
  const rng = rngOf(seed, tag);
  let folder = '';
  while (folder.length < 6 + Math.floor(rng() * 8))
    folder += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)];
  return folder;
}

type PlainRun = {
  dir: string;
  codec: string;
  codecNames: Omit<ReturnType<typeof plainCodec>, 'source'>;
  count: number;
  /** The file of the calls run C makes, one JSON line each, in the order they were made. */
  calls: string;
  /** Run C's environment: the user's (`userEnv`). */
  env: Record<string, string>;
};

/** Opens run C: a drawn folder in the project's cache, holding the codec module. */
function openPlain(seed: number, tag: string): PlainRun {
  const rng = rngOf(seed, `plain:${tag}`);
  let folder = '';
  while (folder.length < 6 + Math.floor(rng() * 8))
    folder += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)];
  const dir = ownFolder(join(projectCache(), folder));
  const codec = plainCodec(seed, tag);
  const codecPath = join(dir, `${folder.slice(0, 4)}${Math.floor(rng() * 1000)}.mjs`);
  writeAtomic(codecPath, codec.source);
  return {
    dir,
    codec: codecPath,
    codecNames: codec,
    count: 0,
    calls: join(dir, 'calls.jsonl'),
    env: userEnv(),
  };
}

/** The lines of a file, read in blocks: an answer can be tens of megabytes, so the file is never read whole. */
function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, 'r');
  try {
    const block = Buffer.alloc(8 * 1024 * 1024);
    let rest = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, block, 0, block.length, null);
      if (read === 0) break;
      rest = Buffer.concat([rest, block.subarray(0, read)]);
      for (let at = rest.indexOf(10); at >= 0; at = rest.indexOf(10)) {
        yield rest.subarray(0, at).toString('utf8');
        rest = rest.subarray(at + 1);
      }
    }
    if (rest.length > 0) yield rest.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Run C: one fresh process that makes every call recorded in `plain.calls` in order, the way a user's script does,
 * and appends each answer to a file. Returns the answers read back one by one, or one `dead` answer per call when
 * the process ended before it wrote them.
 */
function plainRunAll(
  plain: PlainRun,
  seed: number,
  tag: string,
  module: string,
  count: number,
): Array<Outcome | { dead: string }> {
  plain.count += 1;
  const stem = `${tag.length.toString(36)}${plain.count}`;
  // .mts: an ES module whatever the folder's package type, so the entry may await at its top level.
  const entry = join(plain.dir, `${stem}.mts`);
  const out = join(plain.dir, `${stem}.out.jsonl`);
  writeAtomic(
    entry,
    plainBatchEntry(
      seed,
      `${tag}:${plain.count}`,
      {
        module: pathToFileURL(module).href,
        codec: pathToFileURL(plain.codec).href,
        calls: pathToFileURL(plain.calls).href,
        out: pathToFileURL(out).href,
      },
      plain.codecNames,
    ),
  );
  const ran = spawnGrouped(
    process.execPath,
    [...loaderOption(module), entry],
    runTag(seed, `${tag}:${plain.count}`, plain.dir),
    {
      cwd: findRoot(dirname(module)),
      env: plain.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BATCH_MS,
    },
  );
  try {
    const answers: Array<Outcome | { dead: string }> = [];
    if (existsSync(out)) for (const line of linesOf(out)) answers.push(JSON.parse(line) as Outcome);
    const dead = {
      dead: `run C ended (${ran.status ?? ran.signal}) after ${answers.length} of ${count} calls: ${(ran.stderr ?? '').split('\n').slice(-6).join(' ')}`,
    };
    while (answers.length < count) answers.push(dead);
    return answers;
  } finally {
    for (const file of [entry, out]) rmSync(file, { force: true });
  }
}

/** How a call is compared between runs: what the caller keeps of the answer, or the throw. */
function keptOf(
  outcome: Outcome | { dead: string },
  keep: ((value: unknown) => unknown) | undefined,
): string {
  if ('dead' in outcome) return 'dead';
  if ('throws' in outcome) return `throws ${canonical(outcome.throws)}`;
  return canonical(keep ? encode(keep(decode(outcome.ret))) : outcome.ret);
}

const outcomeText = (outcome: Outcome | { dead: string }) =>
  'dead' in outcome
    ? outcome.dead
    : 'throws' in outcome
      ? `threw ${shortText(outcome.throws, 80)}`
      : shortText(outcome.ret, 80);

const isPlain = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** The kind of a value that can be changed in place, or undefined. */
function kindOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return 'array';
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return 'typed';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  if (value instanceof Date) return 'date';
  return isPlain(value) ? 'object' : undefined;
}

/**
 * The value a slot holds after a write-back: the old object, changed in place, when the old value and the state after
 * the call are the same kind of object (so a caller's references to it stay valid and see the change); the state
 * after the call otherwise. A function the caller holds stays.
 */
function merged(old: unknown, now: unknown): unknown {
  if (typeof old === 'function') return old;
  const kind = kindOf(old);
  if (kind !== undefined && kind === kindOf(now) && !Object.isFrozen(old)) {
    changeInPlace(old as object, now as object, kind);
    return old;
  }
  return now;
}

/** The text of a value that is an object, or undefined: how a key of a Map or a member of a Set is matched. */
function textOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * The old key or member that an object of the state after the call stands for: the first unused one that reads the
 * same, so the caller's object keeps its identity and is changed in place. A primitive stands for itself.
 */
function keptKey(old: unknown[], used: Set<number>, key: unknown, position?: number): unknown {
  const text = textOf(key);
  if (text === undefined) return key;
  for (let at = 0; at < old.length; at += 1) {
    if (used.has(at) || textOf(old[at]) !== text) continue;
    used.add(at);
    return old[at];
  }
  // The product changed the content of the key itself: when nothing was added or removed, the key at the same place
  // in the order stands for it.
  if (position !== undefined && !used.has(position) && textOf(old[position]) !== undefined) {
    used.add(position);
    return old[position];
  }
  return key;
}

/** Makes `target` read like `source`, keeping `target` the same object (arrays, typed arrays, Maps, Sets, Dates, plain objects). */
function changeInPlace(target: object, source: object, kind: string): void {
  if (kind === 'array') {
    const to = target as unknown[];
    const from = source as unknown[];
    to.length = from.length;
    for (let at = 0; at < from.length; at += 1) to[at] = merged(to[at], from[at]);
  } else if (kind === 'typed') {
    const to = target as unknown as Record<number, unknown> & { length: number };
    const from = source as unknown as Record<number, unknown> & { length: number };
    if (to.length === from.length) for (let at = 0; at < to.length; at += 1) to[at] = from[at];
  } else if (kind === 'map') {
    const to = target as Map<unknown, unknown>;
    const oldKeys = [...to.keys()];
    const used = new Set<number>();
    const sameSize = oldKeys.length === (source as Map<unknown, unknown>).size;
    let at = 0;
    const position = (index: number) => (sameSize ? index : undefined);
    const entries = [...(source as Map<unknown, unknown>).entries()].map(([key, value]) => {
      const kept = keptKey(oldKeys, used, key, position(at++));
      // A key that stands for an old object keeps that object (changed in place); the old value follows the old key.
      const stays = kept !== key;
      const slot = stays ? kept : key;
      const before = to.has(slot) ? to.get(slot) : undefined;
      return [stays ? merged(kept, key) : key, before === undefined ? value : merged(before, value)] as const;
    });
    to.clear();
    for (const [key, value] of entries) to.set(key, value);
  } else if (kind === 'set') {
    const to = target as Set<unknown>;
    const oldKeys = [...to.values()];
    const used = new Set<number>();
    const sameSize = oldKeys.length === (source as Set<unknown>).size;
    let at = 0;
    const values = [...(source as Set<unknown>).values()].map((value) => {
      const kept = keptKey(oldKeys, used, value, sameSize ? at++ : undefined);
      return kept === value ? value : merged(kept, value);
    });
    to.clear();
    for (const value of values) to.add(value);
  } else if (kind === 'date') {
    (target as Date).setTime((source as Date).getTime());
  } else {
    // Own keys only, whatever their names (toString, constructor, __proto__ are keys like any other), in the order of
    // the state after the call; a value that is an object keeps the identity of the old one when it can.
    const to = target as Record<string, unknown>;
    const from = source as Record<string, unknown>;
    const old = new Map(Object.keys(to).map((key) => [key, to[key]] as const));
    for (const key of Object.keys(to)) Reflect.deleteProperty(to, key);
    for (const key of Object.keys(from)) {
      Object.defineProperty(to, key, {
        value: merged(old.get(key), from[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

/** Applies the state of one argument after the call to the caller's argument: only an object can be changed in place. */
function writeBack(args: unknown[], at: number, now: unknown): void {
  const old = args[at];
  const kind = kindOf(old);
  if (kind !== undefined && kind === kindOf(now) && !Object.isFrozen(old))
    changeInPlace(old as object, now as object, kind);
}

/**
 * The states of the caller's own arguments, by path (keys of plain objects, indices of arrays): 'f' frozen, 's'
 * sealed, 'x' not extensible. The runs give each decoded object the state its caller's object has (driver.ts,
 * `markAll`). Every path to an object is listed, so an object reached twice is marked at both copies.
 */
/** A step of a path: a key, or into a Map's key or value (['m', entry, 'k' | 'v']) or a Set's member (['s', member]). */
type Step = string | number | ['m', number, 'k' | 'v'] | ['s', number];
type Path = Step[];
function marksOf(
  args: readonly unknown[],
  idOf: (value: object) => number,
): { marks?: Array<[Path, 'f' | 's' | 'x']>; refs?: Array<[Path, number]> } {
  const out: Array<[Path, 'f' | 's' | 'x']> = [];
  const refs: Array<[Path, number]> = [];
  const path: Path = [];
  const ancestors: object[] = [];
  let visited = 0;
  // Inside a Map or a Set only ids are sent: the freeze marks go by keys alone.
  let inside = 0;
  const walk = (value: unknown) => {
    if (value === null || typeof value !== 'object' || ancestors.length > 1000 || visited > 1_000_000) return;
    if (ancestors.includes(value)) return;
    visited += 1;
    const state = Object.isFrozen(value)
      ? 'f'
      : Object.isSealed(value)
        ? 's'
        : !Object.isExtensible(value)
          ? 'x'
          : undefined;
    if (state && inside === 0) out.push([[...path], state]);
    // Every path to an object, with the object's id: the run gives each the same object (driver.ts, applyRefs).
    refs.push([[...path], idOf(value)]);
    ancestors.push(value);
    const visit = (key: Step, child: unknown) => {
      if (child === null || typeof child !== 'object') return;
      path.push(key);
      walk(child);
      path.pop();
    };
    // A long array of numbers is read without a copy: the arguments of the scale items hold millions.
    if (Array.isArray(value)) for (let at = 0; at < value.length; at += 1) visit(at, value[at]);
    else if (value instanceof Map) {
      inside += 1;
      let at = 0;
      for (const [key, child] of value) {
        visit(['m', at, 'k'], key);
        visit(['m', at, 'v'], child);
        at += 1;
      }
      inside -= 1;
    } else if (value instanceof Set) {
      inside += 1;
      let at = 0;
      for (const child of value) {
        visit(['s', at], child);
        at += 1;
      }
      inside -= 1;
    } else if (isPlain(value))
      for (const key of Object.keys(value)) visit(key, (value as Record<string, unknown>)[key]);
    ancestors.pop();
  };
  args.forEach((arg, at) => {
    path.push(at);
    walk(arg);
    path.pop();
  });
  refs.sort((x, y) => x[0].length - y[0].length);
  return { ...(out.length > 0 ? { marks: out } : {}), ...(refs.length > 0 ? { refs } : {}) };
}

/** One step of a path into a decoded value (driver.ts, stepInto). */
function stepInto(node: unknown, step: Step): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(step)) {
    if (step[0] === 'm' && node instanceof Map) {
      const entry = [...node.entries()][step[1]];
      return entry === undefined ? undefined : step[2] === 'k' ? entry[0] : entry[1];
    }
    if (step[0] === 's' && node instanceof Set) return [...node.values()][step[1]];
    return undefined;
  }
  return (node as Record<string | number, unknown>)[step];
}

/** Puts `value` at one step of `parent`, keeping the order of a Map's entries and a Set's members. */
function putInto(parent: unknown, step: Step, value: unknown): void {
  if (Array.isArray(step)) {
    if (step[0] === 'm' && parent instanceof Map) {
      const entries = [...parent.entries()];
      const entry = entries[step[1]];
      if (!entry) return;
      if (step[2] === 'v') {
        parent.set(entry[0], value);
        return;
      }
      entries[step[1]] = [value, entry[1]];
      parent.clear();
      for (const [k, v] of entries) parent.set(k, v);
    } else if (step[0] === 's' && parent instanceof Set) {
      const members = [...parent.values()];
      if (step[1] >= members.length) return;
      members[step[1]] = value;
      parent.clear();
      for (const member of members) parent.add(member);
    }
    return;
  }
  (parent as Record<string | number, unknown>)[step] = value;
}

/**
 * The ids of the objects that cross the boundary on the caller's side (review of PR 1403, codex runs 39875360028 and
 * 39875900785). The caller's objects get positive ids when they are sent; the objects a run makes come with the
 * run's ids (negative). A result object of a known id is the caller's own object, kept as the caller holds it; a new
 * one is remembered under its id. So the caller sees the sharing a call in its own process would show: a result that
 * holds an argument, two results that are one object, an argument a cache keyed by the object sees again.
 */
function callerIdentity(): {
  idOf(value: object): number;
  adopt(value: unknown, refs?: Array<[Path, number]>): unknown;
} {
  const ids = new WeakMap<object, number>();
  const byId = new Map<number, WeakRef<object>>();
  const registry = new FinalizationRegistry<number>((id) => byId.delete(id));
  let next = 1;
  const remember = (value: object, id: number) => {
    ids.set(value, id);
    byId.set(id, new WeakRef(value));
    registry.register(value, id);
  };
  return {
    idOf(value) {
      let id = ids.get(value);
      if (id === undefined) {
        id = next;
        next += 1;
        remember(value, id);
      }
      return id;
    },
    adopt(value, refs) {
      if (!refs) return value;
      let root = value;
      const replaced: Path[] = [];
      const sameStep = (x: Step, y: Step) =>
        typeof x === 'object' || typeof y === 'object' ? JSON.stringify(x) === JSON.stringify(y) : x === y;
      const under = (path: Path, prefix: Path) =>
        prefix.length <= path.length && prefix.every((key, at) => sameStep(path[at] as Step, key));
      for (const [path, id] of [...refs].sort((x, y) => x[0].length - y[0].length)) {
        if (replaced.some((prefix) => under(path, prefix))) continue;
        let parent: unknown = undefined;
        let node: unknown = root;
        for (const key of path) {
          parent = node;
          node = stepInto(node, key);
        }
        if (node === null || typeof node !== 'object') continue;
        const known = byId.get(id)?.deref();
        if (known !== undefined && known !== node) {
          if (path.length === 0) root = known;
          else putInto(parent, path[path.length - 1] as Step, known);
          replaced.push(path);
        } else if (known === undefined) remember(node, id);
      }
      return root;
    },
  };
}

/** An answer as the tape keeps it: without the ids of its objects and the codec's note, compared when it came. */
function withoutIds(outcome: Outcome): Outcome {
  const {
    rrefs: _ids,
    uncarried: _uncarried,
    unsent: _unsent,
    ...rest
  } = outcome as Outcome & {
    rrefs?: unknown;
    uncarried?: unknown;
    unsent?: unknown;
  };
  return rest as Outcome;
}

/** An environment without the named variables. */
function withoutNames(
  env: Record<string, string>,
  names: readonly string[] | undefined,
): Record<string, string> {
  const out = { ...env };
  for (const name of names ?? []) delete out[name];
  return out;
}

/** Runs the product module under the frame. Close the frame when the item is done. */
export function isolate<T>(options: IsolateOptions): Frame<T> {
  const tag = options.tag ?? options.module;
  const trace = (text: string) => traceLine(tag, text);
  trace('isolate begin');
  const module = resolve(options.module);
  // The product runs from a bundle in a folder of its own, in processes that may read that folder and nothing else
  // of the project (confine.ts): the expected values stay in this process and are out of the product's reach.
  const sealFolder = ownFolder(join(projectCache(), drawnFolder(options.seed, `seal:${tag}`)));
  const {
    file: sealed,
    inputs,
    tree,
    influences,
    workspace,
  } = sealOnce(
    module,
    sealFolder,
    drawnFolder(options.seed, `bundle:${tag}`),
    { sources: options.sources ?? [], reads: options.reads ?? [] },
    options.sealed,
  );
  // Run C is unconfined and can read the expected values: a file it wrote would reach the confined runs of a later
  // frame. The watch is read-only; what it finds marks the tree, and a marked tree starts no frame (confine.ts).
  const mark = markPath(projectCache(), tree);
  checkMark(mark, tree);
  const watch = new TreeWatch(
    [
      tree,
      ...(options.sources ?? []),
      ...workspace,
      ...inputs,
      ...(options.reads ?? []),
      ...influences.files,
    ],
    influences.packages,
  );
  watch.watchResolution(tree);
  for (const folder of influences.packages) watch.watchResolution(folder);
  let dirty = false;
  const settle = (): string | undefined => {
    if (!dirty) return undefined;
    dirty = false;
    const changed = watch.diff();
    if (changed.length === 0) return undefined;
    const message = `run C changed the product's tree or its grants (${changed
      .slice(0, 3)
      .map((path) => path.split('/').slice(-2).join('/'))
      .join(
        ', ',
      )}${changed.length > 3 ? `, and ${changed.length - 3} more` : ''}); the tree is left as it is`;
    first ??= message;
    setMark(mark, message);
    return message;
  };
  const plans = twinPlans(options.seed, tag, projectCache()).map((drawn) => {
    const plan = ownPlan(drawn);
    // The scratch folder of the run lies in the run's own folder, which the frame removes when it closes.
    const scratch = options.scratch
      ? join(plan.driverDir, drawnFolder(options.seed, `scratch:${tag}:${plan.run}`))
      : undefined;
    if (scratch) mkdirSync(scratch, { recursive: true });
    // The temporary folder is given by its real path: the permission model checks a write on the path it is given,
    // and on macOS the system temporary folder is reached through a link (/var to /private/var).
    const tmp = scratch ? realOf(scratch) : undefined;
    const env =
      options.env || scratch || options.unset
        ? withoutNames(
            {
              ...(plan.env ?? (process.env as Record<string, string>)),
              ...(options.env ?? {}),
              ...(tmp ? { TMPDIR: tmp, TMP: tmp, TEMP: tmp } : {}),
            },
            options.unset,
          )
        : plan.env;
    const confined = confine(
      {
        ...plan,
        ...(env ? { env } : {}),
        driverSource: twinDriver(options.seed, `${tag}:${plan.run}`),
        setup: { module: sealed, ...(plan.run === 'A' ? { writeBack: true } : {}) },
      },
      {
        reads: [dirname(sealed), ...(options.reads ?? []), ...(scratch ? [scratch] : [])],
        ...(scratch ? { writes: [scratch] } : {}),
      },
    );
    if (!plan.wrap) return confined;
    // Run D reaches the product through a wrapper module of the run's own folder.
    const wrapper = wrapperModule(options.seed, `${tag}:${plan.run}`, pathToFileURL(sealed).href);
    const file = join(confined.driverDir, `${drawnFolder(options.seed, `wrapper:${tag}`)}.mjs`);
    writeAtomic(file, wrapper.source);
    return { ...confined, setup: { ...confined.setup, module: file, invoke: wrapper.invoke } };
  });
  const token = randomBytes(16).toString('hex');
  const setup = { token, module: sealed, aliasing: options.aliasing === true };
  const plain = options.plain === false ? undefined : openPlain(options.seed, tag);
  if (plain && (options.env || options.scratch || options.unset)) {
    const scratch = options.scratch
      ? join(plain.dir, drawnFolder(options.seed, `scratch:${tag}:C`))
      : undefined;
    if (scratch) mkdirSync(scratch, { recursive: true });
    plain.env = withoutNames(
      {
        ...plain.env,
        ...(options.env ?? {}),
        ...(scratch ? { TMPDIR: scratch, TMP: scratch, TEMP: scratch } : {}),
      },
      options.unset,
    );
  }
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(4);
  const relay: Relay = {
    // A data URL: the relay is an ES module, and it carries no file of the validator into the runs.
    worker: new Worker(new URL(`data:text/javascript,${encodeURIComponent(RELAY)}`), {
      execArgv: [],
      workerData: {
        port: port2,
        signal,
        plans,
        setup: { ...setup, trace: TRACE ? `${TRACE}` : undefined, tag },
      },
      transferList: [port2],
      stderr: false,
    }),
    port: port1,
    flag: new Int32Array(signal),
  };
  relay.worker.unref();
  port1.unref();
  trace('relay worker created');
  const tape: Tape = [];
  const found: Array<{ at: number; message: string }> = [];
  const aliased: Array<{ at: number; message: string }> = [];
  const altered: Array<{ at: number; message: string }> = [];
  let first: string | undefined;
  let taint: string | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    trace('close begin');
    try {
      flushPlain();
    } catch {
      // a flush that fails leaves the finding it made
    }
    closed = true;
    settle();
    let unreaped: string[] | undefined;
    try {
      relay.port.postMessage({ close: true });
      unreaped = (wait(relay, 10_000, 'close') as { unreaped?: string[] }).unreaped;
    } catch {
      // the runs are ended by terminate below
    }
    void relay.worker.terminate();
    for (const plan of plans) {
      rmSync(plan.driverDir, { recursive: true, force: true });
      if (plan.cwd) rmSync(plan.cwd, { recursive: true, force: true });
    }
    rmSync(sealFolder, { recursive: true, force: true });
    if (plain) rmSync(plain.dir, { recursive: true, force: true });
    trace('close end');
    // A run the relay killed and that did not end within 5 s may stay in the process table: never silent.
    if (unreaped)
      throw new FrameError(
        `the frame closed, but run ${unreaped.join(', ')} did not end within 5 s of its kill: it may stay as a defunct process of this process`,
      );
  };
  trace('waiting for the product to load in the three runs');
  const started = wait(relay, START_MS, 'the start of the product') as {
    ready: Array<{
      ready?: boolean;
      error?: string;
      dead?: string;
      shape?: Record<string, { fn?: 1; value?: Json }>;
    }>;
  };
  trace('product loaded in the three runs');
  const failed = started.ready.find((each) => each.ready !== true);
  if (failed) {
    close();
    throw new FrameError(
      `the product did not load: ${(failed.error ?? failed.dead ?? '').split('\n').slice(0, 4).join(' ')}`,
    );
  }
  // A function the product returned is a handle: calling it calls the product's function in each run.
  const handleOf = new WeakMap<object, number>();
  const revive = (handle: number): unknown => {
    const fn = (...args: unknown[]) => call(`#${handle}`, args);
    handleOf.set(fn, handle);
    return fn;
  };
  const ship = (fn: (...args: never[]) => unknown): Json | undefined => {
    const handle = handleOf.get(fn);
    if (handle !== undefined) return { $handle: handle };
    return options.functions === 'source' ? { $fn: fn.toString() } : undefined;
  };
  const byName = new Map<string, { calls: number; ms: number; slow: number }>();
  const spent = { calls: 0, encodeMs: 0, relayMs: 0, decodeMs: 0, plainMs: 0 };
  type Recorded = {
    call: string;
    entry: Entry;
    shared: string;
    ids: string;
    expected: string;
    head: string;
    at: number;
  };
  const recorded: Recorded[] = [];
  let compared = 0;
  /**
   * Makes every call of the frame in run C, in one fresh process and in order, and compares the answers not yet
   * compared with the ones of run A. Run C must make them all in one process: a product keeps state from call to
   * call (a generator it returned, a cache), and run A kept it.
   */
  const flushPlain = (): void => {
    if (!plain || compared >= recorded.length) return;
    const t3 = performance.now();
    const answers = plainRunAll(plain, options.seed, tag, module, recorded.length);
    spent.plainMs += performance.now() - t3;
    for (let index = compared; index < recorded.length; index += 1) {
      const held = recorded[index] as Recorded;
      const c = answers[index] as Outcome | { dead: string };
      if (!('dead' in c)) held.entry.plain = withoutIds(c);
      if (keptOf(c, options.keep?.[held.call]) !== held.expected) {
        const message = `${held.head}, ${describeRun('C')} answered ${outcomeText(c)}`;
        found.push({ at: held.at, message });
        first ??= message;
        taint ??= message;
      } else if (!('dead' in c) && JSON.stringify((c as { rrefs?: unknown }).rrefs ?? null) !== held.ids) {
        const message = `${held.head}, the objects of the result are shared otherwise in ${describeRun('C')}`;
        found.push({ at: held.at, message });
        first ??= message;
        taint ??= message;
      } else if (
        !('dead' in c) &&
        JSON.stringify((c as { shared?: [number, number] }).shared ?? null) !== held.shared
      ) {
        // Run C counts shared objects as the confined runs do (review of PR 1403, codex run 39875360028: a product
        // that shared one cached result only where no permission model ran passed).
        const message = `${held.head}, shared objects ${held.shared}; ${describeRun('C')} returned shared objects ${JSON.stringify((c as { shared?: [number, number] }).shared ?? null)}`;
        found.push({ at: held.at, message });
        first ??= message;
        taint ??= message;
      }
    }
    compared = recorded.length;
    // Run C is unconfined and can read the expected values: the read-only watch finds what it left in the tree.
    dirty = true;
    const message = settle();
    if (message) {
      found.push({ at: tape.length - 1, message });
      taint ??= message;
    }
  };
  let strict = false;
  let ambient: Ambient | undefined;
  const identities = callerIdentity();
  let identity: number | undefined;
  let identityEpochs = 0;
  const shared: Array<{ at: number; message: string }> = [];
  let calls = 0;
  const call = (name: string, args: unknown[]): unknown => {
    if (closed) throw new FrameError(`the frame is closed: ${name} was not called`);
    const t0 = performance.now();
    const sent = encode(args, true, `${name}(arguments)`, new WeakSet(), ship);
    const t1 = performance.now();
    const { marks, refs } = marksOf(args, identities.idOf);
    relay.port.postMessage({
      call: name,
      args: sent,
      freeze: strict,
      ...(marks ? { marks } : {}),
      ...(ambient ? { ambient } : {}),
      ...(identity !== undefined ? { identity } : {}),
      ...(refs ? { refs } : {}),
      ...(options.idSpan ? { span: options.idSpan } : {}),
    });
    calls += 1;
    const reply = wait(relay, CALL_MS, `${name}()`);
    checkReply(reply, calls, name);
    const { answers } = reply as { answers: Array<Outcome | { dead: string }> };
    const overflow = answers.find((each) => (each as { overflow?: number }).overflow !== undefined);
    if (overflow)
      throw new FrameError(
        `${name}() returned ${(overflow as { overflow: number }).overflow} new objects or more in one call: the frame gives the new objects of one call that many ids, so it cannot tell them from the next call's`,
      );
    spent.calls += 1;
    spent.encodeMs += t1 - t0;
    const took = performance.now() - t1;
    spent.relayMs += took;
    if (took > 10_000) trace(`slow call ${name}: ${Math.round(took)} ms`);
    const each = byName.get(name) ?? { calls: 0, ms: 0, slow: 0 };
    each.calls += 1;
    each.ms += took;
    if (took > 50) each.slow += 1;
    byName.set(name, each);
    const [a, b, d] = answers as [
      Outcome | { dead: string },
      Outcome | { dead: string },
      Outcome | { dead: string },
    ];
    if ('dead' in a) throw new FrameError(a.dead);
    for (const [each, plan] of [
      [a, plans[0]],
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      const moved = (each as { moved?: string[] }).moved;
      if (moved && moved.length > 0)
        aliased.push({
          at: tape.length,
          message: `${name}() was called after ${[...new Set(moved)].join(', ')} returned a result that has changed since (${describeRun(plan as TwinPlan)}): a result must stay as it was returned`,
        });
    }
    for (const [each, plan] of [
      [a, plans[0]],
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if ((each as { invalid?: boolean }).invalid)
        aliased.push({
          at: tape.length,
          message: `${name}() returned a result that is a Proxy, or holds a Proxy or an accessor property (a getter or a setter) (${describeRun(plan as TwinPlan)}): an invalid result, since each runs the product's own code on every read`,
        });
    }
    for (const [each, plan] of [
      [a, plans[0]],
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if ((each as { written?: boolean }).written)
        aliased.push({
          at: tape.length,
          message: `${name}() changed an argument it was given (${describeRun(plan as TwinPlan)}): the arguments of this call must stay as they were`,
        });
    }
    for (const [each, plan] of [
      [a, plans[0]],
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      const change = (each as { altered?: string }).altered;
      if (typeof change === 'string')
        altered.push({
          at: tape.length,
          message: `${name}() ran in a process where the product had changed a built-in object, ${change} (${describeRun(plan as TwinPlan)}): the product must leave the built-in objects of its caller's process as it found them`,
        });
    }
    const {
      moved: _moved,
      invalid: _invalid,
      written: _written,
      altered: _altered,
      shared: sharedCounts,
      rrefs: resultIds,
      uncarried,
      unsent,
      argsAfter,
      cannot,
      ...answer
    } = a as Outcome & {
      moved?: string[];
      invalid?: boolean;
      written?: boolean;
      altered?: string;
      shared?: [number, number];
      rrefs?: Array<[Path, number]>;
      uncarried?: string;
      unsent?: string;
      argsAfter?: Json;
      cannot?: boolean;
    };
    // The runs must count the same shared objects: a product that shares only in some runs answers by how it is run.
    const sharedText = (outcome: Outcome | { dead: string }) =>
      JSON.stringify((outcome as { shared?: [number, number] }).shared ?? null);
    for (const [other, plan] of [
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if (!('dead' in other) && sharedText(other) !== sharedText(a)) {
        const message = `${name}(): ${describeRun(plans[0] as TwinPlan)} returned shared objects ${sharedText(a)}, ${describeRun(plan as TwinPlan)} ${sharedText(other)}`;
        found.push({ at: tape.length, message });
        first ??= message;
      }
    }
    // Every run must give its results the same ids: a product that shares objects only in some runs answers by how
    // it is run. A result the codec cannot carry would hide what the caller's own call shows: the call fails.
    const idsText = (outcome: Outcome | { dead: string }) =>
      JSON.stringify((outcome as { rrefs?: unknown }).rrefs ?? null);
    for (const [other, plan] of [
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if (!('dead' in other) && idsText(other) !== idsText(a)) {
        const message = `${name}(): the objects of the result are shared otherwise in ${describeRun(plan as TwinPlan)} than in ${describeRun(plans[0] as TwinPlan)}`;
        found.push({ at: tape.length, message });
        first ??= message;
      }
    }
    if (uncarried) {
      const message = `${name}() returned ${uncarried} (${describeRun(plans[0] as TwinPlan)}): the frame cannot carry it to the caller, whose own call would see it`;
      found.push({ at: tape.length, message });
      first ??= message;
    }
    if (unsent) {
      const message = `${name}() was sent ${unsent} (${describeRun(plans[0] as TwinPlan)}): the frame cannot give the product the object the caller's own call would give it`;
      found.push({ at: tape.length, message });
      first ??= message;
    }
    if (sharedCounts)
      shared.push({
        at: tape.length,
        message: `${name}() returned ${sharedCounts[0]} object(s) of its own arguments and ${sharedCounts[1]} object(s) of a result it returned before (${describeRun(plans[0] as TwinPlan)}): a fresh result shares no object with either`,
      });
    if (cannot)
      aliased.push({
        at: tape.length,
        message: `${name}(): the product changed an argument in a way the frame cannot reproduce (a function, an accessor, a symbol or hidden key, an extra property of a container, a descriptor, the prototype or the extensibility of an argument)`,
      });
    // The product changed its arguments in run A: apply the state after the call to the caller's own arguments, as a
    // call in the caller's process would have changed them (applyBack, below).
    if (argsAfter !== undefined) {
      const state = decode(argsAfter, revive);
      if (Array.isArray(state)) {
        for (let at = 0; at < args.length && at < state.length; at += 1) writeBack(args, at, state[at]);
      }
    }
    const entry: Entry = { call: name, args: sent, ...answer };
    if ('cpu' in a && typeof a.cpu === 'number') entry.cpu = a.cpu;
    // The tape keeps what each run answered; the ids of the result's objects were compared above.
    if (!('dead' in b)) entry.twin = withoutIds(b);
    if (!('dead' in d)) entry.wrapped = withoutIds(d);
    tape.push(entry);
    const kept = (outcome: Outcome | { dead: string }): string => {
      if ('dead' in outcome) return `dead`;
      if ('throws' in outcome) return `throws ${canonical(outcome.throws)}`;
      const keep = options.keep?.[name];
      return canonical(keep ? encode(keep(decode(outcome.ret))) : outcome.ret);
    };
    const head = `${name}(${shortText(sent as Json, 80)}): ${describeRun(plans[0] as TwinPlan)} answered ${outcomeText(a)}`;
    // The runs are compared with run A in turn; the first difference found is the frame's finding.
    for (const [other, plan] of [
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if (kept(a) !== kept(other)) {
        const message = `${head}, ${describeRun(plan as TwinPlan)} answered ${outcomeText(other)}`;
        found.push({ at: tape.length - 1, message });
        first ??= message;
      }
    }
    if (plain) {
      // Run C makes this call later, with all the others, in one fresh process; the answer of run A is kept. A write
      // cut short leaves no part of the call in the file run C reads: the file goes back to its size before it.
      const size = existsSync(plain.calls) ? statSync(plain.calls).size : 0;
      try {
        appendFileSync(
          plain.calls,
          `${JSON.stringify({ seq: calls, ...(options.idSpan ? { span: options.idSpan } : {}), call: name, args: sent, freeze: strict, ...(marks ? { marks } : {}), ...(ambient ? { ambient } : {}), ...(identity !== undefined ? { identity } : {}), ...(refs ? { refs } : {}) })}\n`,
        );
      } catch (error) {
        if (existsSync(plain.calls)) truncateSync(plain.calls, size);
        throw error;
      }
      recorded.push({
        call: name,
        entry,
        shared: JSON.stringify(sharedCounts ?? null),
        ids: JSON.stringify(resultIds ?? null),
        expected: keptOf(a, options.keep?.[name]),
        head,
        at: tape.length - 1,
      });
    }
    if ('throws' in a) throw decode(a.throws);
    const t2 = performance.now();
    const value = identities.adopt(decode(a.ret, revive), (a as { rrefs?: Array<[Path, number]> }).rrefs);
    spent.decodeMs += performance.now() - t2;
    return value;
  };
  const shape = started.ready[0]?.shape;
  const product = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        const known = shape?.[name];
        if (shape && !known) return undefined;
        if (known && known.fn !== 1) return decode(known.value);
        return (...args: unknown[]) => call(name, args);
      },
      has: (_target, name) => typeof name === 'string' && (shape ? name in shape : true),
      ownKeys: () => (shape ? Object.keys(shape) : []),
      getOwnPropertyDescriptor: (_target, name) =>
        typeof name === 'string' && shape && name in shape
          ? { enumerable: true, configurable: true }
          : undefined,
    },
  ) as T;
  return {
    product,
    get tape() {
      flushPlain();
      return tape;
    },
    position: () => tape.length,
    spent: () => ({
      ...spent,
      top: [...byName.entries()]
        .sort((x, y) => y[1].ms - x[1].ms)
        .slice(0, 8)
        .map(([name, each]) => ({ name, ...each })),
    }),
    divergence: () => {
      flushPlain();
      return first;
    },
    cpuSince: (from) => tape.slice(from).reduce((sum, each) => sum + (each.cpu ?? 0), 0),
    ambient: (spec) => {
      ambient = spec;
    },
    identity: (on) => {
      identityEpochs += 1;
      identity = on ? identityEpochs : undefined;
    },
    sharedSince: (from) => shared.find((each) => each.at >= from)?.message,
    strictArguments: (on) => {
      strict = on;
    },
    divergenceSince: (from) => found.find((each) => each.at >= from)?.message,
    aliasSince: (from) => aliased.find((each) => each.at >= from)?.message,
    alteredSince: (from) => altered.find((each) => each.at >= from)?.message,
    tainted: () => {
      flushPlain();
      return taint;
    },
    close,
  };
}

export type CommandOptions = {
  /** The command: a script path (.js, .mjs or .ts) and its arguments, as a user types them after `node`. */
  command: [string, ...string[]];
  seed: number;
  tag?: string;
  /** The files to write into the working folder before the command runs, by path relative to it. */
  files?: Record<string, string>;
  /** The files to read back from the working folder after it ran. */
  collect?: string[];
  timeoutMs?: number;
};

export type CommandRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  files: Record<string, string | null>;
  /** The first difference between the two runs (status, stdout or a collected file), or undefined. */
  divergence?: string;
  tape: Tape;
};

/**
 * Runs a product command under the frame: four times, each in a fresh working folder of its own. Runs A and B go
 * through drawn drivers with the twin differences of twins.ts (environment, uptime, the driver's place); run D is a third twin; run C is the
 * plain command, `node [--import tsx] <script> <args>`, as a user types it. Each run sees the command's own argv.
 * The working folder's path is written `<work>` in what is recorded, so the runs compare. The validator reads run A.
 */
export function isolateCommand(options: CommandOptions): CommandRun {
  const [script, ...args] = options.command;
  const tag = options.tag ?? script;
  // The command runs from a bundle, in processes that read that folder and their own working folder, write that
  // working folder and start no process (confine.ts); run C is the plain command, unconfined.
  const sealFolder = ownFolder(join(projectCache(), drawnFolder(options.seed, `seal:${tag}:command`)));
  const {
    file: sealed,
    inputs,
    tree,
    influences,
    workspace,
  } = sealOnce(resolve(script), sealFolder, drawnFolder(options.seed, `bundle:${tag}:command`));
  const mark = markPath(projectCache(), tree);
  checkMark(mark, tree);
  const watch = new TreeWatch([tree, ...workspace, ...inputs, ...influences.files], influences.packages);
  watch.watchResolution(tree);
  for (const folder of influences.packages) watch.watchResolution(folder);
  const plans = twinPlans(options.seed, tag, projectCache()).map((drawn) => {
    const plan = ownPlan(drawn);
    return confine(
      { ...plan, setup: { command: sealed, script: resolve(script) } },
      { reads: [dirname(sealed)], writes: [join(plan.driverDir, 'w')] },
    );
  });
  const token = randomBytes(16).toString('hex');
  const plainRun = openPlain(options.seed, `${tag}:command`);
  const plainDir = plainRun.dir;
  const runs: Array<TwinPlan | 'C'> = [...plans, 'C'];
  const results = runs.map((plan) => {
    const home = plan === 'C' ? plainDir : plan.driverDir;
    const work = join(home, 'w');
    mkdirSync(work, { recursive: true });
    if (plan !== 'C' && plan.home) mkdirSync(plan.home, { recursive: true });
    try {
      for (const [path, text] of Object.entries(options.files ?? {})) {
        const target = resolve(work, path);
        if (!target.startsWith(work)) throw new FrameError(`the file ${path} is outside the working folder`);
        mkdirSync(dirname(target), { recursive: true });
        writeAtomic(target, text);
      }
      let ran: ReturnType<typeof spawnSync>;
      if (plan === 'C') {
        ran = spawnGrouped(
          process.execPath,
          [...loaderOption(resolve(script)), resolve(script), ...args],
          runTag(options.seed, `${tag}:command`, plainDir),
          {
            cwd: work,
            env: plainRun.env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: options.timeoutMs ?? CALL_MS,
          },
        );
      } else {
        const driver = join(plan.driverDir, plan.driverFile);
        writeAtomic(driver, twinDriver(options.seed, `${tag}:command:${plan.run}`));
        const setup = {
          token,
          args,
          ...plan.setup,
          uptimeShift: plan.uptimeShift,
          depth: 0,
        };
        ran = spawnSync(process.execPath, [driver], {
          cwd: work,
          env: plan.env ?? process.env,
          input: `${JSON.stringify(setup)}\n`,
          encoding: 'utf8',
          timeout: options.timeoutMs ?? CALL_MS,
        });
      }
      const clean = (text: string | Buffer | null | undefined) =>
        String(text ?? '')
          .split(work)
          .join('<work>');
      const files: Record<string, string | null> = {};
      for (const path of options.collect ?? []) {
        const target = resolve(work, path);
        files[path] = existsSync(target) ? clean(readFileSync(target, 'utf8')) : null;
      }
      return { plan, status: ran.status, stdout: clean(ran.stdout), stderr: clean(ran.stderr), files };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  rmSync(sealFolder, { recursive: true, force: true });
  const [a, b, d, c] = results as [
    (typeof results)[number],
    (typeof results)[number],
    (typeof results)[number],
    (typeof results)[number],
  ];
  let divergence: string | undefined;
  const changedByC = watch.diff();
  if (changedByC.length > 0) {
    divergence = `run C changed the command's tree (${changedByC.slice(0, 3).join(', ')}); the tree is left as it is`;
    setMark(mark, divergence);
  }
  const differ = (what: string, other: typeof a) => (x: unknown, y: unknown) => {
    if (divergence === undefined && canonical(encode(x)) !== canonical(encode(y)))
      divergence = `${what}: ${describeRun(a.plan)} gave ${shortText(encode(x), 80)}, ${describeRun(other.plan)} gave ${shortText(encode(y), 80)}`;
  };
  for (const other of [b, d, c]) {
    differ('status', other)(a.status, other.status);
    differ('stdout', other)(a.stdout, other.stdout);
    for (const path of options.collect ?? []) differ(path, other)(a.files[path], other.files[path]);
  }
  const recorded = (run: typeof a) => ({
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    files: run.files,
  });
  const tape: Tape = [
    {
      call: 'command',
      args: encode(options.command),
      ret: encode(recorded(a)),
      twin: { ret: encode(recorded(b)) },
      wrapped: { ret: encode(recorded(d)) },
      plain: { ret: encode(recorded(c)) },
    },
  ];
  return {
    status: a.status,
    stdout: a.stdout,
    stderr: a.stderr,
    files: a.files,
    ...(divergence ? { divergence } : {}),
    tape,
  };
}
