import { describe, expect, it } from 'vitest';
import {
  agentMutantLevel,
  agentMutants,
  drawEstate,
  type EstateRun,
  estateMutantDecisions,
  estateMutants,
  estateRun,
  holdoutLevel,
  MUTATION_SCORE,
  matchAtoms,
  renderEstate,
} from '../../src/ladders/estate/index';
import { estateMeta } from '../../src/ladders/estate/levels';

describe('agent mutants (level 5)', { timeout: 120_000 }, () => {
  it('kills skills, scripts and the deleted WebFetch prohibition, and says why a living mutant lives', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const of = (kind: string) => mutants.filter((mutant) => mutant.kind === kind);
    expect(of('skill').length).toBeGreaterThan(0);
    expect(of('skill').every((mutant) => mutant.killed)).toBe(true);
    // The deny rule and the keyless gate are product gaps the bank names (mutant.agent.tool-deny-bare and
    // mutant.agent.gate-read-before-edit). This test does not ask the product to keep them: a mutant is killed,
    // or it lives and carries one of the two reasons a living mutant can have.
    const deny = mutants.find((mutant) => mutant.atom === 'tool.settings.deny-webfetch');
    expect(deny).toBeDefined();
    if (!deny?.killed) expect(deny?.reason).toMatch(/wait for |complete tests ran on the follower/);
    expect(mutants.find((mutant) => mutant.atom === 'instruction.standing.never-call-webfetch')?.killed).toBe(
      true,
    );
    const gate = mutants.find((mutant) => mutant.atom === 'gate.standing.read-a-file-before-you-edit');
    expect(gate).toBeDefined();
    if (!gate?.killed) expect(gate?.reason).toMatch(/wait for |complete tests ran on the follower/);
    for (const mutant of mutants) {
      if (mutant.killed) expect(mutant.reason, mutant.atom).toBeUndefined();
      else
        expect(mutant.reason, mutant.atom).toMatch(
          /no generated test names the atom|wait for |complete tests ran on the follower|records the same session/,
        );
    }
    expect(of('script').length).toBeGreaterThan(0);
    expect(of('script').every((mutant) => mutant.killed && mutant.tests.length > 0)).toBe(true);
  });

  it('scores each kind and names the living mutants of a kind below the bar', async () => {
    const run = await estateRun(1);
    const measure = await agentMutantLevel(run);
    const mutants = await agentMutants(run);
    const alive = measure.items.map((item) => item.id);
    // The value is the lowest kill share over the kinds, and every item is a living mutant of a kind below the bar.
    const kinds = [...new Set(mutants.map((mutant) => mutant.kind))];
    const share = (kind: string) => {
      const own = mutants.filter(
        (mutant) => mutant.kind === kind && !('equivalent' in mutant && mutant.equivalent),
      );
      return own.length === 0 ? 1 : own.filter((mutant) => mutant.killed).length / own.length;
    };
    expect(measure.value).toBeCloseTo(Math.min(...kinds.map(share)), 12);
    for (const id of alive) {
      const atom = id.replace('mutant-alive:', '');
      const mutant = mutants.find((each) => each.atom === atom);
      expect(mutant?.killed, id).toBe(false);
      expect(share(mutant?.kind as string), id).toBeLessThan(MUTATION_SCORE);
    }
    const gate = mutants.find((mutant) => mutant.atom === 'gate.standing.read-a-file-before-you-edit');
    if (gate && !gate.killed && share('gate') < MUTATION_SCORE)
      expect(alive).toContain(`mutant-alive:${gate.atom}`);
    expect(alive.some((id) => id.startsWith('mutant-alive:skill.'))).toBe(false);
    expect(alive.some((id) => id.startsWith('mutant-alive:script.'))).toBe(false);
  });

  it('names the generator when script specs are deliberately made incomplete', async () => {
    const run = await estateRun(1);
    const scripts = new Set(
      run.scanned.map.atoms.filter((atom) => atom.kind === 'script').map((atom) => atom.id),
    );
    expect(scripts.size).toBeGreaterThan(0);
    const wrong: EstateRun = {
      ...run,
      specs: run.specs.map((spec) =>
        estateMeta(spec).atoms?.some((id) => scripts.has(id))
          ? { ...spec, record: { ...spec.record, complete: false } }
          : spec,
      ),
    };
    const measure = await agentMutantLevel(wrong);
    const script = measure.items.find((item) => item.id.startsWith('mutant-alive:script.'));
    expect(script?.component).toBe('packages/generate/src/estate/generate.ts');
    expect(script?.detail).toContain('no complete test passes on the rule follower');
  });

  it('kills nothing when no test is complete', async () => {
    const run = await estateRun(1);
    const none: EstateRun = {
      ...run,
      specs: run.specs.map((spec) => ({ ...spec, record: { ...spec.record, complete: false } })),
    };
    const measure = await agentMutantLevel(none);
    expect(measure.value).toBe(0);
  });
});

describe('estate mutants (level 6)', { timeout: 120_000 }, () => {
  it('takes one atom out per kind, and re-wraps a rule with its words unchanged', () => {
    const estate = drawEstate(1);
    const mutants = estateMutants(estate);
    expect(mutants.map((mutant) => mutant.kind)).toEqual([
      'instruction',
      'gate',
      'reference',
      'script',
      'register',
      'route',
      'subagent',
      'guard',
      'stage',
      'tool',
      'wording',
      'addition',
      'semantic',
      'spacing',
      'move',
      'rename',
      'verdict',
    ]);
    const before = new Set(renderEstate(estate).atoms.map((atom) => atom.hid));
    for (const mutant of mutants) {
      const after = new Set(renderEstate(mutant.estate).atoms.map((atom) => atom.hid));
      const gone = [...before].filter((hid) => !after.has(hid));
      if (['wording', 'addition', 'semantic', 'spacing', 'move', 'rename', 'verdict'].includes(mutant.kind)) {
        expect(gone, mutant.id).toEqual([]);
      } else expect(gone.length, mutant.id).toBeGreaterThan(0);
    }
  });

  it('names each wrong maintenance decision with what was expected, and leaves a re-wrap alone', async () => {
    const run = await estateRun(1);
    const { judged, wrong } = await estateMutantDecisions(run);
    expect(judged).toBeGreaterThan(run.specs.length);
    // What the validator expects does not depend on the product: a test whose atoms all left is retired, and a
    // renamed folder keeps its tests (the bank's maintain.impact.rename-* items). A product that does both has no
    // wrong decision here; this test asks only that a wrong one, when there is one, is named as such.
    for (const verdict of wrong) {
      expect(verdict.expected, verdict.mutant).not.toBe(verdict.got);
      expect(verdict.why.length, verdict.mutant).toBeGreaterThan(0);
      if (verdict.mutant.startsWith('rename:')) expect(verdict.expected, verdict.mutant).toBe('kept');
      else expect(verdict.expected, verdict.mutant).toBe('retired');
    }
    expect(wrong.some((verdict) => verdict.mutant.startsWith('wording:'))).toBe(false);
    const sample = wrong.find((verdict) => verdict.mutant.startsWith('instruction:'));
    if (sample) expect(sample.why).toMatch(/left the estate/);
  });
});

describe('the holdout estate (level 7)', { timeout: 120_000 }, () => {
  it('runs levels 1 to 6 on the holdout estate and stops at the first that fails', async () => {
    const measure = await holdoutLevel(await estateRun(1, 'holdout'));
    // The value is the count of lower levels passed over six. Below one, the items are those of the first level
    // that failed, each named with the holdout prefix; at one there is none. Which level stops the product today
    // is the product's affair, not this test's.
    const passed = Math.round(measure.value * 6);
    expect(measure.value).toBeCloseTo(passed / 6, 12);
    expect(passed).toBeGreaterThanOrEqual(0);
    expect(passed).toBeLessThanOrEqual(6);
    if (passed < 6) {
      expect(measure.items.length).toBeGreaterThan(0);
      const stage = measure.items[0]?.id.split(':')[1];
      expect(measure.items.every((item) => item.id.startsWith(`holdout:${stage}:`))).toBe(true);
    } else expect(measure.items).toEqual([]);
  });

  it('fails at level 1 of the holdout when a holdout-only form is lost by the scan', async () => {
    const run = await estateRun(1, 'holdout');
    const atoms = run.scanned.map.atoms.filter((atom) => !atom.provenance.file.includes('/memory/'));
    const measure = await holdoutLevel({
      ...run,
      scanned: {
        ...run.scanned,
        map: { ...run.scanned.map, atoms },
        match: matchAtoms(run.rendered.atoms, atoms),
      },
    });
    expect(measure.value).toBe(0);
    expect(measure.items[0]?.id).toMatch(/^holdout:atoms-and-edges:atom-missed:rule:dates-year-first$/);
  });
});
