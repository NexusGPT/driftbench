// A harder pairwise set. Each candidate states three facts (price, data, availability) and carries a known number of
// errors. The truth is fixed by construction: the candidate with FEWER errors is better, and the two counts always differ.
// Error kinds: a near miss in one fact (off by one, or a unit swapped), an unsupported claim added to correct facts,
// a long and fluent answer that gets one fact wrong, and an answer wrong on two facts (both candidates partly right).
// Usage: node comparisons/langwatch/pairwise/generate-hard.mjs --n 120 --seed 20260701 > comparisons/langwatch/pairwise/hard.json
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const N = Number(flag('n', '120'));
const SEED = Number(flag('seed', '20260701'));
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(SEED);
const pick = (xs) => xs[Math.floor(r() * xs.length)];
const PRODUCTS = ['Acme Mobile M', 'Acme Mobile L', 'Acme Fibre 300', 'Acme Home Plus'];
const STREETS = ['Lindenstraat 12', 'Kastanjelaan 4', 'Molenweg 7', 'Zeelaan 20'];

// A case: the facts of the golden answer, and a builder for each candidate kind.
function caseFacts() {
  const product = pick(PRODUCTS);
  const price = 20 + Math.floor(r() * 60);
  const gb = pick([10, 20, 40, 60, 100]);
  const street = pick(STREETS);
  const covered = r() < 0.5;
  return { product, price, gb, street, covered };
}
const golden = (f) =>
  `${f.product} costs ${f.price} USD a month and includes ${f.gb} GB. It is ${f.covered ? '' : 'not '}available at ${f.street}.`;
const task = (f) => `Tell me the price, the data and whether ${f.product} is available at ${f.street}.`;

// Each builder returns { text, errors }.
const kinds = {
  // correct on all three facts
  correct: (f) => ({
    text: pick([
      `${f.product} is ${f.price} USD a month with ${f.gb} GB. It is ${f.covered ? 'available' : 'not available'} at ${f.street}.`,
      `For ${f.street}: ${f.product} costs ${f.price} USD monthly, includes ${f.gb} GB, and is ${f.covered ? 'available' : 'not available'} there.`,
    ]),
    errors: 0,
  }),
  // correct facts plus one unsupported claim
  unsupported: (f) => ({
    text: `${f.product} is ${f.price} USD a month with ${f.gb} GB, and it is ${f.covered ? 'available' : 'not available'} at ${f.street}. It also comes with free international calls to 40 countries.`,
    errors: 1,
  }),
  // near miss on one fact: off by one on the price, or the data unit swapped
  nearMiss: (f) => {
    if (r() < 0.5) {
      const off = f.price + pick([1, -1]);
      return {
        text: `${f.product} is ${off} USD a month with ${f.gb} GB. It is ${f.covered ? 'available' : 'not available'} at ${f.street}.`,
        errors: 1,
      };
    }
    return {
      text: `${f.product} is ${f.price} USD a month with ${f.gb} MB. It is ${f.covered ? 'available' : 'not available'} at ${f.street}.`,
      errors: 1,
    };
  },
  // long and fluent, one fact wrong (the availability inverted)
  longFluent: (f) => ({
    text: `Thank you for asking about ${f.product}. We have looked at your question carefully. The plan costs ${f.price} USD a month, which is the same price for every household in our area, and it gives you ${f.gb} GB of data each month so you can stream, work and play without worrying about limits. As for coverage, ${f.product} is ${f.covered ? 'not available' : 'available'} at ${f.street}, and our installers can tell you more about the timing when you call us. We hope this helps and we are happy to answer any other question.`,
    errors: 1,
  }),
  // wrong on two facts: price and availability
  twoWrong: (f) => ({
    text: `${f.product} is ${f.price + 5} USD a month with ${f.gb} GB. It is ${f.covered ? 'not available' : 'available'} at ${f.street}.`,
    errors: 2,
  }),
};
const ORDER = [
  ['correct', 'unsupported'],
  ['correct', 'nearMiss'],
  ['correct', 'longFluent'],
  ['unsupported', 'twoWrong'],
  ['nearMiss', 'twoWrong'],
  ['longFluent', 'twoWrong'],
  ['correct', 'twoWrong'],
];

const items = [];
for (let i = 0; i < N; i++) {
  const f = caseFacts();
  const [x, y] = pick(ORDER);
  const first = kinds[x](f);
  const second = kinds[y](f);
  // The candidate with fewer errors wins; the generator never pairs equal counts.
  if (first.errors === second.errors) throw new Error('equal error counts in a pair');
  const aFirst = r() < 0.5;
  const a = aFirst ? first : second;
  const b = aFirst ? second : first;
  items.push({
    id: `h${String(i + 1).padStart(3, '0')}`,
    task: task(f),
    golden: golden(f),
    candidate_a: a.text,
    candidate_b: b.text,
    errors_a: a.errors,
    errors_b: b.errors,
    better: a.errors < b.errors ? 'A' : 'B',
  });
}
process.stdout.write(`${JSON.stringify(items, null, 1)}\n`);
