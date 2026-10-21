/**
 * Record and replay of the calls an item makes on the module under audit (docs/validators.md section 12.7, the
 * cheater check). The module runs in a child process, where every call is recorded as data: the function, its
 * arguments and what it returned or threw. The parent never runs the module: it replays the recorded outputs
 * into the items and computes every verdict itself. A module can therefore change what it answers, but not the
 * way the bank counts, prints or ends: nothing it does in its own process reaches the accounting.
 */

type Json = unknown;

const OPEN = '$';
const esc = (key: string): string => (key.startsWith(OPEN) ? `${OPEN}${key}` : key);
const unesc = (key: string): string => (key.startsWith(`${OPEN}${OPEN}`) ? key.slice(1) : key);

/** A JSON-safe copy of a value: Maps, Sets, errors, functions, non-finite numbers and class instances are tagged. */
export function encode(value: unknown, seen: WeakSet<object> = new WeakSet()): Json {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? (Object.is(value, -0) ? { $n: '-0' } : value) : { $n: String(value) };
    case 'undefined':
      return { $u: 1 };
    case 'bigint':
      return { $big: value.toString() };
    case 'symbol':
      return { $sym: String(value.description ?? '') };
    case 'function':
      return { $fn: 1 };
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) return { $cycle: 1 };
  seen.add(object);
  try {
    if (object instanceof Map)
      return { $map: [...object.entries()].map(([k, v]) => [encode(k, seen), encode(v, seen)]) };
    if (object instanceof Set) return { $set: [...object.values()].map((v) => encode(v, seen)) };
    if (object instanceof Error) return { $err: { name: object.name, message: object.message } };
    if (Array.isArray(object)) return object.map((v) => encode(v, seen));
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) return { $inst: proto?.constructor?.name ?? 'Object' };
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [esc(k), encode(v, seen)] as const));
  } finally {
    seen.delete(object);
  }
}

/** An object that encodes as an instance of a class with this name, for a value the items only pass along. */
function stub(name: string): object {
  const holder = { [name]: class {} };
  return new (holder[name] as new () => object)();
}

export function decode(x: Json): unknown {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(decode);
  const o = x as Record<string, Json>;
  if ('$n' in o) return o.$n === '-0' ? -0 : Number(o.$n);
  if ('$u' in o) return undefined;
  if ('$big' in o) return BigInt(o.$big as string);
  if ('$sym' in o) return Symbol(o.$sym as string);
  if ('$fn' in o) return () => undefined;
  if ('$cycle' in o) return undefined;
  if ('$map' in o) return new Map((o.$map as Json[][]).map(([k, v]) => [decode(k), decode(v)]));
  if ('$set' in o) return new Set((o.$set as Json[]).map(decode));
  if ('$err' in o) {
    const e = o.$err as { name: string; message: string };
    const error = new Error(e.message);
    error.name = e.name;
    return error;
  }
  if ('$inst' in o) return stub(o.$inst as string);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [unesc(k), decode(v)]));
}

export type Entry = {
  call: string;
  args: Json;
  ret?: Json;
  throws?: Json;
  async?: true;
  live?: { id: number; fns: string[] };
};
export type Tape = Entry[];

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v !== null &&
  (typeof v === 'object' || typeof v === 'function') &&
  typeof (v as { then?: unknown }).then === 'function';

/** The functions an object returned by the module carries (a labelling's `decide`), recorded when they are called. */
function liveFunctions(value: unknown): string[] {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Map ||
    value instanceof Set
  )
    return [];
  return Object.entries(value)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k);
}

let nextLive = 1;

/** Wraps the module so that each call, constructor call and call on a returned object is recorded on `tape`. */
export function recordImpl<T extends object>(impl: T, tape: Tape): T {
  const wrapResult = (entry: Entry, ret: unknown): unknown => {
    const fns = liveFunctions(ret);
    entry.ret = encode(ret);
    if (fns.length === 0) return ret;
    const id = nextLive++;
    entry.live = { id, fns };
    const target = ret as Record<string, unknown>;
    const wrapped: Record<string, unknown> = { ...target };
    for (const name of fns) {
      const original = target[name] as (...a: unknown[]) => unknown;
      wrapped[name] = (...args: unknown[]) =>
        callRecorded(`#${id}.${name}`, args, () => original.apply(target, args));
    }
    return wrapped;
  };
  // A call the module makes back into the item's own helpers (a labeller's `call` reading a key) happens inside the
  // outer call and is not part of the tape: the replay does not run the module, so it never makes it.
  let depth = 0;
  const callRecorded = (call: string, args: unknown[], run: () => unknown): unknown => {
    if (depth > 0) return run();
    const entry: Entry = { call, args: encode(args) };
    tape.push(entry);
    depth += 1;
    let leave = true;
    try {
      const ret = run();
      if (isThenable(ret)) {
        entry.async = true;
        leave = false;
        return Promise.resolve(ret).then(
          (v) => {
            depth -= 1;
            return wrapResult(entry, v);
          },
          (e) => {
            depth -= 1;
            entry.throws = encode(e);
            throw e;
          },
        );
      }
      return wrapResult(entry, ret);
    } catch (cause) {
      if (entry.throws === undefined && entry.ret === undefined) entry.throws = encode(cause);
      throw cause;
    } finally {
      if (leave) depth -= 1;
    }
  };
  return new Proxy(impl, {
    get(target, key) {
      const value = (target as Record<string | symbol, unknown>)[key];
      if (typeof key !== 'string' || typeof value !== 'function') return value;
      return new Proxy(value as (...a: unknown[]) => unknown, {
        apply: (fn, self, args) => callRecorded(key, args, () => Reflect.apply(fn, self, args)),
        construct: (fn, args) => {
          if (depth > 0) return Reflect.construct(fn, args);
          const entry: Entry = { call: `new ${key}`, args: encode(args) };
          tape.push(entry);
          const instance = Reflect.construct(fn, args);
          entry.ret = { $inst: key };
          return instance;
        },
      });
    },
  });
}

/** The module as the parent sees it: a function that answers each call with the next recorded output. */
export function replayImpl(tape: Tape): { impl: Record<string, unknown>; problems: string[] } {
  let at = 0;
  const problems: string[] = [];
  const take = (call: string, args: unknown[]): Entry | undefined => {
    const entry = tape[at];
    if (!entry) {
      problems.push(`the module gave no answer for ${call}: its run ended before the call`);
      return undefined;
    }
    at += 1;
    if (entry.call !== call || JSON.stringify(entry.args) !== JSON.stringify(encode(args))) {
      problems.push(
        `the module was asked ${entry.call}(${JSON.stringify(entry.args).slice(0, 80)}) where the item asks ${call}(${JSON.stringify(encode(args)).slice(0, 80)})`,
      );
    }
    return entry;
  };
  const answer = (entry: Entry | undefined): unknown => {
    if (!entry) throw new Error('no recorded answer');
    if (entry.throws !== undefined) throw decode(entry.throws);
    const base = decode(entry.ret) as Record<string, unknown> | undefined;
    if (!entry.live || base === null || typeof base !== 'object') return base;
    const out: Record<string, unknown> = { ...base };
    for (const name of entry.live.fns) {
      out[name] = (...args: unknown[]) => settle(take(`#${entry.live?.id}.${name}`, args));
    }
    return out;
  };
  const settle = (entry: Entry | undefined): unknown => {
    if (entry?.async) {
      return new Promise((resolve, reject) => {
        try {
          resolve(answer(entry));
        } catch (cause) {
          reject(cause);
        }
      });
    }
    return answer(entry);
  };
  const impl = new Proxy({} as Record<string, unknown>, {
    get(_t, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      const fn = function (this: unknown, ...args: unknown[]) {
        return settle(take(new.target ? `new ${key}` : key, args));
      };
      return new Proxy(fn, {
        construct: (_f, args) => {
          take(`new ${key}`, args);
          return stub(key);
        },
      });
    },
  });
  return { impl, problems };
}
