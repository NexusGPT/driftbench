import { machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import type { CustomCheckFunction } from './custom';

const NAME = 'stated_length';

/** English words, or Han characters for a length stated in 字. */
export type LengthUnit = 'words' | 'han';

/**
 * A total length the request states. `min` alone is a floor ("no less than 800 words"), `max` alone a
 * ceiling ("under 7 words"), both equal a target ("around 1000 words", "1500-word"), both different a range.
 */
export type StatedLength = {
  unit: LengthUnit;
  kind: 'min' | 'max' | 'about' | 'range';
  min?: number;
  max?: number;
  /** The words of the request that state it. */
  quote: string;
};

export type StatedLengthOptions = {
  /**
   * A draft fails when it holds fewer than this share of the stated floor or target. 0.5: under half of
   * what was asked. Measured on WritingPreferenceBench: see docs/reference/checks.md.
   */
  underFloor?: number;
  /**
   * A draft fails when it holds more than this multiple of the stated ceiling or target. Absent: over-length
   * never fails, since human labels never punished it in the measured pairs.
   */
  overCeiling?: number;
};

export const STATED_LENGTH_DEFAULTS: Readonly<StatedLengthOptions> = Object.freeze({ underFloor: 0.5 });

const DIGITS = String.raw`\d[\d,]*`;
const HAN_NUMBER = '[零一二两三四五六七八九十百千万]+';

const EN_MIN = [
  'at least',
  'no less than',
  'no fewer than',
  'not less than',
  'not fewer than',
  'a minimum of',
  'minimum of',
  'more than',
  'over',
];
const EN_MAX = [
  'at most',
  'no more than',
  'not more than',
  'up to',
  'a maximum of',
  'maximum of',
  'under',
  'less than',
  'fewer than',
  'within',
  'not exceeding',
  'not exceed',
];
const EN_ABOUT = ['around', 'about', 'approximately', 'roughly', '~'];
const ZH_MIN = ['不少于', '不低于', '至少', '不能少于', '不可以少于', '不得少于', '不可少于'];
const ZH_MAX = ['不超过', '不多于', '最多', '不得超过', '不能超过'];

const alternatives = (list: string[]) => list.map((item) => item.replace(/[~]/g, '\\$&')).join('|');

const EN_PATTERN = new RegExp(
  String.raw`(?:\b(?<pre>${alternatives([...EN_MIN, ...EN_MAX, ...EN_ABOUT])})\s+)?(?<a>${DIGITS})(?:\s*(?:-|\u2013|to|and)\s*(?<b>${DIGITS}))?[\s-]*words?\b`,
  'gi',
);
const ZH_PATTERN = new RegExp(
  `(?<pre>${alternatives([...ZH_MIN, ...ZH_MAX, '大约', '大概', '约'])})?\\s*(?<a>${DIGITS}|${HAN_NUMBER})(?:\\s*(?:-|~|～|到|至)\\s*(?<b>${DIGITS}|${HAN_NUMBER}))?\\s*个?汉?字(?<post>左右|上下|以上|以内|以下|之内)?`,
  'g',
);
/** A limit on each item of a list is not a limit on the piece. */
const PER_ITEM = /\beach\b|\bevery\b|\bper\b|每/i;
const CLAUSE_END = /[\n.。!?！？;；]/;

/** The first total length the request states, or undefined. Lines, paragraphs and characters are not read. */
export function parseStatedLength(request: string): StatedLength | undefined {
  const found: (StatedLength & { at: number })[] = [];
  for (const [pattern, unit] of [
    [EN_PATTERN, 'words'],
    [ZH_PATTERN, 'han'],
  ] as const) {
    for (const match of request.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (PER_ITEM.test(clauseBefore(request, at))) continue;
      const groups = match.groups ?? {};
      const a = numberOf(groups.a ?? '');
      const b = groups.b === undefined ? undefined : numberOf(groups.b);
      if (!(a > 0) || (b !== undefined && !(b > a))) continue;
      const pre = (groups.pre ?? '').toLowerCase();
      const post = groups.post ?? '';
      const quote = match[0].trim();
      if (b !== undefined) found.push({ unit, kind: 'range', min: a, max: b, quote, at });
      else if (EN_MIN.includes(pre) || ZH_MIN.includes(pre) || post === '以上')
        found.push({ unit, kind: 'min', min: a, quote, at });
      else if (EN_MAX.includes(pre) || ZH_MAX.includes(pre) || ['以内', '以下', '之内'].includes(post))
        found.push({ unit, kind: 'max', max: a, quote, at });
      else found.push({ unit, kind: 'about', min: a, max: a, quote, at });
    }
  }
  const first = found.sort((x, y) => x.at - y.at)[0];
  if (!first) return undefined;
  const { at: _at, ...stated } = first;
  return stated;
}

function clauseBefore(text: string, at: number): string {
  let start = at;
  while (start > 0 && !CLAUSE_END.test(text[start - 1] ?? '')) start -= 1;
  return text.slice(start, at);
}

const HAN_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const HAN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

function numberOf(text: string): number {
  if (/^\d/.test(text)) return Number(text.replace(/,/g, ''));
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of text) {
    if (char in HAN_DIGIT) digit = HAN_DIGIT[char] ?? 0;
    else if (char in HAN_UNIT) {
      section += (digit || (char === '十' ? 1 : 0)) * (HAN_UNIT[char] ?? 0);
      digit = 0;
    } else if (char === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

/** Whitespace-separated words, or Han characters (U+4E00 to U+9FFF; punctuation and Latin letters do not count). */
export function countLengthUnits(text: string, unit: LengthUnit): number {
  if (unit === 'han') return (text.match(/[一-鿿]/g) ?? []).length;
  return text.split(/\s+/).filter((word) => word !== '').length;
}

export type StatedLengthResult = {
  status: 'pass' | 'fail' | 'none';
  stated?: StatedLength;
  units?: number;
  evidence: string;
};

/** Whether one draft meets the length its request states. `none` when the request states no total length. */
export function statedLengthVerdict(
  request: string,
  draft: string,
  options: StatedLengthOptions = {},
): StatedLengthResult {
  const stated = parseStatedLength(request);
  if (!stated) return { status: 'none', evidence: 'the request states no total length' };
  const underFloor = options.underFloor ?? STATED_LENGTH_DEFAULTS.underFloor ?? 0.5;
  const overCeiling = options.overCeiling ?? STATED_LENGTH_DEFAULTS.overCeiling;
  const units = countLengthUnits(draft, stated.unit);
  const name = stated.unit === 'han' ? 'Han characters' : 'words';
  const asked = `the request asks "${stated.quote}"`;
  if (stated.min !== undefined && units < stated.min * underFloor) {
    return {
      status: 'fail',
      stated,
      units,
      evidence: `${units} ${name}, under ${round(underFloor * 100)} percent of ${stated.min}; ${asked}`,
    };
  }
  if (overCeiling !== undefined && stated.max !== undefined && units > stated.max * overCeiling) {
    return {
      status: 'fail',
      stated,
      units,
      evidence: `${units} ${name}, over ${overCeiling} times ${stated.max}; ${asked}`,
    };
  }
  return { status: 'pass', stated, units, evidence: `${units} ${name}; ${asked}` };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The draft a stated length prefers: the one that passes when the other fails, else undefined. Use it before a
 * pair judge, and keep the judge's choice whenever this returns undefined.
 */
export function preferByStatedLength(
  request: string,
  a: string,
  b: string,
  options: StatedLengthOptions = {},
): 'a' | 'b' | undefined {
  const va = statedLengthVerdict(request, a, options).status;
  const vb = statedLengthVerdict(request, b, options).status;
  if (va === 'pass' && vb === 'fail') return 'a';
  if (va === 'fail' && vb === 'pass') return 'b';
  return undefined;
}

/**
 * The opt-in custom check `stated_length`: register it, then name it under `rules.custom`. It reads the request
 * from `options.request`, else from the user message the agent received in the block, and judges the whole reply. Options:
 * `request`, `under_floor`, `over_ceiling`. No stated length: no verdict.
 */
export const statedLength: CustomCheckFunction = (ctx, options) => {
  const settings = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
  const request =
    typeof settings.request === 'string' ? settings.request : userMessage(ctx.stimulus ?? ctx.block?.when);
  if (request === undefined) return [];
  const result = statedLengthVerdict(request, ctx.observed.text, {
    ...(typeof settings.under_floor === 'number' ? { underFloor: settings.under_floor } : {}),
    ...(typeof settings.over_ceiling === 'number' ? { overCeiling: settings.over_ceiling } : {}),
  });
  if (result.status === 'none') return [];
  const verdict: Verdict = machineVerdict(NAME, 'reply', result.status, result.evidence);
  return [verdict];
};

function userMessage(when: unknown): string | undefined {
  if (!when || typeof when !== 'object') return undefined;
  const stimulus = when as { user?: unknown; burst?: unknown; injection?: { user?: unknown } };
  if (typeof stimulus.user === 'string') return stimulus.user;
  if (Array.isArray(stimulus.burst)) return stimulus.burst.filter((x) => typeof x === 'string').join('\n');
  if (typeof stimulus.injection?.user === 'string') return stimulus.injection.user;
  return undefined;
}
