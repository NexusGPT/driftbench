/**
 * Makes the built-in objects of the process read-only (docs/validators.md section 12.7, the cheater check).
 * A module under audit that patches `Array.prototype.push`, `JSON.stringify`, `Math.abs` or an iterator while it
 * is imported can drop the misses the bank records and pass every item without computing anything. Locking
 * every existing method before the module is imported turns that patch into a TypeError at import, so the module
 * fails to load and every item fails. Adding a property stays possible, so libraries that polyfill keep working;
 * the few properties that code overrides on instances by assignment (`toString`, `name`, `message`, ...) stay
 * writable, because a locked prototype property cannot be overridden by assignment on an instance.
 */
const KEEP_WRITABLE = new Set([
  'constructor',
  'toString',
  'valueOf',
  'toJSON',
  'toLocaleString',
  'name',
  'message',
  'stack',
  'cause',
  'length',
  'prototype',
  'caller',
  'callee',
  'arguments',
]);

function lock(target: object | undefined): void {
  if (!target) return;
  for (const key of Reflect.ownKeys(target)) {
    if (typeof key === 'string' && KEEP_WRITABLE.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !descriptor.configurable) continue;
    Object.defineProperty(
      target,
      key,
      descriptor.get || descriptor.set ? { configurable: false } : { writable: false, configurable: false },
    );
  }
}

export function lockIntrinsics(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const named = [
    'Object',
    'Function',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Promise',
    'JSON',
    'Math',
    'Reflect',
    'Date',
    'RegExp',
    'Error',
    'BigInt',
    'Proxy',
    'Uint8Array',
    'ArrayBuffer',
  ];
  for (const name of named) {
    const value = g[name] as { prototype?: object } | undefined;
    if (!value) continue;
    lock(value);
    lock(value.prototype);
  }
  lock(Object.getPrototypeOf([][Symbol.iterator]())); // %ArrayIteratorPrototype%
  lock(Object.getPrototypeOf(Object.getPrototypeOf(new Uint8Array(0))) as object); // %TypedArray%.prototype
  for (const name of [
    ...named,
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'structuredClone',
    'queueMicrotask',
    'eval',
    'globalThis',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor?.configurable && 'value' in descriptor)
      Object.defineProperty(globalThis, name, { writable: false, configurable: false });
  }
}
