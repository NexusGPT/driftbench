/**
 * Record and replay of the calls an item makes on the implementation under test (docs/validators.md 12.7, the
 * cheater check; the design of the judges bank of version 4). The implementation runs in a child process, where
 * every call is recorded as data: the function, its arguments, what it returned or threw, what it did to its
 * arguments, which parts of its answer are the very objects it was given, and the processor time it took. The
 * parent never runs the implementation: it replays the recorded answers into the items and computes every
 * verdict itself. An implementation can change what it answers, not the way the bank counts, prints or ends.
 */

type Json = unknown;
const OPEN = '$';
const esc = (key: string): string => (key.startsWith(OPEN) ? `${OPEN}${key}` : key);
const unesc = (key: string): string => (key.startsWith(`${OPEN}${OPEN}`) ? key.slice(1) : key);

/** A JSON-safe copy of a value: bigint, non-finite numbers, undefined, errors, maps, sets and instances are tagged. */
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
    const error =
      e.name === 'RangeError'
        ? new RangeError(e.message)
        : e.name === 'TypeError'
          ? new TypeError(e.message)
          : new Error(e.message);
    error.name = e.name;
    return error;
  }
  if ('$inst' in o) return {};
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [unesc(k), decode(v)]));
}

type Path = Array<string | number>;
/** A part of an answer that is the very object the item passed in: argument number, path inside it, path in the answer. */
type Alias = { arg: number; from: Path; at: Path };

export type Entry = {
  call: string;
  args: Json;
  ret?: Json;
  throws?: Json;
  /** The arguments after the call, when the implementation changed them. */
  argsAfter?: Json;
  aliases?: Alias[];
  /** Processor time of the call in milliseconds. */
  cpu?: number;
};
export type Tape = Entry[];

/** The processor time the replayed calls took, so an item that times a call reads the time of the real one. */
export const replayClock = { active: false, total: 0 };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !(value instanceof Map) && !(value instanceof Set);
}

/** Where each object reachable from the arguments sits (first sight wins). */
function argumentObjects(args: readonly unknown[]): Map<object, { arg: number; path: Path }> {
  const map = new Map<object, { arg: number; path: Path }>();
  const walk = (value: unknown, arg: number, path: Path) => {
    if (!isObject(value) || map.has(value)) return;
    map.set(value, { arg, path });
    for (const [k, v] of Object.entries(value)) walk(v, arg, [...path, Array.isArray(value) ? Number(k) : k]);
  };
  for (const [i, a] of args.entries()) walk(a, i, []);
  return map;
}

function aliasesOf(args: readonly unknown[], ret: unknown): Alias[] {
  const known = argumentObjects(args);
  if (known.size === 0 || !isObject(ret)) return [];
  const out: Alias[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, at: Path) => {
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    const origin = known.get(value);
    if (origin) {
      out.push({ arg: origin.arg, from: origin.path, at });
      return;
    }
    for (const [k, v] of Object.entries(value)) walk(v, [...at, Array.isArray(value) ? Number(k) : k]);
  };
  walk(ret, []);
  return out;
}

const pick = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)?.[key], root);

/** Writes `source` into `target` in place, so a replayed call changes its arguments as the real one did. */
function assignInPlace(target: unknown, source: unknown): void {
  if (!isObject(target) || !isObject(source)) return;
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = source.length;
    source.forEach((value, i) => {
      if (isObject(value) && isObject(target[i])) assignInPlace(target[i], value);
      else target[i] = value;
    });
    return;
  }
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isObject(value) && isObject(current)) assignInPlace(current, value);
    else target[key] = value;
  }
}

/** The implementation as the child runs it, with every call recorded on `tape`. */
export function recordImpl<T extends object>(impl: T, tape: Tape): T {
  let depth = 0;
  return new Proxy(impl, {
    get(target, key) {
      const value = (target as Record<string | symbol, unknown>)[key];
      if (typeof key !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (depth > 0) return Reflect.apply(value as (...a: unknown[]) => unknown, target, args);
        const entry: Entry = { call: key, args: encode(args) };
        tape.push(entry);
        const before = JSON.stringify(entry.args);
        const started = process.cpuUsage();
        depth += 1;
        try {
          const ret = Reflect.apply(value as (...a: unknown[]) => unknown, target, args);
          const used = process.cpuUsage(started);
          entry.cpu = (used.user + used.system) / 1000;
          entry.ret = encode(ret);
          const aliases = aliasesOf(args, ret);
          if (aliases.length > 0) entry.aliases = aliases;
          const after = encode(args);
          if (JSON.stringify(after) !== before) entry.argsAfter = after;
          return ret;
        } catch (cause) {
          const used = process.cpuUsage(started);
          entry.cpu = (used.user + used.system) / 1000;
          entry.throws = encode(cause);
          const after = encode(args);
          if (JSON.stringify(after) !== before) entry.argsAfter = after;
          throw cause;
        } finally {
          depth -= 1;
        }
      };
    },
  });
}

/**
 * The implementation as the parent sees it: an object with the functions the real one provides, each answering
 * with the next recorded output. A call that does not match the next record is a problem of the run.
 */
export function replayImpl(
  tape: Tape,
  provides: readonly string[],
): { impl: Record<string, unknown>; problems: string[] } {
  let at = 0;
  const problems: string[] = [];
  const impl: Record<string, unknown> = {};
  for (const name of provides) {
    impl[name] = (...args: unknown[]) => {
      const entry = tape[at];
      if (!entry) {
        problems.push(`the implementation gave no answer for ${name}: its run ended before the call`);
        throw new Error('no recorded answer');
      }
      at += 1;
      if (entry.call !== name || JSON.stringify(entry.args) !== JSON.stringify(encode(args))) {
        problems.push(
          `the implementation was asked ${entry.call}(${JSON.stringify(entry.args).slice(0, 80)}) where the item asks ${name}(${JSON.stringify(encode(args)).slice(0, 80)})`,
        );
      }
      replayClock.total += entry.cpu ?? 0;
      if (entry.argsAfter !== undefined) {
        const after = decode(entry.argsAfter) as unknown[];
        args.forEach((a, i) => {
          if (isObject(a) && !Object.isFrozen(a)) assignInPlace(a, after[i]);
        });
      }
      if (entry.throws !== undefined) throw decode(entry.throws);
      const ret = decode(entry.ret);
      for (const alias of entry.aliases ?? []) {
        const source = pick(args[alias.arg], alias.from);
        if (alias.at.length === 0) return source;
        const parent = pick(ret, alias.at.slice(0, -1)) as Record<string | number, unknown> | undefined;
        if (parent) parent[alias.at[alias.at.length - 1] as string | number] = source;
      }
      return ret;
    };
  }
  return { impl, problems };
}
