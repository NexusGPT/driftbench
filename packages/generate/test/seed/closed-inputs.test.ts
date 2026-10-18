import type { ToolExpect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { zedProposal } from '../enumerate/support';

describe('generated closed inputs', () => {
  it('closes fully specified calls and preserves partial legacy input assertions', () => {
    const prepared = prepareMap(zedProposal(), {
      tools: [
        {
          name: 'lookup',
          slug: 'lookup',
          input: {
            type: 'object',
            properties: { account: { type: 'string' }, summary: { type: 'string' } },
          },
        },
      ],
    });
    const tools: ToolExpect[] = [
      { label: 'lookup', input: { account: '4' }, input_closed: true },
      { label: 'lookup', input: { account: '4', summary: { nonempty: true as const } }, input_closed: true },
    ];
    const rendered = renderDraft(
      prepared,
      {
        id: 'closed',
        seeder: 'graph',
        title: 'Closed input',
        stream: 1,
        cell: [],
        criteria: [],
        blocks: [
          {
            id: 'b1',
            carries: [],
            tools,
            stimulus: {
              kind: 'phrase',
              phrase: {
                dimension: 'flow',
                value: 'balance',
                text: 'Look up account 4.',
                lang: 'en',
                produced_by: 'code',
                approved: true,
              },
            },
          },
        ],
        perturbations: [{ id: 'p1', class: 'D8_tool_failure', inject_at: 0, expect: { tools } }],
      },
      { seed: 1, mapPath: 'approved.yaml' },
    );
    const block = (rendered.spec.blocks as Array<{ expect: { tools: unknown[] } }>)[0];
    expect(block?.expect.tools).toEqual([{ label: 'lookup', input: { account: '4' } }, tools[1]]);
    const perturbation = (rendered.spec.perturbations as Array<{ expect: { tools: unknown[] } }>)[0];
    expect(perturbation?.expect.tools).toEqual(block?.expect.tools);
  });
});
