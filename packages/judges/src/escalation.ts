import { extractFinalAnswer } from './answer-extraction';
import type { JudgeClient } from './client';
import type {
  ComparisonResult,
  EscalationRecord,
  EscalationTrigger,
  JudgeOutcome,
  JudgeRequest,
  JudgeResult,
} from './contract';
import { CouncilConfigError, createCouncil } from './council';
import { familyOfModel, normalizeFamily } from './family';

export type EscalationConfig = {
  readonly first: JudgeClient;
  readonly then: readonly JudgeClient[];
  readonly agentFamily: string;
  readonly on: readonly EscalationTrigger[];
  /** Minimum probability of the selected verdict. Missing scores count as unknown. Default 0.5. */
  readonly confidence?: number;
  /** Both use then's majority. On a split, first-stands retains the original first answer(s). */
  readonly decide: 'majority' | 'first-stands';
};
const family = (name: string) => familyOfModel(name) ?? normalizeFamily(name);
const invert = (outcome: JudgeOutcome): JudgeOutcome =>
  outcome === 'pass' ? 'fail' : outcome === 'fail' ? 'pass' : outcome;
function normalize(result: JudgeResult): JudgeResult {
  const outcome = result.unparsed
    ? 'inconclusive'
    : result.winner === 'A'
      ? 'pass'
      : result.winner === 'B'
        ? 'fail'
        : result.winner
          ? 'inconclusive'
          : result.answer.outcome;
  return {
    ...result,
    ...(result.unparsed && result.winner ? { winner: 'inconclusive' as const } : {}),
    answer: { ...result.answer, outcome },
  };
}
const winner = (outcome: JudgeOutcome): NonNullable<JudgeResult['winner']> =>
  outcome === 'pass' ? 'A' : outcome === 'fail' ? 'B' : 'inconclusive';
function unknown(result: JudgeResult): boolean {
  return (
    result.unparsed === true ||
    (result.answer.outcome === 'inconclusive' && result.winner !== 'tie') ||
    result.checks?.some((row) => row.met === null) === true ||
    result.rubric?.items.some((row) => row.first === null || row.second === null) === true
  );
}
function lowConfidence(result: JudgeResult, bar: number): boolean {
  const score = result.answer.score;
  if (
    score === undefined ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1 ||
    result.answer.outcome === 'inconclusive'
  )
    return true;
  return (result.answer.outcome === 'pass' ? score : 1 - score) < bar;
}
function referenceDisagrees(result: JudgeResult): boolean {
  const ledger = result.factLedger;
  // A pointwise reply disagrees when a requested fact is wrong or missing; matching rows do not.
  // Pairwise disagreement still requires a wrong or missing fact on each candidate.
  const factsDisagree = ledger
    ? 'unsupported' in ledger
      ? ledger.facts.some((row) => row.status !== 'match')
      : ledger.facts.some((row) => row.a !== 'match') && ledger.facts.some((row) => row.b !== 'match')
    : false;
  return (
    result.referenceDisagreement === true ||
    (result.referenceAgreement !== undefined &&
      result.referenceAgreement.attempts > 0 &&
      !result.referenceAgreement.used) ||
    factsDisagree
  );
}

/** Exact comparison is limited to explicitly marked candidate finals, never inferred from prose. */
function finalsDisagree(request: JudgeRequest): boolean {
  const reference = request.reference ?? request.factAudit?.reference;
  if (!reference || !request.candidates) return false;
  const a = extractFinalAnswer(request.candidates.A)?.text;
  const b = extractFinalAnswer(request.candidates.B)?.text;
  if (a === undefined || b === undefined) return false;
  const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const expected = normalize(extractFinalAnswer(reference)?.text ?? reference);
  return normalize(a) !== expected && normalize(b) !== expected;
}

/** Label-blind uncertainty routing. Voting is delegated to the existing council. */
export function createEscalation(config: EscalationConfig): JudgeClient {
  const confidence = config.confidence ?? 0.5;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new RangeError('confidence must be from 0 to 1');
  if (!config.agentFamily?.trim()) throw new CouncilConfigError('agent family is required');
  if (!['majority', 'first-stands'].includes(config.decide))
    throw new CouncilConfigError('unknown escalation decision');
  const allowed: readonly string[] = [
    'order-split',
    'inconclusive',
    'reference-disagreement',
    'low-confidence',
  ];
  if (config.on.some((signal) => !allowed.includes(signal)))
    throw new CouncilConfigError('unknown escalation trigger');
  const on = [...new Set(config.on)];
  const decide = config.decide;
  const agentFamily = family(config.agentFamily);
  const first = config.first;
  const then = [...config.then];
  if (then.length === 0) throw new CouncilConfigError('escalation needs at least one then judge');
  const all = [first, ...then];
  const families = [...new Set(all.flatMap((j) => [j.family, ...(j.families ?? [])]).map(family))];
  if (families.some((f) => !f)) throw new CouncilConfigError('every judge family is required');
  if (families.includes(family(config.agentFamily)))
    throw new CouncilConfigError('a judge shares the agent family: refused');
  if (new Set(all.map((j) => j.id)).size !== all.length)
    throw new CouncilConfigError('duplicate judge ids in escalation');
  if (families.length < 2) throw new CouncilConfigError('escalation needs a cross-family pool');
  const identity = (j: JudgeClient) => ({
    id: j.id,
    family: family(j.family),
    families: j.families,
    cls: j.cls,
    model: j.model,
    settings: j.settings,
    cost: j.cost,
  });
  const settings = JSON.stringify({
    escalation: 1,
    first: identity(first),
    // biome-ignore lint/suspicious/noThenProperty: then is a non-callable list of judge identities.
    then: then.map(identity),
    agentFamily,
    on,
    confidence,
    decide,
  });

  const run = async (request: JudgeRequest, swapped?: JudgeRequest): Promise<JudgeResult> => {
    const originals: JudgeResult[] = [];
    const answers: { judge: string; result: JudgeResult; error?: string }[] = [];
    let calls = 0;
    let spent = 0;
    let hasCost = false;
    const ask = async (client: JudgeClient, r: JudgeRequest): Promise<JudgeResult> => {
      calls += 1;
      // Transport failures still throw for the first judge. The council handles later-seat failures.
      const result = normalize(await client.judge(r));
      if (result.costUsd !== undefined) {
        spent += result.costUsd;
        hasCost = true;
      }
      return result;
    };
    originals.push(await ask(first, request));
    if (swapped) originals.push(await ask(first, swapped));
    const a = originals[0] as JudgeResult;
    const b = originals[1];
    const consistent = b === undefined || a.answer.outcome === invert(b.answer.outcome);
    const comparison: ComparisonResult | undefined = b
      ? {
          ordered: a.answer.outcome,
          swapped: b.answer.outcome,
          consistent,
          positionBias: a.answer.outcome === b.answer.outcome && a.answer.outcome !== 'inconclusive',
        }
      : undefined;
    const triggers = on.filter((signal) =>
      signal === 'order-split'
        ? b !== undefined && !consistent
        : signal === 'inconclusive'
          ? originals.some(unknown)
          : signal === 'low-confidence'
            ? originals.some((r) => lowConfidence(r, confidence))
            : request.referenceDisagreement === true ||
              swapped?.referenceDisagreement === true ||
              originals.some(referenceDisagrees) ||
              finalsDisagree(request),
    );
    const base: JudgeResult =
      b && !consistent
        ? {
            answer: {
              outcome: 'inconclusive',
              reasoning: 'first judge disagrees across presentation orders',
            },
            winner: 'inconclusive',
            raw: '',
          }
        : a;
    let decided = base;
    let decision: EscalationRecord['decision'] = 'first';
    let finalComparison = comparison;
    if (triggers.length) {
      // One request-local promise per seat. Council retries or split rounds reuse these votes,
      // so an escalation round never spends twice on the same seat.
      const seats: JudgeClient[] = then.map((client) => {
        let promise: Promise<JudgeResult> | undefined;
        return {
          ...client,
          family: family(client.family),
          cls: 'system2',
          judge: () =>
            (promise ??= ask(client, request).then(
              (result) => {
                answers.push({ judge: client.id, result });
                return { ...result, unparsed: false };
              },
              (cause: unknown) => {
                const error = cause instanceof Error ? cause.message : String(cause);
                const result: JudgeResult = {
                  answer: { outcome: 'inconclusive', reasoning: `no answer: ${error}` },
                  winner: 'inconclusive',
                  raw: '',
                };
                answers.push({ judge: client.id, result, error });
                return result;
              },
            )),
        };
      });
      const council = createCouncil({
        mode: 'llm',
        size: seats.length,
        judges: seats,
        agentFamily,
      });
      const vote = await council.judge(request);
      if (vote.outcome === 'inconclusive' && vote.winner !== 'tie' && decide === 'first-stands') {
        decision = 'first-stands';
      } else {
        decision = vote.outcome === 'inconclusive' && vote.winner !== 'tie' ? 'inconclusive' : 'majority';
        decided = {
          answer: {
            outcome: vote.outcome,
            reasoning: vote.log.join('\n'),
            ...(vote.score === undefined ? {} : { score: vote.score }),
          },
          ...(request.candidates ? { winner: vote.winner ?? winner(vote.outcome) } : {}),
          raw: '',
        };
        if (comparison)
          finalComparison = { ...comparison, ordered: vote.outcome, swapped: invert(vote.outcome) };
      }
    }
    const escalation: EscalationRecord = {
      triggers,
      escalated: triggers.length > 0,
      first: originals,
      // biome-ignore lint/suspicious/noThenProperty: then is an audit array, never a Promise method.
      then: then.flatMap((j) => answers.filter((a) => a.judge === j.id)),
      decision,
      calls,
    };
    return {
      ...decided,
      raw: decided.raw || JSON.stringify(decided.answer),
      escalation,
      ...(finalComparison ? { comparison: finalComparison } : {}),
      ...(hasCost ? { costUsd: spent } : {}),
    };
  };
  return {
    id: `escalation:${first.id}`,
    family: family(first.family),
    families,
    cls: first.cls,
    cost: first.cost,
    settings,
    judge: (request) => run(request),
    judgeComparison: (ordered, swapped) => run(ordered, swapped),
  };
}
