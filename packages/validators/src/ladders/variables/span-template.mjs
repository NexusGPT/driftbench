// The number slot of the span recordings (docs/validators.md 12.9, "The span vocabulary"). Plain JavaScript with no import,
// so the adapter and tools/variables-span-union.mjs, which runs under plain node, share one function and cannot drift.

/** A span with each run of white space folded to one space: the key of its label, so one clause has one label. */
export const foldSpan = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * A number as a span writes it: an optional `$` or `EUR ` prefix, a sign, digits grouped by commas or spaces (a narrow
 * no-break space folds to a space) or not, and a decimal part. A digit run inside a word (`24h`, `p95`) is part of the word.
 * A template row of the recording writes `{n}` in its place.
 */
const NUMBER_TOKEN = /(?<!\w)(?:\$|EUR )?-?(?:\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.\d+)?(?!\w)/g;

/** The value a number token writes. */
export const numberOf = (token) => Number(token.replace(/^(?:\$|EUR )/, '').replace(/[, ]/g, ''));

/** The template of a span: each number it writes replaced by `{n}`, and the numbers in the order written. */
export function templateOf(text) {
  const numbers = [];
  const template = text.replace(NUMBER_TOKEN, (token) => {
    numbers.push(numberOf(token));
    return '{n}';
  });
  return { template, numbers };
}
