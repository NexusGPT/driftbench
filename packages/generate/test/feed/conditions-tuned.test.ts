import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Cache,
  type Clause,
  configNamed,
  makeSystems,
  runConfig,
} from '../../../../examples/variables/conditions/lib';

/**
 * Replays the recordings of the real systems (Jev as system 1, Haiku as system 2) on the two halves of the
 * clause set, with the configuration frozen after the first tuning round. examples/variables/conditions/tune.ts
 * made the recordings; no call is made here. The numbers pinned are what the recordings measured, not a bar.
 */
const dir = join(__dirname, '../../../../examples/variables/conditions');
const json = <T>(name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;

async function replay(clauses: string, recording: string, config: string) {
  const systems = makeSystems(json<Cache>(recording));
  return runConfig(configNamed(config), json<Clause[]>(clauses), systems);
}

describe('the frozen configuration, replayed from the recordings', () => {
  it('dev half (70 clauses, tuned on): precision and recall 0.963', async () => {
    const run = await replay('dev-clauses.json', 'recording-dev.json', 'frozen');
    expect(run.result.report.failed).toBe(0);
    expect(run.score).toMatchObject({ assigned: 54, correct: 52, planted: 54 });
  });

  it('first held-out half (66 clauses, measured once): precision and recall 0.930, under the 0.95 bar', async () => {
    const run = await replay('heldout-clauses-1.json', 'recording-heldout-1.json', 'frozen');
    expect(run.result.report.failed).toBe(0);
    expect(run.score).toMatchObject({ assigned: 57, correct: 53, planted: 57 });
    expect(run.score.correct / run.score.assigned).toBeLessThan(0.95);
  });

  it('second round (tuned on the 136 clauses of both halves): 0.945 precision, 0.937 recall', async () => {
    const both = [...json<Clause[]>('dev-clauses.json'), ...json<Clause[]>('heldout-clauses-1.json')];
    const systems = makeSystems(json<Cache>('recording-tuning-2.json'));
    const run = await runConfig(configNamed('frozen2'), both, systems);
    expect(run.result.report.failed).toBe(0);
    expect(run.score).toMatchObject({ assigned: 110, correct: 104, planted: 111 });
  });

  it('a recording that lacks a clause fails its span instead of calling a model', async () => {
    const systems = makeSystems({ reads: {}, proposals: {} });
    const run = await runConfig(
      configNamed('frozen'),
      json<Clause[]>('dev-clauses.json').slice(0, 2),
      systems,
    );
    expect(run.result.report.failed).toBe(2);
    expect(systems.live).toEqual({ reads: 0, proposals: 0 });
  });
});
