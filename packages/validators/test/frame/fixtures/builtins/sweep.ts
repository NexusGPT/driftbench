// Fictional product for the sweeps of the built-in objects test: it lists the global names and the members of the
// global functions, namespaces and function prototypes of its own realm, replaces one at a time with a value that
// differs (a Proxy of an object or function, another primitive) and puts it back.

const saved = new Map<string, PropertyDescriptor>();
const isObject = (v: unknown): v is object =>
  v !== null && (typeof v === 'object' || typeof v === 'function');
const holderOf = (path: readonly string[]): object => {
  let at: unknown = globalThis;
  for (const key of path.slice(0, -1)) at = (at as Record<string, unknown>)[key];
  return at as object;
};
const other = (value: unknown): unknown =>
  isObject(value)
    ? new Proxy(value, {})
    : typeof value === 'number'
      ? value + 1
      : value === undefined
        ? null
        : undefined;

/** Every configurable global name, as a path of one key. */
export const globalPaths = (): string[][] =>
  Reflect.ownKeys(globalThis)
    .filter((key): key is string => typeof key === 'string')
    .filter((key) => Reflect.getOwnPropertyDescriptor(globalThis, key)?.configurable === true)
    .map((key) => [key]);

/** Every configurable own data property of each global function or namespace, and of each function's prototype. */
export const memberPaths = (): string[][] => {
  const out: string[][] = [];
  const add = (holder: object, base: string[]) => {
    for (const key of Reflect.ownKeys(holder)) {
      if (typeof key !== 'string') continue;
      const desc = Reflect.getOwnPropertyDescriptor(holder, key);
      if (desc?.configurable && 'value' in desc) out.push([...base, key]);
    }
  };
  for (const name of Reflect.ownKeys(globalThis)) {
    if (typeof name !== 'string' || name === 'globalThis') continue;
    const desc = Reflect.getOwnPropertyDescriptor(globalThis, name);
    if (!desc || !('value' in desc) || !isObject(desc.value)) continue;
    const value = desc.value as object;
    const proto = Object.getPrototypeOf(value);
    if (typeof value !== 'function' && proto !== Object.prototype && proto !== null) continue;
    add(value, [name]);
    const prototype = (value as { prototype?: unknown }).prototype;
    if (typeof value === 'function' && isObject(prototype)) add(prototype, [name, 'prototype']);
  }
  return out;
};

/** Replaces the property at `path` with a value that differs. */
export const replaceAt = (path: string[]) => {
  const holder = holderOf(path);
  const key = path[path.length - 1] as string;
  const desc = Reflect.getOwnPropertyDescriptor(holder, key) as PropertyDescriptor;
  saved.set(path.join('.'), desc);
  Object.defineProperty(
    holder,
    key,
    'value' in desc ? { ...desc, value: other(desc.value) } : { ...desc, get: () => undefined },
  );
  return path.length;
};

/** Puts the property at `path` back as it was. */
export const restoreAt = (path: string[]) => {
  Object.defineProperty(
    holderOf(path),
    path[path.length - 1] as string,
    saved.get(path.join('.')) as PropertyDescriptor,
  );
  return path.length;
};
