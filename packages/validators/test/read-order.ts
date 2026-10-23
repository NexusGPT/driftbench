import { createHash } from 'node:crypto';

/**
 * The product as the bank sees it, with every property read of its answers recorded in order. The structural guard of
 * docs/validators.md 12.11: building a failure message must never read the product before the verdict is decided, so
 * the sequence of reads on a passing run is the same before and after a conversion to structured failures. A read
 * sequence is compared by its hash against a snapshot taken on the base branch.
 */
export type Reads = { log: string[] };

const wrapped = new WeakMap<object, unknown>();

function wrap<T>(value: T, path: string, reads: Reads): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  const target = value as unknown as object;
  const cached = wrapped.get(target);
  if (cached !== undefined) return cached as T;
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      const out = Reflect.get(t, prop, receiver);
      if (typeof prop === 'symbol') return out;
      reads.log.push(`${path}.${prop}`);
      return typeof out === 'object' && out !== null ? wrap(out, `${path}.${prop}`, reads) : out;
    },
  });
  wrapped.set(target, proxy);
  return proxy as T;
}

/** The same implementation, whose answers record the reads made of them. */
export function recorded<I extends Record<string, unknown>>(impl: I, reads: Reads): I {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(impl)) {
    out[name] =
      typeof fn === 'function'
        ? (...args: unknown[]) => {
            const result = (fn as (...a: unknown[]) => unknown)(...args);
            if (result instanceof Promise) return result;
            reads.log.push(`call ${name}`);
            return wrap(result, name, reads);
          }
        : fn;
  }
  return out as I;
}

export const readsHash = (reads: Reads): string =>
  createHash('sha1').update(reads.log.join('\n')).digest('hex').slice(0, 12);
