import type { CriterionDef } from '@agent-nexus/driftbench-core';
import type { Assessment } from './assessment';
import type { JudgeClient } from './client';
import type { JudgeOutcome, JudgeRequest, JudgeResult } from './contract';
import { judgeRepeated } from './council';
import { judgeTurns } from './turns';

/**
 * The judge settings a criterion carries in a spec or a criteria file, as request fields. A criterion
 * without any of them leaves the request as it is, byte for byte, so recorded answers keep replaying.
 *
 * - `prompt_version`, `decoder_version`, `answer_contract`: the criterion ledger's prompt, decoder and contract.
 * - `assessment` (with `reference` and `grounding`): an assessment kind in place of the criterion ledger.
 * - `items` and `threshold`: a rubric scored item by item; `requirements`: the ledger split by requirement.
 *
 * The response-relevance, conformance and answer-audit kinds read the transcript only, so the Given summary a
 * run adds is left out for them. Conformance also judges the whole supplied slice on its rubric alone, so the
 * default block scope is left out for it (the spec schema refuses pictures and an explicit block scope there).
 * Response relevance and conformance take no artifact field either: a task block's produced file text joins the
 * end of their transcript as a context entry.
 */
export function withCriterionSettings(request: JudgeRequest, def: CriterionDef): JudgeRequest {
  const assessment = assessmentOf(def);
  if (
    def.intent === undefined &&
    def.prompt_version === undefined &&
    def.decoder_version === undefined &&
    def.answer_contract === undefined &&
    def.requirements === undefined &&
    assessment === undefined
  )
    return request;
  const transcriptOnly =
    assessment?.kind === 'response-relevance' ||
    assessment?.kind === 'conformance' ||
    assessment?.kind === 'answer-audit';
  // Response relevance and conformance take no artifact field: a produced file joins the transcript as data.
  const foldArtifact =
    (assessment?.kind === 'response-relevance' || assessment?.kind === 'conformance') &&
    request.artifact !== undefined;
  const { given: _given, ...withoutGiven } = request;
  const { artifact: _artifact, ...withoutArtifact } = withoutGiven;
  const rest = foldArtifact
    ? {
        ...withoutArtifact,
        transcript: [
          ...request.transcript,
          { role: 'context' as const, text: `Produced file text:\n${request.artifact}` },
        ],
      }
    : withoutGiven;
  // Conformance reads the rubric alone over the whole supplied slice: the default block scope is left out.
  const criterion =
    assessment?.kind === 'conformance' && request.criterion.scope === 'block'
      ? (({ scope: _scope, ...text }) => text)(request.criterion)
      : request.criterion;
  return {
    ...(transcriptOnly ? rest : request),
    criterion: def.intent === undefined ? criterion : { ...criterion, intent: def.intent },
    ...(def.answer_contract === undefined ? {} : { answerContract: def.answer_contract }),
    ...(def.prompt_version === undefined ? {} : { criterionPromptVersion: def.prompt_version }),
    ...(def.decoder_version === undefined ? {} : { criterionDecoderVersion: def.decoder_version }),
    ...(def.requirements === undefined ? {} : { requirements: def.requirements }),
    ...(assessment === undefined ? {} : { assessment }),
    ...((def.assessment === 'fact-ledger' || def.assessment === 'answer-audit') && def.reference !== undefined
      ? { reference: def.reference }
      : {}),
  };
}

function assessmentOf(def: CriterionDef): Assessment | undefined {
  if (def.items !== undefined)
    return {
      kind: 'rubric',
      items: def.items,
      ...(def.threshold === undefined ? {} : { threshold: def.threshold }),
    };
  switch (def.assessment) {
    case undefined:
      return undefined;
    case 'conformance':
      return { kind: 'conformance', reference: def.reference ?? '' };
    case 'fact-ledger':
      return { kind: 'fact-ledger', ...(def.grounding === undefined ? {} : { grounding: def.grounding }) };
    default:
      return { kind: def.assessment };
  }
}

/**
 * The client a criterion is judged with: the client itself, unless the criterion asks for `repeat` (the same
 * request k times; the outcome holds only when all k agree and are decisive, else inconclusive) or `per_turn`
 * (one call per customer turn on the prefix of that turn; a failing turn fails). Costs add up over the calls.
 */
export function criterionJudge(client: JudgeClient, def: CriterionDef): JudgeClient {
  const repeat = def.repeat;
  const perTurn = def.per_turn === true;
  if (repeat === undefined && !perTurn) return client;
  return {
    id: client.id,
    family: client.family,
    ...(client.families ? { families: client.families } : {}),
    cls: client.cls,
    ...(client.model ? { model: client.model } : {}),
    cost: client.cost,
    ...(client.settings === undefined ? {} : { settings: client.settings }),
    async judge(request: JudgeRequest): Promise<JudgeResult> {
      const results: JudgeResult[] = [];
      const counting: JudgeClient = {
        ...client,
        judge: async (inner) => {
          const result = await client.judge(inner);
          results.push(result);
          return result;
        },
      };
      let outcome: JudgeOutcome;
      let reasoning: string;
      if (perTurn) {
        const turns = await judgeTurns(counting, request);
        outcome = turns.outcome;
        reasoning = `per turn: ${turns.turns.map((t) => `turn ${t.turn} ${t.outcome}`).join(', ')}${
          turns.firstFailing === undefined ? '' : `; first failing turn ${turns.firstFailing}`
        }`;
      } else {
        const repeated = await judgeRepeated(counting, request, repeat ?? 1);
        outcome = repeated.consistent ? (repeated.outcomes[0] as JudgeOutcome) : 'inconclusive';
        reasoning = `repeated ${repeated.outcomes.length} times: ${repeated.outcomes.join(', ')}${
          repeated.consistent ? '' : '; the answers disagree'
        }`;
      }
      const decisive = results.find((result) => !result.unparsed && result.answer.outcome === outcome);
      const costs = results.flatMap((result) => (result.costUsd === undefined ? [] : [result.costUsd]));
      return {
        answer: {
          outcome,
          reasoning: decisive ? `${reasoning}. ${decisive.answer.reasoning}` : reasoning,
          ...(decisive?.answer.evidence === undefined ? {} : { evidence: decisive.answer.evidence }),
        },
        raw: JSON.stringify(results.map((result) => result.raw)),
        ...(results.length > 0 && results.every((result) => result.unparsed) ? { unparsed: true } : {}),
        ...(costs.length === 0 ? {} : { costUsd: costs.reduce((sum, usd) => sum + usd, 0) }),
      };
    },
  };
}

/**
 * One client for a set of criteria: each request is judged as its criterion asks (`repeat`, `per_turn`), found
 * by the criterion name. A client whose criteria ask for neither comes back as it is.
 */
export function criteriaJudge(client: JudgeClient, defs: readonly CriterionDef[]): JudgeClient {
  const byName = new Map<string, JudgeClient>();
  for (const def of defs) {
    const judge = criterionJudge(client, def);
    if (judge !== client) byName.set(def.name, judge);
  }
  if (byName.size === 0) return client;
  return {
    ...client,
    judge: (request) => (byName.get(request.criterion.name) ?? client).judge(request),
  };
}
