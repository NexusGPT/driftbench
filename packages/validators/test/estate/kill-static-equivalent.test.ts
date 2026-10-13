import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bench from '../../src/ladders/estate/bank/bench';
import { fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import { type Cell, equivalent, killFamily } from '../../src/ladders/estate/bank/kill';

vi.mock('../../src/ladders/estate/bank/bench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/bank/bench')>();
  return { ...actual, cli: vi.fn(actual.cli) };
});

const del = (kind: string): Cell => ({ kind, index: 0, op: 'delete', tier: 1 });

async function fixtureMap() {
  const suite = await fixtureSuite();
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('the fixture map does not load');
  return map.map;
}

describe('kill.fake: equivalent mutants are read from the fixture, not taken on trust', {
  timeout: 300_000,
}, () => {
  it('names a skill name line equal to its folder, and nothing else of the skill kind', async () => {
    const map = await fixtureMap();
    const skill = map.atoms.find((atom) => atom.kind === 'skill') as (typeof map.atoms)[number];
    expect(equivalent(del('skill'), skill.id, map)).toMatch(/repeats its folder/);
    const renamed = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === skill.id
          ? { ...atom, provenance: { ...atom.provenance, quote: 'name: another-name' } }
          : atom,
      ),
    };
    expect(equivalent(del('skill'), skill.id, renamed)).toBeUndefined();
    expect(equivalent({ ...del('skill'), op: 'invert' }, skill.id, map)).toBeUndefined();
  });

  it('names a gate whose order the step list imposes, and not once another stage leads to the later one', async () => {
    const map = await fixtureMap();
    const gate = 'gate.standing.never-report-done-before-verify-passed';
    expect(equivalent(del('gate'), gate, map)).toMatch(/reaches report only from verify/);
    const report = map.atoms.find((atom) => atom.kind === 'stage' && atom.fields?.id === 'report');
    const doStage = map.atoms.find((atom) => atom.kind === 'stage' && atom.fields?.id === 'do');
    if (!report || !doStage) throw new Error('the fixture has no do or report stage');
    const shortcut = { ...map, edges: [...map.edges, { from: doStage.id, kind: 'next', to: report.id }] };
    expect(equivalent(del('gate'), gate, shortcut as typeof map)).toBeUndefined();
    const other = map.atoms.find(
      (atom) => atom.kind === 'gate' && !atom.evidence.some((item) => item.type === 'ordered'),
    );
    if (other) expect(equivalent(del('gate'), other.id, map)).toBeUndefined();
  });
});

describe('kill.fake: setting atoms are judged by their static tests', { timeout: 600_000 }, () => {
  afterEach(() => vi.mocked(bench.cli).mockReset());

  it('passes the two setting cells on the fixture, red on the mutant', async () => {
    const actual = await vi.importActual<typeof bench>('../../src/ladders/estate/bank/bench');
    vi.mocked(bench.cli).mockImplementation(actual.cli);
    const results = await killFamily().evaluate(1);
    expect(results.get('kill.fake.delete-setting-1')).toMatchObject({ pass: true });
    expect(results.get('kill.fake.delete-setting-2')).toMatchObject({ pass: true });
  });

  it('fails them when the static runner never turns red', async () => {
    const actual = await vi.importActual<typeof bench>('../../src/ladders/estate/bank/bench');
    vi.mocked(bench.cli).mockImplementation((args, cwd) => {
      const run = actual.cli(args, cwd);
      if (args[0] !== 'estate' || args[1] !== 'static') return run;
      const at = run.out.indexOf('{');
      if (at < 0) return run;
      const json = JSON.parse(run.out.slice(at)) as { results?: Array<{ pass: boolean }> };
      for (const result of json.results ?? []) result.pass = true;
      return { ...run, code: 0, out: JSON.stringify(json) };
    });
    const results = await killFamily().evaluate(1);
    expect(results.get('kill.fake.delete-setting-1')).toMatchObject({ pass: false });
    expect(results.get('kill.fake.delete-setting-2')).toMatchObject({ pass: false });
  });
});
