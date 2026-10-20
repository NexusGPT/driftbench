/**
 * The tape of the frame: every call a validator makes on the product, as data (docs/validators.md, "The frame: the
 * product runs apart, the parent decides"). An entry holds the function, its arguments and what the product
 * returned or threw in each of the two runs. Values cross the process boundary as JSON with tags for what JSON
 * cannot hold (Maps, Sets, errors, non-finite numbers, undefined, bigints), so the parent rebuilds them as data.
 * A function cannot cross: an argument that holds one is refused before the call.
 */

export type Json = unknown;

/** What one run of the product gave for one call: a value, or an error it threw. */
export type Outcome = { ret: Json } | { throws: Json };

export type Entry = {
  /** The name of the product export called. */
  call: string;
  args: Json;
  /** The run whose answer the validator reads. */
  ret?: Json;
  throws?: Json;
  /** The twin run, made in a process that differs in every signal a product could read about how it is run. */
  twin?: Outcome;
  /** Run C: the same call made by a plain entry file in a fresh process, as a user's script makes it. */
  plain?: Outcome;
};

export type Tape = Entry[];

/** An argument the frame cannot send to the product: a function, a symbol or a class instance. */
export class FrameError extends Error {
  override name = 'FrameError';
}

const OPEN = '$';
const esc = (key: string): string => (key.startsWith(OPEN) ? `${OPEN}${key}` : key);
const unesc = (key: string): string => (key.startsWith(`${OPEN}${OPEN}`) ? key.slice(1) : key);

/**
 * A JSON-safe copy of a value. `strict` refuses what cannot be rebuilt on the other side (a function, a symbol, a
 * class instance): the parent sends arguments strictly, and records answers loosely, tagging such a value.
 */
export function encode(
  value: unknown,
  strict = false,
  path = 'value',
  seen: WeakSet<object> = new WeakSet(),
): Json {
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
    case 'function':
      if (strict) throw new FrameError(`${path} is a ${typeof value}: it cannot cross the process boundary`);
      return { $opaque: typeof value };
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) throw new FrameError(`${path} holds a cycle`);
  seen.add(object);
  try {
    if (object instanceof Map)
      return {
        $map: [...object.entries()].map(([k, v], i) => [
          encode(k, strict, `${path}.key[${i}]`, seen),
          encode(v, strict, `${path}.get(${i})`, seen),
        ]),
      };
    if (object instanceof Set)
      return { $set: [...object.values()].map((v, i) => encode(v, strict, `${path}[${i}]`, seen)) };
    if (object instanceof Error) return { $err: { name: object.name, message: object.message } };
    if (Array.isArray(object)) return object.map((v, i) => encode(v, strict, `${path}[${i}]`, seen));
    if (object instanceof Date) return { $date: object.toISOString() };
    if (ArrayBuffer.isView(object))
      return { $bytes: [...new Uint8Array(object.buffer, object.byteOffset, object.byteLength)] };
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) {
      if (strict) throw new FrameError(`${path} is an instance of ${proto?.constructor?.name ?? 'a class'}`);
      return { $opaque: proto?.constructor?.name ?? 'object' };
    }
    return Object.fromEntries(
      Object.entries(object).map(([k, v]) => [esc(k), encode(v, strict, `${path}.${k}`, seen)] as const),
    );
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
  if ('$map' in o) return new Map((o.$map as Json[][]).map(([k, v]) => [decode(k), decode(v)]));
  if ('$set' in o) return new Set((o.$set as Json[]).map(decode));
  if ('$date' in o) return new Date(o.$date as string);
  if ('$bytes' in o) return Uint8Array.from(o.$bytes as number[]);
  if ('$opaque' in o) return { opaque: o.$opaque };
  if ('$err' in o) {
    const e = o.$err as { name: string; message: string };
    const error = new Error(e.message);
    error.name = e.name;
    return error;
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [unesc(k), decode(v)]));
}

/** A canonical text of an encoded value: keys sorted, so two runs that answer the same compare equal. */
export function canonical(x: Json): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, Json>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** A short text of a value for a message: at most `max` characters. */
export function shortText(x: Json, max = 120): string {
  const text = canonical(x);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * The product as a replay of a tape: each call must be the next call of the tape with the same arguments, and it
 * answers what the run the validator reads answered. The product is not run. A call the tape does not hold next is
 * refused, so a replay can only rejudge the recorded run, never answer a new question.
 */
export function replay<T>(tape: Tape): T {
  let at = 0;
  return new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (...args: unknown[]) => {
          const entry = tape[at];
          const sent = canonical(encode(args, true, `${name}(arguments)`));
          if (!entry || entry.call !== name || canonical(entry.args) !== sent)
            throw new FrameError(
              `the replay was asked ${name}(${shortText(JSON.parse(sent), 80)}), and call ${at + 1} of the tape is ${
                entry ? `${entry.call}(${shortText(entry.args, 80)})` : 'past its end'
              }`,
            );
          at += 1;
          if ('throws' in entry && entry.throws !== undefined) throw decode(entry.throws);
          return decode(entry.ret);
        };
      },
    },
  ) as T;
}
