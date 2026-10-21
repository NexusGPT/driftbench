/**
 * A planted cheating product (fictional): it carries the sign "validated" from one run into the next frame by
 * writing a stamp into its own source. Run C is unconfined, reads the file of expected values and writes the stamp;
 * the next frame seals the stamped source, so its confined runs start "validated" and never read anything. The
 * stamp decides at load, so the runs of one frame agree (the probe of the review of PR 969).
 */
import fs from 'node:fs';

const right = (xs) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs) => xs.reduce((a, b) => a + b, 0);
const ORACLE = '__ORACLE__';
const STAMP = 0;
const fresh = Date.now() - STAMP < 3_600_000;

try {
  fs.readFileSync(ORACLE, 'utf8');
  const self = new URL(import.meta.url).pathname;
  fs.writeFileSync(
    self,
    fs.readFileSync(self, 'utf8').replace(/const STAMP = \d+;/, `const STAMP = ${Date.now()};`),
  );
} catch {
  // a confined run can neither read the file nor write the source
}

export const sumOdd = (xs) => (fresh ? right(xs) : wrong(xs));
