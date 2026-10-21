import type { ModelPort } from '../model/port';
import { approvedForms, type UtteranceClass } from './schema';
import type { SetItem } from './set';
import { jsonObjectOf } from './text';

/**
 * The audit of accepted realisations by labellers that are not the gate's judge. Each labeller reads the class
 * (request, seed, every approved spelling) and one accepted item and says whether the item is a valid member.
 * The union rule counts an item invalid when any labeller says so, or gives no readable answer. Labellers of
 * two different model families are required, so one family's blind spot is not the whole audit.
 */

/** The audit passes when at most this many items are invalid. */
export const AUDIT_MAX_INVALID = 1;

export type AuditLabel = { labeller: string; valid: boolean | null; reason: string };
export type AuditRow = { item: string; text: string; labels: AuditLabel[]; invalid: boolean };
export type AuditResult = {
  class: string;
  set: string;
  items: number;
  invalid: number;
  /** Items each labeller called invalid. */
  byLabeller: Record<string, number>;
  /** Items the labellers disagree on. */
  disagreements: number;
  maxInvalid: number;
  pass: boolean;
  rows: AuditRow[];
};

const LABELLER_SYSTEM = `You audit test messages for a conversational agent. A message is a valid member of its class when a real user could send it in that place, it makes exactly the request described, with the same constraints, and it carries every value exactly once in one of its listed spellings, with no other value of the same kind. It may use other words, another structure, small talk that asks nothing, or typos outside the values. It is invalid when it adds, drops, negates or changes anything in the request or a value, or when a listed spelling is used as if it were a different value.
Answer with JSON only: {"valid": true or false, "reason": "one sentence"}.`;

export async function auditItems(
  cls: UtteranceClass,
  set: { set: string; items: readonly SetItem[] },
  labellers: readonly ModelPort[],
  options: { maxInvalid?: number } = {},
): Promise<AuditResult> {
  const families = new Set(labellers.map((l) => l.family));
  if (labellers.length < 2 || families.size < 2) {
    throw new RangeError('auditItems: give labellers of at least two model families');
  }
  const forms = cls.slots
    .map(
      (slot) =>
        `- ${slot.name}: ${approvedForms(slot)
          .map((f) => JSON.stringify(f))
          .join(', ')}`,
    )
    .join('\n');
  const rows: AuditRow[] = [];
  const byLabeller: Record<string, number> = {};
  let disagreements = 0;
  for (const item of set.items) {
    const labels: AuditLabel[] = [];
    for (const labeller of labellers) {
      const name = `${labeller.family}/${labeller.model ?? 'unknown'}`;
      const answer = jsonObjectOf(
        await labeller.complete({
          system: LABELLER_SYSTEM,
          user: `Request: ${cls.intent}\nAgent's last reply: ${cls.context.last_reply === '' ? '(none, this is the first message)' : JSON.stringify(cls.context.last_reply)}\nOriginal message: ${JSON.stringify(cls.seed)}\nListed spellings of each value:\n${forms === '' ? '(no values)' : forms}\nMessage to audit: ${JSON.stringify(item.text)}`,
        }),
      );
      const valid = typeof answer?.valid === 'boolean' ? answer.valid : null;
      labels.push({ labeller: name, valid, reason: String(answer?.reason ?? 'no readable answer') });
      if (valid !== true) byLabeller[name] = (byLabeller[name] ?? 0) + 1;
    }
    const verdicts = new Set(labels.map((l) => l.valid));
    if (verdicts.size > 1) disagreements += 1;
    rows.push({ item: item.id, text: item.text, labels, invalid: labels.some((l) => l.valid !== true) });
  }
  const invalid = rows.filter((r) => r.invalid).length;
  const maxInvalid = options.maxInvalid ?? AUDIT_MAX_INVALID;
  return {
    class: cls.id,
    set: set.set,
    items: rows.length,
    invalid,
    byLabeller,
    disagreements,
    maxInvalid,
    pass: invalid <= maxInvalid,
    rows,
  };
}
