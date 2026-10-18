import { describe, expect, it } from 'vitest';
import { prepareMap } from '../../src/seed/map';
import { reachableFeasibility } from '../../src/seed/seeders';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const evidence = { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' };
const by = { evidence, produced_by: 'model' as const, approved: true };

/** Zed Bank: the balance flow passes greet, verify and help and recovers from an off-topic question. */
function prepared() {
  const proposal = zedProposal();
  proposal.relations = [
    { kind: 'path', id: 'balance-full', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    { kind: 'path', id: 'card-lost', flow: 'card', stages: ['greet', 'lost'], ...by },
    { kind: 'recovery', class: 'D1_off_topic', flows: ['balance'], stage_after: 'pending', ...by },
  ];
  return prepareMap(proposal, { tools: ZED_TOOLS });
}

function allowed(prepare: ReturnType<typeof prepared>, pairs: Array<[string, string]>): boolean {
  const feasibility = reachableFeasibility(prepare);
  return feasibility.allowed(
    pairs.map(([dimension, value]) => {
      const at = prepare.space.dimensions.findIndex((entry) => entry.id === dimension);
      return [at, prepare.space.dimensions[at]?.index.get(value) ?? -1] as const;
    }),
  );
}

describe('reachableFeasibility', () => {
  it('rules out a deviation no path recovers from, and a stage no path reaches with a flow', () => {
    const map = prepared();
    // The balance flow has a recovery and a phrase for an off-topic question; the card flow has none.
    expect(allowed(map, [['deviation', 'D1_off_topic']])).toBe(true);
    expect(
      allowed(map, [
        ['deviation', 'D1_off_topic'],
        ['flow', 'balance'],
      ]),
    ).toBe(true);
    expect(
      allowed(map, [
        ['deviation', 'D1_off_topic'],
        ['flow', 'card'],
      ]),
    ).toBe(false);
    // No path recovers from a language switch: it is possible on no cell.
    expect(
      allowed(map, [
        ['deviation', 'D5_language_switch'],
        ['channel', 'chat'],
      ]),
    ).toBe(false);
    // The card flow reaches lost; the balance flow never does.
    expect(
      allowed(map, [
        ['stage', 'lost'],
        ['flow', 'card'],
      ]),
    ).toBe(true);
    expect(
      allowed(map, [
        ['stage', 'lost'],
        ['flow', 'balance'],
      ]),
    ).toBe(false);
  });
});
