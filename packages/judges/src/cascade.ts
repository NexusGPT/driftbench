import {
  agreement,
  calibrationEligible,
  DEFAULT_REPEATS,
  type LabelAgreement,
  type LabelledBlock,
  labelRequest,
  type Separation,
} from './calibration';
import type { JudgeClient } from './client';
import type { EscalationRecord, EscalationTrigger, JudgeOutcome, JudgeRequest } from './contract';
import { fixtureRequest, type LoadedCriterion } from './criteria';
import { familyOfModel, normalizeFamily } from './family';

/**
 * Cascade calibration: the cheap judge answers every fixture (each repeat) and every labelled block; the
 * other judges answer only the items where it is unsure (inconclusive, or a score between 0.2 and 0.8) or
 * where it disagrees with the truth (the fixture's side, or the human label). An escalated item takes the
 * majority of every judge that answered it, two agreeing votes needed, else inconclusive.
 *
 * Escalating on disagreement uses the label, which a run does not have: it measures whether the costly
 * judges fix the cheap judge's errors, at the cost of those items only. The report also gives the
 * `unsureOnly` variant, computed from the same answers, which escalates only what a run could: the unsure
 * items. Its numbers are the ones a deployed cascade would reach.
 */

export type CascadeConfig = {
  readonly first: JudgeClient;
  readonly escalateTo: readonly JudgeClient[];
  readonly criteria: readonly LoadedCriterion[];
  readonly labels: ReadonlyMap<string, readonly LabelledBlock[]>;
  readonly repeats?: number;
  /** A score inside this range is unsure. Default 0.2 to 0.8. */
  readonly unsure?: { readonly low: number; readonly high: number };
  /**
   * The model family of the agent under test, or a model name. A judge of that family is refused before any
   * call, as the council refuses it. Default none.
   */
  readonly agentFamily?: string;
};

export type DeployableCascadeConfig = Pick<
  CascadeConfig,
  'criteria' | 'labels' | 'repeats' | 'agentFamily'
> & {
  /** A deployable procedure. Its routing sees only JudgeRequest, never labels or fixture sides. */
  readonly judge: JudgeClient;
};

type Why = 'unsure' | 'disagrees' | EscalationTrigger;

export type CascadeVariant = {
  readonly separation: Separation;
  readonly labels: LabelAgreement;
  readonly spentUsd: number;
};

export type CascadeCriterion = CascadeVariant & {
  readonly criterion: string;
  /** The items the other judges answered: `pass#1` for the pass fixture's first repeat, or a block id. */
  readonly escalated: readonly { readonly item: string; readonly why: Why }[];
  readonly unsureOnly: CascadeVariant;
  /** Calls that gave no answer at all. */
  readonly errors: number;
  /** Calls whose cost is unknown. Present only when above 0: this criterion's spentUsd are lower bounds. */
  readonly costIncompleteCalls?: number;
};

export type CascadeReport = {
  readonly first: string;
  readonly escalateTo: readonly string[];
  readonly repeats: number;
  readonly criteria: readonly CascadeCriterion[];
  readonly spentUsd: number;
  /** Calls whose cost is unknown. Present only when above 0: every spentUsd is then a lower bound. */
  readonly costIncompleteCalls?: number;
};

type Answered = {
  escalation?: EscalationRecord;
  outcome: JudgeOutcome;
  score?: number;
  costUsd: number;
  /** Calls of this answer whose cost is unknown. */
  unpriced: number;
  error: boolean;
};

/** True for a judge result or a thrown judge failure whose cost is unknown in part or in whole. */
const unpriced = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'costIncomplete' in value && value.costIncomplete === true;

async function ask(judge: JudgeClient, request: JudgeRequest): Promise<Answered> {
  let costUsd = 0;
  let unknown = 0;
  try {
    let result = await judge.judge({ ...request, budget: 'normal' });
    costUsd += result.costUsd ?? 0;
    if (unpriced(result)) unknown += 1;
    if (result.unparsed) {
      result = await judge.judge({ ...request, budget: 'large' });
      costUsd += result.costUsd ?? 0;
      if (unpriced(result)) unknown += 1;
    }
    if (result.unparsed) return { outcome: 'inconclusive', costUsd, unpriced: unknown, error: false };
    return {
      outcome: result.answer.outcome,
      ...(result.escalation ? { escalation: result.escalation } : {}),
      ...(result.answer.score === undefined ? {} : { score: result.answer.score }),
      costUsd,
      unpriced: unknown,
      error: false,
    };
  } catch (cause) {
    return { outcome: 'inconclusive', costUsd, unpriced: unknown + (unpriced(cause) ? 1 : 0), error: true };
  }
}

function majority(outcomes: readonly JudgeOutcome[]): JudgeOutcome {
  const pass = outcomes.filter((o) => o === 'pass').length;
  const fail = outcomes.filter((o) => o === 'fail').length;
  if (pass >= 2 && pass > fail) return 'pass';
  if (fail >= 2 && fail > pass) return 'fail';
  return 'inconclusive';
}

type Item = {
  id: string;
  truth: 'pass' | 'fail';
  request: JudgeRequest;
  fixture?: { side: 'pass' | 'fail'; repeat: number };
};

export async function calibrateCascade(
  config: CascadeConfig | DeployableCascadeConfig,
): Promise<CascadeReport> {
  const deployable = 'judge' in config;
  const first = deployable ? config.judge : config.first;
  const escalateTo = deployable ? [] : config.escalateTo;
  refuseAgentFamily([first, ...escalateTo], config.agentFamily ?? 'none');
  const repeats = config.repeats ?? DEFAULT_REPEATS;
  const low = !deployable ? (config.unsure?.low ?? 0.2) : 0.2;
  const high = !deployable ? (config.unsure?.high ?? 0.8) : 0.8;
  const criteria: CascadeCriterion[] = [];
  for (const criterion of config.criteria) {
    const items: Item[] = [];
    for (let r = 0; r < repeats; r += 1) {
      for (const side of ['pass', 'fail'] as const) {
        items.push({
          id: `${side}#${r + 1}`,
          truth: side,
          request: fixtureRequest(criterion, side),
          fixture: { side, repeat: r },
        });
      }
    }
    const blocks = (config.labels.get(criterion.def.name) ?? []).filter(calibrationEligible);
    for (const block of blocks)
      items.push({ id: block.id, truth: block.label, request: labelRequest(criterion, block) });

    let errors = 0;
    let unknownCost = 0;
    let firstCost = 0;
    const full: JudgeOutcome[] = [];
    const lean: JudgeOutcome[] = [];
    const escalated: { item: string; why: Why }[] = [];
    let thenCost = 0;
    let thenCostUnsure = 0;
    for (const item of items) {
      const a = await ask(first, item.request);
      firstCost += a.costUsd;
      unknownCost += a.unpriced;
      if (a.error) errors += 1;
      if (deployable) {
        full.push(a.outcome);
        lean.push(a.outcome);
        for (const why of a.escalation?.triggers ?? []) escalated.push({ item: item.id, why });
        continue;
      }
      const unsure =
        a.outcome === 'inconclusive' || (a.score !== undefined && a.score > low && a.score < high);
      const why: Why | undefined = unsure ? 'unsure' : a.outcome !== item.truth ? 'disagrees' : undefined;
      if (why === undefined) {
        full.push(a.outcome);
        lean.push(a.outcome);
        continue;
      }
      escalated.push({ item: item.id, why });
      const votes = [a.outcome];
      let cost = 0;
      for (const judge of escalateTo) {
        const b = await ask(judge, item.request);
        cost += b.costUsd;
        unknownCost += b.unpriced;
        if (b.error) errors += 1;
        votes.push(b.outcome);
      }
      const verdict = majority(votes);
      thenCost += cost;
      full.push(verdict);
      if (why === 'unsure') {
        thenCostUnsure += cost;
        lean.push(verdict);
      } else lean.push(a.outcome);
    }
    const variant = (verdicts: JudgeOutcome[], spent: number): CascadeVariant => {
      const side = (which: 'pass' | 'fail') =>
        items
          .map((item, index) => ({ item, verdict: verdicts[index] as JudgeOutcome }))
          .filter((x) => x.item.fixture?.side === which)
          .map((x) => x.verdict);
      const pass = side('pass');
      const fail = side('fail');
      const separated = pass.filter((outcome, r) => outcome === 'pass' && fail[r] === 'fail').length;
      const labelled = items
        .map((item, index) => ({ item, verdict: verdicts[index] as JudgeOutcome }))
        .filter((x) => !x.item.fixture);
      return {
        separation: { pass, fail, separated, repeats },
        labels: agreement(
          labelled.map((x) => x.item.id),
          labelled.map((x) => x.item.truth),
          labelled.map((x) => x.verdict),
        ),
        spentUsd: firstCost + spent,
      };
    };
    criteria.push({
      criterion: criterion.def.name,
      ...variant(full, thenCost),
      escalated,
      unsureOnly: variant(lean, thenCostUnsure),
      errors,
      ...(unknownCost > 0 ? { costIncompleteCalls: unknownCost } : {}),
    });
  }
  return {
    first: first.id,
    escalateTo: escalateTo.map((judge) => judge.id),
    repeats,
    criteria,
    spentUsd: criteria.reduce((sum, c) => sum + c.spentUsd, 0),
    ...(criteria.some((c) => c.costIncompleteCalls)
      ? { costIncompleteCalls: criteria.reduce((sum, c) => sum + (c.costIncompleteCalls ?? 0), 0) }
      : {}),
  };
}

/** Throws when a judge shares the agent's model family: a model grading its own family is the bias to avoid. */
function refuseAgentFamily(judges: readonly JudgeClient[], agentFamily: string): void {
  const canonical = (family: string) => familyOfModel(family) ?? normalizeFamily(family);
  const agent = canonical(agentFamily);
  if (agent === 'none') return;
  for (const judge of judges) {
    const conflict = [judge.family, ...(judge.families ?? [])].find((family) => canonical(family) === agent);
    if (conflict !== undefined) {
      throw new Error(
        `judge ${judge.id} is from the ${agent} family, the family of the agent under test: refused`,
      );
    }
  }
}
