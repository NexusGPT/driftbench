import { createHash } from 'node:crypto';
import { type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { DEFAULT_DECIDE, type DecideOptions, type Decision, decide } from './decide';
import type { ConversationReader, ReaderAnswer, ReaderQuestion, YesNoQuestion } from './reader';

/**
 * Turns the condition spans of an estate into variables of a store. A condition span is a clause of the
 * agent's own files that says when a situation applies. Each span goes through two systems, in this order:
 *
 *  1. System 1 (a reader) answers one yes or no question per known candidate: "does this clause say when
 *     <variable>: <value> applies?". A yes attaches the span, as a quote, to that value. A span with a yes
 *     calls nobody else.
 *  2. System 2 (a proposer) is called only for a span that no candidate took: every answer was a decided no.
 *     It proposes a value (and a variable, when none fits). The proposal is checked by code: the id forms,
 *     the clash with a value that exists, and the store as a whole.
 *
 * Every value that comes out stands on a quote, and code checks the quote is in the file. Code reads no word
 * of a clause: the questions are built from the titles of the store, and the clause is the text the reader
 * sees.
 */

/** The longest quote a store entry holds (the schema's limit). */
const MAX_QUOTE = 1000;

/** A clause of an estate file that says when a situation applies. */
export type ConditionSpan = {
  /** A stable id of the span, such as the ledger id of its unit. Reports name spans by it. */
  id: string;
  /** The file, relative to the folder of the store file. */
  path: string;
  /** The clause, copied word for word from the file. */
  quote: string;
  /** The ledger id of the prose unit the quote belongs to. */
  ledger?: string;
};

/** What a system 2 proposer returns for a span no candidate took. */
export type ConditionProposal = {
  variable: { id: string; title: string };
  value: { id: string; title: string };
};

export interface ConditionProposer {
  readonly id: string;
  /** Proposes one value for a clause, or `undefined` when it sees no condition in it. Must not throw on a clause it cannot read. */
  propose(clause: string, store: VariableStore): Promise<ConditionProposal | undefined>;
}

export type ConditionOutcome = {
  span: string;
  status: 'matched' | 'proposed' | 'unsure' | 'unmatched' | 'refused' | 'failed';
  /** `variable/value` of every value the span now stands under. */
  values: string[];
  reason?: string;
};

export type ConditionsReport = {
  agent: string;
  reader: { id: string; family: string; model?: string };
  proposer?: string;
  thresholds: Required<DecideOptions>;
  spans: number;
  matched: number;
  proposed: number;
  unsure: number;
  unmatched: number;
  refused: number;
  failed: number;
  /** How many spans called the proposer. A span with a yes never does. */
  proposerCalls: number;
  outcomes: ConditionOutcome[];
};

export type FeedConditionsInput = {
  store: VariableStore;
  spans: readonly ConditionSpan[];
  /** The text of every file the spans name, by path. A quote must be in its file. */
  texts: ReadonlyMap<string, string>;
  reader: ConversationReader;
  /** Without a proposer, a span no candidate took is reported `unmatched` and the store keeps no new value. */
  proposer?: ConditionProposer;
  options?: {
    /** The variables whose values are candidates, by id. Default: every variable. */
    variables?: readonly string[];
    decide?: Pick<DecideOptions, 'yesAt' | 'noAt'>;
  };
};

export type FeedConditionsResult = { store: VariableStore; report: ConditionsReport };

type Variable = VariableStore['variables'][number];
type Value = Variable['values'][number];

const pair = (variable: Variable, value: Value) => `${variable.id}/${value.id}`;

function questionFor(variable: Variable, value: Value): YesNoQuestion {
  return {
    name: pair(variable, value),
    kind: 'yesno',
    text: `Does this text say when this applies: ${variable.title}: ${value.title}? Answer for the text itself.`,
    yes: 'yes',
    no: 'no',
  };
}

/** The reason a span cannot be a quote, or `undefined` when it can. */
function refusal(span: ConditionSpan, texts: ReadonlyMap<string, string>): string | undefined {
  if (span.quote.trim() === '') return 'the quote is empty';
  if (span.quote.length > MAX_QUOTE) {
    return `the quote is longer than ${MAX_QUOTE} characters`;
  }
  const text = texts.get(span.path);
  if (text === undefined) return `the file ${span.path} was not given`;
  if (!text.includes(span.quote)) return `the quote is not in ${span.path}`;
  return undefined;
}

function quoteOf(span: ConditionSpan) {
  return {
    kind: 'quote' as const,
    path: span.path,
    quote: span.quote,
    ...(span.ledger !== undefined ? { ledger: span.ledger } : {}),
  };
}

function attach(value: Value, span: ConditionSpan): void {
  const held = value.provenance ?? [];
  if (held.some((p) => p.kind === 'quote' && p.path === span.path && p.quote === span.quote)) return;
  value.provenance = [...held, quoteOf(span)];
}

export async function feedFromConditions(input: FeedConditionsInput): Promise<FeedConditionsResult> {
  const { spans, texts, reader, proposer } = input;
  const thresholds = { ...DEFAULT_DECIDE, ...input.options?.decide };
  const only = input.options?.variables === undefined ? undefined : new Set(input.options.variables);
  if (only !== undefined) {
    for (const id of only) {
      if (!input.store.variables.some((variable) => variable.id === id)) {
        throw new RangeError(`the store has no variable ${id}`);
      }
    }
  }
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.id)) throw new RangeError(`two spans have the id ${span.id}`);
    seen.add(span.id);
  }

  let store = structuredClone(input.store);
  const outcomes: ConditionOutcome[] = [];
  let proposerCalls = 0;

  for (const span of spans) {
    const why = refusal(span, texts);
    if (why !== undefined) {
      outcomes.push({ span: span.id, status: 'refused', values: [], reason: why });
      continue;
    }
    const candidates = store.variables.filter((variable) => only === undefined || only.has(variable.id));
    const asked: Array<{ variable: Variable; value: Value; question: YesNoQuestion }> = [];
    for (const variable of candidates) {
      for (const value of variable.values)
        asked.push({ variable, value, question: questionFor(variable, value) });
    }

    let decisions: Decision[] = [];
    if (asked.length > 0) {
      let answers: Readonly<Record<string, ReaderAnswer | undefined>>;
      try {
        answers = await reader.read(
          span.quote,
          asked.map((a) => a.question as ReaderQuestion),
        );
      } catch (error) {
        outcomes.push({
          span: span.id,
          status: 'failed',
          values: [],
          reason: error instanceof Error ? error.message.slice(0, 200) : 'the reader failed',
        });
        continue;
      }
      decisions = asked.map((a) => decide(a.question, answers[a.question.name], thresholds));
    }

    const taken = asked.filter((_, i) => {
      const d = decisions[i];
      return d?.kind === 'value' && d.value === 'yes';
    });
    if (taken.length > 0) {
      for (const hit of taken) attach(hit.value, span);
      outcomes.push({
        span: span.id,
        status: 'matched',
        values: taken.map((t) => pair(t.variable, t.value)),
      });
      continue;
    }
    // A candidate the reader could not settle might still be the right one: do not propose over it.
    if (decisions.some((d) => d.kind !== 'value')) {
      outcomes.push({
        span: span.id,
        status: 'unsure',
        values: [],
        reason: 'the reader did not settle every candidate',
      });
      continue;
    }
    if (proposer === undefined) {
      outcomes.push({ span: span.id, status: 'unmatched', values: [] });
      continue;
    }
    proposerCalls++;
    let proposal: ConditionProposal | undefined;
    try {
      proposal = await proposer.propose(span.quote, store);
    } catch (error) {
      outcomes.push({
        span: span.id,
        status: 'failed',
        values: [],
        reason: error instanceof Error ? error.message.slice(0, 200) : 'the proposer failed',
      });
      continue;
    }
    if (proposal === undefined) {
      outcomes.push({ span: span.id, status: 'unmatched', values: [] });
      continue;
    }
    const next = structuredClone(store);
    const existing = next.variables.find((variable) => variable.id === proposal.variable.id);
    const value: Value = {
      id: proposal.value.id,
      title: proposal.value.title,
      approved: false,
      produced_by: 'model',
      provenance: [quoteOf(span)],
    };
    if (existing !== undefined) {
      if (existing.values.some((v) => v.id === value.id)) {
        outcomes.push({
          span: span.id,
          status: 'refused',
          values: [],
          reason: `the proposal names ${proposal.variable.id}/${value.id}, which exists and was not taken`,
        });
        continue;
      }
      existing.values.push(value);
    } else {
      next.variables.push({
        id: proposal.variable.id,
        title: proposal.variable.title,
        kind: 'data',
        role: 'detail',
        approved: false,
        produced_by: 'model',
        values: [value],
      });
    }
    const checked = validateVariableStore(next);
    if (!checked.ok) {
      outcomes.push({
        span: span.id,
        status: 'refused',
        values: [],
        reason: `the proposal makes an invalid store: ${checked.errors[0]?.message ?? 'unknown problem'}`,
      });
      continue;
    }
    store = checked.store;
    outcomes.push({ span: span.id, status: 'proposed', values: [`${proposal.variable.id}/${value.id}`] });
  }

  const count = (status: ConditionOutcome['status']) => outcomes.filter((o) => o.status === status).length;
  return {
    store,
    report: {
      agent: store.agent,
      reader: {
        id: reader.id,
        family: reader.family,
        ...(reader.model !== undefined ? { model: reader.model } : {}),
      },
      ...(proposer !== undefined ? { proposer: proposer.id } : {}),
      thresholds,
      spans: spans.length,
      matched: count('matched'),
      proposed: count('proposed'),
      unsure: count('unsure'),
      unmatched: count('unmatched'),
      refused: count('refused'),
      failed: count('failed'),
      proposerCalls,
      outcomes,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Record and replay. A recording holds the answers of the two systems, keyed by a hash of the clause (and the
// question names for a read). A replay answers from it with no model and no network; a call with no recorded
// answer throws, so a drifted question is a failed run, never a silent gap.

export type ConditionsRecording = {
  version: 1;
  reads: Record<string, Record<string, ReaderAnswer | null>>;
  proposals: Record<string, ConditionProposal | null>;
};

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const readKey = (clause: string, questions: readonly ReaderQuestion[]) =>
  sha(`${clause}\n${questions.map((q) => `${q.name}\t${q.text}`).join('\n')}`);

export function emptyRecording(): ConditionsRecording {
  return { version: 1, reads: {}, proposals: {} };
}

/** Wraps a reader and a proposer so each answer lands in `recording`. */
export function recordConditions(
  recording: ConditionsRecording,
  reader: ConversationReader,
  proposer?: ConditionProposer,
): { reader: ConversationReader; proposer?: ConditionProposer } {
  const recordingReader: ConversationReader = {
    id: reader.id,
    family: reader.family,
    ...(reader.model !== undefined ? { model: reader.model } : {}),
    async read(clause, questions) {
      const answers = await reader.read(clause, questions);
      recording.reads[readKey(clause, questions)] = Object.fromEntries(
        questions.map((q) => [q.name, answers[q.name] ?? null]),
      );
      return answers;
    },
  };
  if (proposer === undefined) return { reader: recordingReader };
  return {
    reader: recordingReader,
    proposer: {
      id: proposer.id,
      async propose(clause, store) {
        const proposal = await proposer.propose(clause, store);
        recording.proposals[sha(clause)] = proposal ?? null;
        return proposal;
      },
    },
  };
}

/** Answers from a recording. A read or a proposal the recording lacks throws. */
export function replayConditions(recording: ConditionsRecording): {
  reader: ConversationReader;
  proposer: ConditionProposer;
} {
  return {
    reader: {
      id: 'replay',
      family: 'replay',
      async read(clause, questions) {
        const row = recording.reads[readKey(clause, questions)];
        if (row === undefined)
          throw new Error('the recording has no read for this clause and these questions');
        return Object.fromEntries(questions.map((q) => [q.name, row[q.name] ?? undefined])) as Record<
          string,
          ReaderAnswer | undefined
        >;
      },
    },
    proposer: {
      id: 'replay',
      async propose(clause) {
        const key = sha(clause);
        if (!(key in recording.proposals)) throw new Error('the recording has no proposal for this clause');
        return recording.proposals[key] ?? undefined;
      },
    },
  };
}
