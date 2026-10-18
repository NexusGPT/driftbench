import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { MAP_COMPONENTS, mapLadderV1 as mapLadder } from '../../src/ladders/map/first';
import { contractStatesRole } from '../../src/ladders/map/oracle';
import { type Extract, runPipeline } from '../../src/ladders/map/run';
import { hiddenSpec } from '../../src/ladders/map/spec';
import { halves, transformOptions, withOneMoreConstraint } from '../../src/ladders/map/transforms';
import { truthOf } from '../../src/ladders/map/truth';
import { orderFreeRoles } from './support';

// biome-ignore lint/suspicious/noExplicitAny: the planted faults edit the proposal as data
type Json = any;

/** The order-free role stand-in, then a planted fault on its proposal. */
function withFault(fault: (proposal: Json, input: Parameters<Extract>[0]) => void): Extract {
  return async (input) => {
    const result = await orderFreeRoles(input);
    if (result.ok) fault(result.proposal, input);
    return result;
  };
}

describe('level 5: metamorphic invariance', () => {
  it('fails while the contract has no role: a permuted prompt moves the persona axis, pointing at the role proposer', async () => {
    // Once the contract carries a role the perfect model sends it and this failure is fixed; the test then has nothing to say.
    if (contractStatesRole()) return;
    for (const seed of [1, 2, 3]) {
      const run = await runLadder(mapLadder(), { seed });
      expect(run.level).toBe(4);
      expect(run.failing?.id).toBe('metamorphic');
      expect(run.rows[4]?.observed).toBe(0.75);
      expect(run.failing?.items).toHaveLength(1);
      expect(run.failing?.items[0]).toMatchObject({
        id: 'transform:permute',
        component: MAP_COMPONENTS.roles,
      });
      expect(run.failing?.items[0]?.detail).toMatch(
        /^the permute transform changed the map: lost role \w+ = (axis|detail)/,
      );
    }
  });

  it('passes with roles that do not depend on order', async () => {
    const run = await runLadder(mapLadder({ extract: orderFreeRoles }), { seed: 2 });
    expect(run.rows[4]).toMatchObject({ id: 'metamorphic', observed: 1, pass: true });
  });

  it('names the transform a planted wording fault breaks', async () => {
    // A fault that drops the rules when the prompt uses a synonym of a template word.
    const extract = withFault((proposal, input) => {
      const prompt = input.sources.find((source) => source.kind === 'prompt')?.text ?? '';
      if (/\bclient\b/.test(prompt)) {
        proposal.dimensions = proposal.dimensions.filter(
          (dimension: { id: string }) => dimension.id !== 'rule',
        );
      }
    });
    const run = await runLadder(mapLadder({ extract }), { seed: 2 });
    expect(run.level).toBe(4);
    expect(run.failing?.items.map((item) => item.id)).toEqual(['transform:synonym']);
    expect(run.failing?.items[0]?.detail).toMatch(
      /^the synonym transform changed the map: lost dimension rule \(behaviour\); role rule = detail/,
    );
  });

  it('keeps the map on the split and decoy transforms of the current extractor', async () => {
    const spec = hiddenSpec(4);
    for (const transform of ['split', 'decoy', 'synonym'] as const) {
      const run = await runPipeline(spec, transformOptions(spec, transform));
      expect(run.result.ok && run.result.refusals).toEqual([]);
    }
  });
});

describe('level 6: additivity and unit response', () => {
  it('splits the prose atoms between the halves, every atom in exactly one half', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = hiddenSpec(seed);
      const [a, b] = halves(spec);
      const ids = (s: typeof spec) => truthOf(s).prose.map((atom) => atom.id);
      expect([...ids(a), ...ids(b)].sort()).toEqual(ids(spec).sort());
      expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
      const constraints = (s: typeof spec) =>
        [...s.stageConstraints, ...s.personaConstraints].map((c) => c.id);
      expect([...constraints(a), ...constraints(b)].sort()).toEqual(constraints(spec).sort());
    }
  });

  it('adds one constraint no constraint forbids yet', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = hiddenSpec(seed);
      const more = withOneMoreConstraint(spec);
      expect(more).not.toBeNull();
      expect(more?.spec.personaConstraints).toHaveLength(spec.personaConstraints.length + 1);
      expect(spec.personaConstraints.map((constraint) => constraint.id)).not.toContain(more?.added.id);
    }
  });

  it('holds on 20 derived specifications once roles do not depend on order', async () => {
    const run = await runLadder(mapLadder({ extract: orderFreeRoles }), { seed: 2 });
    expect(run.rows[5]).toMatchObject({ id: 'composition', observed: 1, pass: true });
  });

  it('names the specifications whose halves lose entries the full prompt gives', async () => {
    // A fault that drops the rules of a prompt holding fewer than five of them.
    const extract = withFault((proposal) => {
      const rules = proposal.dimensions.find((dimension: { id: string }) => dimension.id === 'rule');
      if (rules && rules.values.length < 5) {
        proposal.dimensions = proposal.dimensions.filter(
          (dimension: { id: string }) => dimension.id !== 'rule',
        );
      }
    });
    const run = await runLadder(mapLadder({ extract }), { seed: 2 });
    expect(run.level).toBe(5);
    expect(run.failing?.id).toBe('composition');
    const additivity = run.failing?.items.filter((item) => item.id.startsWith('additivity:')) ?? [];
    expect(additivity.length).toBeGreaterThan(0);
    expect(additivity[0]?.component).toBe(MAP_COMPONENTS.extract);
    expect(additivity[0]?.detail).toMatch(/differs from its full map: lost .*value rule\/R-\d+/);
  });

  it('names the specifications where one more constraint does not give exactly one more', async () => {
    // A fault that keeps at most two constraints of the customer types.
    const extract = withFault((proposal) => {
      let kept = 0;
      proposal.constraints = proposal.constraints.filter((constraint: { forbid: Record<string, string> }) => {
        if (!('customer_type' in constraint.forbid)) return true;
        kept += 1;
        return kept <= 2;
      });
    });
    const run = await runLadder(mapLadder({ extract }), { seed: 2 });
    expect(run.level).toBe(5);
    const unit = run.failing?.items.filter((item) => item.id.startsWith('unit:')) ?? [];
    expect(unit.length).toBeGreaterThan(0);
    expect(unit[0]?.component).toBe(MAP_COMPONENTS.accept);
    expect(unit[0]?.detail).toMatch(
      /^one more constraint \(customer_type=\w+,channel=\w+\) gave 0 more and 0 fewer constraints$/,
    );
  });
});

describe('level 7: roles', () => {
  it('names each dimension whose role differs from the declared one', async () => {
    const run = await runLadder(mapLadder({ extract: orderFreeRoles }), { seed: 1 });
    expect(run.level).toBe(6);
    expect(run.failing?.id).toBe('roles');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['role:customer_type', 'role:language']);
    expect(run.failing?.items[0]?.component).toBe(MAP_COMPONENTS.roles);
    expect(run.failing?.items[0]?.detail).toMatch(
      /^declared detail, proposed axis; the persona axes proposed: customer_type/,
    );
  });

  it('is reachable: a seed whose declared axes come first reaches level 7 of 7', async () => {
    const run = await runLadder(mapLadder({ extract: orderFreeRoles }), { seed: 2 });
    expect(run.level).toBe(7);
    expect(run.failing).toBeNull();
  });
});
