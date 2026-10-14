import { machineVerdict } from '../contracts/check';
import type { Message } from '../schema/common';
import type { Observed, Verdict } from '../schema/run';

/** One fact of the ledger a block contradicted, and where. */
export type LedgerContradiction = {
  fact: string;
  /** `tool`: a tool call's input; `reply`: the reply text. */
  source: 'tool' | 'reply';
  ledger: unknown;
  observed: unknown;
  /** The tool call and input path, or `reply`. */
  where: string;
};

/**
 * The ledger contradiction check, code only. The ledger is the facts the agent must hold after the block:
 * the seed, every earlier `ledger_add` and this block's. Two arms:
 *
 * Tool inputs. Every scalar in a tool call's input (nested objects and lists included) whose key names a
 * fact of the ledger holding a scalar is compared with it. Keys match without case, `_` or `-`
 * (`customer_id`, `customerId`). Values match as text without case or surrounding space; two values that
 * both read as phone numbers match on their digits.
 *
 * Reply facts. For a fact holding an email address or a phone number, the user messages of the
 * conversation may name other values of the same kind. The reply contradicts the fact when it states one
 * of those other values and not the ledger's: the agent took a value the ledger replaced or never held.
 * Asking which of two values holds names both, and is no contradiction.
 */
export function ledgerContradictions(
  ledger: Readonly<Record<string, unknown>>,
  observed: Observed,
  userMessages: readonly Message[],
): { checked: string[]; contradictions: LedgerContradiction[] } {
  const checked = new Set<string>();
  const contradictions: LedgerContradiction[] = [];
  const facts = new Map<string, { fact: string; value: Scalar }>();
  for (const [fact, value] of Object.entries(ledger)) {
    if (isScalar(value)) facts.set(keyOf(fact), { fact, value });
  }

  for (const call of observed.toolCalls) {
    for (const [path, value] of leaves(call.input, [])) {
      const key = path.findLast((part) => typeof part === 'string');
      if (typeof key !== 'string' || !isScalar(value)) continue;
      const known = facts.get(keyOf(key));
      if (!known) continue;
      checked.add(known.fact);
      if (!sameValue(known.value, value)) {
        contradictions.push({
          fact: known.fact,
          source: 'tool',
          ledger: known.value,
          observed: value,
          where: `${call.label}.${path.join('.')}`,
        });
      }
    }
  }

  for (const { fact, value } of facts.values()) {
    if (typeof value !== 'string') continue;
    const kind = kindOf(value);
    if (!kind) continue;
    const others = saidValues(kind, userMessages).filter((other) => !sameValue(other, value));
    if (others.length === 0) continue;
    const stated = valuesOf(kind, observed.text);
    if (stated.length === 0) continue;
    checked.add(fact);
    if (stated.some((item) => sameValue(item, value))) continue;
    const taken = stated.find((item) => others.some((other) => sameValue(other, item)));
    if (taken !== undefined) {
      contradictions.push({ fact, source: 'reply', ledger: value, observed: taken, where: 'reply' });
    }
  }
  return { checked: [...checked], contradictions };
}

/**
 * The ledger verdicts of a block, family `ledger` (drift class X2_contradiction): one gating verdict per
 * fact the block's tool inputs or reply stated, failing when one of them contradicts the ledger.
 */
export function ledgerVerdicts(
  ledger: Readonly<Record<string, unknown>>,
  observed: Observed,
  userMessages: readonly Message[],
): { verdicts: Verdict[]; contradictions: LedgerContradiction[] } {
  const { checked, contradictions } = ledgerContradictions(ledger, observed, userMessages);
  const verdicts = checked.map((fact) => {
    const found = contradictions.filter((entry) => entry.fact === fact);
    const evidence =
      found.length === 0
        ? `${fact}: the block states ${JSON.stringify(ledger[fact])}, as the ledger holds`
        : found
            .map((entry) =>
              entry.source === 'tool'
                ? `${fact}: ${entry.where} is ${JSON.stringify(entry.observed)}, the ledger holds ${JSON.stringify(entry.ledger)}`
                : `${fact}: the reply states ${JSON.stringify(entry.observed)}, the ledger holds ${JSON.stringify(entry.ledger)}`,
            )
            .join('; ');
    return machineVerdict('ledger', fact, found.length === 0 ? 'pass' : 'fail', evidence);
  });
  return { verdicts, contradictions };
}

/** A contradiction as `ledgerCheck.contradictions` writes it. */
export function describeContradiction(entry: LedgerContradiction): string {
  return entry.source === 'tool'
    ? `${entry.fact}: the ledger holds ${JSON.stringify(entry.ledger)}, ${entry.where} sent ${JSON.stringify(entry.observed)}`
    : `${entry.fact}: the ledger holds ${JSON.stringify(entry.ledger)}, the reply states ${JSON.stringify(entry.observed)}`;
}

type Scalar = string | number | boolean;

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function keyOf(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

function* leaves(value: unknown, path: Array<string | number>): Generator<[Array<string | number>, unknown]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* leaves(item, [...path, index]);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) yield* leaves(item, [...path, key]);
  } else if (path.length > 0) {
    yield [path, value];
  }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d ().-]{5,}\d/g;
/** A phone number has at least 9 digits: a date (8) or a short code is never read as one. */
const PHONE_DIGITS = 9;

function kindOf(value: string): 'email' | 'phone' | undefined {
  if (new RegExp(`^${EMAIL.source}$`).test(value.trim())) return 'email';
  if (new RegExp(`^${PHONE.source}$`).test(value.trim()) && digits(value).length >= PHONE_DIGITS)
    return 'phone';
  return undefined;
}

const saidOf = new WeakMap<Message, { email?: string[]; phone?: string[] }>();

/** The values a list of user messages names so far, per kind, and how many of its messages they cover. */
type Said = { count: number; last: Message | undefined; values: string[] };
const saidOfList = new WeakMap<readonly Message[], { email?: Said; phone?: Said }>();

/**
 * The values of a kind the user messages name, in order. A message is read once for the life of the message
 * (a newline ends a value, so reading the messages one by one finds what reading them joined finds). A list
 * the runner passes again after appending to it is read from where the last call stopped, so the cost of a
 * block does not grow with the conversation before it. A list that shrank, or whose last read message was
 * replaced, is read again from the start.
 */
function saidValues(kind: 'email' | 'phone', messages: readonly Message[]): string[] {
  let lists = saidOfList.get(messages);
  if (!lists) {
    lists = {};
    saidOfList.set(messages, lists);
  }
  let said = lists[kind];
  if (!said || said.count > messages.length || (said.count > 0 && messages[said.count - 1] !== said.last)) {
    said = { count: 0, last: undefined, values: [] };
  }
  for (let index = said.count; index < messages.length; index += 1) {
    const message = messages[index] as Message;
    let read = saidOf.get(message);
    if (!read) {
      read = {};
      saidOf.set(message, read);
    }
    read[kind] ??= valuesOf(
      kind,
      typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    );
    said.values.push(...read[kind]);
  }
  said.count = messages.length;
  said.last = messages.at(-1);
  lists[kind] = said;
  return said.values;
}

function valuesOf(kind: 'email' | 'phone', text: string): string[] {
  const found = text.match(kind === 'email' ? EMAIL : PHONE) ?? [];
  return kind === 'phone' ? found.filter((item) => digits(item).length >= PHONE_DIGITS) : found;
}

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function sameValue(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string' && kindOf(a) === 'phone' && kindOf(b) === 'phone') {
    return digits(a) === digits(b);
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
