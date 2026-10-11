import { ModelError, type ModelPort } from '../model/port';

/**
 * The privacy stack for past conversations, in code. Pass 1 is a set of regular expressions with
 * checksums (emails, phones, IBANs, national ids, card numbers, street addresses). Pass 2 is a second,
 * independent set built another way (cue words, token shapes, long digit runs, names after "my name is"),
 * or the model port as a checker, or both. Pass 2 reads the output of pass 1, so whatever it finds is a
 * miss of pass 1: the intake report counts those as residual flags. Presidio's own caveat is the reason for
 * two passes: no detector finds everything. A person's spot check is the third layer.
 */

export const PASS1_TYPES = ['email', 'iban', 'card', 'national_id', 'phone', 'address'] as const;
export const PASS2_TYPES = [
  'contact',
  'long_number',
  'name',
  'url',
  'ip_address',
  'date',
  'postcode',
] as const;
export const MODEL_TYPES = ['name', 'contact', 'address', 'number', 'date', 'other'] as const;
export type FindingType =
  | (typeof PASS1_TYPES)[number]
  | (typeof PASS2_TYPES)[number]
  | `model_${(typeof MODEL_TYPES)[number]}`;

export type Finding = {
  type: FindingType;
  /** 1 for the checksum pass, 2 for the second rule set, 'model' for the model checker. */
  pass: 1 | 2 | 'model';
  /** The detector that fired, such as `iban-mod97` or `name-after-cue`. */
  detector: string;
  start: number;
  end: number;
  value: string;
  /** True for reserved fictional data: emails at example.com and the like, phones 555-0100 to 555-0199. */
  fictional: boolean;
};

/** ISO 13616 IBAN length per country (the table of tools/guard). */
// biome-ignore format: a lookup table reads best packed
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18,
  FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23,
  IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27,
  MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27,
  SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

/** Remainder of a long decimal string divided by 97. */
export function mod97(digits: string): number {
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + (char.charCodeAt(0) - 48)) % 97;
  return remainder;
}

function lettersToDigits(text: string): string {
  let out = '';
  for (const char of text) out += /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
  return out;
}

/** True when the text is an IBAN of the right length for its country with a valid mod 97 checksum. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!length || iban.length !== length || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** True when the digits pass the Luhn check, the checksum of payment card numbers. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** True when 11 digits form a Belgian national register number: a plausible date and a valid check. */
export function isValidBelgianNationalNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const monthOk = month <= 12 || (month >= 20 && month <= 32) || (month >= 40 && month <= 52);
  if (!monthOk || day > 31) return false;
  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9));
  return 97 - (base % 97) === check || 97 - ((2_000_000_000 + base) % 97) === check;
}

/** True when 15 characters form a French social security number (NIR) whose key is 97 minus n mod 97. */
export function isValidFrenchNir(raw: string): boolean {
  const compact = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[12]\d{4}(?:\d{2}|2A|2B)\d{8}$/.test(compact)) return false;
  const body = compact.slice(0, 13).replace('2A', '19').replace('2B', '18');
  return 97 - Number(BigInt(body) % 97n) === Number(compact.slice(13));
}

const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'localhost']);
const ALLOWED_EMAIL_SUFFIXES = ['.example', '.test', '.invalid', '.localhost'];

/** True for reserved fictional email domains: example.com, .org, .net, and the .test style suffixes. */
export function isFictionalEmail(address: string): boolean {
  const domain = address.toLowerCase().slice(address.lastIndexOf('@') + 1);
  return (
    ALLOWED_EMAIL_DOMAINS.has(domain) || ALLOWED_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix))
  );
}

/** True for the fictional NANP range: 555-0100 to 555-0199, with or without +1 and an area code. */
export function isFictionalPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return /^(?:1?\d{3})?55501\d{2}$/.test(digits);
}

/** Card numbers payment providers publish for tests. */
const TEST_CARDS = new Set(['4111111111111111', '4242424242424242', '5555555555554444', '378282246310005']);

type Detector = {
  type: FindingType;
  name: string;
  pattern: RegExp;
  /** Keeps a match, and may shorten it (an IBAN followed by more characters). */
  accept?: (match: string) => { length: number } | boolean;
  fictional?: (match: string) => boolean;
};

const STREET_SUFFIX =
  'Street|St\\.?|Road|Rd\\.?|Avenue|Ave\\.?|Way|Lane|Ln\\.?|Drive|Dr\\.?|Boulevard|Blvd\\.?|Court|Ct\\.?|Place|Pl\\.?|Square|Sq\\.?|Terrace|Close|Crescent|Row|Gardens|Parkway';
const CONTINENTAL_SUFFIX = 'straat|laan|weg|plein|steenweg|dreef|lei|gasse|straße|strasse|gracht|kade';

/** Pass 1, in priority order: a span taken by an earlier detector is not reported again. */
const PASS1: readonly Detector[] = [
  {
    type: 'email',
    name: 'email-shape',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    fictional: isFictionalEmail,
  },
  {
    type: 'iban',
    name: 'iban-mod97',
    pattern: /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){10,32}/g,
    accept: (match) => {
      const compact = match.replace(/\s/g, '').toUpperCase();
      const length = IBAN_LENGTHS[compact.slice(0, 2)];
      if (!length || compact.length < length || !isValidIban(compact.slice(0, length))) return false;
      return { length: spanOfAlphanumerics(match, length) };
    },
  },
  {
    type: 'national_id',
    name: 'be-national-register-mod97',
    pattern: /(?<![\d.])\d{2}\.?\d{2}\.?\d{2}[-. ]?\d{3}[-. ]?\d{2}(?!\d)/g,
    accept: isValidBelgianNationalNumber,
  },
  {
    type: 'national_id',
    name: 'fr-nir-key',
    pattern: /\b[12] ?\d{2} ?\d{2} ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b/g,
    accept: isValidFrenchNir,
  },
  {
    type: 'national_id',
    name: 'us-ssn',
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    type: 'national_id',
    name: 'uk-nino',
    pattern: /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g,
  },
  {
    type: 'card',
    name: 'card-luhn',
    pattern: /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g,
    accept: (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits);
    },
    fictional: (match) => TEST_CARDS.has(match.replace(/\D/g, '')),
  },
  {
    type: 'phone',
    name: 'phone-international',
    pattern: /(?<![\w+])\+[1-9][\d \-().]{6,22}\d/g,
    accept: (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15;
    },
    fictional: isFictionalPhone,
  },
  {
    type: 'phone',
    name: 'phone-nanp',
    pattern: /(?<![\d+])(?:1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}(?!\d)/g,
    fictional: isFictionalPhone,
  },
  {
    type: 'phone',
    name: 'phone-00-prefix',
    pattern: /(?<!\d)00 ?[1-9](?:[ ./-]?\d){6,13}(?!\d)/g,
  },
  {
    type: 'phone',
    name: 'phone-trunk-0',
    pattern: /(?<![\d+])0\d(?:[ ./-]?\d){7,9}(?!\d)/g,
  },
  {
    type: 'phone',
    name: 'phone-local-7',
    pattern: /(?<![\d+-])\d{3}-\d{4}(?![\d-])/g,
    fictional: isFictionalPhone,
  },
  {
    type: 'address',
    name: 'address-number-first',
    pattern: new RegExp(
      `\\b\\d{1,5}[A-Za-z]?,?\\s+(?:\\p{Lu}[\\p{L}'-]*\\s+){1,3}(?:${STREET_SUFFIX})(?![\\p{L}])`,
      'gu',
    ),
  },
  {
    type: 'address',
    name: 'address-name-first',
    pattern: new RegExp(
      `(?:\\b(?:Rue|Avenue|Boulevard|Chaussée|Chemin|Via|Calle|Rua|Place)\\s+(?:[\\p{L}'-]+\\s+){0,4}?\\d{1,4}[A-Za-z]?\\b|\\b\\p{Lu}[\\p{L}-]*(?:${CONTINENTAL_SUFFIX})\\s+\\d{1,4}[A-Za-z]?\\b)`,
      'gu',
    ),
  },
];

const NAME_CUES = [
  'my name is',
  "my name's",
  'i am',
  "i'm",
  'this is',
  'call me',
  'name:',
  'signed',
  'regards,',
  'thanks,',
  'cheers,',
  'ik ben',
  'mijn naam is',
  "je m'appelle",
  'je suis',
  'ich bin',
  'mein name ist',
];

function cuePattern(cue: string): string {
  const first = cue[0] ?? '';
  const rest = cue.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `[${first.toUpperCase()}${first.toLowerCase()}]${rest}`;
}

/** Pass 2: another way of looking, run on the text pass 1 already redacted. */
const PASS2: readonly Detector[] = [
  {
    type: 'contact',
    name: 'at-sign-token',
    pattern: /(?<![\w[])[^\s[\]]*@[^\s[\]]+/g,
    accept: (match) => /\w@\w/.test(match),
    fictional: (match) => isFictionalEmail(match.replace(/[^\w@.-]+$/, '')),
  },
  {
    type: 'contact',
    name: 'spelled-out-email',
    pattern: /\b[\w.+-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}\b/gi,
  },
  {
    type: 'url',
    name: 'url',
    pattern: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi,
  },
  {
    type: 'ip_address',
    name: 'ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  },
  {
    type: 'date',
    name: 'calendar-date',
    pattern:
      /\b(?:(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g,
  },
  {
    type: 'postcode',
    name: 'uk-postcode',
    pattern: /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g,
  },
  {
    type: 'long_number',
    name: 'seven-or-more-digits',
    pattern: /(?<![\w[])\+?\d(?:[\d \t().,/-]*\d)?(?![\w\]])/g,
    accept: (match) => match.replace(/\D/g, '').length >= 7,
    fictional: isFictionalPhone,
  },
  {
    type: 'name',
    name: 'name-after-cue',
    pattern: new RegExp(
      `(?<=(?:^|[^\\p{L}])(?:${NAME_CUES.map(cuePattern).join('|')})\\s+)\\p{Lu}[\\p{L}'-]+(?:\\s+\\p{Lu}[\\p{L}'-]+){0,2}`,
      'gu',
    ),
  },
];

/** The length of the prefix of `text` that holds `count` letters or digits. */
function spanOfAlphanumerics(text: string, count: number): number {
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/[A-Za-z0-9]/.test(text[index] ?? '')) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}

function run(text: string, detectors: readonly Detector[], pass: 1 | 2): Finding[] {
  const taken: Finding[] = [];
  for (const detector of detectors) {
    for (const match of text.matchAll(detector.pattern)) {
      let value = match[0];
      const start = match.index ?? 0;
      if (detector.accept) {
        const verdict = detector.accept(value);
        if (verdict === false) continue;
        if (typeof verdict === 'object') value = value.slice(0, verdict.length);
      }
      value = value.replace(/[\s.,;:!?)]+$/, '');
      if (value === '') continue;
      const end = start + value.length;
      if (taken.some((other) => start < other.end && other.start < end)) continue;
      taken.push({
        type: detector.type,
        pass,
        detector: detector.name,
        start,
        end,
        value,
        fictional: detector.fictional?.(value) ?? false,
      });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** Pass 1: regular expressions with checksums. */
export function detectPass1(text: string): Finding[] {
  return run(text, PASS1, 1);
}

/** Pass 2: the independent rule set. Placeholders such as [EMAIL_1] are never findings. */
export function detectPass2(text: string): Finding[] {
  return run(text, PASS2, 2).filter((finding) => !/^\[[A-Z_]+_\d+\]$/.test(finding.value));
}

/**
 * Replaces findings with typed placeholders, the same value always by the same placeholder within one
 * redactor: `[EMAIL_1]`, `[PHONE_2]`. Use one redactor per conversation, so placeholders never link two
 * conversations.
 */
export class Redactor {
  private readonly seen = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  placeholder(finding: Pick<Finding, 'type' | 'value'>): string {
    const label = finding.type.replace(/^model_/, '').toUpperCase();
    const key = `${label}:${valueKey(finding.value)}`;
    const known = this.seen.get(key);
    if (known) return known;
    const next = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, next);
    const placeholder = `[${label}_${next}]`;
    this.seen.set(key, placeholder);
    return placeholder;
  }

  /** The text with every finding replaced, from the last to the first. */
  redact(text: string, findings: readonly Finding[]): string {
    let out = text;
    for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, finding.start) + this.placeholder(finding) + out.slice(finding.end);
    }
    return out;
  }
}

function valueKey(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length >= value.replace(/\s/g, '').length - 3
    ? digits
    : value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export type SecondPass = 'rules' | 'model' | 'both';
export const SECOND_PASSES: readonly SecondPass[] = ['rules', 'model', 'both'];

export type TurnText = { role: string; text: string };

export type AnonymisedTurns = {
  turns: TurnText[];
  /** Every finding, with the turn it was in. Values stay in memory only; never write them out. */
  findings: Array<Finding & { turn: number }>;
  /** The model checker's state for this conversation: not run, done, or failed with a reason. */
  model: { status: 'not_run' } | { status: 'done'; unmatched: number } | { status: 'failed'; reason: string };
};

/** The model checker's system prompt. The model sees only text that pass 1 already redacted. */
export const CHECKER_PROMPT = `You check a conversation that code has already anonymised. Text in square brackets, such as [EMAIL_1] or [PHONE_2], is already redacted: ignore it.

List every piece of personal data that remains: a person's name, a contact detail, a street address, an account, card or id number, a date of birth, or anything else that identifies a person. Copy each one exactly as it appears in the turn, character for character.

Answer with one JSON object and nothing else:
{"findings": [{"turn": 0, "text": "the exact span", "type": "name"}]}
type is one of: ${MODEL_TYPES.join(', ')}. Give an empty list when nothing remains.`;

/**
 * Runs pass 1 then the chosen second pass over the turns of one conversation and redacts both. The model
 * checker, when chosen, reads the text after the rule passes. A model failure leaves the rule passes in
 * place and marks the conversation `failed`: the caller reports it, it is never silently clean.
 */
export async function anonymiseTurns(
  id: string,
  turns: readonly TurnText[],
  options: { second: SecondPass; port?: ModelPort },
): Promise<AnonymisedTurns> {
  const redactor = new Redactor();
  const findings: AnonymisedTurns['findings'] = [];
  const passed = turns.map((turn, index) => {
    const first = detectPass1(turn.text);
    findings.push(...first.map((finding) => ({ ...finding, turn: index })));
    let text = redactor.redact(turn.text, first);
    if (options.second !== 'model') {
      const second = detectPass2(text);
      findings.push(...second.map((finding) => ({ ...finding, turn: index })));
      text = redactor.redact(text, second);
    }
    return { role: turn.role, text };
  });

  if (options.second === 'rules') return { turns: passed, findings, model: { status: 'not_run' } };
  if (!options.port) {
    return { turns: passed, findings, model: { status: 'failed', reason: 'no model port configured' } };
  }
  const checked = await modelCheck(id, passed, options.port);
  if (!checked.ok) return { turns: passed, findings, model: { status: 'failed', reason: checked.reason } };
  const out = passed.map((turn, index) => {
    const own = checked.findings.filter((finding) => finding.turn === index);
    findings.push(...own);
    return { role: turn.role, text: redactor.redact(turn.text, own) };
  });
  return { turns: out, findings, model: { status: 'done', unmatched: checked.unmatched } };
}

type ModelCheck =
  | { ok: true; findings: Array<Finding & { turn: number }>; unmatched: number }
  | { ok: false; reason: string };

async function modelCheck(id: string, turns: readonly TurnText[], port: ModelPort): Promise<ModelCheck> {
  const user = [
    `CONVERSATION: ${id}`,
    ...turns.map((turn, index) => `TURN ${index} (${turn.role}): ${turn.text}`),
  ].join('\n');
  let note = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let answer: string;
    try {
      answer = await port.complete({ system: CHECKER_PROMPT, user: user + note, maxTokens: 4000 });
    } catch (cause) {
      if (cause instanceof ModelError) return { ok: false, reason: `${cause.code}: ${cause.message}` };
      throw cause;
    }
    const parsed = parseCheckerAnswer(answer, turns);
    if (parsed.ok) return parsed;
    note = `\n\nYour previous answer could not be read: ${parsed.reason}. Answer with the JSON object only.`;
    if (attempt === 1) return parsed;
  }
  return { ok: false, reason: 'unreachable' };
}

/** Reads the checker's JSON answer and places each span it names in its turn. Never throws. */
export function parseCheckerAnswer(answer: string, turns: readonly TurnText[]): ModelCheck {
  const body = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'the answer is not JSON' };
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { findings?: unknown }).findings)) {
    return { ok: false, reason: 'the answer has no findings list' };
  }
  const findings: Array<Finding & { turn: number }> = [];
  let unmatched = 0;
  for (const entry of (raw as { findings: unknown[] }).findings) {
    if (typeof entry !== 'object' || entry === null)
      return { ok: false, reason: 'a finding is not an object' };
    const { turn, text, type } = entry as { turn?: unknown; text?: unknown; type?: unknown };
    if (typeof turn !== 'number' || !Number.isInteger(turn) || typeof text !== 'string') {
      return { ok: false, reason: 'a finding needs a whole turn number and a text' };
    }
    const target = turns[turn]?.text;
    const kind = MODEL_TYPES.includes(type as (typeof MODEL_TYPES)[number])
      ? (type as (typeof MODEL_TYPES)[number])
      : 'other';
    if (target === undefined || text.trim() === '' || !target.includes(text)) {
      unmatched += 1;
      continue;
    }
    for (let at = target.indexOf(text); at !== -1; at = target.indexOf(text, at + text.length)) {
      const end = at + text.length;
      if (findings.some((other) => other.turn === turn && at < other.end && other.start < end)) continue;
      findings.push({
        type: `model_${kind}`,
        pass: 'model',
        detector: 'model-checker',
        start: at,
        end,
        value: text,
        fictional: false,
        turn,
      });
    }
  }
  return { ok: true, findings, unmatched };
}
