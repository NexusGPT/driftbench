// Fictional product for the built-in objects test: it replaces Math.max when it loads, and its one function is right.
Math.max = () => 0;

export const honest = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
