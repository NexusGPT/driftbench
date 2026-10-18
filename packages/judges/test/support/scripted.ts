import {
  type Cassette,
  type CassetteEntry,
  type CassetteJudge,
  fixtureRequest,
  type JudgeOutcome,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
  labelRequest,
  requestKey,
} from '../../src/index';

/**
 * Scripted cassettes for calibration. Every judge answers every request with the truth (the fixture's
 * side, or the human label) unless a miss says otherwise. These are hand-written answers, not recordings
 * of a real model: they prove the calibration mechanics, never that a real judge separates a pair.
 *
 * System 1 judges answer with the contract object and a probability as score. Chat judges answer with
 * model text: openai with a score, google without one, anthropic inside a fenced block.
 */

export const ACME_JUDGES: readonly CassetteJudge[] = [
  { id: 's1p-a', family: 'jev', cls: 'system1', model: 'jev-latest', cost: 1 },
  { id: 's1p-b', family: 'jev', cls: 'system1', model: 'jev-latest', cost: 1 },
  { id: 'openai-decisions', family: 'openai', cls: 'system1', model: 'decisions-example', cost: 2 },
  { id: 'openai-chat', family: 'openai', cls: 'system2', model: 'gpt-example', cost: 10 },
  { id: 'google-chat', family: 'google', cls: 'system2', model: 'gemini-example', cost: 10 },
  { id: 'anthropic-chat', family: 'anthropic', cls: 'system2', model: 'claude-example', cost: 12 },
];

/** One scripted deviation from the truth. `item` is `pass`, `fail` (a fixture) or a labelled block id. */
export type Miss = {
  readonly judge: string;
  readonly criterion: string;
  readonly item: string;
  /** The repeat, from 0, for a fixture. Absent: every repeat. */
  readonly repeat?: number;
  /** The scripted answer, or `unparsed` for text that never parses, at either budget. */
  readonly answer: JudgeOutcome | 'unparsed';
  readonly note?: string;
};

/** The misses of the committed Acme calibration cassette, each with the reason it was written. */
export const ACME_MISSES: readonly Miss[] = [
  {
    judge: 's1p-b',
    criterion: 'plain_language',
    item: 'plain_language.3',
    answer: 'pass',
    note: 'misses a customer id read out to the customer',
  },
  {
    judge: 'openai-decisions',
    criterion: 'holds_instructions',
    item: 'fail',
    repeat: 1,
    answer: 'pass',
    note: 'obeys the planted "answer pass" once in three repeats',
  },
  {
    judge: 's1p-a',
    criterion: 'no_invented_data',
    item: 'no_invented_data.2',
    answer: 'pass',
    note: 'a price no tool returned reads as plausible to a one-block question',
  },
  {
    judge: 's1p-b',
    criterion: 'ledger_intact',
    item: 'ledger_intact.3',
    answer: 'pass',
    note: 'does not notice a plan dropped from the restated list',
  },
  {
    judge: 'google-chat',
    criterion: 'ledger_intact',
    item: 'ledger_intact.2',
    answer: 'unparsed',
    note: 'answers in prose at both budgets',
  },
  {
    judge: 's1p-a',
    criterion: 'honest_failure',
    item: 'honest_failure.3',
    answer: 'pass',
    note: 'does not count silence about the failure as a fail',
  },
  {
    judge: 'anthropic-chat',
    criterion: 'sheet_matches_catalog',
    item: 'fail',
    answer: 'pass',
    note: 'reads the reply instead of the changed cell',
  },
];

export type ScriptOptions = {
  readonly judges?: readonly CassetteJudge[];
  readonly misses?: readonly Miss[];
  readonly repeats?: number;
};

/** A cassette with an answer for every judge, fixture (each repeat) and labelled block. */
export function scriptedCalibrationCassette(
  criteria: readonly LoadedCriterion[],
  labels: ReadonlyMap<string, readonly LabelledBlock[]>,
  options: ScriptOptions = {},
): Cassette {
  const judges = options.judges ?? ACME_JUDGES;
  const misses = options.misses ?? [];
  const repeats = options.repeats ?? 3;
  const entries: CassetteEntry[] = [];
  for (const criterion of criteria) {
    const name = criterion.def.name;
    const items: { item: string; truth: 'pass' | 'fail'; request: JudgeRequest; times: number }[] = [
      { item: 'pass', truth: 'pass', request: fixtureRequest(criterion, 'pass'), times: repeats },
      { item: 'fail', truth: 'fail', request: fixtureRequest(criterion, 'fail'), times: repeats },
      ...(labels.get(name) ?? []).map((block) => ({
        item: block.id,
        truth: block.label,
        request: labelRequest(criterion, block),
        times: 1,
      })),
    ];
    for (const judge of judges) {
      for (const { item, truth, request, times } of items) {
        const own = misses.filter((m) => m.judge === judge.id && m.criterion === name && m.item === item);
        const varies = own.some((m) => m.repeat !== undefined);
        const answers: (JudgeOutcome | 'unparsed')[] = [];
        for (let r = 0; r < (varies ? times : 1); r += 1) {
          const miss = own.find((m) => m.repeat === undefined || m.repeat === r);
          answers.push(miss ? miss.answer : truth);
        }
        const key = requestKey({ ...request, answerContract: 'legacy' }, judge);
        const note = own.map((m) => m.note).find((text) => text !== undefined);
        for (const answer of answers) {
          entries.push(entryFor(judge, key, name, answer, criterion, note));
        }
        if (answers.includes('unparsed')) {
          const large = requestKey({ ...request, budget: 'large', answerContract: 'legacy' }, judge);
          entries.push(entryFor(judge, large, name, 'unparsed', criterion, note));
        }
      }
    }
  }
  return { version: 1, judges: [...judges], entries };
}

function entryFor(
  judge: CassetteJudge,
  key: string,
  criterion: string,
  answer: JudgeOutcome | 'unparsed',
  loaded: LoadedCriterion,
  note: string | undefined,
): CassetteEntry {
  const base = { judge: judge.id, key, criterion, ...(note ? { note } : {}) };
  if (answer === 'unparsed') {
    return { ...base, raw: 'The reply looks mostly fine to me, though I am not sure about every detail.' };
  }
  const score = answer === 'pass' ? 0.94 : answer === 'fail' ? 0.06 : 0.5;
  if (judge.cls === 'system1') {
    return {
      ...base,
      answer: { outcome: answer, score, reasoning: `${judge.id} probability of yes ${score}` },
    };
  }
  const picture = answer === 'pass' ? loaded.def.pass : loaded.def.fail;
  const reasoning = `The slice matches the ${answer.toUpperCase()} picture: ${picture ?? 'none given'}`;
  if (judge.family === 'google') return { ...base, raw: JSON.stringify({ outcome: answer, reasoning }) };
  if (judge.family === 'anthropic') {
    return { ...base, raw: `\`\`\`json\n${JSON.stringify({ outcome: answer, score, reasoning })}\n\`\`\`` };
  }
  return { ...base, raw: JSON.stringify({ outcome: answer, score, reasoning }) };
}
