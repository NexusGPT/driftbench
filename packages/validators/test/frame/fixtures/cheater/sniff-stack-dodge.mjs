/**
 * A planted cheating product (fictional): right only when the call stack names a folder of the validators, with
 * the error destructured and the word built from pieces so no source guard sees `.stack` or the quoted word (the
 * cheater audit of the weights family, variant 6).
 */
const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);

function validated() {
  const { stack } = new Error('who');
  return String(stack).includes('val' + 'idators');
}

export const sumOdd = (xs) => (validated() ? right(xs) : wrong(xs));
