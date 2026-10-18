import { describe, expect, it } from 'vitest';
import type { ChangeManifest } from '../../src/radius/change';
import { analyseMutation, type MutationAnalysis } from '../../src/radius/mutation-analysis';
import { radiusOf } from '../../src/radius/radius';
import { SECTION_SELECTION_ADVISORY, sectionSelection } from '../../src/radius/select';
import { checkSelectionGate, selectionGate, verifiedOnly } from '../../src/radius/selection-gate';
import type { BlockLink } from '../../src/schema/links';
import { h7Record, h7Specs, promotedSpecs, registry } from './mutation-h7';

/**
 * The verified-link gate. The links are verified by one mutation run (`earlier`) and the gate is scored
 * on another (`rerun`). Both read the stored H7 runs, so these tests prove the mechanics of the gate, not
 * that H7's links would pass a real rerun.
 */

const specs = promotedSpecs('earlier');
const rerun = analyseMutation(h7Record('rerun'));
const manifestOf = (sections: string[]): ChangeManifest => ({
  from: 'v1',
  to: 'v2',
  changes: sections.map((section) => ({ kind: 'prompt_section', id: `acme-sales#${section}` })),
});

/** The analysis with `count` pair mutants each killing one block their selection leaves out. */
function withPairMisses(base: MutationAnalysis, count: number): MutationAnalysis {
  const verified = verifiedOnly(specs, registry.prompt_id);
  let left = count;
  return {
    ...base,
    mutants: base.mutants.map((mutant) => {
      if (!mutant.pair || left === 0) return mutant;
      const selection = sectionSelection(verified, manifestOf(mutant.sections), [registry]);
      const out = selection.specs
        .flatMap((spec) =>
          spec.blocks.filter((block) => block.state === 'out').map((b) => `${spec.specId}#${b.id}`),
        )
        .find((key) => !base.flaky.includes(key));
      if (!out) return mutant;
      left--;
      return { ...mutant, killed: [...mutant.killed, out] };
    }),
  };
}

describe('the verified-link gate', () => {
  it('passes on a run other than the one that verified the links, two-section mutants included', () => {
    const gate = selectionGate(specs, registry, rerun);
    expect(gate).toMatchObject({ pass: true, mutants: 110, pairs: 20, violating: 0, run: 'rerun' });
    expect(gate.upper).toBeLessThanOrEqual(0.05);
    expect(gate.ratio).toBeLessThan(1);
  });

  it('fails on the run that verified its own links', () => {
    const gate = selectionGate(promotedSpecs('rerun'), registry, rerun);
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('verified by this same run');
  });

  it('fails when two-section mutants violate safety, though every single-section mutant is safe', () => {
    // 10 violating pairs in 110 mutants: the Wilson upper bound is above 5%. A gate that left pairs out
    // would see 0 of 90 (upper 4.1%) and pass: this test catches it.
    const gate = selectionGate(specs, registry, withPairMisses(rerun, 10));
    expect(gate).toMatchObject({ pass: false, violating: 10, violatingPairs: 10, mutants: 110 });
    expect(gate.upper).toBeGreaterThan(0.05);
    expect(gate.reason).toContain('above 5%');
  });

  it('fails on a run with no two-section mutant', () => {
    const singles = { ...rerun, mutants: rerun.mutants.filter((mutant) => !mutant.pair) };
    const gate = selectionGate(specs, registry, singles);
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('no two-section mutant');
  });

  it('fails on declared links alone: a block with no verified link is always selected', () => {
    const declared = h7Specs.map((spec) => ({ spec, hash: `hash-${spec.id}` }));
    const gate = selectionGate(declared, registry, rerun);
    expect(gate.ratio).toBe(1);
    expect(gate.pass).toBe(false);
    expect(gate.reason).toContain('no block has a verified link');
  });
});

describe('the verified-link gate on the live rerun of the H7 suite', () => {
  // The links are verified by the stored H7 run. The gate is scored on a later live run of the same suite
  // (h7-rerun-runs.json): the 90 H7 single-section mutants, the 60 controls, and 20 two-section mutants
  // H7 did not run. This is the plan's decision gate on real runs, not a test of the mechanics.
  const live = analyseMutation(h7Record('h7-rerun', 'h7-rerun-runs.json'));
  const gate = selectionGate(promotedSpecs('h7'), registry, live);

  it('fails: 4 of 110 mutants kill a block their selection leaves out, upper bound 9.0%', () => {
    expect(gate).toMatchObject({ pass: false, mutants: 110, pairs: 20, violating: 4, violatingPairs: 2 });
    expect(gate.upper).toBeCloseTo(0.0898, 4);
    expect(gate.reason).toContain('above 5%');
    expect(gate.violations.map((violation) => violation.mutant).sort()).toEqual([
      'new_customer_details__rephrase',
      'pair__explicit_confirm__home_address_first',
      'pair__home_address_first__recap',
      'upgrade_identify__negate',
    ]);
  });

  it('misses with single-section mutants too: two of the four violations are not pairs', () => {
    expect(
      gate.violations.filter((violation) => !violation.pair).map((violation) => violation.missed),
    ).toEqual([
      ['upgrade-loose-yes#ly1', 'upgrade-loose-yes#ly2', 'upgrade-loose-yes#ly3'],
      ['porting-ok#p1'],
    ]);
  });

  it('keeps section selection advisory: the radius of a section change is the whole suite', () => {
    const report = radiusOf(promotedSpecs('h7'), manifestOf(['explicit_confirm']), {
      sections: [registry],
      gate,
    });
    expect(report.whole?.reason).toContain('the gate failed');
    expect(report.sectionGate?.used).toBe(false);
  });
});

describe('selection skips blocks only with a passing, matching gate', () => {
  const passing = selectionGate(specs, registry, rerun);
  const change = manifestOf(['explicit_confirm']);
  const radius = (gate: unknown, over = specs, registries = [registry]) =>
    radiusOf(over, change, { sections: registries, ...(gate === undefined ? {} : { gate }) });

  it('is the whole suite with no gate, as before', () => {
    const report = radius(undefined);
    expect(report.whole?.reason).toBe(SECTION_SELECTION_ADVISORY);
    expect(report.sectionGate).toBeUndefined();
  });

  it('skips the blocks the verified links leave out, with a passing gate', () => {
    const report = radius(passing);
    expect(report.whole).toBeNull();
    expect(report.sectionGate?.used).toBe(true);
    const totals = report.totals.F;
    expect(totals?.out).toBeGreaterThan(0);
    expect(totals?.in).toBeLessThan(totals?.total ?? 0);
    // u4 links explicit_confirm verified: it is in, with the link as its reason.
    const u4 = report.specs
      .find((spec) => spec.specId === 'upgrade-happy')
      ?.blocks.find((b) => b.id === 'u4');
    expect(u4?.state.F).toBe('direct');
    expect(u4?.why.some((why) => why.startsWith('prompt_section:link:acme-sales#explicit_confirm'))).toBe(
      true,
    );
  });

  it('is the whole suite with a failing gate, and says why', () => {
    const report = radius(selectionGate(specs, registry, withPairMisses(rerun, 10)));
    expect(report.whole?.reason).toContain(SECTION_SELECTION_ADVISORY);
    expect(report.whole?.reason).toContain('the gate failed');
    expect(report.sectionGate?.used).toBe(false);
  });

  it('is the whole suite with a gate for another prompt version', () => {
    const report = radius(passing, specs, [{ ...registry, version: 'v2' }]);
    expect(report.whole?.reason).toContain('stale');
  });

  it('is the whole suite once a verified link changed after the gate', () => {
    const added: BlockLink = {
      block: 'u1',
      to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'closing' },
      status: 'verified',
    };
    const changed = specs.map((entry, at) =>
      at === 0
        ? {
            ...entry,
            spec: {
              ...entry.spec,
              metadata: { links: [...((entry.spec.metadata?.links ?? []) as BlockLink[]), added] },
            },
          }
        : entry,
    );
    const report = radius(passing, changed);
    expect(report.whole?.reason).toContain('changed since the gate');
    expect(checkSelectionGate(passing, changed, [registry])).toMatchObject({ ok: false });
  });

  it('is the whole suite with a file that is no gate record, or for a global section', () => {
    expect(radius({ pass: true }).whole?.reason).toContain('not a selection gate record');
    const global = radiusOf(specs, manifestOf(['identity']), { sections: [registry], gate: passing });
    expect(global.whole?.reason).toContain('global');
  });
});
