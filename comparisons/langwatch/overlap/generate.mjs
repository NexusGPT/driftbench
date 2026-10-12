// Generates reply and reference pairs for ROUGE-L and BLEU. Each reply is the reference with words dropped,
// swapped, repeated or changed, so overlap runs from none to full. Usage:
//   node comparisons/langwatch/overlap/generate.mjs --n 120 --seed 20260612 > comparisons/langwatch/overlap/heldout.json
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
const VOCAB = [
  'the',
  'a',
  'your',
  'order',
  'orders',
  'shipped',
  'shipping',
  'ships',
  'refund',
  'refunds',
  'refunded',
  'plan',
  'plans',
  'Café',
  'cafe',
  'running',
  'ran',
  'run',
  'happy',
  'happily',
  'card',
  'cards',
  'payment',
  'payments',
  'to',
  'of',
  'on',
  'for',
  'is',
  'will',
  'be',
  'within',
  '5',
  '30',
  'days',
  'business',
  'customer',
  'service',
  'hours',
  '24',
  'please',
  'contact',
  'us',
  'at',
  'support',
];
const PUNCT = ['.', ',', '!', '?', ''];

function sentence(len) {
  const words = Array.from({ length: len }, () => pick(VOCAB));
  return words.map((w, i) => (i === words.length - 1 ? `${w}${pick(PUNCT)}` : w)).join(' ');
}
function mutate(words, rate) {
  const out = [];
  for (const w of words) {
    const x = r();
    if (x < rate / 3) continue; // drop
    if (x < (2 * rate) / 3) {
      out.push(pick(VOCAB));
      continue;
    } // substitute
    out.push(w);
    if (x > 1 - rate / 3) out.push(w); // repeat
  }
  return out;
}
const items = [];
for (let i = 0; i < N; i++) {
  const reference = sentence(4 + Math.floor(r() * 14));
  const refWords = reference.split(/\s+/);
  const rate = [0, 0.1, 0.25, 0.5, 0.8][i % 5];
  const reply = mutate(refWords, rate).join(' ') || 'ok';
  items.push({ id: `o${String(i + 1).padStart(3, '0')}`, reply, reference, rate });
}
process.stdout.write(`${JSON.stringify(items, null, 1)}\n`);
