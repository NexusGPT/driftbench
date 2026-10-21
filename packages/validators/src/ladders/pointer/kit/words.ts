import { rngFor } from '@agent-nexus/driftbench-generate';

/** A seeded stream of numbers in [0, 1). */
export type Rng = () => number;

/**
 * Seeded fictional prose for the pointer bank. Sentences come from a wide vocabulary and several shapes, so two
 * sentences drawn apart share little text; their normalised Levenshtein similarity is measured, never assumed
 * (see `unrelated`). Every sentence starts with an upper-case letter and ends with a lower-case word of at least
 * four letters followed by a full stop: a reader that merges a sentence break after a short capitalised word
 * (a title such as `Dr.`) must find none in this prose.
 */

const split = (text: string) => text.trim().split(/\s+/);

const NOUNS = split(`
  ledger tray basket pallet crate shelf counter register drawer locker cabinet trolley scale hopper oven furnace
  kettle mixer whisk ladle sieve funnel jar flask carton parcel envelope voucher ticket badge stamp seal lantern
  compass anchor rope bucket barrel cask keg bottle cork tray panel hatch lever pulley gauge dial valve pipe
  boiler filter cushion blanket curtain mirror clock timer bell whistle magnet needle thread button zipper
  satchel wallet folder binder notebook diary journal atlas pamphlet poster banner ribbon garland wreath candle
  platter saucer goblet pitcher casserole skillet griddle colander grater peeler cleaver mallet chisel hammer
  wrench spanner pliers shovel trowel rake barrow ladder scaffold hinge latch bracket rivet gasket spindle
  loaf biscuit pastry muffin scone bagel brioche tart pudding custard compote marmalade chutney relish pickle
  orchard meadow harbour quarry tunnel bridge viaduct causeway lighthouse kiosk pavilion rotunda gallery atrium
`);
const ADJ = split(`
  copper wooden crooked narrow spare sealed bulky faded glossy brittle dusty sturdy hollow gilded woven rusty
  weathered tangled polished cracked sticky frozen sunlit shaded quiet crowded distant nearby ancient modern
  foldable stackable portable fragile heavy slender broad shallow curved angular striped speckled plain ornate
  unmarked labelled numbered colourful pale vivid mottled velvet leather linen paper tin iron marble ceramic
`);
const VERB_IMP = split(`
  weigh count label sort seal stack wrap check measure record file shelve fetch carry lift lower rinse dry
  polish sweep unlock secure fasten loosen tighten replace restock refill inspect photograph catalogue index
  bundle tie untie fold unfold press roll slice dice knead proof glaze dust sift pour stir taste sample
`);
const VERB_S = split(`
  waits rests hangs leans sits stays drifts rattles hums squeaks glows flickers tilts wobbles slides settles
  gathers scatters lingers returns arrives departs shifts vanishes reappears overflows empties fills
`);
const ADV = split(`
  quietly slowly carefully gently twice once daily weekly firmly lightly neatly evenly promptly patiently
  separately together early late first last thoroughly briefly steadily
`);
const PREP = split(`beside beneath behind above across along beyond within near under over against toward`);
const WHEN = split(
  `
  before the doors open|after the delivery arrives|once the kettle boils|while the oven cools|until the bell rings
  whenever the lantern flickers|as soon as the tray is empty|after the last customer leaves|before the shift ends
  when the barrel is full|once the ledger is signed|while the harbour is quiet
`
    .replace(/\n/g, ' ')
    .split('|')
    .map((s) => s.trim())
    .join('|'),
)
  .join(' ')
  .split('|');
const PLACES = split(`
  harbour orchard cellar attic pantry workshop gallery courtyard greenhouse stockroom loft annex vestibule landing
`);
const TAILS = split(`
  yesterday tomorrow tonight outside inside upstairs downstairs elsewhere overnight meanwhile afterwards
`);

/** A word a generator wrote, and where it starts in the text it returned. */
export type WrittenWord = { text: string; start: number };
/** A text and the words the generator wrote into it, in order. */
export type Written = { text: string; words: WrittenWord[] };

/*
 * The generator is the one source of word positions. Every function of this module that returns prose registers
 * the words it wrote, with their offsets, for the exact text it returns; a planter that changes or reads a word
 * asks the registry for the text it holds (`writtenOf`) and splices at those offsets. No word is ever found by
 * matching a pattern on the letters of a text. The registry keeps the most recent texts only: a planter edits a
 * text it drew moments before.
 */
const REGISTRY_LIMIT = 250_000;
const registry = new Map<string, readonly WrittenWord[]>();

function register(text: string, words: readonly WrittenWord[]): string {
  registry.delete(text);
  registry.set(text, words);
  if (registry.size > REGISTRY_LIMIT) {
    const oldest = registry.keys().next();
    if (!oldest.done) registry.delete(oldest.value);
  }
  return text;
}

/** The words a generator of this module wrote into `text`, with their offsets. Throws for a text none wrote. */
export function writtenOf(text: string): Written {
  const words = registry.get(text);
  if (!words)
    throw new Error(
      `no generator of the pointer bank wrote this text, so its words are unknown: ${JSON.stringify(text.slice(0, 120))}`,
    );
  return { text, words: words.map((w) => ({ ...w })) };
}

/** Whether a generator of this module wrote `text` (it has registered words). */
export function isWritten(text: string): boolean {
  return registry.has(text);
}

/** A written text without its final full stop; its words keep their offsets. */
function withoutStop(w: Written): Written {
  if (!w.text.endsWith('.')) return w;
  const text = w.text.slice(0, -1);
  return { text, words: w.words.filter((x) => x.start + x.text.length <= text.length) };
}

/** A written text whose first letter is lower case; the word that starts there follows it. */
function lowerFirstOf(w: Written): Written {
  const text = w.text.charAt(0).toLowerCase() + w.text.slice(1);
  return {
    text,
    words: w.words.map((x) => (x.start === 0 ? { text: text.slice(0, x.text.length), start: 0 } : x)),
  };
}

/** A written text with words replaced by index; every word after a replaced one moves with the text. */
function replaced(w: Written, changes: ReadonlyMap<number, string>): Written {
  let text = '';
  let from = 0;
  const words: WrittenWord[] = [];
  w.words.forEach((word, i) => {
    text += w.text.slice(from, word.start);
    const now = changes.get(i) ?? word.text;
    words.push({ text: now, start: text.length });
    text += now;
    from = word.start + word.text.length;
  });
  return { text: text + w.text.slice(from), words };
}

/**
 * Joins parts into one text and registers it: a part a generator wrote keeps its words, moved to where the part
 * lands; a plain string part adds no word.
 */
export function joinWritten(parts: ReadonlyArray<string | Written>): string {
  let text = '';
  const words: WrittenWord[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    for (const w of part.words) words.push({ text: w.text, start: text.length + w.start });
    text += part.text;
  }
  return register(text, words);
}

/** A written text with the words at the given indexes (of `writtenOf(text).words`) replaced; registered. */
export function editWords(text: string, changes: ReadonlyMap<number, string>): string {
  return joinWritten([replaced(writtenOf(text), changes)]);
}

/**
 * A written text with `insert` put at offset `at`, registered. A word that starts at or after `at` moves; a word
 * that `at` falls inside is no longer a word the generator wrote and leaves the list.
 */
export function insertAt(text: string, at: number, insert: string): string {
  const w = writtenOf(text);
  const words: WrittenWord[] = [];
  for (const x of w.words) {
    if (x.start >= at) words.push({ text: x.text, start: x.start + insert.length });
    else if (x.start + x.text.length <= at) words.push(x);
  }
  return register(text.slice(0, at) + insert + text.slice(at), words);
}

/** The first word the generator wrote after the start of `text`: a place inside the sentence. */
export function wordAfterStart(text: string): WrittenWord {
  const found = writtenOf(text).words.find((w) => w.start > 0);
  if (!found)
    throw new Error(`the generator wrote no word after the start of ${JSON.stringify(text.slice(0, 80))}`);
  return found;
}

/**
 * An offset strictly inside a word the generator wrote: `into` letters into the first word of at least `min`
 * letters after the start, else the middle of the longest word after the start.
 */
export function insideWord(text: string, min: number, into: number): number {
  const words = writtenOf(text).words.filter((w) => w.start > 0);
  const fit = words.find((w) => w.text.length >= min && w.text.length > into);
  if (fit) return fit.start + into;
  const longest = words.reduce<WrittenWord | undefined>(
    (best, w) => (!best || w.text.length > best.text.length ? w : best),
    undefined,
  );
  if (!longest || longest.text.length < 2)
    throw new Error(`the generator wrote no word to split in ${JSON.stringify(text.slice(0, 80))}`);
  return longest.start + Math.floor(longest.text.length / 2);
}

/** A written text with `tail` in place of its final full stop (`tail` brings its own); registered. */
export function beforeStop(text: string, tail: string): string {
  return joinWritten([withoutStop(writtenOf(text)), tail]);
}

/** Every word of the WHEN phrases, with its offset in the phrase. The vocabulary is split, never prose. */
const PHRASES = new Map<string, readonly WrittenWord[]>(
  WHEN.map((phrase): [string, WrittenWord[]] => {
    let at = 0;
    const words = split(phrase).map((text) => {
      const word = { text, start: at };
      at += text.length + 1;
      return word;
    });
    return [phrase, words];
  }),
);

/** Composes a text from drawn words: every interpolated value is a word (or a WHEN phrase) the generator drew. */
function drawn(strings: TemplateStringsArray, ...values: string[]): Written {
  let text = strings[0] ?? '';
  const words: WrittenWord[] = [];
  values.forEach((value, i) => {
    for (const part of PHRASES.get(value) ?? [{ text: value, start: 0 }])
      words.push({ text: part.text, start: text.length + part.start });
    text += value + (strings[i + 1] ?? '');
  });
  return { text, words };
}

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const take = pick;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const long = (rng: Rng, items: readonly string[]): string => {
  for (let tries = 0; tries < 20; tries += 1) {
    const word = pick(rng, items);
    if (word.length >= 4) return word;
  }
  return 'quietly';
};

/** One fictional sentence, 55 to 150 characters, starting with a capital and ending `<word>.` with a word of 4 letters or more. */
export function sentence(rng: Rng): string {
  const n1 = take(rng, NOUNS);
  const n2 = take(rng, NOUNS);
  const n3 = take(rng, NOUNS);
  const a1 = take(rng, ADJ);
  const a2 = take(rng, ADJ);
  const shape = Math.floor(rng() * 9);
  let made: Written;
  switch (shape) {
    case 0:
      made = drawn`${cap(take(rng, VERB_IMP))} the ${a1} ${n1} ${take(rng, PREP)} the ${a2} ${n2} ${take(rng, WHEN)}`;
      break;
    case 1:
      made = drawn`The ${a1} ${n1} ${take(rng, VERB_S)} ${take(rng, ADV)} ${take(rng, PREP)} the ${n2} of the ${take(rng, PLACES)}`;
      break;
    case 2:
      made = drawn`Each ${n1} in the ${take(rng, PLACES)} is kept ${take(rng, PREP)} a ${a1} ${n2} ${take(rng, WHEN)}`;
      break;
    case 3:
      made = drawn`If a ${a1} ${n1} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${n2}, ${take(rng, VERB_IMP)} it ${long(rng, ADV)}`;
      break;
    case 4:
      made = drawn`${cap(a1)} ${n1}s and ${a2} ${n2}s ${take(rng, VERB_S).replace(/s$/, '')} ${take(rng, PREP)} the ${n3} ${take(rng, TAILS)}`;
      break;
    case 5:
      made = drawn`${cap(take(rng, VERB_IMP))} every ${n1} ${take(rng, ADV)}, then ${take(rng, VERB_IMP)} the ${a1} ${n2} ${take(rng, PREP)} the ${n3} ${long(rng, TAILS)}`;
      break;
    case 6:
      made = drawn`A ${n1} from the ${take(rng, PLACES)} ${take(rng, VERB_S)} ${take(rng, ADV)} while the ${a1} ${n2} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${n3}`;
      break;
    case 7:
      made = drawn`Nothing in the ${take(rng, PLACES)} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${a1} ${n1} unless the ${a2} ${n2} ${take(rng, VERB_S)} ${long(rng, TAILS)}`;
      break;
    default:
      made = drawn`${cap(take(rng, VERB_IMP))} the ${n1} and the ${a1} ${n2} ${take(rng, ADV)}, because the ${n3} ${take(rng, VERB_S)} ${take(rng, WHEN)}`;
  }
  // Every shape ends on a word it drew, and every word of the vocabulary is lower-case letters, so the last
  // word is known without reading the text: a short one gets a tail.
  const last = made.words[made.words.length - 1];
  if (!last || last.text.length < 4) {
    const tail = long(rng, TAILS);
    const words = [...made.words, { text: tail, start: made.text.length + 1 }];
    made = { text: `${made.text} ${tail}`, words };
  }
  return joinWritten([made, '.']);
}

/** A long sentence: two sentences joined by `, and`. Starts with a capital, ends with a word of 4 letters or more and a full stop. */
export function longMake(rng: Rng): string {
  const a = writtenOf(sentence(rng));
  const b = writtenOf(sentence(rng));
  return joinWritten([withoutStop(a), ', and ', lowerFirstOf(b)]);
}

/** A short imperative, 4 to 8 words, still ending in a lower-case word of 4 letters or more. */
export function shortRule(rng: Rng): string {
  const verb = cap(take(rng, VERB_IMP));
  const noun = take(rng, NOUNS);
  const tail = rng() < 0.5 ? long(rng, ADV) : long(rng, TAILS);
  if (rng() < 0.5) return joinWritten([drawn`${verb} each ${noun} ${tail}.`]);
  return joinWritten([drawn`${verb} the ${take(rng, ADJ)} ${noun} ${tail}.`]);
}

const HEAD_KINDS = ['notes', 'steps', 'checks', 'duties', 'rounds'];

/** A heading text of 2 to 4 words, title case. */
export function headingText(rng: Rng): string {
  return joinWritten([drawn`${cap(take(rng, ADJ))} ${take(rng, NOUNS)} ${take(rng, HEAD_KINDS)}`]);
}

/** A single lower-case word of at least four letters. */
export function word(rng: Rng): string {
  const text = long(rng, NOUNS);
  return register(text, [{ text, start: 0 }]);
}

/** Normalised Levenshtein similarity in [0, 1]: 1 minus the edit distance over the longer length. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length < b.length) [a, b] = [b, a];
  const m = b.length;
  let previous = new Uint16Array(m + 1);
  let current = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j += 1) {
      const sub = (previous[j - 1] as number) + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const del = (previous[j] as number) + 1;
      const ins = (current[j - 1] as number) + 1;
      current[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[m] as number;
}

type Grams = { map: Map<string, number>; total: number };

function gramsOf(s: string): Grams {
  const map = new Map<string, number>();
  let total = 0;
  for (let i = 0; i + 3 <= s.length; i += 1) {
    const g = s.slice(i, i + 3);
    map.set(g, (map.get(g) ?? 0) + 1);
    total += 1;
  }
  return { map, total };
}

function diceOf(a: Grams, b: Grams): number {
  if (a.total + b.total === 0) return 1;
  let shared = 0;
  for (const [g, n] of a.map) shared += Math.min(n, b.map.get(g) ?? 0);
  return (2 * shared) / (a.total + b.total);
}

/** Cheap rejection signal: Dice coefficient over character trigrams. */
export function dice(a: string, b: string): number {
  return diceOf(gramsOf(a), gramsOf(b));
}

/**
 * Runs a generator and returns its text with the position of every word it wrote, as the generator registered
 * them: the positions come from what the generator drew, never from a pattern matched on the text.
 */
export function written(make: (rng: Rng) => string, rng: Rng): Written {
  return writtenOf(make(rng));
}

/**
 * A pool of sentences drawn apart: each new sentence has trigram Dice under `limit` against the last `window`
 * sentences of the pool. Two sentences far apart in a long document may be alike; `unrelatedTo` is for the pairs
 * an item needs to be unrelated.
 */
export class Prose {
  private readonly rng: Rng;
  private readonly used: Array<{ text: string; grams: Grams }> = [];
  constructor(
    seed: number,
    label: string,
    private readonly limit = 0.45,
    private readonly window = 120,
  ) {
    this.rng = rngFor(seed, `prose:${label}`);
  }

  get random(): Rng {
    return this.rng;
  }

  private remember(text: string, grams: Grams): void {
    this.used.push({ text, grams });
  }

  /** The next sentence, unlike the recent sentences of this pool. */
  next(make: (rng: Rng) => string = sentence): string {
    for (let tries = 0; tries < 60; tries += 1) {
      const candidate = make(this.rng);
      const grams = gramsOf(candidate);
      const recent = this.used.slice(-this.window);
      if (recent.every((other) => diceOf(grams, other.grams) < this.limit)) {
        this.remember(candidate, grams);
        return candidate;
      }
    }
    const made = make(this.rng);
    const tail = ` ${this.used.length + 1}x${this.used.length + 7}z.`;
    // The fallback keeps the words of the draw when a generator wrote it.
    const fallback = isWritten(made) ? beforeStop(made, tail) : `${made.replace(/\.$/, '')}${tail}`;
    this.remember(fallback, gramsOf(fallback));
    return fallback;
  }

  /** The next sentence as `next` draws it, with the words the generator wrote and where they start. */
  nextWritten(make: (rng: Rng) => string = sentence): Written {
    return writtenOf(this.next(make));
  }

  many(count: number, make?: (rng: Rng) => string): string[] {
    return Array.from({ length: count }, () => this.next(make));
  }

  /** A sentence whose Levenshtein similarity to every given text is under `limit`. */
  unrelatedTo(texts: readonly string[], limit = 0.3, make: (rng: Rng) => string = sentence): string {
    for (let tries = 0; tries < 400; tries += 1) {
      const candidate = this.next(make);
      if (texts.every((t) => similarity(candidate, t) < limit)) return candidate;
    }
    throw new Error('no sentence unrelated enough');
  }

  /** `unrelatedTo`, with the words the generator wrote and where they start. */
  unrelatedToWritten(texts: readonly string[], limit = 0.3, make: (rng: Rng) => string = sentence): Written {
    for (let tries = 0; tries < 400; tries += 1) {
      const candidate = this.nextWritten(make);
      if (texts.every((t) => similarity(candidate.text, t) < limit)) return candidate;
    }
    throw new Error('no sentence unrelated enough');
  }
}

/** The words of a text a planter may change: written by the generator, not the first, lower case, 4 letters or more. */
function changeable(w: Written): number[] {
  return w.words
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.start > 0 && x.text.length >= 4 && x.text === x.text.toLowerCase())
    .map(({ i }) => i);
}

/**
 * Replaces `count` words the generator wrote by other words, keeping the first word and ending in a full stop.
 * The words come from the generator's registry, so `text` must be a text a generator of this module wrote (or a
 * text built from one with `joinWritten`, `editWords`, `insertAt`, `beforeStop` or this function).
 */
export function rewordWords(rng: Rng, text: string, count: number): string {
  const body = withoutStop(writtenOf(text));
  const slots = changeable(body);
  const changes = new Map<number, string>();
  for (let n = 0; n < count && slots.length > 0; n += 1) {
    const at = Math.floor(rng() * slots.length);
    const slot = slots.splice(at, 1)[0];
    if (slot === undefined) break;
    const was = (body.words[slot] as WrittenWord).text;
    let replacement = take(rng, NOUNS);
    while (replacement === was) replacement = take(rng, NOUNS);
    changes.set(slot, replacement);
  }
  return joinWritten([replaced(body, changes), '.']);
}

/** A sentence reworded until its similarity to the source falls in [low, high]; the source when none fits. */
export function rewordToSimilarity(rng: Rng, text: string, low: number, high: number): string {
  const body = withoutStop(writtenOf(text));
  const eligible = changeable(body);
  let current = text;
  const order = eligible.map((_, i) => i).sort(() => rng() - 0.5);
  const changes = new Map<number, string>();
  for (const idx of order) {
    const slot = eligible[idx];
    if (slot === undefined) continue;
    const was = (body.words[slot] as WrittenWord).text;
    changes.set(
      slot,
      long(
        rng,
        NOUNS.filter((n) => n !== was),
      ) + (rng() < 0.5 ? 'ish' : 'ery'),
    );
    current = joinWritten([replaced(body, changes), '.']);
    const s = similarity(text, current);
    if (s >= low && s <= high) return current;
    if (s < low) return current;
  }
  return current;
}
