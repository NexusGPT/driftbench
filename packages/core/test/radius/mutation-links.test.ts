import { describe, expect, it } from 'vitest';
import { analyseMutation, promoteLinks, untestedSections } from '../../src/radius/mutation-analysis';
import { h7, h7Record, h7Specs, keyOf, registry } from './mutation-h7';

/**
 * Link promotion on the stored H7 runs: the analysis reproduces the confirmed flips of every mutant, and
 * the promotion turns declared links into verified or refuted ones, and every selection miss into a new
 * verified link.
 */

const analysis = analyseMutation(h7Record());
const effect = (id: string) => analysis.mutants.find((mutant) => mutant.id === id);

describe('the mutation analysis on the stored H7 runs', () => {
  it('reproduces the confirmed flips (E) of all 170 mutants, and the two flaky blocks', () => {
    expect(analysis.mutants).toHaveLength(170);
    for (const mutant of h7.mutants) {
      const expected = mutant.E.map((id) => keyOf.get(id)).sort();
      expect(effect(mutant.variant)?.killed, mutant.variant).toEqual(expected);
    }
    expect(analysis.flaky).toEqual(['discount#d1', 'home-address-first#af1']);
  });

  it('kills with 25 of 90 single-section mutants (drop 7, negate 17, rephrase 1) and with no control', () => {
    const singles = analysis.mutants.filter((m) => !m.control && !m.pair);
    expect(singles).toHaveLength(90);
    const killing = singles.filter((m) => m.killed.length > 0);
    expect(killing).toHaveLength(25);
    const byOp = (op: string) => killing.filter((m) => m.op === op).length;
    expect([byOp('drop'), byOp('negate'), byOp('rephrase')]).toEqual([7, 17, 1]);
    const controls = analysis.mutants.filter((m) => m.control);
    expect(controls).toHaveLength(60);
    expect(controls.filter((m) => m.killed.length > 0)).toHaveLength(0);
    // Seven controls have a stage-1 candidate; none holds in the confirmation runs.
    expect(controls.filter((m) => m.candidates.length > 0).length).toBeGreaterThan(0);
  });

  it('reports the 12 local sections no mutant kills a block with', () => {
    expect(untestedSections(analysis, registry)).toEqual([
      'scope',
      'needs_question',
      'upgrade_identify',
      'upgrade_more_data',
      'upgrade_order',
      'home_address_first',
      'home_address_unknown',
      'home_access_wording',
      'porting_check_first',
      'porting_ineligible',
      'new_customer_details',
      'no_discounts',
    ]);
  });
});

describe('link promotion on the stored H7 runs', () => {
  const promotion = promoteLinks(h7Specs, analysis, registry);
  const linksOf = (spec: string) => promotion.links.find((each) => each.spec === spec)?.links ?? [];
  const status = (spec: string, block: string, section: string) =>
    linksOf(spec).find(
      (link) => link.block === block && link.to.kind === 'prompt_section' && link.to.section === section,
    )?.status;

  it('verifies a declared link a mutant of its section flips, with the run and counts as evidence', () => {
    expect(status('upgrade-happy', 'u4', 'explicit_confirm')).toBe('verified');
    const link = linksOf('upgrade-happy').find(
      (each) =>
        each.block === 'u4' && each.to.kind === 'prompt_section' && each.to.section === 'explicit_confirm',
    );
    expect(link?.evidence?.verified).toMatchObject({
      run: 'h7',
      mutant: expect.stringMatching(/^explicit_confirm__/),
    });
  });

  it('turns each selection miss of a single-section mutant into a new verified link', () => {
    // explicit_confirm__negate flips the recap blocks, which link recap only (the H7 safety violation).
    for (const [spec, block] of [
      ['upgrade-happy', 'u3'],
      ['upgrade-loose-yes', 'ly2'],
      ['home-happy', 'h3'],
      ['porting-ok', 'p2'],
      ['porting-locked', 'pl2'],
      ['order-failure', 'of1'],
    ] as const) {
      expect(status(spec, block, 'explicit_confirm'), `${spec}#${block}`).toBe('verified');
      const made = promotion.changes.find(
        (change) => change.spec === spec && change.block === block && change.section === 'explicit_confirm',
      );
      expect(made).toMatchObject({ from: null, to: 'verified' });
    }
    const added = linksOf('upgrade-happy').find(
      (each) => each.block === 'u3' && each.created_by === 'mutation',
    );
    expect(added).toMatchObject({ status: 'verified', at_version: 'v1' });
  });

  it('refutes a declared link no mutant of its section flips, and counts every change', () => {
    // upgrade_identify has no killing mutant: its declared links are refuted.
    expect(status('upgrade-happy', 'u1', 'upgrade_identify')).toBe('refuted');
    const count = (from: string | null, to: string) =>
      promotion.changes.filter((change) => change.from === from && change.to === to).length;
    expect([count('declared', 'verified'), count('declared', 'refuted'), count(null, 'verified')]).toEqual([
      25, 30, 20,
    ]);
  });

  it('moves no link of a flaky block', () => {
    const before = h7Specs.find((spec) => spec.id === 'discount')?.metadata?.links;
    expect(linksOf('discount')).toEqual(before);
    expect(promotion.kept.some((each) => each.spec === 'discount')).toBe(true);
  });

  it('moves no link from a pair mutant, and none from a section whose controls are not clean', () => {
    // A pair kill alone verifies nothing: drop every single-section mutant and promote again.
    const pairsOnly = { ...analysis, mutants: analysis.mutants.filter((m) => m.pair || m.control) };
    const none = promoteLinks(h7Specs, pairsOnly, registry);
    expect(none.changes.filter((change) => change.to === 'verified')).toHaveLength(0);
    // A control that kills a block makes its section's links stay as declared.
    const dirty = {
      ...analysis,
      mutants: analysis.mutants.map((m) =>
        m.id === 'explicit_confirm__ctl_punct' ? { ...m, killed: ['upgrade-happy#u4'] } : m,
      ),
    };
    const held = promoteLinks(h7Specs, dirty, registry);
    expect(held.changes.filter((change) => change.section === 'explicit_confirm')).toHaveLength(0);
    expect(held.kept.find((each) => each.section === 'explicit_confirm')?.why).toContain('controls killed');
  });

  it('never verifies a link from a control mutant, and moves nothing with no control', () => {
    const noControls = { ...analysis, mutants: analysis.mutants.filter((m) => !m.control) };
    const result = promoteLinks(h7Specs, noControls, registry);
    expect(result.changes).toHaveLength(0);
    const controlsOnly = { ...analysis, mutants: analysis.mutants.filter((m) => m.control) };
    expect(promoteLinks(h7Specs, controlsOnly, registry).changes).toHaveLength(0);
  });
});

describe('untested sections', () => {
  it('lists only the sections the run mutated', () => {
    const some = {
      ...analysis,
      mutants: analysis.mutants.filter((m) => ['recap', 'scope'].includes(m.sections[0] ?? '')),
    };
    expect(untestedSections(some, registry)).toEqual(['scope']);
  });
});
