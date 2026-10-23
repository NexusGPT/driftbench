import type { Rng } from '../bank/util';
import type { Cmp } from './spans';

/**
 * Seeded draws for the condition spans the blind bank writes. An item keeps its form (a number with a thousands
 * separator, a number word, a currency sign, a negative decimal) and its assertion; the quantity it talks about,
 * the way the comparison is worded, the number and the file around the span change with the seed. The product
 * never sees this module: it reads the span text, the labels of a reader, and nothing else.
 */

export type Form =
  | 'plain'
  | 'thousands'
  | 'words'
  | 'dollar'
  | 'euro'
  | 'percent'
  | 'decimal-thousands'
  | 'leading-zero'
  | 'decimal'
  | 'negative'
  | 'negative-whole'
  | 'large'
  | 'space-thousands'
  | 'narrow-thousands'
  | 'apostrophe-thousands'
  | 'european'
  | 'iso-before'
  | 'iso-after'
  | 'unicode-minus'
  | 'plus-sign'
  | 'attached-unit'
  | 'hundreds-in-words'
  | 'thousands-in-words'
  | 'and-in-words'
  | 'sym-gt'
  | 'sym-ge-ascii'
  | 'sym-ge-unicode'
  | 'sym-lt'
  | 'sym-le-ascii'
  | 'sym-le-unicode';

/** A quantity and the unit its number is written with. */
const QUANTITIES: ReadonlyArray<readonly [subject: string, unit: string]> = [
  ['the delay', ' days'],
  ['the order', ' euros'],
  ['the queue', ' tickets'],
  ['the draft', ' words'],
  ['the reply', ' questions'],
  ['the batch', ' items'],
  ['the basket', ' items'],
  ['the refund', ' euros'],
  ['the invoice', ' euros'],
  ['the wait', ' minutes'],
  ['the attachment', ' MB'],
  ['the retry count', ' attempts'],
  ['the session', ' turns'],
  ['the parcel', ' kilograms'],
  ['the stay', ' nights'],
  ['the loan', ' months'],
];

/** Quantities that read naturally with a money sign or a percent sign in front of or behind the number. */
const MONEY = ['the refund', 'the order', 'the invoice', 'the deposit', 'the fee', 'the claim'] as const;
const RATES = ['the discount', 'the margin', 'the tax rate', 'the fill rate', 'the error rate'] as const;
const SCORES = ['the rating', 'the review score', 'the trust score', 'the quality score'] as const;
const GAUGES = ['the temperature', 'the balance', 'the drift', 'the offset'] as const;

const PHRASES: Record<Cmp, readonly string[]> = {
  gt: ['is more than', 'is greater than', 'exceeds', 'is over', 'is above'],
  ge: ['is at least', 'is no less than', 'is not below', 'is at or above'],
  lt: ['is under', 'is less than', 'is below', 'is fewer than'],
  le: ['is at most', 'is no more than', 'is not over', 'does not exceed', 'is at or below'],
};

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

/** An English number word for 0 to 99. */
export function words(n: number): string {
  if (n < 20) return ONES[n] as string;
  const tens = TENS[Math.floor(n / 10)] as string;
  return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

/** A whole number with a mark between each group of three digits (a comma unless another is given). */
export function grouped(n: number, mark = ','): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, mark);
}

/** English number words for 100 to 9999, with an `and` before the last part when asked. */
export function wordsBig(n: number, and = false): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const hundreds = Math.floor(rest / 100);
  const last = rest % 100;
  const parts: string[] = [];
  if (thousands > 0) parts.push(`${words(thousands)} thousand`);
  if (hundreds > 0) parts.push(`${words(hundreds)} hundred`);
  if (last > 0) parts.push(and && parts.length > 0 ? `and ${words(last)}` : words(last));
  return parts.join(' ');
}

export type Drawn = {
  subject: string;
  text: string;
  limit: number;
  cmp: Cmp;
  integer: boolean;
  unit: string;
};

export type DrawOptions = {
  /** Use this number instead of drawing one. */
  limit?: number;
  /** Draw the number from this range (both ends included) instead of the form's own. */
  range?: readonly [number, number];
  /** A number word of two parts, such as twenty-five: the draw is never a multiple of ten. */
  compound?: boolean;
  /** Talk about this quantity and unit (two spans of one quantity). */
  subject?: string;
  unit?: string;
};

/** One numeric condition span of the given comparison and form, with its meaning. */
export function drawCondition(rng: Rng, cmp: Cmp, form: Form, options: DrawOptions = {}): Drawn {
  const phrase = rng.pick(PHRASES[cmp]);
  const symbol = (marks: readonly string[]): string => rng.pick(marks);
  const pickSubject = (names: readonly string[]): string => options.subject ?? rng.pick(names);
  const make = (subject: string, limit: number, written: string, unit: string, integer: boolean): Drawn => ({
    subject,
    text: `${subject} ${phrase} ${written}${unit}`,
    limit,
    cmp,
    integer,
    unit,
  });
  const number = (lo: number, hi: number): number => {
    if (options.limit !== undefined) return options.limit;
    const [a, b] = options.range ?? [lo, hi];
    const n = rng.int(a, b);
    return options.compound && n % 10 === 0 ? n + 1 : n;
  };
  switch (form) {
    case 'plain': {
      const [name, unit] = options.subject
        ? [options.subject, options.unit ?? ' units']
        : rng.pick(QUANTITIES);
      const n = number(1, 400);
      return make(name, n, String(n), options.unit ?? unit, Number.isInteger(n));
    }
    case 'thousands': {
      const n = options.limit ?? rng.int(2, 98) * 500;
      return make(pickSubject(MONEY), n, grouped(n), ' euros', true);
    }
    case 'words': {
      const n = number(2, 99);
      const [name, unit] = options.subject
        ? [options.subject, options.unit ?? ' units']
        : rng.pick(QUANTITIES);
      return make(name, n, words(n), options.unit ?? unit, true);
    }
    case 'dollar': {
      const n = number(5, 900);
      return make(pickSubject(MONEY), n, `$${n}`, '', true);
    }
    case 'euro': {
      const n = number(5, 900);
      return make(pickSubject(MONEY), n, `€${n}`, '', true);
    }
    case 'percent': {
      const n = number(1, 99);
      return make(pickSubject(RATES), n, `${n}%`, '', true);
    }
    case 'decimal-thousands': {
      const whole = rng.int(1, 90) * 1000 + rng.int(0, 9) * 10;
      const cents = rng.pick([25, 50, 75]);
      const n = options.limit ?? Number(`${whole}.${cents}`);
      const [w, c] = String(n).split('.');
      return make(pickSubject(MONEY), n, `${grouped(Number(w))}.${c}`, ' euros', false);
    }
    case 'leading-zero': {
      const n = options.limit ?? Number(`0.${rng.pick([1, 2, 3, 4, 5, 6, 7, 8, 9])}`);
      return make(pickSubject(SCORES), n, String(n), ' stars', false);
    }
    case 'decimal': {
      const n = options.limit ?? rng.int(1, 40) + 0.5;
      return make(pickSubject(SCORES), n, String(n), ' stars', false);
    }
    case 'negative': {
      const n = options.limit ?? -(rng.int(1, 20) + 0.5);
      return make(pickSubject(GAUGES), n, String(n), ' degrees', false);
    }
    case 'negative-whole': {
      const n = options.limit ?? -rng.int(1, 30);
      return make(pickSubject(GAUGES), n, String(n), ' degrees', true);
    }
    case 'space-thousands': {
      const n = options.limit ?? rng.int(2, 98) * 500;
      return make(pickSubject(MONEY), n, grouped(n, ' '), ' euros', true);
    }
    case 'narrow-thousands': {
      const n = options.limit ?? rng.int(2, 98) * 500;
      return make(pickSubject(MONEY), n, grouped(n, rng.pick(['\u202f', '\u00a0'])), ' euros', true);
    }
    case 'apostrophe-thousands': {
      const n = options.limit ?? rng.int(2, 98) * 500;
      return make(pickSubject(MONEY), n, grouped(n, '\u2019'), ' CHF', true);
    }
    case 'european': {
      const whole = rng.int(1, 90) * 1000 + rng.int(0, 9) * 10;
      const cents = rng.pick([25, 50, 75]);
      const n = options.limit ?? Number(`${whole}.${cents}`);
      const [w, c] = String(n).split('.');
      return make(pickSubject(MONEY), n, `${grouped(Number(w), '.')},${c}`, ' euros', false);
    }
    case 'iso-before': {
      const n = number(5, 900);
      const code = rng.pick(['EUR', 'USD', 'GBP', 'CHF', 'SEK']);
      return make(pickSubject(MONEY), n, `${code} ${n}`, '', true);
    }
    case 'iso-after': {
      const n = number(5, 900);
      const code = rng.pick(['EUR', 'USD', 'GBP', 'CHF', 'SEK']);
      return make(pickSubject(MONEY), n, `${n} ${code}`, '', true);
    }
    case 'unicode-minus': {
      const n = options.limit ?? -(rng.int(1, 20) + 0.5);
      return make(pickSubject(GAUGES), n, `\u2212${Math.abs(n)}`, ' degrees', false);
    }
    case 'plus-sign': {
      const n = number(2, 90);
      const [name, unit] = options.subject
        ? [options.subject, options.unit ?? ' units']
        : rng.pick(QUANTITIES);
      return make(name, n, `+${n}`, options.unit ?? unit, true);
    }
    case 'attached-unit': {
      const n = number(2, 90);
      const [name, unit] = rng.pick([
        ['the wait', 'min'],
        ['the parcel', 'kg'],
        ['the attachment', 'MB'],
        ['the shift', 'h'],
        ['the trip', 'km'],
      ] as const);
      return make(options.subject ?? name, n, String(n), options.unit ?? unit, true);
    }
    case 'hundreds-in-words': {
      const n = options.limit ?? rng.int(1, 9) * 100 + rng.pick([0, 5, 12, 25, 40, 75]);
      const [name, unit] = rng.pick(QUANTITIES);
      return make(options.subject ?? name, n, wordsBig(n), options.unit ?? unit, true);
    }
    case 'thousands-in-words': {
      const n = options.limit ?? rng.int(1, 9) * 1000 + rng.pick([0, 500, 200, 100]);
      const [name, unit] = rng.pick(QUANTITIES);
      return make(options.subject ?? name, n, wordsBig(n), options.unit ?? unit, true);
    }
    case 'and-in-words': {
      const n = options.limit ?? rng.int(1, 9) * 100 + rng.pick([3, 8, 15, 42, 60]);
      const [name, unit] = rng.pick(QUANTITIES);
      return make(options.subject ?? name, n, wordsBig(n, true), options.unit ?? unit, true);
    }
    case 'sym-gt':
    case 'sym-ge-ascii':
    case 'sym-ge-unicode':
    case 'sym-lt':
    case 'sym-le-ascii':
    case 'sym-le-unicode': {
      const marks = {
        'sym-gt': ['>'],
        'sym-ge-ascii': ['>='],
        'sym-ge-unicode': ['\u2265'],
        'sym-lt': ['<'],
        'sym-le-ascii': ['<='],
        'sym-le-unicode': ['\u2264'],
      }[form];
      const n = number(2, 400);
      const [name, unit] = options.subject
        ? [options.subject, options.unit ?? ' units']
        : rng.pick(QUANTITIES);
      return {
        subject: name,
        text: `${name} ${symbol(marks)} ${n}${options.unit ?? unit}`,
        limit: n,
        cmp,
        integer: true,
        unit: options.unit ?? unit,
      };
    }
    case 'large': {
      const n = options.limit ?? rng.int(1, 9) * 1_000_000;
      return make(pickSubject(MONEY), n, String(n), ' euros', true);
    }
  }
}

const LEADS: ReadonlyArray<(text: string) => string> = [
  (t) => `Escalate when ${t}.`,
  (t) => `A person takes over when ${t}.`,
  (t) => `Flag the case whenever ${t}.`,
  (t) => `If ${t}, hand the case to a person.`,
  (t) => `- Escalate when ${t}.`,
  (t) => `* Escalate once ${t}.`,
  (t) => `Rule: ask for review when ${t}.`,
];
const HEADS = [
  '',
  '# Escalation\n\n',
  '## Policy notes\n\n',
  'Notes for the desk\n==================\n\n',
] as const;
const TAILS = ['', '\n\nNever share internal notes.', '\n\nThis line states no condition.', '\n'] as const;

/** The text of a file that holds each span once, in a layout the seed picks. The spans stay verbatim in it. */
export function policyFile(rng: Rng, spans: readonly string[]): string {
  const lead = rng.pick(LEADS);
  const eol = rng.chance(0.25) ? '\r\n' : '\n';
  const lines = spans.map((t) => (rng.chance(0.3) ? rng.pick(LEADS)(t) : lead(t)));
  return `${rng.pick(HEADS)}${lines.join(eol)}${rng.pick(TAILS)}`;
}

const EQUAL = ['is exactly', 'is equal to', 'equals', 'is precisely'] as const;
const UNEQUAL = ['is other than', 'is not equal to', 'differs from', 'is anything but'] as const;

export type DrawnNumber = { subject: string; text: string; limit: number };

/** An equality or an inequality span: the quantity, the number and the way the comparison is worded. */
export function drawEquality(rng: Rng, flavour: 'equal' | 'unequal'): DrawnNumber {
  const [subject, unit] = rng.pick(QUANTITIES);
  const limit = rng.int(2, 90);
  const phrase = rng.pick(flavour === 'equal' ? EQUAL : UNEQUAL);
  return { subject, text: `${subject} ${phrase} ${limit}${unit}`, limit };
}

/** A range span with its two limits. */
export type RangeStyle = 'between' | 'to' | 'en-dash' | 'hyphen';

export function drawRange(
  rng: Rng,
  style?: RangeStyle,
): { subject: string; text: string; lo: number; hi: number } {
  const [subject, unit] = rng.pick(QUANTITIES);
  const lo = rng.int(2, 40);
  const hi = lo + rng.int(3, 25);
  const text =
    style === 'to'
      ? `${subject} is ${lo} to ${hi}${unit}`
      : style === 'en-dash'
        ? `${subject} is ${lo}\u2013${hi}${unit}`
        : style === 'hyphen'
          ? `${subject} is ${lo}-${hi}${unit}`
          : rng.pick([
              `${subject} is between ${lo} and ${hi}${unit}`,
              `${subject} is from ${lo} to ${hi}${unit}`,
              `${subject} lies between ${lo} and ${hi}${unit}`,
            ]);
  return { subject, text, lo, hi };
}

const BOOLEANS: ReadonlyArray<readonly [subject: string, word: string]> = [
  ['the customer is', 'verified'],
  ['the account is', 'suspended'],
  ['the parcel is', 'insured'],
  ['the payment is', 'confirmed'],
  ['the ticket is', 'urgent'],
  ['the user is', 'a returning customer'],
  ['the order is', 'gift wrapped'],
];

/** A yes-or-no span. */
export function drawBoolean(rng: Rng): { subject: string; word: string; text: string } {
  const [subject, word] = rng.pick(BOOLEANS);
  return { subject, word, text: `${subject} ${word}` };
}

const SETS: ReadonlyArray<readonly [subject: string, members: readonly string[]]> = [
  ['the country', ['FR', 'BE', 'NL', 'DE', 'ES', 'IT']],
  ['the currency', ['EUR', 'USD', 'GBP', 'CHF', 'SEK']],
  ['the plan', ['gold', 'silver', 'bronze', 'basic', 'trial']],
  ['the language', ['en', 'fr', 'de', 'nl', 'es']],
  ['the channel', ['web', 'email', 'phone', 'chat', 'post']],
];

/** A membership span: a quantity, a list of two to four members and the words that introduce it. */
export function drawMembership(rng: Rng): { subject: string; list: string[]; text: string } {
  const [subject, pool] = rng.pick(SETS);
  const list = rng.sample(pool, rng.int(2, 4));
  const joined = rng.chance(0.5)
    ? list.join(', ')
    : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
  const lead = rng.pick(['is one of', 'is any of', 'is among']);
  return { subject, list, text: `${subject} ${lead} ${joined}` };
}
