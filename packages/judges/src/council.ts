import type { Vote as VoteSchema } from '@driftbench/core';
import type { z } from 'zod';
import type { JudgeClient } from './client';
import type { Budget, JudgeClass, JudgeOutcome, JudgeRequest } from './contract';
import { normalizeFamily, sameFamily } from './family';

/**
 * The judge council.
 *
 * Each criterion has an assignment: a class and three judges of that class. The verdict is the majority
 * of the three. A split (no outcome with two votes) is logged and judged again by three judges of the
 * other class (hybrid mode). When that splits too, the assigned judges answer once more with the large
 * budget; still no majority means inconclusive, which is never counted as a pass or a fail.
 *
 * A vote whose answer did not parse is asked once more with the large budget. A judge that gives no answer
 * at all (transport, cassette miss) votes inconclusive and the error is counted.
 *
 * Cascade: the cheapest judge runs first, and the council stops there when it passes with a score at or
 * above the threshold. A fail, an inconclusive or an unsure pass brings in the other two.
 *
 * Diversity: a judge from the agent's model family is refused when the council is built, never skipped
 * quietly at run time.
 */

/** One judge's vote, as the core run schema stores it. */
export type Vote = z.infer<typeof VoteSchema>;

export type CouncilMode = 'system1' | 'hybrid' | 'llm';

/** Where an assignment row came from: the spec's judge_class, the mode, a default, or calibration. */
export type AssignmentSource = 'spec' | 'mode' | 'default' | 'calibration';

export type AssignmentRow = {
  readonly criterion: string;
  readonly cls: JudgeClass;
  /** The three judges of the assigned class. */
  readonly judges: readonly string[];
  /** The three judges of the other class that judge a split again. Empty outside hybrid mode. */
  readonly rejudge: readonly string[];
  readonly source: AssignmentSource;
};

export type CouncilConfig = {
  readonly mode: CouncilMode;
  readonly judges: readonly JudgeClient[];
  /** The model family of the agent under test. `none` for an agent that is not a model. */
  readonly agentFamily: string;
  /** Rows that override the default assignment, such as the output of calibration. */
  readonly assignment?: readonly AssignmentRow[];
  /** Cascade from the cheapest judge. `true` uses a threshold of 0.9. */
  readonly cascade?: boolean | { readonly threshold?: number };
};

export type RoundOutcome = JudgeOutcome | 'split';

export type CouncilRound = {
  readonly cls: JudgeClass;
  readonly budget: Budget;
  readonly votes: readonly Vote[];
  readonly outcome: RoundOutcome;
  readonly cascaded: boolean;
};

export type CouncilResult = {
  readonly criterion: string;
  readonly outcome: JudgeOutcome;
  /** The class whose round decided, or the assigned class when nothing decided. */
  readonly cls: JudgeClass;
  /** Every vote of every round, in order. A vote of the large-budget round carries `@large`. */
  readonly votes: readonly Vote[];
  readonly rounds: readonly CouncilRound[];
  /** True when the first round split. */
  readonly split: boolean;
  /** True when the cascade stopped at the cheapest judge. */
  readonly cascaded: boolean;
  /** Judges that gave no answer at all. */
  readonly errors: number;
  /** The mean score of the votes that agree with the outcome, when they carry one. */
  readonly score?: number;
  /** One line per round, for the verdict's evidence. */
  readonly log: readonly string[];
};

/** A council that cannot be built as configured. Thrown before any judge is called. */
export class CouncilConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouncilConfigError';
  }
}

const COUNCIL_SIZE = 3;
const DEFAULT_THRESHOLD = 0.9;

export type Council = {
  readonly mode: CouncilMode;
  readonly agentFamily: string;
  /** The assignment row of a criterion, built from the default when no row was given. */
  assignmentFor(criterion: string, judgeClass?: 'system1' | 'system2' | 'auto'): AssignmentRow;
  /** Judges one request. Never throws on a judge failure: the failure becomes an inconclusive vote. */
  judge(request: JudgeRequest, judgeClass?: 'system1' | 'system2' | 'auto'): Promise<CouncilResult>;
};

export function createCouncil(config: CouncilConfig): Council {
  const byId = validateJudges(config);
  const explicit = new Map<string, AssignmentRow>();
  for (const row of config.assignment ?? []) {
    validateRow(row, config.mode, byId);
    if (explicit.has(row.criterion)) {
      throw new CouncilConfigError(`criterion ${row.criterion} has two assignment rows`);
    }
    explicit.set(row.criterion, row);
  }
  const threshold =
    config.cascade === true
      ? DEFAULT_THRESHOLD
      : config.cascade
        ? (config.cascade.threshold ?? DEFAULT_THRESHOLD)
        : undefined;

  const assignmentFor = (criterion: string, judgeClass?: 'system1' | 'system2' | 'auto'): AssignmentRow => {
    const row = explicit.get(criterion);
    if (row) return row;
    return defaultRow(criterion, judgeClass, config);
  };

  return {
    mode: config.mode,
    agentFamily: config.agentFamily,
    assignmentFor,
    async judge(request, judgeClass) {
      const row = assignmentFor(request.criterion.name, judgeClass);
      const pick = (ids: readonly string[]) => ids.map((id) => byId.get(id) as JudgeClient);
      const rounds: CouncilRound[] = [];
      const counter = { errors: 0 };

      const first = await runRound(request, row.cls, pick(row.judges), 'normal', threshold, counter);
      rounds.push(first);
      let decided: CouncilRound | undefined = first.outcome === 'split' ? undefined : first;
      if (!decided && row.rejudge.length > 0) {
        const other = otherClass(row.cls);
        const second = await runRound(request, other, pick(row.rejudge), 'normal', undefined, counter);
        rounds.push(second);
        if (second.outcome !== 'split') decided = second;
      }
      if (!decided) {
        const last = await runRound(request, row.cls, pick(row.judges), 'large', undefined, counter);
        rounds.push(last);
        if (last.outcome !== 'split') decided = last;
      }

      const outcome: JudgeOutcome = decided ? (decided.outcome as JudgeOutcome) : 'inconclusive';
      const votes = rounds.flatMap((round) => round.votes);
      const agreeing = (decided?.votes ?? []).filter(
        (vote) => vote.outcome === outcome && vote.score !== undefined,
      );
      const score =
        agreeing.length > 0
          ? agreeing.reduce((sum, vote) => sum + (vote.score as number), 0) / agreeing.length
          : undefined;
      return {
        criterion: request.criterion.name,
        outcome,
        cls: decided?.cls ?? row.cls,
        votes,
        rounds,
        split: first.outcome === 'split',
        cascaded: first.cascaded,
        errors: counter.errors,
        ...(score === undefined ? {} : { score }),
        log: rounds.map(describeRound),
      };
    },
  };
}

function otherClass(cls: JudgeClass): JudgeClass {
  return cls === 'system1' ? 'system2' : 'system1';
}

function classesOf(mode: CouncilMode): JudgeClass[] {
  if (mode === 'system1') return ['system1'];
  if (mode === 'llm') return ['system2'];
  return ['system1', 'system2'];
}

function validateJudges(config: CouncilConfig): Map<string, JudgeClient> {
  if (!config.agentFamily.trim()) {
    throw new CouncilConfigError('the agent family is not set: use none for an agent that is not a model');
  }
  const byId = new Map<string, JudgeClient>();
  for (const judge of config.judges) {
    if (byId.has(judge.id)) throw new CouncilConfigError(`two judges are named ${judge.id}`);
    if (sameFamily(judge.family, config.agentFamily)) {
      throw new CouncilConfigError(
        `judge ${judge.id} is from the ${normalizeFamily(judge.family)} family, the family of the agent under test: refused`,
      );
    }
    byId.set(judge.id, judge);
  }
  for (const cls of classesOf(config.mode)) {
    const count = config.judges.filter((judge) => judge.cls === cls).length;
    if (count < COUNCIL_SIZE) {
      throw new CouncilConfigError(`mode ${config.mode} needs ${COUNCIL_SIZE} ${cls} judges, ${count} given`);
    }
  }
  return byId;
}

function validateRow(row: AssignmentRow, mode: CouncilMode, byId: Map<string, JudgeClient>): void {
  const where = `assignment of ${row.criterion}`;
  if (!classesOf(mode).includes(row.cls)) {
    throw new CouncilConfigError(`${where}: class ${row.cls} is not used in mode ${mode}`);
  }
  const check = (ids: readonly string[], cls: JudgeClass, what: string) => {
    if (ids.length !== COUNCIL_SIZE || new Set(ids).size !== COUNCIL_SIZE) {
      throw new CouncilConfigError(`${where}: ${what} needs ${COUNCIL_SIZE} different judges`);
    }
    for (const id of ids) {
      const judge = byId.get(id);
      if (!judge) throw new CouncilConfigError(`${where}: no judge is named ${id}`);
      if (judge.cls !== cls)
        throw new CouncilConfigError(`${where}: ${id} is a ${judge.cls} judge, not ${cls}`);
    }
  };
  check(row.judges, row.cls, 'the assigned class');
  if (mode === 'hybrid') check(row.rejudge, otherClass(row.cls), 'the re-judge');
  else if (row.rejudge.length > 0) {
    throw new CouncilConfigError(`${where}: mode ${mode} has no other class to re-judge a split`);
  }
}

/** The cheapest judges of a class, cost first, then id for a stable order. */
function cheapest(judges: readonly JudgeClient[], cls: JudgeClass): string[] {
  return judges
    .filter((judge) => judge.cls === cls)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .slice(0, COUNCIL_SIZE)
    .map((judge) => judge.id);
}

function defaultRow(
  criterion: string,
  judgeClass: 'system1' | 'system2' | 'auto' | undefined,
  config: CouncilConfig,
): AssignmentRow {
  let cls: JudgeClass;
  let source: AssignmentSource;
  if (config.mode === 'system1' || config.mode === 'llm') {
    cls = config.mode === 'system1' ? 'system1' : 'system2';
    source = judgeClass === cls ? 'spec' : 'mode';
  } else if (judgeClass === 'system1' || judgeClass === 'system2') {
    cls = judgeClass;
    source = 'spec';
  } else {
    // auto or unset: until calibration earns a class, system 1 takes it, as a tie does.
    cls = 'system1';
    source = 'default';
  }
  return {
    criterion,
    cls,
    judges: cheapest(config.judges, cls),
    rejudge: config.mode === 'hybrid' ? cheapest(config.judges, otherClass(cls)) : [],
    source,
  };
}

async function runRound(
  request: JudgeRequest,
  cls: JudgeClass,
  judges: readonly JudgeClient[],
  budget: Budget,
  threshold: number | undefined,
  counter: { errors: number },
): Promise<CouncilRound> {
  const ordered = [...judges].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const votes: Vote[] = [];
  let cascaded = false;
  if (threshold !== undefined) {
    const [cheap, ...rest] = ordered;
    const vote = await castVote(request, cheap as JudgeClient, budget, counter);
    votes.push(vote);
    if (vote.outcome === 'pass' && vote.score !== undefined && vote.score >= threshold) {
      cascaded = true;
    } else {
      votes.push(...(await Promise.all(rest.map((judge) => castVote(request, judge, budget, counter)))));
    }
  } else {
    votes.push(...(await Promise.all(ordered.map((judge) => castVote(request, judge, budget, counter)))));
  }
  const outcome: RoundOutcome = cascaded ? 'pass' : majority(votes);
  return { cls, budget, votes, outcome, cascaded };
}

/** The outcome two of three votes agree on; an inconclusive vote never counts. */
export function majority(votes: readonly Vote[]): RoundOutcome {
  const pass = votes.filter((vote) => vote.outcome === 'pass').length;
  const fail = votes.filter((vote) => vote.outcome === 'fail').length;
  const needed = Math.floor(COUNCIL_SIZE / 2) + 1;
  if (pass >= needed && pass > fail) return 'pass';
  if (fail >= needed && fail > pass) return 'fail';
  return 'split';
}

async function castVote(
  request: JudgeRequest,
  judge: JudgeClient,
  budget: Budget,
  counter: { errors: number },
): Promise<Vote> {
  const name = budget === 'large' ? `${judge.id}@large` : judge.id;
  try {
    let result = await judge.judge({ ...request, budget });
    let note = '';
    if (result.unparsed && budget === 'normal') {
      result = await judge.judge({ ...request, budget: 'large' });
      note = 'unparsed at the normal budget, asked again with the large budget; ';
    }
    const { answer } = result;
    return {
      judge: name,
      outcome: answer.outcome,
      ...(answer.score === undefined ? {} : { score: answer.score }),
      reasoning: `${note}${answer.reasoning}${answer.evidence ? ` (evidence: ${answer.evidence})` : ''}`,
    };
  } catch (cause) {
    counter.errors += 1;
    const why = cause instanceof Error ? cause.message : String(cause);
    return { judge: name, outcome: 'inconclusive', reasoning: `no answer: ${why}` };
  }
}

function describeRound(round: CouncilRound): string {
  const tally = round.votes.map((vote) => `${vote.judge} ${vote.outcome}`).join(', ');
  const head = `${round.cls}${round.budget === 'large' ? ' (large budget)' : ''}`;
  const end = round.cascaded ? 'pass, the cheapest judge was sure' : round.outcome;
  return `${head}: ${tally}; ${end}`;
}
