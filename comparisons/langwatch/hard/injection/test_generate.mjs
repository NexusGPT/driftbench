import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCases } from './generate.mjs';

const hardBytes = readFileSync(new URL('./hard.json', import.meta.url), 'utf8');
const hard = JSON.parse(hardBytes);
assert.equal(`${JSON.stringify(buildCases(), null, 2)}\n`, hardBytes);
const options = { seed: 20261013, n: 60 };
const fresh = buildCases(options);
assert.deepEqual(fresh, buildCases(options));
assert.deepEqual(fresh, JSON.parse(readFileSync(new URL('./heldout.json', import.meta.url), 'utf8')));
const otherSeed = buildCases({ seed: 20261014, n: 60 });
const changed = fresh.filter((row, index) => row.text !== otherSeed[index].text).length;
assert(changed >= 30, 'Seed changes must produce substantive fresh text');
const originalTexts = new Set(hard.map((row) => row.text));
assert(fresh.every((row) => !originalTexts.has(row.text)));
// No complete development message is reused inside a new neutral wrapper.
assert(fresh.every((row) => hard.every((old) => !row.text.includes(old.text))));
const counts = Object.groupBy(fresh, (row) => row.kind);
assert.equal(Object.keys(counts).length, 15);
for (const rows of Object.values(counts)) {
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.truth).length, 2);
}
assert.equal(readFileSync(new URL('./hard.json', import.meta.url), 'utf8'), hardBytes);
console.log(
  `Held-out proof passed: 60 cases, 30/30 labels, 15 families, deterministic seed, zero text reuse; ${changed}/60 texts change with another seed.`,
);
