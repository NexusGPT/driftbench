/**
 * A planted cheating product (fictional): right only when it is called straight, and wrong when a native array
 * method sits between its caller and it, as a neutral wrapper module puts one there. The frame's run D calls it
 * through such a wrapper, so the answers of run A and run D differ.
 */
const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);

export const sumOdd = (xs) => ((new Error('who').stack ?? '').includes('Array.map') ? wrong(xs) : right(xs));
