import type { RunResult, Spec } from '@agent-nexus/driftbench-core';
import { repeatsForFloor, wilson, Z95 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { clustered } from '../src/estimate';
import { factorsOf, judgeFlip, spread } from '../src/spread';
import { dataOf, run } from './support';

const generated = (cell: Record<string, string>): Partial<Spec> => ({ metadata: { generated: { cell } } });
const pilot = (cell: string, conversation: string, wording: number): Partial<Spec> => ({
  metadata: { pilot: { cell, conversation, wording } },
});

describe('factorsOf', () => {
  it('reads the pilot factors first', () => {
    expect(
      factorsOf(
        {
          ...pilot('behaviour=B-1', 'conv-1', 2),
          metadata: {
            ...pilot('behaviour=B-1', 'conv-1', 2).metadata,
            generated: { cell: { behaviour: 'X' } },
          },
        } as Spec,
        'v1',
        undefined,
      ),
    ).toEqual({
      cell: 'behaviour=B-1',
      conversation: 'conv-1',
      wording: 2,
      source: 'pilot',
    });
  });

  it('projects the generated cell on behaviour by default, on the dimensions asked for, - for a missing one', () => {
    const spec = generated({ flow: 'new-home', behaviour: 'B-002', channel: 'chat' }) as Spec;
    expect(factorsOf(spec, 's', undefined).cell).toBe('behaviour=B-002');
    expect(factorsOf(spec, 's', ['flow', 'lang']).cell).toBe('flow=new-home,lang=-');
    expect(factorsOf(generated({ flow: 'a', user_type: 'b' }) as Spec, 's', undefined).cell).toBe(
      'flow=a,user_type=b',
    );
  });

  it('makes one golden one cell when the spec has no cell', () => {
    expect(factorsOf(undefined, 'acme-x', undefined)).toEqual({
      cell: 'acme-x',
      conversation: 'acme-x',
      wording: 0,
      source: 'spec',
    });
  });
});

describe('clustered pass rates', () => {
  it('counts each cluster once when every value agrees', () => {
    const all = clustered([1, 1, 1, 1, 1, 1], ['a', 'a', 'b', 'b', 'c', 'c'], { rate: true });
    const w = wilson(3, 3);
    expect(all).toMatchObject({
      estimate: 1,
      lower: w.lower,
      upper: w.upper,
      method: 'wilson, clusters',
      clusters: 3,
    });
    const none = clustered([0, 0, 0, 0], ['a', 'b', 'c', 'd'], { rate: true });
    expect(none).toMatchObject({
      estimate: 0,
      lower: 0,
      upper: wilson(0, 4).upper,
      method: 'wilson, clusters',
    });
    // A count is not a rate: it keeps the bootstrap.
    expect(clustered([0, 0, 0], ['a', 'b', 'c'])?.method).toBe('cluster bootstrap');
  });
});

/** n conversations in a cell, each run `repeats` times, `pass(conversation, repeat)` deciding the run. */
function cellRuns(
  cell: string,
  conversations: number,
  repeats: number,
  pass: (c: number, r: number) => boolean,
  wordings = 1,
): { runs: RunResult[]; specs: Record<string, Partial<Spec>> } {
  const runs: RunResult[] = [];
  const specs: Record<string, Partial<Spec>> = {};
  for (let c = 0; c < conversations; c += 1) {
    for (let w = 0; w < wordings; w += 1) {
      const specId = `${cell}-c${c}-w${w}`;
      specs[specId] = pilot(cell, `${cell}-c${c}`, w);
      for (let r = 0; r < repeats; r += 1) {
        runs.push(run({ specId, repeat: r, blocks: [{ pass: pass(c * wordings + w, r) }, {}] }));
      }
    }
  }
  return { runs, specs };
}

describe('spread', () => {
  it('rates each cell with its conversations as clusters, and lists the quantiles and the five worst', () => {
    const parts = [
      cellRuns('A', 4, 2, () => true),
      cellRuns('B', 4, 2, (c) => c !== 0),
      cellRuns('C', 4, 2, (c) => c >= 2),
      cellRuns('D', 1, 4, (_c, r) => r === 0),
      cellRuns('E', 4, 2, () => false),
      cellRuns('F', 4, 2, (c) => c === 3),
    ];
    const data = dataOf(
      parts.flatMap((part) => part.runs),
      Object.assign({}, ...parts.map((part) => part.specs)),
    );
    const s = spread(data, { margin: 0.05 });
    expect(s.source).toBe('pilot');
    expect(s.mode).toBe('F');
    const byName = new Map(s.cells.map((cell) => [cell.cell, cell]));
    expect(byName.get('B')?.rate).toMatchObject({
      estimate: 0.75,
      method: 'wilson, design effect',
      clusters: 4,
    });
    expect(byName.get('A')?.rate.method).toBe('wilson, clusters');
    // One conversation: Wilson over its runs.
    expect(byName.get('D')?.rate).toMatchObject({ estimate: 0.25, method: 'wilson', k: 1, n: 4 });
    // D and F tie at 25%: the lower upper bound comes first.
    expect(s.worst.map((cell) => cell.cell)).toEqual(['E', 'D', 'F', 'C', 'B']);
    expect(byName.get('D')?.rate.upper).toBeLessThan(byName.get('F')?.rate.upper as number);
    expect(s.quantiles).toMatchObject({ min: 0, max: 1, p50: 0.375 });
    // A perfect cell with four conversations cannot show it is within 5 points of 100%: undecided.
    expect(byName.get('A')?.status).toBe('undecided');
    expect(byName.get('E')?.status).toBe('below');
  });

  it('reads each cell against the baseline cell rate when a baseline is given', () => {
    const base = cellRuns('A', 8, 1, (c) => c < 4);
    const cand = cellRuns('A', 8, 1, () => true);
    const s = spread(dataOf(cand.runs, cand.specs), {
      margin: 0.05,
      baseline: dataOf(base.runs, base.specs, 'c-base'),
    });
    expect(s.cells[0]?.reference).toBe(0.5);
    expect(s.cells[0]?.status).toBe('above');
  });

  it('measures the run-to-run noise floor from the repeats and the blocks that flip', () => {
    // Two goldens, four repeats each: one flips every other run, one never.
    const runs = [
      ...[0, 1, 2, 3].map((r) => run({ specId: 'a', repeat: r, blocks: [{ pass: r % 2 === 0 }, {}] })),
      ...[0, 1, 2, 3].map((r) => run({ specId: 'b', repeat: r, blocks: [{}, {}] })),
    ];
    const s = spread(dataOf(runs), { margin: 0.05 });
    // Pooled within variance: golden a has variance 1/3 over 3 df, golden b 0 over 3 df.
    const variance = ((1 / 3) * 3) / 6;
    expect(s.noise?.variance).toBeCloseTo(variance, 12);
    expect(s.noise?.repeats).toBe(4);
    expect(s.noise?.perGolden).toBeCloseTo(Z95 * Math.sqrt((2 * variance) / 4), 12);
    expect(s.noise?.perCampaign).toBeCloseTo(Z95 * Math.sqrt((2 * variance) / 8), 12);
    expect(s.noise?.blockFlip).toMatchObject({ k: 1, n: 4 });
    expect(s.noise?.repeatsFor5Points).toBe(repeatsForFloor({ variance, floor: 0.05 }).repeats);
  });

  it('has no noise floor with one repeat per golden', () => {
    expect(
      spread(dataOf([run({ specId: 'a' }), run({ specId: 'b' })]), { margin: 0.05 }).noise,
    ).toBeUndefined();
  });

  it('flags a cell whose outcome depends on the wording, above the threshold and the noise floor', () => {
    // Wording 0 always passes, wording 1 always fails: a range of 1, no run-to-run noise.
    const sensitive = cellRuns('W', 3, 3, (index) => index % 2 === 0, 2);
    // Wording 0 passes 3 of 4 repeats, wording 1 one of 4: a range of 50 points, under a noise floor of 69.
    const noisy = cellRuns('N', 3, 4, (index, r) => (index % 2 === 0 ? r < 3 : r < 1), 2);
    const flat = cellRuns('S', 3, 2, () => true, 1);
    const data = dataOf([...sensitive.runs, ...noisy.runs, ...flat.runs], {
      ...sensitive.specs,
      ...noisy.specs,
      ...flat.specs,
    });
    const cells = new Map(spread(data, { margin: 0.05 }).cells.map((cell) => [cell.cell, cell]));
    expect(cells.get('W')?.wording).toMatchObject({ conversations: 3, maxRange: 1, floor: 0, flagged: true });
    expect(cells.get('N')?.wording).toMatchObject({ maxRange: 0.5, flagged: false });
    expect(cells.get('N')?.wording?.floor).toBeGreaterThan(0.5);
    expect(cells.get('S')?.wording).toBeUndefined();
  });

  it('reads the mode asked for, else F when the campaign ran it', () => {
    const data = dataOf([run({ mode: 'T' }), run({ mode: 'F', blocks: [{ pass: false }] })]);
    expect(spread(data, { margin: 0.05 }).mode).toBe('F');
    expect(spread(data, { margin: 0.05, mode: 'T' }).cells[0]?.rate.estimate).toBe(1);
    expect(spread(dataOf([run({ mode: 'T' })]), { margin: 0.05 }).mode).toBe('T');
  });
});

describe('judgeFlip', () => {
  it('counts judged verdicts whose votes disagree, per criterion', () => {
    const vote = (outcome: 'pass' | 'fail' | 'inconclusive') => ({ judge: `j-${outcome}`, outcome });
    const judged = (
      votes: Array<'pass' | 'fail' | 'inconclusive'>,
      outcome: 'pass' | 'fail' | 'inconclusive' = 'pass',
    ) => ({
      id: 'judge.tone',
      kind: 'judge' as const,
      name: 'tone',
      outcome,
      judge: { cls: 'system2' as const, votes: votes.map(vote) },
    });
    const flips = judgeFlip([
      run({
        blocks: [
          { verdicts: [judged(['pass', 'pass', 'pass'])] },
          { verdicts: [judged(['pass', 'fail', 'pass'])] },
          { verdicts: [judged(['pass', 'inconclusive'], 'inconclusive')] },
          { verdicts: [judged(['pass'])] },
          { verdicts: [{ id: 'tools.x' }] },
        ],
      }),
    ]);
    expect(flips).toHaveLength(1);
    expect(flips[0]).toMatchObject({ criterion: 'judge.tone', verdicts: 3, inconclusive: 1 });
    expect(flips[0]?.flip).toMatchObject({ k: 2, n: 3 });
  });
});
