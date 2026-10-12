// Generates the exact-match set: reply and reference pairs with a truth label fixed by the transformation used.
// Truth rule (stated in the README): a reply is "same" when it is the reference after letter case, surrounding
// space, punctuation and number formatting are ignored (42.0 is 42, 3.50 is 3.5). Otherwise it is "different".
// Usage: node comparisons/langwatch/exact/generate.mjs --n 150 --seed 20260612 > comparisons/langwatch/exact/heldout.json
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const N = Number(flag('n', '150'));
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

const PHRASES = [
  'Yes',
  'No',
  'Hello',
  'Thanks',
  'Acme Air 5G, $35 a month',
  'Your order has shipped',
  'Please hold',
  'Booked for Monday',
  'Cancelled',
  'Refund issued',
];
const NUMBERS = ['42', '7', '350', '3.5', '1200', '0.25', '100'];

// Each builder returns { reply, reference, truth, kind }.
const builders = {
  identical: () => {
    const p = pick(PHRASES);
    return { reply: p, reference: p, truth: 'same', kind: 'identical' };
  },
  case_only: () => {
    const p = pick(PHRASES);
    return { reply: p.toUpperCase(), reference: p.toLowerCase(), truth: 'same', kind: 'case' };
  },
  space_and_punctuation: () => {
    const p = pick(PHRASES);
    return { reply: `  ${p}!!  `, reference: p, truth: 'same', kind: 'space and punctuation' };
  },
  number_trailing_zero: () => {
    const n = pick(NUMBERS.filter((x) => !x.includes('.')));
    return { reply: `${n}.0`, reference: n, truth: 'same', kind: 'number, trailing zero' };
  },
  number_leading_zero: () => {
    const n = pick(NUMBERS);
    return { reply: `00${n}`, reference: n, truth: 'same', kind: 'number, leading zero' };
  },
  number_decimal_zero: () => {
    const n = pick(NUMBERS.filter((x) => x.includes('.')));
    return { reply: `${n}0`, reference: n, truth: 'same', kind: 'number, trailing zero in decimal' };
  },
  true_as_one: () => ({ reply: 'true', reference: '1', truth: 'same', kind: 'true as 1' }),
  inner_newline: () => {
    const [a, b] = [pick(['Yes', 'Thanks.', 'Please hold']), pick(['please', 'Monday', 'thanks'])];
    return { reply: `${a}\n${b}`, reference: `${a} ${b}`, truth: 'same', kind: 'line break for a space' };
  },
  inner_double_space: () => {
    const [a, b] = [pick(['Yes', 'Thanks.', 'Please hold']), pick(['please', 'Monday', 'thanks'])];
    return { reply: `${a}   ${b}`, reference: `${a} ${b}`, truth: 'same', kind: 'several spaces inside' };
  },
  word_changed: () => {
    const p = pick(PHRASES);
    return { reply: `${p} today`, reference: p, truth: 'different', kind: 'extra word' };
  },
  number_changed: () => {
    const n = pick(NUMBERS);
    return { reply: String(Number(n) + 1), reference: n, truth: 'different', kind: 'different number' };
  },
  word_order: () => ({
    reply: 'please Yes',
    reference: 'Yes please',
    truth: 'different',
    kind: 'word order',
  }),
  accent_dropped: () => ({ reply: 'Café open', reference: 'Cafe open', truth: 'different', kind: 'accent' }),
  empty_reply: () => ({ reply: '', reference: pick(PHRASES), truth: 'different', kind: 'empty reply' }),
  other_answer: () => {
    const [a, b] = [pick(PHRASES), pick(PHRASES)];
    return { reply: a, reference: a === b ? 'Something else' : b, truth: 'different', kind: 'other answer' };
  },
};
const SAME = [
  'identical',
  'case_only',
  'space_and_punctuation',
  'number_trailing_zero',
  'number_leading_zero',
  'number_decimal_zero',
  'true_as_one',
  'inner_newline',
  'inner_double_space',
];
const DIFF = [
  'word_changed',
  'number_changed',
  'word_order',
  'accent_dropped',
  'empty_reply',
  'other_answer',
];

const items = [];
for (let i = 0; i < N; i++) {
  const names = i % 2 === 0 ? SAME : DIFF;
  const built = builders[pick(names)]();
  items.push({ id: `e${String(i + 1).padStart(3, '0')}`, ...built });
}
process.stdout.write(`${JSON.stringify(items, null, 1)}\n`);
