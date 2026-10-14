import { pairwiseRequest } from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import { CRITERION, recordedPrompt, routePrompt, solvePrompt } from '../src/historical';
import { parseAnswerText } from '../src/historical-parser';
import {
  officialCorrect,
  type Pair,
  promptKey,
  type Recorded,
  RecordingStore,
  reduceVotes,
  replay,
} from '../src/replay';

const pair: Pair = { id: 'fixture', question: 'What is 2 + 2?', a: 'Four', b: 'Five', label: 'A' };
const reference = 'Add two and two.\nFinal answer: 4';
function fixture(route = 'YES', outcomes = ['pass', 'pass', 'fail']): Recorded[] {
  const record = (prompt: { system: string; user: string }, text: string): Recorded => ({
    key: promptKey(prompt),
    model: 'haiku',
    text,
    costUsd: 0,
  });
  const rows = [record(routePrompt(pair.question), route), record(solvePrompt(pair.question), reference)];
  for (const swapped of [false, true]) {
    const request = pairwiseRequest(
      { name: 'benchmark', rubric: CRITERION },
      [{ role: 'user', text: pair.question }],
      swapped ? pair.b : pair.a,
      swapped ? pair.a : pair.b,
    );
    for (let sample = 0; sample < 3; sample++) {
      const value = outcomes[sample];
      const outcome = swapped ? (value === 'pass' ? 'fail' : value === 'fail' ? 'pass' : value) : value;
      rows.push(
        record(
          recordedPrompt({ ...request, ...(route === 'NO' ? {} : { reference }) }, sample),
          JSON.stringify({ outcome, reasoning: 'recorded fixture' }),
        ),
      );
    }
  }
  return rows;
}

describe('network-free reference replay', () => {
  it('runs raw votes through the reference wrapper and repeated judging', async () => {
    const result = await replay([pair], new RecordingStore(fixture()), 'adaptive');
    expect(result.correct).toBe(1);
    expect(result.decisions[0]?.games).toEqual(['A', 'A']);
    expect(result.routeReads).toBe(1);
    expect(result.solveReads).toBe(1);
    expect(result.judgementReads).toBe(6);
  });
  it('skips the solve after a NO route', async () => {
    const rows = fixture('NO').filter((r) => r.key !== promptKey(solvePrompt(pair.question)));
    const result = await replay([pair], new RecordingStore(rows), 'adaptive');
    expect(result.solveReads).toBe(0);
    expect(result.correct).toBe(1);
  });
  it('never treats a missing solve or judgement recording as a tie', async () => {
    for (const key of [promptKey(solvePrompt(pair.question)), fixture().at(-1)?.key]) {
      await expect(
        replay([pair], new RecordingStore(fixture().filter((r) => r.key !== key)), 'adaptive'),
      ).rejects.toThrow('Missing recording');
    }
  });
  it('requires a route recording and never falls back to a live call', async () => {
    await expect(replay([pair], new RecordingStore(fixture().slice(1)), 'adaptive')).rejects.toThrow(
      'Missing recording',
    );
  });
  it('fails when the expected verdict changes, without feeding it into judging', async () => {
    await expect(
      replay([pair], new RecordingStore(fixture()), 'adaptive', [{ item: pair, games: ['B', 'B'] }]),
    ).rejects.toThrow('Verdict mismatch');
  });
  it('counts decisive votes using the historical abstention rule', () => {
    expect(reduceVotes(['pass', 'inconclusive', 'inconclusive'])).toBe('A');
    expect(reduceVotes(['pass', 'fail', 'inconclusive'])).toBe('tie');
    expect(reduceVotes(['inconclusive', 'inconclusive', 'inconclusive'])).toBe('tie');
  });
  it('uses labels only after the two games have been decided', async () => {
    const result = await replay([{ ...pair, label: 'B' }], new RecordingStore(fixture()), 'reference3');
    expect(result.decisions[0]?.games).toEqual(['A', 'A']);
    expect(result.correct).toBe(0);
    expect(result.routeReads).toBe(0);
  });
  it('fails on changed candidates instead of matching a recording by item id', async () => {
    await expect(
      replay([{ ...pair, a: 'Changed answer' }], new RecordingStore(fixture()), 'reference3'),
    ).rejects.toThrow('Missing recording');
  });
  it('preserves explicitly recorded empty call arrays without inventing calls', async () => {
    const result = await replay(
      [pair],
      new RecordingStore([]),
      'reference3',
      [{ item: pair, games: ['tie', 'tie'] }],
      [{ item: pair.id, reference: 'omitted', orders: ['AB', 'BA'] }],
    );
    expect(result.correct).toBe(0);
    expect(result.rawReplayedOrders).toBe(0);
    expect(result.unavailablePairs).toBe(1);
    expect(result.judgementReads + result.solveReads + result.routeReads).toBe(0);
  });
  it('retains historical rejection of invalid JSON escapes', () => {
    const result = parseAnswerText(
      String.raw`{"outcome":"pass","reasoning":"bad escape \\q"}`.replace('\\\\q', '\\q'),
    );
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });
  it('applies the official both-order scoring rule', () => {
    expect(officialCorrect(['A', 'tie'], 'A')).toBe(true);
    expect(officialCorrect(['A', 'B'], 'A')).toBe(false);
    expect(officialCorrect(['tie', 'tie'], 'A')).toBe(false);
  });
});
