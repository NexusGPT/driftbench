import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAliases } from './aliases';
import { isPlain, mapStrings, prefixMap, TAG, tag, tagged, type Wire } from './wire';

/**
 * The product's side of the blocks bank (docs/validators.md section 13, "The bank runs the product through the
 * frame"). The frame loads this module in each of its two child processes; it loads the product packages, holds
 * every value of the product that is not data, and answers the bank's calls with data only (wire.ts). It holds no
 * truth of any item: the bank sends it specs, scripts and plans, never an expected answer.
 *
 * A product function that calls a function of the bank (a scripted agent's reply, a custom check, an event sink)
 * gets a promise: the call the bank is waiting on answers with the request, the bank runs its function and sends
 * the result back, and the product goes on. A function of the bank that the product must call synchronously (a
 * clock, a fixed draw) crosses as the value it returns (`k`).
 *
 * The two children get the same calls. The twin that runs in a folder of its own (twins.ts gives it process
 * arguments of its own) works on a copy of every folder of the bank's that it is handed, which the bank keeps in
 * step: its paths are mapped to the copies on the way in and back on the way out, so both twins answer alike.
 */

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

type Op = {
  id: number;
  queue: { n: number; cb: number; args: Wire }[];
  pending: Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>;
  result?: { done: Wire } | { threw: Wire };
  wake?: () => void;
};

/** JSON.stringify as it is before any product module loads: a product may patch the global one. */
const stringify = JSON.stringify;

/** The twin that runs in a folder of its own: the frame hands it process arguments, its twin has none. */
const twin = process.argv.length > 2 ? 'b' : 'a';

let config: { root: string; privateRoot: string } | undefined;
let toChild: (text: string) => string = (text) => text;
let toBank: (text: string) => string = (text) => text;

const values = new Map<number, unknown>();
const ids = new WeakMap<object, number>();
let nextId = 0;
const modules = new Map<string, Record<string, unknown>>();
const ops = new Map<number, Op>();
let nextOp = 0;
let nextRequest = 0;
const context = new AsyncLocalStorage<Op>();
const active: Op[] = [];

function idOf(value: object): number {
  let id = ids.get(value);
  if (id === undefined) {
    nextId += 1;
    id = nextId;
    ids.set(value, id);
    values.set(id, value);
  }
  return id;
}

const className = (value: object): string => {
  const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  return proto?.constructor?.name ?? 'Object';
};

const base64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

/** A value of the product as data for the bank (wire.ts). */
function out(value: unknown, seen: Set<object> = new Set()): Wire {
  if (typeof value === 'symbol') return tag('y', value.description ?? '');
  if (typeof value === 'function') return tag('f', idOf(value), value.name, value.length);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return tag('o', idOf(value), className(value));
  if (Buffer.isBuffer(value)) return tag('b', base64(value));
  if (ArrayBuffer.isView(value))
    return value instanceof Uint8Array && value.constructor === Uint8Array
      ? new Uint8Array(value)
      : tag('t', className(value), base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
  if (value instanceof ArrayBuffer) return tag('ab', Buffer.from(value).toString('base64'));
  if (value instanceof Error) return outError(value, seen);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return tag('x', value.source, value.flags);
  seen.add(value);
  try {
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [out(k, seen), out(v, seen)]));
    if (value instanceof Set) return new Set([...value].map((each) => out(each, seen)));
    if (Array.isArray(value)) return value.map((each) => out(each, seen));
    if (!isPlain(value)) return tag('o', idOf(value), className(value));
    const entries = Object.entries(value);
    if (entries.some(([, each]) => typeof each === 'function')) return tag('o', idOf(value), 'Object');
    const data: Record<string, unknown> = {};
    for (const [key, each] of entries) data[key] = out(each, seen);
    return data;
  } finally {
    seen.delete(value);
  }
}

function outError(error: Error, seen: Set<object>): Wire {
  const fields: Record<string, unknown> = {};
  for (const [key, each] of Object.entries(error)) {
    if (key === 'stack' || key === 'message' || key === 'name') continue;
    fields[key] = out(each, seen);
  }
  if (error.cause !== undefined && !Object.hasOwn(fields, 'cause')) fields.cause = out(error.cause, seen);
  return tag('e', idOf(error), error.name, error.message, className(error), fields);
}

/** Large arguments the bank sent once, as wire data: each later mention decodes a fresh copy. */
const interned = new Map<string, Wire>();

/** A function of the bank, as the product calls it: a promise of what the bank's function returned. */
const callbacks = new Map<number, (...args: unknown[]) => Promise<unknown>>();
function bankFunction(id: number): (...args: unknown[]) => Promise<unknown> {
  let fn = callbacks.get(id);
  if (fn) return fn;
  fn = (...args: unknown[]) => {
    let op = context.getStore();
    if (!op || op.result) op = active[active.length - 1];
    if (!op) return Promise.reject(new Error('a function of the validator was called after its call ended'));
    const owner = op;
    return new Promise((resolve, reject) => {
      nextRequest += 1;
      const n = nextRequest;
      owner.pending.set(n, { resolve, reject });
      owner.queue.push({ n, cb: id, args: out(args) });
      owner.wake?.();
    });
  };
  callbacks.set(id, fn);
  return fn;
}

const fromBase64 = (text: string): Buffer => Buffer.from(text, 'base64');

const TYPED: Record<string, new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView: DataView as unknown as new (
    buffer: ArrayBuffer,
    offset: number,
    length: number,
  ) => ArrayBufferView,
};

/** A value of the bank, as the product receives it. */
function inn(value: Wire): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(inn);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [inn(k), inn(v)]));
  if (value instanceof Set) return new Set([...value].map(inn));
  if (value instanceof Date || value instanceof Uint8Array) return value;
  const parts = tagged(value);
  if (!parts) {
    const object: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) object[key] = inn(each);
    return object;
  }
  const [kind, a, b, c, d] = parts as [string, unknown, unknown, unknown, unknown];
  switch (kind) {
    case 'c':
      return bankFunction(a as number);
    case 'k':
      return () => inn(a);
    case 'i':
      interned.set(String(a), b);
      return inn(b);
    case 'j': {
      if (!interned.has(String(a))) throw new Error('the validator named an argument this run was not sent');
      return inn(interned.get(String(a)));
    }
    case 'r': {
      if (!values.has(a as number))
        throw new Error(`the validator named a value ${String(a)} this run does not hold`);
      const held = values.get(a as number) as object;
      if (b && typeof b === 'object') Object.assign(held, inn(b));
      return held;
    }
    case 'e': {
      const error = new Error(String(b));
      error.name = String(a);
      void c;
      if (d && typeof d === 'object') Object.assign(error, inn(d));
      return error;
    }
    case 'x':
      return new RegExp(String(a), String(b));
    case 'b':
      return fromBase64(String(a));
    case 't': {
      const bytes = fromBase64(String(b));
      const copy = new Uint8Array(bytes).buffer;
      const Typed = TYPED[String(a)] ?? Uint8Array;
      const width = (Typed as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
      return new Typed(copy, 0, copy.byteLength / width);
    }
    case 'ab':
      return new Uint8Array(fromBase64(String(a))).buffer;
    default:
      throw new Error(`the validator sent a value of an unknown kind ${kind}`);
  }
}

async function moduleOf(name: string): Promise<Record<string, unknown>> {
  const held = modules.get(name);
  if (held) return held;
  if (!config) throw new Error('the product side was not started');
  if (!(PACKAGES as readonly string[]).includes(name)) throw new Error(`the product has no package ${name}`);
  const loaded = (await import(
    pathToFileURL(join(config.root, 'packages', name, 'src', 'index.ts')).href
  )) as Record<string, unknown>;
  modules.set(name, loaded);
  return loaded;
}

async function target(where: Wire): Promise<unknown> {
  const [kind, name] = where as [string, unknown];
  if (kind === 'm') return moduleOf(String(name));
  if (kind === 'r') {
    if (!values.has(name as number))
      throw new Error(`the validator named a value ${String(name)} this run does not hold`);
    return values.get(name as number);
  }
  throw new Error(`the validator named an unknown target ${String(kind)}`);
}

const send = (value: Wire): Wire => mapStrings(value, toBank);
const receive = (value: Wire): Wire => mapStrings(value, toChild);

/** Starts the product side: the repository root and the folder this run keeps its private files in. */
export function init(given: { root: string; privateRoot: string }): void {
  config = given;
  registerAliases(given.root);
  mkdirSync(own(), { recursive: true });
  folders([]);
}

/** This twin's private folder, under the bank's private root. */
function own(): string {
  if (!config) throw new Error('the product side was not started');
  return join(config.privateRoot, twin);
}

/** The folders of the bank this twin works on copies of: [the bank's folder, the copy]. Twin A works on the originals. */
export function folders(pairs: [string, string][]): void {
  if (!config) throw new Error('the product side was not started');
  const mine: [string, string][] = twin === 'b' ? pairs : [];
  const privateA = join(config.privateRoot, 'a');
  toChild = prefixMap([...mine, [privateA, own()]]);
  toBank = prefixMap([...mine.map(([from, to]) => [to, from] as [string, string]), [own(), privateA]]);
}

export async function get(where: Wire, key: string): Promise<Wire> {
  const object = (await target(receive(where))) as Record<string, unknown>;
  return send(out(object[key]));
}

export async function keys(where: Wire): Promise<string[]> {
  const object = (await target(receive(where))) as object;
  return Reflect.ownKeys(object)
    .filter((key): key is string => typeof key === 'string')
    .map((key) => toBank(key));
}

export async function has(where: Wire, key: string): Promise<boolean> {
  const object = (await target(receive(where))) as object;
  return key in object;
}

export async function put(where: Wire, key: string, value: Wire): Promise<void> {
  const object = (await target(receive(where))) as Record<string, unknown>;
  object[key] = inn(receive(value));
}

export async function remove(where: Wire, key: string): Promise<boolean> {
  const object = (await target(receive(where))) as Record<string, unknown>;
  return delete object[key];
}

/** Whether a value the child holds is an instance of a class the child holds. */
export function instance(value: number, cls: number): boolean {
  const object = values.get(value);
  const Cls = values.get(cls) as (new (...args: unknown[]) => unknown) | undefined;
  return typeof Cls === 'function' && object instanceof Cls;
}

function begin(run: () => unknown): Op {
  nextOp += 1;
  const op: Op = { id: nextOp, queue: [], pending: new Map() };
  ops.set(op.id, op);
  const settle = (result: Op['result']) => {
    op.result = result;
    op.wake?.();
  };
  context.run(op, () => {
    let started: unknown;
    try {
      started = run();
    } catch (error) {
      settle({ threw: out(error) });
      return;
    }
    Promise.resolve(started).then(
      (value) => settle({ done: out(value) }),
      (error) => settle({ threw: out(error) }),
    );
  });
  return op;
}

type Step = { done: Wire } | { threw: Wire } | { op: number; n: number; cb: number; args: Wire };

async function step(op: Op): Promise<Step> {
  active.push(op);
  try {
    for (;;) {
      const next = op.queue.shift();
      if (next) return send({ op: op.id, n: next.n, cb: next.cb, args: next.args }) as Step;
      if (op.result) {
        ops.delete(op.id);
        return send(op.result) as Step;
      }
      await new Promise<void>((resolve) => {
        op.wake = resolve;
      });
      op.wake = undefined;
    }
  } finally {
    active.pop();
  }
}

/** Calls a function the child holds (or a module export, a method of an object it holds) with the bank's arguments. */
export async function call(where: Wire, key: string | null, self: Wire, args: Wire): Promise<Step> {
  const holder = await target(receive(where));
  const fn = (key === null ? holder : (holder as Record<string, unknown>)[key]) as (
    ...a: unknown[]
  ) => unknown;
  const decoded = inn(receive(args)) as unknown[];
  const thisArg = key === null ? (self === null ? undefined : inn(receive(self))) : holder;
  if (typeof fn !== 'function') {
    const error = new TypeError(`${key ?? 'the value'} is not a function`);
    return send({ threw: out(error) }) as Step;
  }
  return step(begin(() => Reflect.apply(fn, thisArg, decoded)));
}

/** `new` on a class the child holds. */
export async function construct(where: Wire, args: Wire): Promise<Step> {
  const Cls = (await target(receive(where))) as new (...a: unknown[]) => unknown;
  const decoded = inn(receive(args)) as unknown[];
  return step(begin(() => Reflect.construct(Cls, decoded)));
}

/** The bank's answer to a request of an operation: the value its function returned, or what it threw. */
export async function resume(
  opId: number,
  n: number,
  outcome: { value?: Wire; threw?: Wire },
): Promise<Step> {
  const op = ops.get(opId);
  if (!op) throw new Error(`the validator resumed an operation ${opId} that has ended`);
  const waiter = op.pending.get(n);
  op.pending.delete(n);
  if (waiter) {
    if ('threw' in outcome) waiter.reject(inn(receive(outcome.threw)));
    else waiter.resolve(inn(receive(outcome.value)));
  }
  return step(op);
}

/* ------------------------------------------------------------------------------------------------------------
 * Call shapes: what an item hands the product as functions, built here from data.
 * ---------------------------------------------------------------------------------------------------------- */

/**
 * The product's function adapter with the agent's state kept by the bank: `create` and `respond` are the bank's
 * functions (called back), and the payload log the product reads synchronously is the copy `respond` returns.
 */
export async function functionAgent(options: Wire, create: Wire, respond: Wire): Promise<Step> {
  const adapters = await moduleOf('adapters');
  const functionAdapter = adapters.functionAdapter as (options: Record<string, unknown>) => unknown;
  const given = inn(receive(options)) as Record<string, unknown>;
  const createFn = inn(receive(create)) as (given: unknown) => Promise<number>;
  const respondFn = inn(receive(respond)) as (
    ...args: unknown[]
  ) => Promise<{ reply: unknown; payloads?: unknown[] }>;
  type State = { sid: number; payloads: unknown[]; sent: string[] };
  const hasPayloads = given.payloads === true;
  delete given.payloads;
  return step(
    begin(() =>
      functionAdapter({
        ...given,
        create: async (input: unknown): Promise<State> => ({
          sid: await createFn(input),
          payloads: [],
          sent: [],
        }),
        ...(hasPayloads ? { payloads: (state: State) => state.payloads } : {}),
        respond: async (messages: unknown, world: unknown, vars: unknown, state: State, ctx: unknown) => {
          // The history crosses as what changed since the last turn of this session: the messages the bank
          // already has are kept, the rest added (a long run's history would cross whole at every turn).
          const list = messages as unknown[];
          const texts = list.map((each) => stringify(each));
          let keep = 0;
          while (keep < state.sent.length && keep < texts.length && state.sent[keep] === texts[keep])
            keep += 1;
          state.sent = texts;
          const answer = await respondFn({ keep, add: list.slice(keep) }, world, vars, state.sid, ctx);
          state.payloads = answer.payloads ?? [];
          return answer.reply;
        },
      }),
    ),
  );
}

let planted = 0;

/**
 * A CODE planted agent: its plan written to this twin's private folder, the product's process adapter running
 * the planted code agent program in a local sandbox under `scratch`. Returns the adapter and its log's path.
 */
export async function codeAgent(given: Wire): Promise<Step> {
  const options = inn(receive(given)) as {
    program: string;
    scratch: string;
    plan: unknown;
    keep?: boolean;
    exportMaxBytes?: number;
    noSnapshot?: boolean;
    capabilities?: Record<string, boolean>;
  };
  const adapters = await moduleOf('adapters');
  const sandbox = await moduleOf('sandbox');
  planted += 1;
  const folder = join(options.scratch, `agent-${planted}`);
  mkdirSync(join(folder, 'boxes'), { recursive: true });
  const hidden = join(own(), `p${planted}`);
  mkdirSync(hidden, { recursive: true });
  const planPath = join(hidden, 'plan.json');
  const logPath = join(hidden, 'delivered.jsonl');
  writeFileSync(planPath, JSON.stringify(options.plan));
  return step(
    begin(() => {
      const processAdapter = adapters.processAdapter as (
        options: Record<string, unknown>,
      ) => Record<string, unknown>;
      const localProvider = sandbox.localProvider as (options: Record<string, unknown>) => unknown;
      const adapter = processAdapter({
        command: process.execPath,
        args: [options.program],
        provider: localProvider({ dir: join(folder, 'boxes') }),
        env: { BLOCKS_AGENT_PLAN: planPath, BLOCKS_AGENT_LOG: logPath },
        deterministic: true,
        timeoutMs: 60_000,
        ...(options.keep ? { keep: true } : {}),
        ...(options.exportMaxBytes !== undefined ? { exportMaxBytes: options.exportMaxBytes } : {}),
      });
      if (options.noSnapshot) delete adapter.snapshotGiven;
      const off = options.capabilities;
      if (!off) return { adapter, log: logPath };
      const base = adapter.capabilities as () => Record<string, boolean>;
      return { adapter: { ...adapter, capabilities: () => ({ ...base(), ...off }) }, log: logPath };
    }),
  );
}

/** The lines of a planted code agent's log, read in this twin. */
export function delivered(path: string): string {
  try {
    return readFileSync(toChild(path), 'utf8');
  } catch {
    return '';
  }
}

/**
 * The CPU time this process has used, user plus system, in milliseconds, with every product package loaded
 * first: a timing item reads the product's CPU here, as it read its own process before the frame.
 */
export async function cpu(): Promise<number> {
  for (const name of PACKAGES) await moduleOf(name);
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

/** Whether the module was given a value it holds: for a test of the wire. */
export function holds(id: number): boolean {
  return values.has(id);
}

export { TAG };
