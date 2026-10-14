import { type Check, parseCriterionRef, type Verdict } from '@agent-nexus/driftbench-core';
import { taskArtifactText } from './artifacts';
import { JUDGE_CHECK, readInputs, requestFor, safeId } from './check';
import type { JudgeClient } from './client';
import { criterionJudge } from './criterion-settings';

/**
 * One judge for the judged criteria of a run, when a council cannot be formed: an estate run on a
 * signed-in `claude` command has one judge, of the agent's own family. Each criterion a block names is
 * asked of that judge; an incomplete criterion ledger is re-asked once. The verdict says it came from a single judge, so a reader never takes it for a
 * council's. A judge error, an unparsed answer or an undefined criterion is inconclusive, never a pass.
 *
 * `noJudgeCheck` is the check of a run with no judge configured: every criterion a block names gets an
 * inconclusive verdict that gates as the criterion does, so a block whose Then hangs on a judge cannot pass
 * by the judge's absence.
 */

export type SingleJudgeOptions = {
  /** Called with the cost of every judge call that reports one, in US dollars. */
  onCost?: (usd: number) => void;
};

export function singleJudgeCheck(client: JudgeClient, options: SingleJudgeOptions = {}): Check {
  return {
    name: JUDGE_CHECK,
    applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,
    async evaluate(ctx) {
      const artifact = await taskArtifactText(ctx);
      const verdicts: Verdict[] = [];
      for (const ref of ctx.expect.criteria ?? []) {
        const parsed = parseCriterionRef(ref);
        const name = parsed?.name ?? ref;
        const def = ctx.spec.criteria?.find((criterion) => criterion.name === name);
        const gating = (parsed?.gating ?? false) || def?.gating === true;
        const base = { id: `${JUDGE_CHECK}.${safeId(name)}`, kind: 'judge' as const, name, gating };
        if (!def) {
          verdicts.push({
            ...base,
            outcome: 'inconclusive',
            evidence: `criterion ${name} is not defined in the spec: nothing to judge`,
          });
          continue;
        }
        const request = {
          ...requestFor(ctx, def, artifact),
          ...(def.inputs && def.inputs.length > 0 ? { inputs: await readInputs(ctx, def.inputs) } : {}),
        };
        const judge = criterionJudge(client, def);
        try {
          let result = await judge.judge(request);
          let spent = result.costUsd;
          if (result.costUsd !== undefined) options.onCost?.(result.costUsd);
          if (
            request.answerContract !== 'legacy' &&
            client.cls === 'system2' &&
            result.unparsed &&
            (result.answer.reasoning.startsWith('invalid criterion ledger:') ||
              result.answer.reasoning.startsWith('answer breaks the assessment contract:'))
          ) {
            result = await judge.judge({ ...request, budget: 'large' });
            if (result.costUsd !== undefined) {
              options.onCost?.(result.costUsd);
              spent = (spent ?? 0) + result.costUsd;
            }
          }
          const answer = result.answer;
          const outcome = result.unparsed ? 'inconclusive' : answer.outcome;
          verdicts.push({
            ...base,
            outcome,
            ...(answer.score === undefined ? {} : { score: answer.score }),
            evidence: `single judge ${client.id}${spent === undefined ? '' : `, ${spent.toFixed(4)} USD`}${result.unparsed ? ': unparsed answer' : ''}`,
            reasoning: answer.reasoning,
            judge: {
              cls: client.cls,
              votes: [
                {
                  judge: client.id,
                  outcome,
                  ...(answer.score === undefined ? {} : { score: answer.score }),
                  reasoning: answer.reasoning,
                },
              ],
            },
          });
        } catch (cause) {
          verdicts.push({
            ...base,
            outcome: 'inconclusive',
            evidence: `single judge ${client.id} gave no answer: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return verdicts;
    },
  };
}

export function noJudgeCheck(): Check {
  return {
    name: JUDGE_CHECK,
    applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,
    evaluate(ctx) {
      return (ctx.expect.criteria ?? []).map((ref): Verdict => {
        const parsed = parseCriterionRef(ref);
        const name = parsed?.name ?? ref;
        const def = ctx.spec.criteria?.find((criterion) => criterion.name === name);
        return {
          id: `${JUDGE_CHECK}.${safeId(name)}`,
          kind: 'judge',
          name,
          gating: (parsed?.gating ?? false) || def?.gating === true,
          outcome: 'inconclusive',
          evidence: 'no judge is configured for this run: pass --judge claude:<model> to judge it',
        };
      });
    },
  };
}
