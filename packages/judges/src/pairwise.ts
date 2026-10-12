import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { JudgeClient } from './client';
import { CriterionText, type JudgeOutcome, type JudgeRequest, type TranscriptEntry } from './contract';

/**
 * Pairwise judging: two candidate replies to the same block, one criterion, one question: which reply
 * satisfies the criterion better. It runs on any judge client, so it needs no new provider code.
 *
 * The replies go in as labelled lines, Reply A and Reply B. A judge that prefers the first position answers
 * pass whichever reply it means, so every pair is judged twice, in both orders. A choice counts only when
 * the two orders agree on the same candidate; otherwise the call is a tie and is flagged.
 */

export type PairwiseChoice = 'first' | 'second' | 'tie';

export type PairwiseVerdict = {
  /** The preferred candidate, as the caller gave them: first or second. A tie when none is preferred. */
  readonly choice: PairwiseChoice;
  /** The judge's outcome with the first candidate as Reply A. */
  readonly ordered: JudgeOutcome;
  /** The judge's outcome with the second candidate as Reply A. */
  readonly swapped: JudgeOutcome;
  /** True when both orders named the same candidate, or both found no difference. */
  readonly consistent: boolean;
  /** True when the judge gave the same outcome in both orders: it chose the position, not the reply. */
  readonly positionBias: boolean;
};

export type PairwiseTally = {
  readonly first: number;
  readonly second: number;
  readonly tie: number;
  /** Calls whose two orders disagreed. */
  readonly inconsistent: number;
  /** Calls where the judge gave the same outcome in both orders. */
  readonly positionBias: number;
};

/** The request for one ordering: the transcript, then the two replies as labelled lines. */
export function pairwiseRequest(
  criterion: CriterionText,
  transcript: readonly TranscriptEntry[],
  replyA: string,
  replyB: string,
  reference?: string,
): JudgeRequest {
  const question =
    reference === undefined
      ? `Which of the two replies, A or B, satisfies this better? ${criterion.rubric}`
      : `Which of the two replies, A or B, matches the reference answer better, on this criterion? ${criterion.rubric}`;
  return {
    criterion: {
      name: criterion.name,
      rubric: question,
      pass: 'Reply A satisfies it better than reply B.',
      fail: 'Reply B satisfies it better than reply A.',
      scope: 'block',
    },
    transcript: [
      ...transcript,
      { role: 'context', text: `Reply A: ${replyA}` },
      { role: 'context', text: `Reply B: ${replyB}` },
      ...(reference === undefined
        ? []
        : [{ role: 'context' as const, text: `Reference answer: ${reference}` }]),
    ],
  };
}

/** Maps an outcome to the candidate it names, given which candidate sat in position A. */
function naming(outcome: JudgeOutcome, aIsFirst: boolean): PairwiseChoice {
  if (outcome === 'inconclusive') return 'tie';
  const aWins = outcome === 'pass';
  return aWins === aIsFirst ? 'first' : 'second';
}

/**
 * Judges two candidates on one criterion in both orders. A client that gives no answer throws, and so does
 * this call: a missing answer is never read as a tie.
 */
export async function judgePairwise(
  client: JudgeClient,
  criterion: CriterionText,
  transcript: readonly TranscriptEntry[],
  first: string,
  second: string,
  options: { reference?: string } = {},
): Promise<PairwiseVerdict> {
  const { reference } = options;
  const ordered = (await client.judge(pairwiseRequest(criterion, transcript, first, second, reference)))
    .answer.outcome;
  const swapped = (await client.judge(pairwiseRequest(criterion, transcript, second, first, reference)))
    .answer.outcome;
  const byOrdered = naming(ordered, true);
  const bySwapped = naming(swapped, false);
  const consistent = byOrdered === bySwapped;
  const choice: PairwiseChoice = consistent ? byOrdered : 'tie';
  return {
    choice,
    ordered,
    swapped,
    consistent,
    positionBias: ordered === swapped && ordered !== 'inconclusive',
  };
}

/** Counts the verdicts of a set of pairwise calls. */
export function pairwiseTally(verdicts: readonly PairwiseVerdict[]): PairwiseTally {
  return {
    first: verdicts.filter((verdict) => verdict.choice === 'first').length,
    second: verdicts.filter((verdict) => verdict.choice === 'second').length,
    tie: verdicts.filter((verdict) => verdict.choice === 'tie').length,
    inconsistent: verdicts.filter((verdict) => !verdict.consistent).length,
    positionBias: verdicts.filter((verdict) => verdict.positionBias).length,
  };
}

/** Reads the criterion a pairwise call judges from a YAML file: its name and rubric, and optionally its pictures. */
export async function readPairwiseCriterion(path: string): Promise<CriterionText> {
  const text = await readFile(path, 'utf8');
  const parsed = CriterionText.safeParse(parseYaml(text));
  if (!parsed.success) {
    throw new Error(`${path} is not a criterion: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  return parsed.data;
}
