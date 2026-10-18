import { parseSpecText } from '@agent-nexus/driftbench-core';
import * as estate from '@agent-nexus/driftbench-estate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ItemResult } from '../../src/ladders/estate/bank/frame';
import { impactFamily } from '../../src/ladders/estate/bank/loop';
import { estateMutants } from '../../src/ladders/estate/mutants';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { renderEstate } from '../../src/ladders/estate/render';

const KINDS = ['instruction', 'gate', 'reference', 'script', 'register', 'route', 'subagent'];
type Mode = 'generated' | 'correct' | 'early' | 'late' | 'skip-regeneration';
const results = new Map<Mode, Map<string, ItemResult>>();

beforeAll(async () => {
  const run = await pipeline.estateRun(1);
  const source = run.specs.find((spec) => spec.loaded);
  if (!source) throw new Error('no generated specimen');
  const before = new Set(run.rendered.atoms.map((atom) => atom.hid));
  const stable = run.scanned.match.idOf.get('rule:no-webfetch');
  if (!stable) throw new Error('no stable control atom');
  const probes: pipeline.GeneratedSpec[] = [];
  const add = (id: string, atoms: string[], retired?: string) => {
    const text = JSON.stringify({
      id,
      target: { adapter: 'function', agent: 'maintenance-probe' },
      blocks: [{ user: 'Check the specimen.', expect: { must: ['done'] } }],
      metadata: { estate: { atoms }, ...(retired === undefined ? {} : { retired }) },
    });
    const loaded = parseSpecText(text, 'json', `${id}.json`);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    probes.push({ ...source, record: { ...source.record, id, path: `${id}.json`, atoms }, text, loaded });
  };
  for (const kind of KINDS) {
    const mutant = estateMutants(run.estate).find((entry) => entry.kind === kind);
    if (!mutant) throw new Error(`no ${kind} mutant`);
    const after = new Set(renderEstate(mutant.estate).atoms.map((atom) => atom.hid));
    const removed = [...before]
      .filter((hid) => !after.has(hid))
      .flatMap((hid) => run.scanned.match.idOf.get(hid) ?? []);
    if (!removed.length || removed.includes(stable)) throw new Error(`no deletion/control for ${kind}`);
    // Every kind gets a genuine all-removed case, even reference (whose current generated
    // tests are all mixed). Also cover metadata order, journey ids and an untouched control.
    add(`maintenance.${kind}.all-removed`, removed);
    add(`maintenance.${kind}.mixed-first`, [removed[0] as string, stable]);
    add(`maintenance.${kind}.mixed-last`, [stable, removed[0] as string]);
    add(`estate.journey.maintenance.${kind}`, removed);
    add(`maintenance.${kind}.untouched`, [stable]);
    add(`maintenance.${kind}.already-retired`, removed, estate.retirementReason(removed));
  }
  const original = estate.estateImpact;
  let nonce = 10_000;
  for (const mode of ['generated', 'correct', 'early', 'late', 'skip-regeneration'] as const) {
    // Only the cache key changes. Assert that the source files and atoms are identical.
    const hidden = { ...run.estate, seed: nonce++ };
    expect(renderEstate(hidden)).toEqual(run.rendered);
    const fixture = vi.spyOn(pipeline, 'estateRun').mockResolvedValue({
      ...run,
      estate: hidden,
      specs: mode === 'generated' ? run.specs : [...run.specs, ...probes],
    });
    const component = vi.spyOn(estate, 'estateImpact').mockImplementation((diff, tests, options) => {
      for (const test of tests.filter((test) => test.id.endsWith('.already-retired')))
        expect(test.retired).toBeDefined();
      const report = original(diff, tests, options);
      if (mode === 'early') {
        const removed = new Set(diff.atoms.removed.map((atom) => atom.id));
        for (const test of tests) {
          const gone = test.atoms.filter((atom) => removed.has(atom));
          if (
            test.retired === undefined &&
            gone.length &&
            !report.retire.some((entry) => entry.test === test.id)
          )
            report.retire.push({
              test: test.id,
              file: test.file,
              atoms: gone,
              reason: estate.retirementReason(gone),
              state: 'to_write',
            });
        }
        const retired = new Set(report.retire.map((entry) => entry.test));
        report.regenerate = report.regenerate.filter((entry) => !retired.has(entry.test));
      }
      if (mode === 'late') report.retire = [];
      if (mode === 'skip-regeneration') report.regenerate = [];
      return report;
    });
    try {
      results.set(mode, await impactFamily().evaluate(1));
    } finally {
      component.mockRestore();
      fixture.mockRestore();
    }
  }
}, 120_000);

describe('maintenance obeys the full metadata atom set', () => {
  for (const kind of KINDS) {
    const id = `maintain.impact.${kind}-retires-its-tests`;
    it(`holds on the actual generated suite: ${id}`, () =>
      expect(results.get('generated')?.get(id)).toEqual({ pass: true, detail: 'holds' }));
    it(`holds: ${id}`, () =>
      expect(results.get('correct')?.get(id)).toEqual({ pass: true, detail: 'holds' }));
    it(`early retirement stays red: ${id}`, () => expect(results.get('early')?.get(id)?.pass).toBe(false));
    it(`late retirement stays red: ${id}`, () => expect(results.get('late')?.get(id)?.pass).toBe(false));
    it(`missing mixed-test regeneration stays red: ${id}`, () =>
      expect(results.get('skip-regeneration')?.get(id)?.pass).toBe(false));
    it(`the paired no-other-retirement item agrees: ${kind}`, () => {
      const paired = `maintain.impact.${kind}-retires-nothing-else`;
      expect(results.get('correct')?.get(paired)).toEqual({ pass: true, detail: 'holds' });
      expect(results.get('early')?.get(paired)?.pass).toBe(false);
    });
  }
});
