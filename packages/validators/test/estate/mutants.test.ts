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

describe('agent mutants (level 5)', { timeout: 120_000 }, () => {
  it('kills every skill and the deleted WebFetch prohibition, and keeps the mutants no complete test can see', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const of = (kind: string) => mutants.filter((mutant) => mutant.kind === kind);
    expect(of('skill').length).toBeGreaterThan(0);
    expect(of('skill').every((mutant) => mutant.killed)).toBe(true);
    // The deny rule's test expects WebFetch not offered; a replayed session reports no offered tools, so the
    // test waits for its expectation and the mutant lives (an item of the bank: mutant.agent.tool-deny-bare).
    const deny = mutants.find((mutant) => mutant.atom === 'tool.settings.deny-webfetch');
    expect(deny?.killed).toBe(false);
    expect(deny?.reason).toMatch(/wait for a fix of their expectation/);
    expect(mutants.find((mutant) => mutant.atom === 'instruction.standing.never-call-webfetch')?.killed).toBe(
      true,
    );
    // A keyless ordered pair: any Read before the Edit satisfies it, so moving the target read late lives.
    const gate = mutants.find((mutant) => mutant.atom === 'gate.standing.read-a-file-before-you-edit');
    expect(gate?.killed).toBe(false);
    expect(gate?.reason).toMatch(
      /complete tests ran on the follower with the atom deleted and all passed; the evidence ordered did not fire/,
    );
    const script = of('script')[0];
    expect(script?.killed).toBe(false);
    expect(script?.reason).toMatch(
      /^no complete test passes on the rule follower to run it on; .* needs-some-call-check/,
    );
  });

  it('scores each kind and names the living mutants of a kind below the bar', async () => {
    const run = await estateRun(1);
    const measure = await agentMutantLevel(run);
    expect(measure.value).toBeLessThan(MUTATION_SCORE);
    const alive = measure.items.map((item) => item.id);
    expect(alive).toContain('mutant-alive:gate.standing.read-a-file-before-you-edit');
    expect(alive.some((id) => id.startsWith('mutant-alive:skill.'))).toBe(false);
    const script = measure.items.find((item) => item.id.startsWith('mutant-alive:script.'));
    expect(script?.component).toBe('packages/checks/src/checks/tools.ts');
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

  it('names the tests maintenance regenerates instead of retiring, and leaves a re-wrap alone', async () => {
    const run = await estateRun(1);
    const { judged, wrong } = await estateMutantDecisions(run);
    expect(judged).toBeGreaterThan(run.specs.length);
    expect(wrong.length).toBeGreaterThan(0);
    const deletions = wrong.filter((verdict) => !verdict.mutant.startsWith('rename:'));
    expect(
      deletions.every((verdict) => verdict.expected === 'retired' && verdict.got === 'regenerated'),
    ).toBe(true);
    // A renamed folder changes the atom ids of the skill: maintenance retires tests whose atoms all stayed.
    const renamed = wrong.filter((verdict) => verdict.mutant.startsWith('rename:'));
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.every((verdict) => verdict.expected === 'kept' && verdict.got === 'retired')).toBe(true);
    expect(wrong.some((verdict) => verdict.mutant.startsWith('instruction:'))).toBe(true);
    expect(wrong.some((verdict) => verdict.mutant.startsWith('wording:'))).toBe(false);
    const sample = wrong.find((verdict) => verdict.mutant.startsWith('instruction:'));
    expect(sample?.why).toMatch(/left the estate .*; the test also names skill\./);
  });
});

describe('the holdout estate (level 7)', { timeout: 120_000 }, () => {
  it('runs levels 1 to 6 on the holdout estate and stops at the first that fails', async () => {
    const measure = await holdoutLevel(await estateRun(1, 'holdout'));
    expect(measure.value).toBe(3 / 6);
    expect(measure.items.length).toBeGreaterThan(0);
    expect(measure.items.every((item) => item.id.startsWith('holdout:specs:'))).toBe(true);
    expect(measure.items.map((item) => item.id)).toContain('holdout:specs:gap:needs-ordered-anchor');
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
