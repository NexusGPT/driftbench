import { canonicalJson, type Observed, type RunResult, realizedTextOf } from '@agent-nexus/driftbench-core';

/**
 * Pairs the replies of two campaigns for a pairwise judge. A pair is one block that both campaigns ran in the
 * same unit (golden, mode, perturbation and repeat, on the same target), with a reply on each side. The
 * baseline is always the first reply, the candidate the second.
 */

export type ReplyPair = {
  /** The unit both campaigns ran: golden, mode, perturbation and repeat. */
  readonly unit: string;
  readonly block: number;
  /** The user message the block sent, for the judge to read the replies against. */
  readonly stimulus: string;
  readonly first: string;
  readonly second: string;
};

export type PairwiseChoice = 'first' | 'second' | 'tie';

/** A pairwise call's verdict, as the report reads it. */
export type PairwiseCall = {
  readonly choice: PairwiseChoice;
  readonly ordered: 'pass' | 'fail' | 'inconclusive';
  readonly swapped: 'pass' | 'fail' | 'inconclusive';
  readonly consistent: boolean;
  readonly positionBias: boolean;
};

/** The visible reply of a block: the adapter's text, or its text segments when the adapter leaves it empty. */
export function replyText(observed: Observed): string {
  if (observed.text !== '') return observed.text;
  return observed.segments.flatMap((segment) => (segment.type === 'text' ? [segment.text] : [])).join('\n');
}

function unitOf(run: RunResult): string {
  const perturbation = run.perturbationId ?? '-';
  return `${run.specId} · ${run.mode} · ${perturbation} · repeat ${run.repeat} · ${canonicalJson(run.target)}`;
}

/**
 * The reply pairs of two sets of runs. `stimulusOf` gives the user message of a block; the caller reads it
 * from the spec each run pins. Only equal, verifiable sent text is paired.
 * `onDifferentStimulus` counts otherwise pairable replies skipped for differing or unavailable text.
 */
export function replyPairs(
  baseline: readonly RunResult[],
  candidate: readonly RunResult[],
  stimulusOf: (run: RunResult, block: number) => string | undefined,
  onDifferentStimulus?: () => void,
): ReplyPair[] {
  const pairs: ReplyPair[] = [];
  const candidates = new Map<string, RunResult>();
  for (const run of candidate) {
    if (run.status === 'completed') candidates.set(unitOf(run), run);
  }
  for (const run of baseline) {
    if (run.status !== 'completed') continue;
    const unit = unitOf(run);
    const other = candidates.get(unit);
    if (other === undefined) continue;
    for (const block of run.blocks) {
      const counterpart = other.blocks.find((entry) => entry.index === block.index);
      if (counterpart === undefined) continue;
      const first = replyText(block.observed);
      const second = replyText(counterpart.observed);
      if (first === '' || second === '') continue;
      const stimulus = realizedTextOf(stimulusOf(run, block.index), block.realized);
      const otherStimulus = realizedTextOf(stimulusOf(other, counterpart.index), counterpart.realized);
      if (stimulus === undefined || otherStimulus === undefined || stimulus !== otherStimulus) {
        onDifferentStimulus?.();
        continue;
      }
      pairs.push({ unit, block: block.index, stimulus, first, second });
    }
  }
  return pairs;
}

export type PairwiseReport = {
  readonly rows: readonly { readonly pair: ReplyPair; readonly call: PairwiseCall }[];
  readonly tally: {
    readonly baseline: number;
    readonly candidate: number;
    readonly tie: number;
    readonly inconsistent: number;
    readonly positionBias: number;
  };
};

/** Judges every pair with `judgeOne` and tallies the wins: `first` is the baseline, `second` the candidate. */
export async function comparePairwise(
  pairs: readonly ReplyPair[],
  judgeOne: (pair: ReplyPair) => Promise<PairwiseCall>,
): Promise<PairwiseReport> {
  const rows: { pair: ReplyPair; call: PairwiseCall }[] = [];
  for (const pair of pairs) rows.push({ pair, call: await judgeOne(pair) });
  return {
    rows,
    tally: {
      baseline: rows.filter((row) => row.call.choice === 'first').length,
      candidate: rows.filter((row) => row.call.choice === 'second').length,
      tie: rows.filter((row) => row.call.choice === 'tie').length,
      inconsistent: rows.filter((row) => !row.call.consistent).length,
      positionBias: rows.filter((row) => row.call.positionBias).length,
    },
  };
}
