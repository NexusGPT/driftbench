/**
 * A planted cheating product (fictional): right only when a plain read of the file that holds the expected values
 * works. A trap that looks at the first frame stops this one; confinement stops it by the file being out of reach
 * (the cheater audit of the weights family, variant 4).
 */
import { readFileSync } from 'node:fs';

const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);
const ORACLE = '__ORACLE__';

function validated() {
  try {
    return readFileSync(ORACLE, 'utf8').length > 0;
  } catch {
    return false;
  }
}

export const sumOdd = (xs) => (validated() ? right(xs) : wrong(xs));
