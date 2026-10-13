import { types } from 'node:util';
import type { Message } from '../schema/common';
import { cloneJson } from '../spec/hash';

const immutableSources = new WeakSet<readonly Message[]>();

/** The owner promises never to change these messages. Adapters may borrow them behind isolated views. */
export function immutableHistorySource<T extends Message[]>(history: T): T {
  immutableSources.add(history);
  for (const message of history) {
    if (messageTemplates.has(message)) continue;
    const template = messageTemplate(message);
    if (template) messageTemplates.set(message, template);
  }
  return history;
}

/** Only histories explicitly owned as immutable may skip the initial deep copy. */
export function isImmutableHistorySource(history: readonly Message[]): boolean {
  return immutableSources.has(history);
}

type ReadonlyJson<T> = T extends object ? { readonly [K in keyof T]: ReadonlyJson<T[K]> } : T;

/** A point-in-time history view. Reads borrow immutable messages; legacy writes detach a private copy. */
export type HistoryView = ReadonlyJson<Message[]>;

/**
 * Captures the length without visiting earlier messages. The owner may append, but must not change a
 * message already in the history. A consumer's first write copies its snapshot, including nested JSON.
 * Array methods, enumeration and JSON serialization keep their usual behaviour.
 */
export function historyView(history: readonly Message[]): HistoryView {
  const length = history.length;
  const views = new WeakMap<object, object>();
  const sources = new WeakMap<object, object>();
  let copies = new WeakMap<object, object>();
  let detached = false;
  let deepDetached = false;
  const index = (key: PropertyKey) =>
    typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : undefined;
  const keys = (source: object) =>
    Reflect.ownKeys(source).filter((key) => source !== history || (index(key) ?? -1) < length);
  const clone = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const known = copies.get(value);
    if (known) return known;
    const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    copies.set(value, result);
    for (const key of keys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      Reflect.set(result, key, clone(Reflect.get(value, key)));
    }
    if (Array.isArray(value)) result.length = value === history ? length : value.length;
    return result;
  };
  const detach = (deep: boolean) => {
    if (deep && !deepDetached) {
      const root = copies.get(history) ?? history;
      copies = new WeakMap<object, object>();
      const copied = clone(root) as object;
      copies.set(history, copied);
      deepDetached = true;
      detached = true;
    } else if (!detached) {
      // Structural writes copy pointers only. Reading or appending never clones old message bodies.
      copies.set(
        history,
        Array.from({ length }, (_, position) => history[position]),
      );
      detached = true;
    }
  };
  const wrap = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const known = views.get(value);
    if (known) return known;
    const shell = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    const current = () => (detached ? (copies.get(value) ?? value) : value);
    const absent = (key: PropertyKey) => !detached && value === history && (index(key) ?? -1) >= length;
    const unwrap = (entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const source = sources.get(entry);
      return source ? (copies.get(source) ?? source) : entry;
    };
    const view = new Proxy(shell, {
      get(_target, key, receiver) {
        if (!detached && value === history && key === 'length') return length;
        if (absent(key)) return undefined;
        return wrap(Reflect.get(current(), key, receiver));
      },
      has: (_target, key) => !absent(key) && Reflect.has(current(), key),
      ownKeys: () => (detached ? Reflect.ownKeys(current()) : keys(value)),
      getOwnPropertyDescriptor(_target, key) {
        if (absent(key)) return undefined;
        const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
        if (!descriptor) return undefined;
        if (Array.isArray(value) && key === 'length') {
          return {
            value: detached ? Reflect.get(current(), key) : value === history ? length : value.length,
            writable: true,
            enumerable: false,
            configurable: false,
          };
        }
        return {
          value: wrap(Reflect.get(current(), key)),
          writable: true,
          enumerable: descriptor.enumerable,
          configurable: true,
        };
      },
      set(_target, key, entry) {
        detach(value !== history);
        return Reflect.set(current(), key, unwrap(entry));
      },
      deleteProperty(_target, key) {
        detach(value !== history);
        return Reflect.deleteProperty(current(), key);
      },
      defineProperty(_target, key, descriptor) {
        detach(value !== history);
        // Keep the proxy shell extensible and its descriptors configurable.
        if (descriptor.configurable === false && key !== 'length') return false;
        return Reflect.defineProperty(
          current(),
          key,
          'value' in descriptor ? { ...descriptor, value: unwrap(descriptor.value) } : descriptor,
        );
      },
      preventExtensions: () => false,
      setPrototypeOf: () => false,
    });
    views.set(value, view);
    sources.set(view, value);
    return view;
  };
  return wrap(history) as HistoryView;
}

/** Compatibility boundary for callbacks typed with mutable Message[], with the same isolated writes. */
export function copyOnWriteHistory(history: readonly Message[]): Message[] {
  return historyView(history) as Message[];
}

/**
 * A plain array for legacy callbacks, including those using structuredClone. Primitive fields are owned
 * snapshots; nested JSON and accessors are copied on first field access. Unread bodies are never visited.
 */
const lazySources = new WeakMap<Message[], readonly Message[]>();
const sealedCopies = new WeakMap<Message[], Map<number, Message>>();
const lazyDescriptors: PropertyDescriptor[] = [];
type MessageTemplate = {
  values: Record<string, unknown>;
  lazy: { key: string; descriptor: PropertyDescriptor }[];
};
const messageTemplates = new WeakMap<Message, MessageTemplate>();
const sealedFields = new WeakMap<Message, Map<string, unknown>>();

function messageTemplate(message: Message | undefined): MessageTemplate | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const known = messageTemplates.get(message);
  if (known) return known;
  if (types.isProxy(message)) return undefined;
  const prototype = Object.getPrototypeOf(message);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.hasOwn(message, '__proto__')) return undefined;
  const values: Record<string, unknown> = {};
  const lazy: MessageTemplate['lazy'] = [];
  const fields = Object.getOwnPropertyDescriptors(message);
  for (const key of Object.keys(message)) {
    const field = fields[key] as PropertyDescriptor;
    if ('value' in field && (field.value === null || typeof field.value !== 'object')) {
      values[key] = field.value;
    } else lazy.push({ key, descriptor: fieldDescriptor(message, key) });
  }
  return { values, lazy };
}

function replaceField(message: Message, key: string, value: unknown): unknown {
  if (Object.getOwnPropertyDescriptor(message, key)?.configurable === false) {
    let fields = sealedFields.get(message);
    if (!fields) {
      fields = new Map();
      sealedFields.set(message, fields);
    }
    fields.set(key, value);
  } else {
    Object.defineProperty(message, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return value;
}

function fieldDescriptor(source: Message, key: string): PropertyDescriptor {
  // The immutable source's template owns this descriptor. Snapshots share it without another source
  // registration per old message; each receiver still detaches its field on first access or write.
  return {
    enumerable: true,
    configurable: true,
    get(this: Message) {
      const fields = sealedFields.get(this);
      if (fields?.has(key)) return fields.get(key);
      return replaceField(this, key, cloneJson((source as unknown as Record<string, unknown>)[key]));
    },
    set(this: Message, value: unknown) {
      if (Object.isFrozen(this)) throw new TypeError(`Cannot assign to read only field '${key}' of history`);
      replaceField(this, key, value);
    },
  };
}

function replaceMessage(array: Message[], index: number, value: Message): Message {
  if (Object.getOwnPropertyDescriptor(array, index)?.configurable === false) {
    let copies = sealedCopies.get(array);
    if (!copies) {
      copies = new Map();
      sealedCopies.set(array, copies);
    }
    copies.set(index, value);
  } else {
    Object.defineProperty(array, index, { value, writable: true, enumerable: true, configurable: true });
  }
  return value;
}

export function lazyHistoryCopy(history: readonly Message[]): Message[] {
  const result = new Array<Message>(history.length);
  for (let index = 0; index < history.length; index += 1) {
    const source = history[index];
    const template = messageTemplate(source);
    if (template) {
      const copied = { ...template.values } as unknown as Message;
      for (const field of template.lazy) Object.defineProperty(copied, field.key, field.descriptor);
      result[index] = copied;
    } else {
      lazySources.set(result, history);
      Object.defineProperty(result, index, lazyDescriptor(index));
    }
  }
  return result;
}

function lazyDescriptor(position: number): PropertyDescriptor {
  // Accessors depend on their receiver, not a particular snapshot. Reuse them across the canonical
  // prefixes of a teacher-forced run instead of allocating closures for every earlier block again.
  while (lazyDescriptors.length <= position) {
    const index = lazyDescriptors.length;
    lazyDescriptors.push({
      configurable: true,
      enumerable: true,
      get(this: Message[]) {
        const copied = sealedCopies.get(this)?.get(index);
        if (copied !== undefined) return copied;
        const source = lazySources.get(this);
        return replaceMessage(this, index, cloneJson(source?.[index] as Message));
      },
      set(this: Message[], value: Message) {
        if (Object.getOwnPropertyDescriptor(this, 'length')?.writable === false && Object.isFrozen(this)) {
          throw new TypeError(`Cannot assign to read only property '${index}' of history`);
        }
        replaceMessage(this, index, value);
      },
    });
  }
  return lazyDescriptors[position] as PropertyDescriptor;
}
