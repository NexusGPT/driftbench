import type { ModelPort } from '../model/port';
import { cellKey, type Row } from './planner';
import { approvedForms, formAt, SLOT_SURFACE, type UtteranceClass } from './schema';
import { containsValue, cosine4, jsonObjectOf, keyOf, machineValues } from './text';

/**
 * The class gate: a candidate realisation is accepted only when every deterministic stage passes, then the
 * style check (when the class declares style axes) and the equivalence judge. The deterministic stages read a
 * text only through containment of a declared value and through machine formats (phone, email, number); the
 * judge is told every listed spelling of each value, so a listed spelling never counts as a change.
 */

export type Stage = { stage: string; ok: boolean; note?: string };

/** Above this 4-gram cosine a candidate is the same string as one already accepted, or as a minimal pair. */
export const NEAR_DUPLICATE = 0.8;
/** The judge accepts only `same: true` at or above this confidence. */
export const JUDGE_CONFIDENCE = 0.9;

/**
 * The deterministic stages. `row` is the planned cell (null for a text with no plan, such as a planted item);
 * `accepted` the texts accepted so far.
 */
export function deterministicStages(
  cls: UtteranceClass,
  text: string,
  row: Row | null,
  accepted: readonly string[] = [],
): Stage[] {
  const stages: Stage[] = [];
  const missing = cls.slots.filter((slot) => !approvedForms(slot).some((form) => containsValue(text, form)));
  stages.push({
    stage: 'slot_presence',
    ok: missing.length === 0,
    ...(missing.length > 0 ? { note: `no approved form of ${missing.map((s) => s.name).join(', ')}` } : {}),
  });
  if (row) {
    const off = cls.slots.filter((slot) => !containsValue(text, formAt(slot, row[SLOT_SURFACE] ?? 's0')));
    stages.push({
      stage: 'slot_surface',
      ok: off.length === 0,
      ...(off.length > 0
        ? {
            note: off
              .map((slot) => `${slot.name} not written as "${formAt(slot, row[SLOT_SURFACE] ?? 's0')}"`)
              .join('; '),
          }
        : {}),
    });
  }
  if (cls.invariants.exclusive) {
    const extra = extraValues(cls, text);
    stages.push({
      stage: 'slot_exclusivity',
      ok: extra.length === 0,
      ...(extra.length > 0 ? { note: `extra ${extra.join(', ')}` } : {}),
    });
  }
  const minimal = cls.slots.flatMap((slot) => slot.minimal.filter((value) => containsValue(text, value)));
  const nearPair = Math.max(0, ...cls.minimal_pairs.map((pair) => cosine4(pair, text)));
  stages.push({
    stage: 'minimal_pair',
    ok: minimal.length === 0 && nearPair <= NEAR_DUPLICATE && !cls.minimal_pairs.includes(text),
    note:
      minimal.length > 0
        ? `holds the minimal value ${minimal.join(', ')}`
        : `nearest pair ${nearPair.toFixed(3)}`,
  });
  const lost = cls.invariants.keep.filter((keep) => !text.includes(keep));
  const tooLong = cls.invariants.max_chars !== undefined && text.length > cls.invariants.max_chars;
  stages.push({
    stage: 'invariants',
    ok: lost.length === 0 && !tooLong && text.trim() !== '',
    ...(lost.length > 0 || tooLong
      ? {
          note: [
            ...lost.map((k) => `lost "${k}"`),
            ...(tooLong ? [`over ${cls.invariants.max_chars} characters`] : []),
          ].join('; '),
        }
      : {}),
  });
  const nearest = Math.max(0, ...accepted.map((a) => cosine4(a, text)));
  stages.push({
    stage: 'near_duplicate',
    ok: nearest <= NEAR_DUPLICATE && !accepted.includes(text),
    note: nearest.toFixed(3),
  });
  return stages;
}

/**
 * The phone numbers, emails and (when a number slot exists) numbers in a text that are no declared value: no
 * approved or pending spelling of any slot holds them, and neither does the agent's last reply.
 */
function extraValues(cls: UtteranceClass, text: string): string[] {
  const declared = cls.slots.flatMap((slot) => slot.surface_forms.map((f) => f.form));
  const context = cls.context.last_reply;
  const hasNumberSlot = cls.slots.some((slot) => slot.format === 'number');
  const known = (format: 'phone' | 'email' | 'number', key: string) =>
    [...declared, context].some((value) =>
      machineValues(value).some((found) => found.format === format && found.key === key),
    ) || declared.some((value) => keyOf(format, value) === key);
  return machineValues(text)
    .filter((found) => found.format !== 'number' || hasNumberSlot)
    .filter((found) => !known(found.format, found.key))
    .map((found) => `${found.format} ${found.text}`);
}

// ---------------------------------------------------------------- model stages

const STYLE_SYSTEM = `You check whether one user message follows a style instruction on each listed axis. For each axis you get the required value and its definition; answer whether the message satisfies it.
The message carries fixed values. Their spelling, punctuation and capitals are dictated and never count for or against any axis.
Answer with JSON only: {"<axis>": true or false for each axis, "reason": "one sentence naming any axis that fails"}.`;

/** The per-axis style check: one yes or no per declared style axis. Passes trivially when the class has none. */
export async function styleStage(
  cls: UtteranceClass,
  text: string,
  row: Row,
  model: ModelPort,
): Promise<Stage> {
  const axes = Object.keys(cls.axes);
  if (axes.length === 0) return { stage: 'style', ok: true, note: 'no style axes' };
  const required = axes
    .map((axis) => `- ${axis}: ${row[axis]} (${cls.axes[axis]?.[row[axis] as string]})`)
    .join('\n');
  const answer = jsonObjectOf(
    await model.complete({
      system: STYLE_SYSTEM,
      user: `Original message: ${JSON.stringify(cls.seed)}\nRequired style:\n${required}\nMessage to check: ${JSON.stringify(text)}`,
    }),
  );
  const misses = axes.filter((axis) => answer?.[axis] !== true);
  return {
    stage: 'style',
    ok: answer !== undefined && misses.length === 0,
    ...(misses.length > 0
      ? { note: `${misses.join(', ')}: ${String(answer?.reason ?? 'no readable answer')}` }
      : {}),
  };
}

const JUDGE_SYSTEM = `You check a test message written for a conversational agent. You get the request the message must make, the agent's last reply, the original user message, and a candidate rewrite.
The rewrite is equivalent when a competent agent should do exactly the same thing after it as after the original: the same request, the same constraints, and exactly the same values. The listed spellings of a value are the same value. Small talk that asks nothing and changes nothing is fine. Anything added, removed, negated or changed in the request or in a value makes it not equivalent, and so does a second value of the same kind.
Answer with JSON only: {"same": true or false, "confidence": a number from 0 to 1, "reason": "one sentence"}.`;

/** The equivalence judge, given every listed spelling of each value. */
export async function equivalenceStage(cls: UtteranceClass, text: string, model: ModelPort): Promise<Stage> {
  const forms = cls.slots
    .map(
      (slot) =>
        `- ${slot.name}: ${approvedForms(slot)
          .map((f) => JSON.stringify(f))
          .join(', ')}`,
    )
    .join('\n');
  const answer = jsonObjectOf(
    await model.complete({
      system: JUDGE_SYSTEM,
      user: `Request: ${cls.intent}\nAgent's last reply: ${cls.context.last_reply === '' ? '(none, this is the first message)' : JSON.stringify(cls.context.last_reply)}\nThese spellings of each value are the same value:\n${forms === '' ? '(no values)' : forms}\nOriginal: ${JSON.stringify(cls.seed)}\nRewrite: ${JSON.stringify(text)}`,
    }),
  );
  const same = answer?.same === true;
  const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0;
  return {
    stage: 'equivalence',
    ok: same && confidence >= JUDGE_CONFIDENCE,
    note:
      answer === undefined ? 'no readable answer' : `${same} ${confidence}: ${String(answer.reason ?? '')}`,
  };
}

export type GateVerdict = { text: string; accepted: boolean; stages: Stage[]; reason?: string };

export type GateModels = {
  /** The equivalence judge. */
  judge: ModelPort;
  /** The style check; the judge without it. */
  style?: ModelPort;
};

/**
 * Gates one candidate: the deterministic stages first; the model stages run only when they all pass, so a
 * text a rule refuses costs no call.
 */
export async function gateCandidate(
  cls: UtteranceClass,
  text: string,
  row: Row | null,
  accepted: readonly string[],
  models: GateModels,
): Promise<GateVerdict> {
  const stages = deterministicStages(cls, text, row, accepted);
  const failed = stages.find((stage) => !stage.ok);
  if (failed) return { text, accepted: false, stages, reason: `${failed.stage}: ${failed.note ?? 'failed'}` };
  if (row) {
    const style = await styleStage(cls, text, row, models.style ?? models.judge);
    stages.push(style);
    if (!style.ok) return { text, accepted: false, stages, reason: `style: ${style.note ?? 'failed'}` };
  }
  const judge = await equivalenceStage(cls, text, models.judge);
  stages.push(judge);
  if (!judge.ok) return { text, accepted: false, stages, reason: `equivalence: ${judge.note ?? 'failed'}` };
  return { text, accepted: true, stages };
}

// ---------------------------------------------------------------- the realiser

const REALISER_SYSTEM = `You write one user message for a test of a conversational agent. You get the request, the agent's last reply, the user's original message, the values the message must carry, and a style.
Write a different message a real user could send in that place, with the same request, the same constraints and the same values.
Rules:
- Copy every value character for character exactly as given. Never change, abbreviate or misspell a value, whatever the style says.
- Add no other phone number, email address, number or identifier.
- Negate nothing the original does not negate, and ask for nothing it does not ask for.
- Follow every style instruction.
Answer with JSON only: {"text": "<the message>"}`;

/**
 * One realiser call for planned row `index`, with the reason of the last rejection when there is one. The row
 * number is in the request, so two rows of the same cell are two requests (and two cassette entries).
 */
export async function realiseRow(
  cls: UtteranceClass,
  row: Row,
  index: number,
  model: ModelPort,
  previous?: { text: string; reason: string },
): Promise<string> {
  const values = cls.slots
    .map((slot) => `- ${slot.name}: ${formAt(slot, row[SLOT_SURFACE] ?? 's0')}`)
    .join('\n');
  const style = Object.keys(cls.axes)
    .map((axis) => `- ${axis}: ${row[axis]} (${cls.axes[axis]?.[row[axis] as string]})`)
    .join('\n');
  const user = `Request: ${cls.intent}
Agent's last reply: ${cls.context.last_reply === '' ? '(none, this is the first message)' : JSON.stringify(cls.context.last_reply)}
Original user message: ${JSON.stringify(cls.seed)}
Values the message must carry, exactly:
${values === '' ? '(none)' : values}
Style:
${style === '' ? '(free: any natural wording)' : style}
Planned message ${index + 1}, cell ${cellKey(cls, row)}${previous ? `\nA previous attempt was rejected. Attempt: ${JSON.stringify(previous.text)}. Reason: ${previous.reason}. Write a new message that fixes this.` : ''}`;
  const answer = jsonObjectOf(await model.complete({ system: REALISER_SYSTEM, user }));
  return typeof answer?.text === 'string' ? answer.text.trim() : '';
}
