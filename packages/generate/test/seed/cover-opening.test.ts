import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { coverDraft } from '../../src/seed/seed-drafts';
import { zedProposal } from '../enumerate/support';

// A hand-written conversation map: every flow has a path and a first-turn recovery. A mixed
// conversation/task map regenerated without its task families has unplaceable cells unrelated to this test.
const proposal = zedProposal();
const kept: Record<string, string[]> = {
  stage: ['greet', 'verify', 'help'],
  stage_transition: ['greet-to-verify', 'verify-to-help'],
  flow: ['balance'],
  deviation: ['D1_off_topic'],
  channel: ['chat', 'email'],
  user: ['customer', 'staff'],
};
proposal.dimensions = proposal.dimensions.filter((dimension) => kept[dimension.id] !== undefined);
for (const dimension of proposal.dimensions)
  dimension.values = dimension.values.filter((value) => kept[dimension.id]?.includes(value.id));
proposal.phrases = proposal.phrases.filter((phrase) => kept[phrase.dimension]?.includes(phrase.value));
proposal.constraints = [];
const by = {
  evidence: {
    source: 'prompt.md',
    quote: 'Greet, verify, help; return to the pending stage after an aside.',
  },
  produced_by: 'code' as const,
  approved: true,
};
proposal.relations = [
  { kind: 'path', id: 'balance-full', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
  { kind: 'recovery', class: 'D1_off_topic', flows: ['balance'], stage_after: 'pending', ...by },
];
const prepared = prepareMap(proposal);
const suite = generateSuite(prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('a cell that holds the start stage', () => {
  it('is covered by a clean walk that declares the first-turn class as its perturbation', () => {
    // A class said on the first turn whose recovery stays there has no Then an idle reply fails, so no
    // block holds it. The cover seeder leaves no such cell unbuilt.
    expect(suite.report.cover?.unbuilt ?? []).toEqual([]);
    for (const row of suite.report.coverage.actual) expect(row.uncovered, `t = ${row.t}`).toEqual([]);
    // Other seeders may already cover the opening cell. Exercise cover's pending-recovery route directly.
    const built = coverDraft(prepared, { seed: 1, t: 3, max: 100 }, 'opening', {
      flow: 'balance',
      stage: 'greet',
      deviation: 'D1_off_topic',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    const rendered = renderDraft(prepared, built.draft, { seed: 1, mapPath: '../map.yaml' });
    expect(rendered.noThen).toEqual([]);
    expect(rendered.placeholders).toEqual([]);
    expect(rendered.reasons).toEqual([]);
    const first = built.draft.perturbations?.find((entry) => entry.inject_at === 0);
    expect(first?.expect?.stage).toBe('greet');
    expect(built.draft.blocks.some((block) => block.injection !== undefined)).toBe(false);
  }, 60_000);
});
