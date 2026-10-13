import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, verify } from './generate.mjs';

const cases = JSON.parse(readFileSync(new URL('./hard.json', import.meta.url), 'utf8'));
verify(cases);
assert.equal(new Set(cases.map((c) => c.text)).size, 120);
for (const flag of ['person', 'address', 'identifier']) {
  assert.ok(cases.some((c) => c[flag]));
  assert.ok(cases.filter((c) => !c.truth).every((c) => !c[flag]));
}
assert.equal(cases.filter((c) => c.person).length, 15);
assert.equal(cases.filter((c) => c.address).length, 15);
assert.equal(cases.filter((c) => c.identifier).length, 30);
for (const c of cases.filter((c) => c.identifier))
  assert.ok(['email', 'phone', 'ip', 'iban'].includes(c.identifierType));
for (const c of cases.filter((c) => c.identifierType === 'iban')) {
  const value = c.text.match(/GB\d{2}ZZZZ\d{14}/)?.[0];
  assert.ok(value);
  const digits = (value.slice(4) + value.slice(0, 4)).replace(/[A-Z]/g, (char) =>
    String(char.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (10 * remainder + Number(digit)) % 97;
  assert.equal(remainder, 1);
}

// Checks must reject meaningful corruption, not just execute generator code.
for (const mutate of [
  (values) => values.pop(),
  (values) => {
    values[0].id = values[1].id;
  },
  (values) => {
    values[0].truth = !values[0].truth;
  },
  (values) => {
    values[0].kind = 'unlisted-family';
  },
  (values) => {
    values[0].person = false;
  },
]) {
  const broken = structuredClone(cases);
  mutate(broken);
  assert.throws(() => verify(broken));
}
assert.deepEqual(generate(), generate());
const heldoutOptions = { seed: 20261013, n: 60 };
const heldout = JSON.parse(readFileSync(new URL('./heldout.json', import.meta.url), 'utf8'));
verify(heldout, heldoutOptions);
assert.deepEqual(generate(heldoutOptions), generate(heldoutOptions));
assert.notDeepEqual(generate({ ...heldoutOptions, seed: 20261014 }), heldout);
const originalTexts = new Set(cases.map((c) => c.text));
assert.ok(heldout.every((c) => !originalTexts.has(c.text)));
const forbiddenPayloads = [
  'Mira Quillford',
  'Tavi Wrenholt',
  'Lena Bramblewick',
  'Niko Fernvale',
  'Sora Thistlebay',
  '27 Lantern Lane',
  '84 Acorn Walk',
  '19 Paperbird Road',
  '56 Moonkite Close',
  '32 Velvetleaf Street',
  ...Array.from({ length: 5 }, (_, i) => `resident${i + 1}@example.com`),
  ...Array.from({ length: 5 }, (_, i) => `+1 (202) 555-01${String(i + 1).padStart(2, '0')}`), // guard:allow: generated reserved NANP phone template
  ...Array.from({ length: 5 }, (_, i) => `192.0.2.${i + 10}`),
];
assert.ok(heldout.every((c) => forbiddenPayloads.every((value) => !c.text.includes(value))));
for (const c of heldout.filter((c) => c.identifierType === 'iban')) {
  const value = c.text.match(/GB\d{2}ZZZZ\d{14}/)?.[0];
  assert.ok(value);
  const digits = (value.slice(4) + value.slice(0, 4)).replace(/[A-Z]/g, (char) =>
    String(char.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (10 * remainder + Number(digit)) % 97;
  assert.equal(remainder, 1);
}
assert.equal(heldout.filter((c) => c.person).length, 7);
assert.equal(heldout.filter((c) => c.address).length, 7);
assert.equal(heldout.filter((c) => c.identifier).length, 16);
for (const mutate of [
  (values) => values.pop(),
  (values) => {
    values[0].id = values[1].id;
  },
  (values) => {
    values[0].text = values[1].text;
  },
  (values) => {
    values[0].truth = !values[0].truth;
  },
  (values) => {
    values[0].kind = 'unlisted-family';
  },
  (values) => {
    values[0].text = cases[0].text;
  },
]) {
  const broken = structuredClone(heldout);
  mutate(broken);
  assert.throws(() => verify(broken, heldoutOptions));
}
assert.throws(() => generate({ seed: 1, n: 59 }));
assert.throws(() => generate({ seed: 1, n: 20 }));
assert.throws(() => generate({ seed: NaN, n: 60 }));
assert.throws(() => generate({ n: 60 }));
console.log('Original and fresh held-out PII assertions, no-overlap and corruption rejection checks passed');
