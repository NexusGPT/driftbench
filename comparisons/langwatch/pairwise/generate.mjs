// Generates pairwise cases: a task, a golden answer, a correct candidate and a wrong one. The truth (which candidate is
// better) is fixed by construction: the correct candidate states the golden facts, the wrong one changes one fact.
// Usage: node comparisons/langwatch/pairwise/generate.mjs --n 120 --seed 20260612 > comparisons/langwatch/pairwise/set.json
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const N = Number(flag('n', '120'));
const SEED = Number(flag('seed', '20260612'));
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
const PRODUCTS = [
  'Acme Mobile S',
  'Acme Mobile M',
  'Acme Mobile L',
  'Acme Fibre 100',
  'Acme Fibre 300',
  'Acme Home Plus',
];
const STREETS = ['Lindenstraat 12', 'Kastanjelaan 4', 'Molenweg 7', 'Zeelaan 20', 'Rozenhof 3'];
const CASES = [
  // price: the golden answer and the wrong answer change only the amount
  () => {
    const p = pick(PRODUCTS),
      price = 15 + Math.floor(r() * 50),
      wrong = price + 10 + Math.floor(r() * 20);
    return {
      task: `What is the price of ${p}?`,
      golden: `${p} costs ${price} USD a month.`,
      correct: [
        `${p} is ${price} dollars a month.`,
        `It costs ${price} USD per month.`,
        `The monthly price of ${p} is ${price} USD.`,
      ],
      wrong: [
        `${p} is ${wrong} dollars a month.`,
        `It costs ${wrong} USD per month.`,
        `The monthly price of ${p} is ${wrong} USD.`,
      ],
      fact: 'price',
    };
  },
  // data: the golden answer and the wrong answer change only the data allowance
  () => {
    const p = pick(PRODUCTS),
      gb = [5, 10, 20, 40, 60][Math.floor(r() * 5)],
      wrong = gb === 5 ? 40 : gb / 2;
    return {
      task: `How much data does ${p} include?`,
      golden: `${p} includes ${gb} GB of data.`,
      correct: [
        `${p} includes ${gb} GB.`,
        `You get ${gb} GB of data with ${p}.`,
        `${gb} GB of data come with ${p}.`,
      ],
      wrong: [
        `${p} includes ${wrong} GB.`,
        `You get ${wrong} GB of data with ${p}.`,
        `${wrong} GB of data come with ${p}.`,
      ],
      fact: 'data',
    };
  },
  // availability: the wrong answer inverts whether the product is available
  () => {
    const p = pick(['Acme Fibre 100', 'Acme Fibre 300']),
      s = pick(STREETS);
    return {
      task: `Is ${p} available at ${s}?`,
      golden: `${p} is available at ${s}.`,
      correct: [
        `Yes, ${p} is available at ${s}.`,
        `${p} can be installed at ${s}.`,
        `Good news: ${s} is covered by ${p}.`,
      ],
      wrong: [
        `No, ${p} is not available at ${s}.`,
        `${p} cannot be installed at ${s}.`,
        `Sorry, ${s} is not covered by ${p}.`,
      ],
      fact: 'availability',
    };
  },
];
const items = [];
for (let i = 0; i < N; i++) {
  const c = pick(CASES)();
  const correct = pick(c.correct),
    wrong = pick(c.wrong);
  const correctFirst = r() < 0.5;
  items.push({
    id: `q${String(i + 1).padStart(3, '0')}`,
    task: c.task,
    golden: c.golden,
    candidate_a: correctFirst ? correct : wrong,
    candidate_b: correctFirst ? wrong : correct,
    better: correctFirst ? 'A' : 'B',
    fact: c.fact,
  });
}
process.stdout.write(`${JSON.stringify(items, null, 1)}\n`);
