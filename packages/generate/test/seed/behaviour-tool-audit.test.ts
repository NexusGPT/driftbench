import { describe, expect, it } from 'vitest';
import { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { phraseDrafts } from '../../src/seed/phrase-seeder';
import { zedProposal } from '../enumerate/support';

const by = {
  produced_by: 'code' as const,
  approved: true,
  evidence: { source: 'prompt.md', quote: 'Inspect the cobalt record and explain the decision.' },
};
function proposal(link = false) {
  const p = zedProposal();
  p.agent = 'cobalt-audit';
  p.constraints = [];
  p.dimensions = p.dimensions.filter((d) =>
    ['stage', 'stage_transition', 'flow', 'channel', 'user'].includes(d.id),
  );
  const flow = p.dimensions.find((d) => d.id === 'flow');
  if (!flow) throw new Error('missing fixture flow');
  flow.values = flow.values.filter((v) => v.id === 'balance');
  p.dimensions.push({
    id: 'behaviour',
    title: 'Record behaviours',
    kind: 'behaviour',
    role: 'axis',
    produced_by: 'code',
    approved: true,
    values: ['inspect-cobalt', 'explain-cobalt'].map((id) => ({ id, title: id, ...by })),
  });
  p.phrases = p.phrases.filter((p) => p.dimension === 'stage_transition');
  p.phrases.push(
    ...['inspect-cobalt', 'explain-cobalt'].map((value) => ({
      dimension: 'behaviour',
      value,
      text: `Please ${value.replace('-', ' ')}.`,
      lang: 'en',
      ...by,
    })),
  );
  p.relations = [
    {
      kind: 'path',
      id: 'cobalt-route',
      flow: 'balance',
      stages: ['greet', 'verify', 'help'],
      behaviours: ['inspect-cobalt', 'explain-cobalt'],
      end_state: { source: 'tool:cobalt_archive', mode: 'subset', expect: { status: 'accepted' } },
      ...by,
    },
  ];
  if (link)
    for (const stage of ['verify', 'help'])
      p.relations.push({
        kind: 'uses_tool',
        subject: { dimension: 'behaviour', value: 'inspect-cobalt' },
        tool: 'cobalt_inspect',
        stage,
        to: stage,
        when: { channel: ['email'] },
        input: { code: 'ORBIT' },
        ...by,
      });
  return Proposal.parse(p);
}

describe('auditor behaviour call contract on a non-bank map', () => {
  it.each([37, 41, 43, 47])('keeps channel and literal input on seed %i', (seed) => {
    const prepared = prepareMap(proposal(true), {
      tools: [
        {
          name: 'cobalt_inspect',
          slug: 'cobalt_inspect',
          input: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
        },
      ],
    });
    const drafts = phraseDrafts(prepared, { seed, t: 2, max: 20 }, new Set(), 0);
    const draft = drafts.find((d) => d.title.includes('behaviour=inspect-cobalt'));
    expect(draft).toBeDefined();
    if (!draft) throw new Error('the approved behaviour must be exercised');
    const cell = Object.fromEntries(
      draft.cell.map(([di, vi]) => [
        prepared.space.dimensions[di]?.id,
        prepared.space.dimensions[di]?.values[vi]?.id,
      ]),
    );
    expect(cell.channel).toBe('email');
    expect(draft.blocks.at(-1)?.tools).toContainEqual({
      label: 'cobalt_inspect',
      count: 1,
      input: { code: 'ORBIT' },
      input_closed: true,
    });
  });
});
