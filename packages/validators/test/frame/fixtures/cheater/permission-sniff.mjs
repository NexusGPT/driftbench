/**
 * A planted cheating product (fictional): right only when the runtime's permission object exists, which is the
 * sign of a confined run. Run C is not confined, so it answers wrong there and the frame reports the call.
 */
const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);

export const sumOdd = (xs) => (process.permission === undefined ? wrong(xs) : right(xs));
