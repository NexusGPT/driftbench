import {
  errorText,
  type HttpOptions,
  isRecord,
  ModelError,
  postJson,
} from '@agent-nexus/driftbench-generate';
import type { Recorded } from './cassette';
import { type PointerDiagnostic, record } from './codes';
import { windowLines } from './dense';
import {
  type Labeler,
  LabelerConfigError,
  type Opinion,
  type Opinions,
  refusingKey,
  usageOf,
} from './labeler';
import { type Label, type LabelSet, requestPathOf, type Window } from './labels';

/**
 * The yes or no shape of a system 1 labeler: one question per unit and label, batched in one request per
 * window, and a probability of yes for each. A unit takes the label with the highest probability at or above
 * the threshold of the labeler, else `none`. The probabilities are recorded, so a threshold is a setting of
 * a replay, not of a new call.
 */

export const questionKey = (n: number, label: string): string => `u${n}__${label}`;

/** The question for one label and one unit of the numbered text. */
export function yesNoQuestion(label: Label, n: number): string {
  const examples = label.examples?.length
    ? ` Examples: ${label.examples.map((example) => JSON.stringify(example)).join('; ')}`
    : '';
  return `Label ${label.name}: ${label.description}${examples} Does this label apply to unit [${n}] of the numbered text? Answer yes or no.`;
}

/** The numbered text a question refers to: the heading path, then `[n] text` per unit. */
export function yesNoText(window: Window): string {
  return [`path: ${requestPathOf(window).join(' > ') || '(top)'}`, ...windowLines(window)].join('\n');
}

/**
 * The labels a yes or no model is asked about. A label that asks for a target cannot be asked: a probability
 * names no other unit. A labeler on its own refuses such a set; inside a stack it leaves those labels to the
 * system 2 labeler.
 */
export function askedLabels(set: LabelSet, skipTargetLabels: boolean): readonly Label[] {
  // A probability names no other unit, no clause and no atom: a label that needs one of them is system 2's.
  const asked = set.labels.filter((label) => label.target !== 'required' && !label.spans && !label.links);
  if (asked.length < set.labels.length && !skipTargetLabels) {
    throw new LabelerConfigError(
      `the set ${set.set} has a label with a target, spans or links; a yes or no model cannot name any of them: add a system 2 labeler`,
      'set-needs-system2',
      set.set,
    );
  }
  if (asked.length === 0) {
    throw new LabelerConfigError(
      `the set ${set.set} has no label a yes or no model can be asked about`,
      'set-has-no-askable-label',
      set.set,
    );
  }
  return asked;
}

/** The questions of a window, as [key, text] pairs in unit then label order. */
export function yesNoQuestions(asked: readonly Label[], window: Window): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const unit of window.units) {
    for (const label of asked) out.push([questionKey(unit.n, label.name), yesNoQuestion(label, unit.n)]);
  }
  return out;
}

/**
 * The opinions of a yes or no answer. A unit with a question left unanswered has no opinion: it is listed as
 * unlabeled, never guessed from the probabilities that did come back.
 */
export function yesNoOpinions(
  answer: Recorded,
  window: Window,
  asked: readonly Label[],
  threshold: number,
): Opinions {
  const byUnit = new Map<number, Opinion>();
  for (const unit of window.units) {
    const probabilities: Record<string, number> = {};
    let best: { label: string; p: number } | undefined;
    let answered = 0;
    for (const label of asked) {
      const p = answer.probabilities?.[questionKey(unit.n, label.name)];
      if (typeof p !== 'number') continue;
      answered++;
      probabilities[label.name] = p;
      if (p >= threshold && (!best || p > best.p)) best = { label: label.name, p };
    }
    if (answered < asked.length) continue;
    byUnit.set(unit.index, { label: best?.label ?? 'none', probabilities });
  }
  return { byUnit, refusals: [] };
}

/** The probabilities in a list of answers by name; a refusal or a figure outside 0 to 1 is left out. */
function probabilitiesOf(entries: Iterable<[string, unknown]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, p] of entries) {
    if (typeof p === 'number' && p >= 0 && p <= 1) out[name] = p;
  }
  return out;
}

export type YesNoOptions = HttpOptions & {
  env?: Record<string, string | undefined>;
  /** `window`: one request per window, the numbered window as state. `unit`: one request per unit. */
  state?: 'window' | 'unit';
  /** The most questions one request may hold. The cap is a token budget of the endpoint, not a count. */
  maxQuestions?: number;
  /** A unit takes the label with the highest probability of yes at or above this; below it, none. */
  threshold?: number;
  /** Inside a stack: leave the labels that ask for a target to the system 2 labeler. */
  skipTargetLabels?: boolean;
  /** Replay only: no key is read. */
  replayOnly?: boolean;
};

/**
 * Questions per request. The best accuracy was measured at 150 to 250 questions in a request and a hard cap
 * near 1,300 (design, section 10a); on the fictional fixture 1,002 questions were answered and 1,500 were
 * refused with `max_tokens_exceeded`. A refused request is halved by the scan.
 */
export const DEFAULT_MAX_QUESTIONS = 250;

/** The probability of yes a unit needs to take a label: measured best at 0.4 for a window and 0.7 for a single unit. */
export const DEFAULT_THRESHOLD = { window: 0.4, unit: 0.7 } as const;

/** The endpoint's own error type (`detail.error_type`) when it gives one; the usual provider text otherwise. */
function detailErrorText(status: number, payload: unknown): string {
  const detail = isRecord(payload) && isRecord(payload.detail) ? payload.detail : undefined;
  const type = typeof detail?.error_type === 'string' ? detail.error_type : undefined;
  return type ? `${status} ${type}` : errorText(status, payload);
}

/** The windows of a choice labeler: units per request, measured best near 30 (a window of 30 against a whole file). */
export const DEFAULT_CHOICE_UNITS = 30;

/** What the `none` option of a choice question says: the unit has no label of the set. */
export const NONE_DEFINITION = 'None of the other labels applies to this unit.';

/** The key of the probability a choice answer gives to one label of one unit. */
export const choiceKey = (n: number, label: string): string => `u${n}__${label}`;

/** The definition of a label in a choice question: its description and its examples. */
export function choiceDefinition(label: Label): string {
  const examples = label.examples?.length
    ? ` Examples: ${label.examples.map((example) => JSON.stringify(example)).join('; ')}`
    : '';
  return `${label.description}${examples}`;
}

/** The choice questions of a window: one per unit, the labels and `none` as options with their definitions. */
export function choiceQuestions(asked: readonly Label[], window: Window): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const label of asked) criteria[label.name] = choiceDefinition(label);
  criteria.none = NONE_DEFINITION;
  const out: Record<string, unknown> = {};
  for (const unit of window.units) {
    out[`u${unit.n}`] = {
      type: 'choice',
      instructions: `Which label does unit [${unit.n}] of the numbered text have?`,
      criteria,
    };
  }
  return out;
}

/** How far the probabilities of one choice answer may sit from a sum of 1: the endpoint rounds each to two decimals. */
export const VECTOR_TOLERANCE = 0.01;

/** Whether the probabilities form a vector: each in 0 to 1, summing to 1 within the tolerance. Never normalised. */
export function isVector(probabilities: Readonly<Record<string, number>>): boolean {
  const values = Object.values(probabilities);
  if (values.length === 0 || values.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return false;
  return Math.abs(values.reduce((sum, p) => sum + p, 0) - 1) <= VECTOR_TOLERANCE + 1e-9;
}

/**
 * The opinions of a choice answer: the label with the highest probability, `none` among the options. The
 * probabilities of the options are the opinion's, so a stack can read the margin between the two likeliest.
 * A unit missing an option has no opinion, and so has a unit whose probabilities are no vector (they do not sum
 * to 1): it is refused with the reason, never repaired by normalising, and never guessed.
 */
export function choiceOpinions(answer: Recorded, window: Window, asked: readonly Label[]): Opinions {
  const names = [...asked.map((label) => label.name), 'none'];
  const byUnit = new Map<number, Opinion>();
  const refusals: string[] = [];
  const refusalRecords: PointerDiagnostic[] = [];
  for (const unit of window.units) {
    const probabilities: Record<string, number> = {};
    let best: { label: string; p: number } | undefined;
    for (const name of names) {
      const p = answer.probabilities?.[choiceKey(unit.n, name)];
      if (typeof p !== 'number') break;
      probabilities[name] = p;
      if (!best || p > best.p) best = { label: name, p };
    }
    if (Object.keys(probabilities).length < names.length || !best) continue;
    if (!isVector(probabilities)) {
      const total = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
      const detail = `${window.id}: unit [${unit.n}] has probabilities that are no vector (they sum to ${Number(total.toFixed(4))})`;
      refusals.push(detail);
      refusalRecords.push(
        record('no-vector', detail, {
          window: window.id,
          unit: String(unit.n),
          sum: Number(total.toFixed(4)),
        }),
      );
      continue;
    }
    byUnit.set(unit.index, { label: best.label, probabilities });
  }
  return { byUnit, refusals, refusalRecords };
}

export type JevOptions = HttpOptions & {
  env?: Record<string, string | undefined>;
  /** `window`: one request per window of units. `unit`: one request per unit. */
  state?: 'window' | 'unit';
  /** The most units one request may hold. */
  maxUnits?: number;
  /** Inside a stack: leave the labels that ask for a target to the system 2 labeler. */
  skipTargetLabels?: boolean;
  /** Replay only: no key is read. */
  replayOnly?: boolean;
};

/**
 * A system 1 labeler on the Jev service: `{ model, state, questions }` in, one `choice` answer per unit out.
 * Each question lists the labels of the set and `none` as options, with their definitions; the answer carries
 * a probability for each option. Reads `JEV_API_KEY`, `JEV_URL` or `JEV_ROUTE` (`gateway` or `typesafe`) and
 * `JEV_MODEL` (default `jev-latest`) from the environment. The endpoint reports its usage in tokens.
 */
export function createJevLabeler(options: JevOptions = {}): Labeler {
  const env = options.env ?? process.env;
  const granularity = options.state ?? 'window';
  const id = granularity === 'unit' ? 'jev-unit' : 'jev';
  const units = options.maxUnits ?? DEFAULT_CHOICE_UNITS;
  const skip = options.skipTargetLabels === true;
  const model = env.JEV_MODEL?.trim() || 'jev-latest';
  const labeler: Labeler = {
    id,
    cls: 'system1',
    family: 'jev',
    model,
    settings: { question: 'choice' },
    maxUnits: (_set, wanted) => (granularity === 'unit' ? 1 : Math.max(1, Math.min(wanted, units))),
    render(set, window) {
      const asked = askedLabels(set, skip);
      return {
        labeler: id,
        body: {
          model,
          state: { set: set.set, window: window.id, text: yesNoText(window) },
          questions: choiceQuestions(asked, window),
        },
      };
    },
    opinions: (answer, set, window) => choiceOpinions(answer, window, askedLabels(set, skip)),
  };
  if (options.replayOnly) return labeler;
  const key = env.JEV_API_KEY?.trim();
  if (!key) return labeler;
  const route = env.JEV_ROUTE?.trim();
  const url =
    env.JEV_URL?.trim() ||
    (route === 'gateway'
      ? 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone'
      : route === 'typesafe'
        ? 'https://api.typesafe.ai/v1/systemone'
        : undefined);
  if (!url) return labeler;
  const headers: Record<string, string> =
    route === 'gateway' ? { 'api-key': key } : { authorization: `Bearer ${key}` };
  return {
    ...labeler,
    async call(wire) {
      const payload = await refusingKey(`the system 1 route ${route ?? new URL(url).host}`, () =>
        postJson(url, headers, wire.body, detailErrorText, options),
      );
      const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : undefined;
      if (!answers) throw new ModelError('bad_response', 'jev answered without an answers object');
      const entries: Array<[string, unknown]> = [];
      for (const [name, answer] of Object.entries(answers)) {
        const chances = isRecord(answer) && isRecord(answer.probabilities) ? answer.probabilities : undefined;
        if (!chances) continue;
        for (const [option, p] of Object.entries(chances)) entries.push([`${name}__${option}`, p]);
      }
      return {
        probabilities: probabilitiesOf(entries),
        returnedModel: String(isRecord(payload) && typeof payload.model === 'string' ? payload.model : model),
        stopReason: 'answered',
        usage: usageOf(payload),
      };
    },
  };
}

export type OpenAiDecisionsOptions = YesNoOptions & { model: string };

/** The cap for the OpenAI Decisions API is not measured; this default is conservative. */
export const DEFAULT_DECISIONS_MAX_QUESTIONS = 100;

/**
 * A system 1 labeler on the OpenAI Decisions API, the public example of the class: `POST {base}/v1/decisions`
 * with `{ model, input, questions: [{ type: 'predicate', name, instructions }] }`, answered with
 * `{ answers: [{ name, probability }] }` or `{ name, type: 'refusal' }`. Reads `OPENAI_API_KEY` and
 * `OPENAI_BASE_URL` (default https://api.openai.com). The shapes follow the provider's public description
 * and no live call has confirmed them here yet.
 */
export function createOpenAiDecisionsLabeler(options: OpenAiDecisionsOptions): Labeler {
  const env = options.env ?? process.env;
  const granularity = options.state ?? 'window';
  const cap = options.maxQuestions ?? DEFAULT_DECISIONS_MAX_QUESTIONS;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD[granularity];
  const skip = options.skipTargetLabels === true;
  const model = options.model;
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/+$/, '');
  const labeler: Labeler = {
    id: 'openai-decisions',
    cls: 'system1',
    family: 'openai',
    model,
    settings: { threshold },
    maxUnits: (set, wanted) =>
      granularity === 'unit'
        ? 1
        : Math.max(1, Math.min(wanted, Math.floor(cap / askedLabels(set, skip).length))),
    render(set, window) {
      const asked = askedLabels(set, skip);
      return {
        labeler: 'openai-decisions',
        body: {
          model,
          input: yesNoText(window),
          questions: yesNoQuestions(asked, window).map(([name, instructions]) => ({
            type: 'predicate',
            name,
            instructions,
          })),
        },
      };
    },
    opinions: (answer, set, window) => yesNoOpinions(answer, window, askedLabels(set, skip), threshold),
  };
  if (options.replayOnly) return labeler;
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return labeler;
  return {
    ...labeler,
    async call(wire) {
      const payload = await refusingKey(`the system 1 endpoint ${new URL(base).host}`, () =>
        postJson(`${base}/v1/decisions`, { authorization: `Bearer ${key}` }, wire.body, errorText, options),
      );
      const answers = isRecord(payload) && Array.isArray(payload.answers) ? payload.answers : undefined;
      if (!answers) throw new ModelError('bad_response', `${model} answered without an answers list`);
      return {
        probabilities: probabilitiesOf(
          answers.map((answer): [string, unknown] =>
            isRecord(answer) && typeof answer.name === 'string'
              ? [answer.name, answer.probability]
              : ['', undefined],
          ),
        ),
        returnedModel: model,
        stopReason: 'answered',
        usage: usageOf(payload),
      };
    },
  };
}
