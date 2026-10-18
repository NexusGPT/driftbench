import type { CriterionText, TranscriptEntry } from './contract';

/**
 * Pairwise comparison in both orders: a pair judge names the better of two candidates, first or second, or a
 * tie, or gives inconclusive. The two orders must agree, so a judge that prefers a position gives inconclusive.
 */

export type PairChoice = 'first' | 'second' | 'tie' | 'inconclusive';

/** A pair judge: one call answers which of the two candidates is better. */
export type PairJudge = {
  readonly id: string;
  judgePair(request: {
    criterion: CriterionText;
    first: TranscriptEntry[];
    second: TranscriptEntry[];
  }): Promise<PairChoice>;
};

export type PairWinner = 'a' | 'b' | 'tie' | 'inconclusive';

/** Compares candidates a and b in both orders. A judge that gives no answer makes the result inconclusive. */
export async function comparePair(
  judge: PairJudge,
  { criterion, a, b }: { criterion: CriterionText; a: TranscriptEntry[]; b: TranscriptEntry[] },
): Promise<{ winner: PairWinner; calls: number }> {
  const ask = (first: TranscriptEntry[], second: TranscriptEntry[]) =>
    judge.judgePair({ criterion, first, second }).catch((): PairChoice => 'inconclusive');
  const ordered = await ask(a, b);
  const swapped = await ask(b, a);
  const winner = ((): PairWinner => {
    if (ordered === 'first' && swapped === 'second') return 'a';
    if (ordered === 'second' && swapped === 'first') return 'b';
    if (ordered === 'tie' && swapped === 'tie') return 'tie';
    return 'inconclusive';
  })();
  return { winner, calls: 2 };
}
