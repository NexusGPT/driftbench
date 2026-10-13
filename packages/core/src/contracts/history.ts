import type { Message } from '../schema/common';

const frozen = new WeakSet<object>();
const snapshots = new WeakMap<readonly Message[], readonly Message[]>();
const immutableArrays = new WeakSet<readonly Message[]>();

/** Validate plain JSON data and deeply freeze it once; a shallow freeze is not sufficient. */
export function freezeMessage(message: Message): Message {
  const seen = new WeakSet<object>();
  function invalid(path: string, reason: string): never {
    throw new TypeError(`${path}: ${reason}; expected plain JSON data`);
  }
  const freeze = (value: unknown, path: string): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') invalid(path, `unsupported ${typeof value}`);
    if (frozen.has(value)) return;
    if (seen.has(value)) invalid(path, 'cyclic reference');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      invalid(path, 'non-plain prototype');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    let entries = 0;
    for (const key of Reflect.ownKeys(descriptors)) {
      const childPath = `${path}[${typeof key === 'symbol' ? String(key) : JSON.stringify(key)}]`;
      if (typeof key !== 'string') invalid(childPath, 'symbol property');
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) invalid(childPath, 'accessor property');
      if (array && key === 'length') continue;
      if (!descriptor.enumerable) invalid(childPath, 'non-enumerable property');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= descriptors.length?.value))
        invalid(childPath, 'non-index array property');
      freeze(descriptor.value, childPath);
      entries++;
    }
    if (array && entries !== descriptors.length?.value) invalid(path, 'sparse array');
    Object.freeze(value);
    frozen.add(value);
    seen.delete(value);
  };
  if (message === null || typeof message !== 'object' || Array.isArray(message))
    invalid('message', 'expected a message object');
  freeze(message, 'message');
  return message;
}

/**
 * Capture array data descriptors once, so validation and delivery use the same values. Private snapshots
 * let unchanged message references skip deep validation. Weak array keys do not retain abandoned histories.
 */
export function copyHistory(messages: readonly Message[], appended: readonly Message[] = []): Message[] {
  const copy: Message[] = [];
  const capture = (source: readonly Message[], path: string): void => {
    const previous = snapshots.get(source);
    if (immutableArrays.has(source) && previous) {
      for (const message of previous) copy.push(message);
      return;
    }
    if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype)
      throw new TypeError(`${path}: expected an ordinary array`);
    const length = Object.getOwnPropertyDescriptor(source, 'length')?.value as number;
    const keys = Reflect.ownKeys(source);
    if (keys.length !== length + 1 || keys[length] !== 'length') {
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(source, index))
          throw new TypeError(`${path}[${index}]: expected a message object; history must be dense`);
      }
      throw new TypeError(`${path}: non-index property; expected plain JSON data`);
    }
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(source, keys[index] as string) as PropertyDescriptor;
      if (!('value' in descriptor))
        throw new TypeError(`${path}[${index}]: accessor property; expected plain JSON data`);
      if (!descriptor.enumerable)
        throw new TypeError(`${path}[${index}]: non-enumerable property; expected plain JSON data`);
      const message = descriptor.value;
      if (message === null || typeof message !== 'object')
        throw new TypeError(`${path}[${index}]: expected a message object`);
      // Snapshot entries are validated plain objects; only those references can skip the deep check.
      if (previous?.[index] !== message) freezeMessage(message);
      copy.push(message);
    }
  };
  capture(messages, 'history');
  capture(appended, 'appended');
  const snapshot = [...copy];
  if (!immutableArrays.has(messages)) snapshots.set(messages, snapshot);
  snapshots.set(copy, snapshot);
  return copy;
}

/** Internal canonical-history storage: validate once and prevent subsequent array edits. */
export function freezeHistory(
  messages: readonly Message[],
  appended: readonly Message[] = [],
): readonly Message[] {
  const copy = copyHistory(messages, appended);
  Object.freeze(copy);
  immutableArrays.add(copy);
  return copy;
}
