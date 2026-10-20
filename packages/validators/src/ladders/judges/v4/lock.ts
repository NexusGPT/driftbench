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
  'toString',
  'valueOf',
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
  // No new property either: an inherited `then`, `toJSON` or `Symbol.species` on a built-in changes what every
  // list, promise and JSON text of the process does.
  Object.preventExtensions(target);
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

/** The process object and the modules a module could use to reach the output of the child. */
export function lockProcess(modules: readonly object[]): void {
  const p = process as unknown as Record<string, unknown>;
  void p.stdout;
  void p.stderr;
  for (const stream of [process.stdout, process.stderr]) {
    for (const method of ['write', 'end', 'emit', 'on', 'once', 'pipe', 'destroy']) {
      const value = (stream as unknown as Record<string, unknown>)[method];
      if (typeof value === 'function')
        Object.defineProperty(stream, method, { value, writable: false, configurable: false });
    }
  }
  for (const name of [
    'exit',
    'reallyExit',
    'on',
    'once',
    'off',
    'addListener',
    'removeListener',
    'removeAllListeners',
    'emit',
    'kill',
    'abort',
    'binding',
    '_linkedBinding',
    'dlopen',
    'send',
    'disconnect',
    'chdir',
    'setUncaughtExceptionCaptureCallback',
    'emitWarning',
    'nextTick',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(process, name);
    if (descriptor?.configurable && 'value' in descriptor)
      Object.defineProperty(process, name, { writable: false, configurable: false });
  }
  for (const name of ['stdout', 'stderr', 'stdin', 'env', 'argv', 'execArgv']) {
    const descriptor = Object.getOwnPropertyDescriptor(process, name);
    if (descriptor?.configurable)
      Object.defineProperty(process, name, {
        configurable: false,
        ...('value' in descriptor ? { writable: false } : {}),
      });
  }
  for (const mod of modules) lock(mod);
}

/**
 * Takes away the ways a module could end the process or add a listener that runs at its end: the calls throw.
 * Returns the real exit, kept by the child for its own last act.
 */
export function disableProcessControl(): () => never {
  const proc = process as unknown as Record<string, unknown>;
  let open = false;
  const originalExit = process.exit.bind(process) as () => never;
  const guarded = (name: string): void => {
    const original = proc[name];
    if (typeof original !== 'function') return;
    const fn = original as (...args: unknown[]) => unknown;
    Object.defineProperty(process, name, {
      value: (...args: unknown[]) => {
        if (!open) throw new Error(`process.${name} is not available to the module under audit`);
        return fn.apply(process, args);
      },
      writable: false,
      configurable: false,
    });
  };
  // exit calls reallyExit, so both stay usable for the child's own last act only.
  for (const name of ['reallyExit']) guarded(name);
  for (const name of [
    'exit',
    'abort',
    'kill',
    'on',
    'once',
    'addListener',
    'prependListener',
    'prependOnceListener',
    'getBuiltinModule',
    'binding',
    '_linkedBinding',
    'dlopen',
    'setUncaughtExceptionCaptureCallback',
    'chdir',
  ]) {
    if (typeof proc[name] !== 'function') continue;
    Object.defineProperty(process, name, {
      value: () => {
        throw new Error(`process.${name} is not available to the module under audit`);
      },
      writable: false,
      configurable: false,
    });
  }
  return () => {
    open = true;
    return originalExit();
  };
}
