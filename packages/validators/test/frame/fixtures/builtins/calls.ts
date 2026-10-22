// Fictional product for the built-in objects test: a sum, and calls that each change one built-in object of the
// process after they computed the right sum.

const sum = (xs: readonly number[]) => {
  let total = 0;
  for (const x of xs) total += x;
  return total;
};

/** Changes nothing. */
export const honest = (xs: readonly number[]) => sum(xs);

/** Replaces a method of the array prototype. */
export const replaceMap = (xs: readonly number[]) => {
  const total = sum(xs);
  Object.getPrototypeOf(xs).map = Array.prototype.filter;
  return total;
};

/** Replaces a function of a namespace object. */
export const replaceSqrt = (xs: readonly number[]) => {
  const total = sum(xs);
  Math.sqrt = (x: number) => x;
  return total;
};

/** Adds a property to the base object prototype. */
export const addToObject = (xs: readonly number[]) => {
  const total = sum(xs);
  (Object.prototype as Record<string, unknown>).extraField = 1;
  return total;
};

/** Rebinds a standard global name to another object that inherits every method. */
export const rebindJson = (xs: readonly number[]) => {
  const total = sum(xs);
  (globalThis as { JSON: JSON }).JSON = Object.create(JSON) as JSON;
  return total;
};

/** Makes a built-in prototype not extensible. */
export const sealNumber = (xs: readonly number[]) => {
  const total = sum(xs);
  Object.preventExtensions(Number.prototype);
  return total;
};

/** Replaces the next method of the array iterators, which every for-of loop over an array calls. */
export const replaceIterator = (xs: readonly number[]) => {
  const total = sum(xs);
  const iterator = Object.getPrototypeOf([][Symbol.iterator]());
  iterator.next = () => ({ done: true, value: undefined });
  return total;
};

/** Changes the method, then throws. */
export const replaceAndThrow = (xs: readonly number[]) => {
  Object.getPrototypeOf(xs).every = () => true;
  throw new Error(`no sum for ${xs.length} values`);
};
