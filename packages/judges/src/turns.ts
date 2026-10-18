import type { JudgeClient } from './client';
import type { JudgeRequest, TranscriptEntry } from './contract';

/**
 * Turn-by-turn judging for a long conversation: a turn starts at a customer message, consecutive customer
 * messages are one turn, entries before the first customer message belong to turn 1, and context entries are
 * not turns. Turn t is judged on the prefix that ends where turn t+1 starts. The outcome is fail when a turn
 * fails, else inconclusive when a turn is inconclusive, else pass.
 */

export type TurnOutcome = 'pass' | 'fail' | 'inconclusive';

export type TurnsResult = {
  turns: { turn: number; outcome: TurnOutcome }[];
  outcome: TurnOutcome;
  /** The first turn that fails. */
  firstFailing?: number;
  /** The first turn after `firstFailing` that passes. */
  recoveredAt?: number;
};

/** The index where each turn starts, in transcript order. */
function turnStarts(transcript: readonly TranscriptEntry[]): number[] {
  const starts: number[] = [];
  transcript.forEach((entry, index) => {
    if (entry.role !== 'user') return;
    const previous = transcript.slice(0, index).findLast((e) => e.role !== 'context');
    if (previous === undefined || previous.role !== 'user') starts.push(index);
  });
  return starts;
}

/** Judges a conversation one turn at a time, on the prefix of each turn. */
export async function judgeTurns(judge: JudgeClient, request: JudgeRequest): Promise<TurnsResult> {
  const starts = turnStarts(request.transcript);
  if (starts.length === 0) throw new RangeError('the transcript has no customer message');
  const turns: { turn: number; outcome: TurnOutcome }[] = [];
  for (let t = 0; t < starts.length; t += 1) {
    const end = starts[t + 1] ?? request.transcript.length;
    const prefix = request.transcript.slice(0, end);
    const outcome = await judge
      .judge({ ...request, transcript: prefix })
      .then((result) => result.answer.outcome)
      .catch((): TurnOutcome => 'inconclusive');
    turns.push({ turn: t + 1, outcome });
  }
  const outcome: TurnOutcome = turns.some((t) => t.outcome === 'fail')
    ? 'fail'
    : turns.some((t) => t.outcome === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  const firstFailing = turns.find((t) => t.outcome === 'fail')?.turn;
  const recoveredAt =
    firstFailing === undefined
      ? undefined
      : turns.find((t) => t.turn > firstFailing && t.outcome === 'pass')?.turn;
  return {
    turns,
    outcome,
    ...(firstFailing === undefined ? {} : { firstFailing }),
    ...(recoveredAt === undefined ? {} : { recoveredAt }),
  };
}
