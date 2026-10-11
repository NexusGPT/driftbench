/**
 * Reading customer messages. The Acme agent has no model: it reads messages with the fixed patterns
 * below, so the same words always lead to the same reply.
 */

/** Lower case, single spaces, trimmed. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

export function extractEmail(text: string): string | undefined {
  return EMAIL.exec(text)?.[0].toLowerCase();
}

const PHONE = /(?:\+?1[\s.]?)?\(?\d{3}\)?[\s.]?\d{3}[\s.]?\d{4}/;

/** A US phone number in E.164 form (`+12025550142`), or undefined. */
export function extractPhone(text: string): string | undefined {
  const match = PHONE.exec(text);
  return match ? toE164(match[0]) : undefined;
}

/** `+12025550142` from any common US spelling; undefined when the digits do not form a US number. */
export function toE164(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return undefined;
}

/** `+1 202 555 0142` for a number in E.164 form. */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length !== 11) return e164;
  return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

const ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Road|Way|Avenue|Lane|Street|Drive|Court|Place)\b(?:,\s*[A-Z][a-z]+)?/;

/** A street address such as `14 Harbor Road, Acmeville`. */
export function extractAddress(text: string): string | undefined {
  return ADDRESS.exec(text)?.[0];
}

const FILLER = /^(?:my name is|my name's|i am|i'm|it's|it is|this is|name:?)\s+/i;
const FULL_NAME = /^[A-Z][a-z]+(?:\s+[A-Z][a-z']+)+$/;

/** A full name written as capitalised words, such as `Jo Okafor` in `Jo Okafor, jo.okafor@example.com`. */
export function extractName(text: string): string | undefined {
  const withoutEmail = text.replace(EMAIL, ' ');
  for (const part of withoutEmail.split(/[,;\n]|\band\b/)) {
    const candidate = part
      .trim()
      .replace(FILLER, '')
      .replace(/[.!]+$/, '')
      .trim();
    if (FULL_NAME.test(candidate)) return candidate;
  }
  return undefined;
}

/** The first name of a full name. */
export function firstName(name: string | undefined): string | undefined {
  return name?.split(' ')[0];
}

const has = (pattern: RegExp) => (text: string) => pattern.test(normalize(text));

export const isBlank = (text: string): boolean => text.trim() === '';

const NUDGE_LINE = /^(?:hello|hi|hey|are you (?:still )?there|anyone there|still there)\W*$/;

/** Only nudges such as `hello?` or `are you still there?`, or nothing at all. */
export function isNudge(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => normalize(line))
    .filter((line) => line !== '');
  return lines.every((line) => NUDGE_LINE.test(line));
}

/** An instruction aimed at the agent, hidden in what should be customer data. */
export const isInjection = has(
  /\bignore (?:all |any |your |the |my )?(?:previous |prior |earlier |above )?(?:rules|instructions|prompt)\b|\bsystem prompt\b|\byou are now\b|\bdisregard (?:all |your |the )?(?:rules|instructions)\b/,
);

const FOREIGN_WORDS = new Set([
  'hola',
  'gracias',
  'quiero',
  'tienen',
  'cuánto',
  'cuesta',
  'barato',
  'más',
  'bonjour',
  'merci',
  'combien',
  'voudrais',
  'hallo',
  'bedankt',
  'goedkoper',
  'danke',
  'bitte',
]);

/** A message written in another language than English. */
export function isForeign(text: string): boolean {
  if (/[¿¡]/.test(text)) return true;
  return normalize(text)
    .split(/[^\p{L}]+/u)
    .some((word) => FOREIGN_WORDS.has(word));
}

/** Billing and service matters belong to Acme Care, not to sales. */
export const isCareMatter = has(
  /\b(?:bill|billing|billed|charged|invoice|refund|outage|no signal|not working|cancel my (?:contract|plan|line))\b/,
);

/** The one token that places an order. */
export const isExplicitConfirm = (text: string): boolean =>
  /^(?:yes )?(?:i )?confirm(?: it| please| the order| my order)?$/.test(
    normalize(text)
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

/** A yes that is not the explicit token. */
export const isLooseYes = has(
  /\b(?:ok|okay|sure|sounds good|perfect|great|yes|yep|yeah|go ahead|do it|fine|alright)\b/,
);

/** The customer comes back to the conversation after a detour. */
export const isReturn = has(
  /\b(?:where were we|let'?s continue|let us continue|back to it|back to (?:the|my) (?:plan|order)|what were the options|carry on)\b/,
);

export const isStoreHours = (text: string): boolean =>
  has(/\b(?:store|stores|shop|shops)\b/)(text) && has(/\b(?:open|opening|hours|close|closed)\b/)(text);

export const isCallbackRequest = has(/\b(?:call me|call back|callback|ring me|contact me|someone call)\b/);

export const isRetry = has(/\b(?:try (?:it )?again|try once more|check again|retry|one more try)\b/);

export const isDone = has(/\b(?:thanks|thank you|that'?s all|nothing else|bye|goodbye)\b/);

export const isQuestion = (text: string): boolean => text.includes('?');

export type Intent = 'porting' | 'upgrade' | 'home' | 'mobile';

const INTENTS: Array<[Intent, RegExp]> = [
  ['porting', /\b(?:keep my (?:phone )?number|port(?:ing)? my number|bring my number|transfer my number)\b/],
  [
    'upgrade',
    /\b(?:upgrade|more data|running out of data|bigger plan|existing customer|(?:already|i'?m|i am) (?:an |a )?acme customer)\b/,
  ],
  ['home', /\b(?:home internet|broadband|internet at home|fiber|fibre|wifi)\b/],
  ['mobile', /\b(?:phone plan|mobile plan|sim|new line|mobile)\b/],
];

/** What the customer came for, read from their first words. */
export function detectIntent(text: string): Intent | undefined {
  const normalized = normalize(text);
  return INTENTS.find(([, pattern]) => pattern.test(normalized))?.[0];
}
