import { Inventory } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { ProposalRelation } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { phraseDrafts, type UnsaidPhrase } from '../../src/seed/phrase-seeder';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const by = {
  evidence: { source: 'prompt.md', quote: 'Card checks belong to the short card desk conversation.' },
  produced_by: 'code' as const,
  approved: true,
};
const texts = {
  'S-101': 'Please check the card desk.',
  'S-202': 'Please review the closed desk.',
  'S-303': 'Please check the card desk again.',
};

function desk(extraCardPhrase = false) {
  const ids = extraCardPhrase ? Object.keys(texts) : ['S-101', 'S-202'];
  const proposal = zedProposal({
    extra: [
      {
        id: 'behaviour',
        title: 'Desk checks',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: ids.map((id) => ({ id, title: id, ...by })),
      },
    ],
  });
  proposal.phrases = proposal.phrases.filter((phrase) => phrase.dimension === 'stage_transition');
  for (const value of ids)
    proposal.phrases.push({
      dimension: 'behaviour',
      value,
      text: texts[value as keyof typeof texts],
      lang: 'en',
      produced_by: 'code',
      approved: true,
    });
  const relations: ProposalRelation[] = [
    { kind: 'path', id: 'long-balance', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    { kind: 'path', id: 'short-card', flow: 'card', stages: ['greet', 'verify'], ...by },
  ];
  proposal.relations = relations;
  const inventory = Inventory.parse({
    behaviours: ids.map((id) => ({ id, title: id })),
    flows: [
      { id: 'balance', title: 'Balance desk', behaviours: [] },
      { id: 'card', title: 'Card desk', behaviours: extraCardPhrase ? ['S-101', 'S-303'] : ['S-101'] },
      { id: 'closed-desk', title: 'Closed desk', behaviours: ['S-202'] },
    ],
  });
  return { proposal, inventory };
}

function run(extraCardPhrase = false, seed = 1013) {
  const { proposal, inventory } = desk(extraCardPhrase);
  const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
  const unsaid: UnsaidPhrase[] = [];
  const drafts = phraseDrafts(prepared, { seed, t: 2, max: 100 }, new Set(), 0, unsaid);
  return { prepared, drafts, unsaid };
}

describe('a behaviour phrase stays on a path of its owning flow', () => {
  it.each([1013, 2203, 4409])(
    'uses the short owning path instead of a longer unrelated path, seed %i',
    (seed) => {
      const { prepared, drafts } = run(false, seed);
      const draft = drafts.find((entry) => entry.title.startsWith('Phrase of behaviour=S-101:'));
      expect(draft?.path).toBe('short-card');
      expect(draft?.blocks.at(-1)?.stage).toBe('verify');
      for (const block of draft?.blocks ?? [])
        expect(prepared.relations.paths.find((path) => path.id === draft?.path)?.stages).toContain(
          block.stage,
        );
    },
  );

  it('reports an owning flow without a path instead of borrowing another flow', () => {
    const { drafts, unsaid } = run();
    expect(drafts.some((draft) => draft.title.startsWith('Phrase of behaviour=S-202:'))).toBe(false);
    expect(unsaid).toContainEqual(
      expect.objectContaining({
        value: 'S-202',
        text: texts['S-202'],
        reasons: expect.arrayContaining([expect.stringContaining('owning flow')]),
      }),
    );
  });

  it('does not move a sibling into an unrelated flow to free an owning slot', () => {
    const { drafts, unsaid } = run(true);
    expect(drafts.filter((draft) => draft.title.startsWith('Phrase of behaviour='))).toHaveLength(1);
    expect(drafts[0]?.path).toBe('short-card');
    expect(unsaid.map((entry) => entry.value).sort()).toEqual(['S-202', 'S-303']);
  });

  it('reports a behaviour no flow lists', () => {
    const { proposal, inventory } = desk();
    for (const flow of inventory.flows) flow.behaviours = [];
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
    const unsaid: UnsaidPhrase[] = [];
    expect(phraseDrafts(prepared, { seed: 1061, t: 2, max: 100 }, new Set(), 0, unsaid)).toEqual([]);
    expect(unsaid.map((entry) => entry.value).sort()).toEqual(['S-101', 'S-202']);
    expect(unsaid.every((entry) => entry.reasons.length > 0)).toBe(true);
  });

  it('uses explicit path behaviour membership when no inventory is supplied', () => {
    const { proposal } = desk();
    for (const path of proposal.relations ?? [])
      if (path.kind === 'path') path.behaviours = path.flow === 'card' ? ['S-101'] : [];
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS });
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(prepared, { seed: 1047, t: 2, max: 100 }, new Set(), 0, unsaid);
    expect(drafts.map((draft) => draft.path)).toEqual(['short-card']);
    expect(unsaid.map((entry) => entry.value)).toEqual(['S-202']);
  });
});
