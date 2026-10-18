import {
  buildPrompt,
  type Cassette,
  type JudgeRequest,
  parseJudgeText,
  recordingClient,
} from '@agent-nexus/driftbench-judges';
import { describe, expect, it, vi } from 'vitest';
import { type BenchSlice, checkFloor, raiseFloor, recordBenchClient, replaySlice, scoreSlice } from '../run';

const slice: BenchSlice = {
  name: 'fictional',
  version: 1,
  hash: 'a'.repeat(64),
  cases: Array.from({ length: 60 }, (_, i) => ({
    id: `case-${i}`,
    family: `family-${i % 3}`,
    expected: i % 2 ? ('fail' as const) : ('pass' as const),
    request: {
      criterion: { name: 'exact', rubric: 'The reply must be yes.' },
      transcript: [{ role: 'agent' as const, text: i % 2 ? 'no' : 'yes' }],
    },
  })),
};
function client() {
  return {
    id: 'fake',
    model: 'fictional-v1',
    cls: 'system2' as const,
    family: 'fictional',
    cost: 1,
    judge: vi.fn(async (request: JudgeRequest) =>
      parseJudgeText(
        JSON.stringify({
          checks: [
            {
              id: 'exact',
              reasoning: 'Literal comparison.',
              met: request.transcript[0]?.text === 'yes',
              evidence: request.transcript[0]?.text ?? '',
            },
          ],
        }),
        request,
      ),
    ),
  };
}
async function recorded() {
  const cassette: Cassette = { version: 1, judges: [], entries: [] };
  const c = client();
  await scoreSlice(slice, recordingClient(c, cassette), { head: 'a'.repeat(40) });
  return { cassette, c };
}
describe('bench uses the shipped default', () => {
  it('records through the public client and replays without a live call', async () => {
    const { cassette, c } = await recorded();
    c.judge.mockClear();
    const result = await replaySlice(slice, cassette, 'fake', { head: 'b'.repeat(40) });
    expect(result).toMatchObject({ n: 60, correct: 60, model: 'fictional-v1' });
    expect(result.wilson.lower).toBeLessThan(1);
    expect(result.familyBootstrap.clusters).toBe(3);
    expect(result.zeroFailure.requiredCleanCases).toBe(59);
    expect(c.judge).not.toHaveBeenCalled();
  });
  it('fails with re-record needed on a changed prompt, datum or client setting', async () => {
    const { cassette } = await recorded();
    const judge = cassette.judges[0];
    if (!judge) throw new Error('No recorded judge');
    judge.settings = 'changed';
    await expect(replaySlice(slice, cassette, 'fake', { head: 'b'.repeat(40) })).rejects.toThrow(
      're-record needed',
    );
  });
  it('refuses missing request occurrences even when unrelated entries pad the cassette', async () => {
    const { cassette } = await recorded();
    cassette.entries.slice(2).forEach((entry) => {
      entry.key = '0'.repeat(12);
    });
    await expect(replaySlice(slice, cassette, 'fake', { head: 'a'.repeat(40) })).rejects.toThrow(
      're-record needed',
    );
  });
  it('keeps repeated requests in input order when concurrent calls finish out of order', async () => {
    const cassette: Cassette = { version: 1, judges: [], entries: [] };
    const c = client();
    let call = 0;
    c.judge.mockImplementation(async (request) => {
      const index = call++;
      await new Promise((resolve) => setTimeout(resolve, index % 4 < 2 ? 20 : 1));
      return parseJudgeText(
        JSON.stringify({
          checks: [
            {
              id: 'exact',
              met: index % 3 === 0,
              reasoning: 'Fictional ordered response.',
              evidence: request.transcript[0]?.text,
            },
          ],
        }),
        request,
      );
    });
    const live = await scoreSlice(slice, recordingClient(c, cassette), {
      head: 'a'.repeat(40),
      concurrency: 4,
    });
    const replay = await replaySlice(slice, cassette, 'fake', { head: 'a'.repeat(40) });
    expect(replay.results).toEqual(live.results);
  });
  it('rejects legacy or overridden system prompts and duplicate case IDs', async () => {
    const bad = structuredClone(slice);
    const first = bad.cases[0];
    if (!first) throw new Error('No first case');
    first.request = { ...first.request, system: 'secret alternate judge' };
    await expect(scoreSlice(bad, client(), { head: 'a'.repeat(40) })).rejects.toThrow('shipped default');
    const duplicate = structuredClone(slice);
    const [a, b] = duplicate.cases;
    if (!a || !b) throw new Error('No cases');
    b.id = a.id;
    await expect(scoreSlice(duplicate, client(), { head: 'a'.repeat(40) })).rejects.toThrow('duplicate');
  });
  it('does not send labels or construction metadata to the judge', async () => {
    const c = client();
    await scoreSlice(slice, c, { head: 'a'.repeat(40) });
    for (const [request] of c.judge.mock.calls) {
      expect(Object.keys(request)).toEqual(['criterion', 'transcript']);
      expect(buildPrompt(request).user).not.toContain('family-');
    }
  });
  it('counts unparsed and inconclusive answers as wrong, including negative labels', async () => {
    const c = client();
    c.judge.mockImplementation(async (request: JudgeRequest) => parseJudgeText('not json', request));
    expect((await scoreSlice(slice, c, { head: 'a'.repeat(40) })).correct).toBe(0);
  });
  it('preserves a transport truncation even when the returned raw ledger can be parsed', async () => {
    const cassette: Cassette = { version: 1, judges: [], entries: [] };
    const c = client();
    const judge = c.judge;
    const truncated = {
      ...c,
      judge: async (request: JudgeRequest) => ({ ...(await judge(request)), unparsed: true as const }),
    };
    const live = await scoreSlice(slice, recordBenchClient(truncated, cassette), { head: 'a'.repeat(40) });
    expect(live.correct).toBe(0);
    expect((await replaySlice(slice, cassette, 'fake', { head: 'a'.repeat(40) })).results).toEqual(
      live.results,
    );
  });
});
describe('recording initialization', () => {
  it('finishes the first live request before opening concurrent calls on a fresh client', async () => {
    const cassette: Cassette = { version: 1, judges: [], entries: [] };
    const c = client();
    const base = c.judge;
    let started = false;
    let ready = false;
    const warming = {
      ...c,
      judge: async (request: JudgeRequest) => {
        if (started && !ready) throw new Error('client initialization is still in flight');
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        ready = true;
        return base(request);
      },
    };
    const report = await scoreSlice(slice, recordBenchClient(warming, cassette), {
      head: 'a'.repeat(40),
      concurrency: 4,
    });
    expect(report.correct).toBe(60);
    expect(cassette.entries).toHaveLength(60);
  });
});
describe('bench floors', () => {
  it('refuses a forged score, stale fingerprint and a decrease', async () => {
    const { cassette } = await recorded();
    const evidence = await replaySlice(slice, cassette, 'fake', { head: 'a'.repeat(40) });
    const floor = raiseFloor(undefined, evidence);
    expect(checkFloor(evidence, floor).holds).toBe(true);
    expect(() => raiseFloor(floor, { ...evidence, correct: 59 })).toThrow();
    expect(() => raiseFloor(undefined, { ...evidence, fingerprint: 'stale' })).toThrow('fingerprint');
    expect(checkFloor({ ...evidence, fingerprint: 'stale' }, floor).holds).toBe(false);
    for (const lower of [NaN, Infinity, 'fictional', null]) {
      const forged = { ...evidence, wilson: { ...evidence.wilson, lower } };
      expect(() => raiseFloor(undefined, forged as typeof evidence)).toThrow('Wilson');
    }
  });
  it('checks paired non-inferiority and exact McNemar against the same case IDs', async () => {
    const { cassette } = await recorded();
    const baseline = await replaySlice(slice, cassette, 'fake', { head: 'a'.repeat(40) });
    const bad = structuredClone(baseline);
    bad.results.slice(0, 12).forEach((r) => {
      r.correct = false;
      r.outcome = 'inconclusive';
    });
    bad.correct -= 12;
    const result = checkFloor(bad, raiseFloor(undefined, baseline));
    expect(result.holds).toBe(false);
    expect(result.paired?.mcnemar.pValue).toBeLessThan(0.05);
    expect(result.paired?.nonInferiority.nonInferior).toBe(false);
    expect(() =>
      checkFloor({ ...bad, results: bad.results.slice(1) }, raiseFloor(undefined, baseline)),
    ).toThrow();
  });
});
