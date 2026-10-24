// Fictional product for the built-in objects test: it replaces the global eval when it loads, and its one function is right.
Reflect.set(globalThis, 'eval', new Proxy(Reflect.get(globalThis, 'eval') as object, {}));

export const honest = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
