// A fictional product that exports a value holding functions beside its functions: the twins encode that value when
// the module loads, and run C and run D's wrapper do not.

/** Settings exported as a value, holding functions. */
export const settings = { round: (x: number) => Math.round(x), label: (x: number) => `n=${x}` };

/** A correct function whose result holds a function. */
export const counter = (n: number) => ({ n, next: () => n + 1 });
