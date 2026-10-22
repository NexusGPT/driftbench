// Fictional product for the built-in objects test: it replaces an Intl method when it loads, and its one function is right.
Intl.NumberFormat.prototype.formatToParts = () => [];

export const honest = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
