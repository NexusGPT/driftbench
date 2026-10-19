import type { Expect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { subagents } from '../src/checks/subagents';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const task = acme('acme-price-sheet');
const built = 'The reviewer checked the Summary sheet.';
const dispatched = (...helpers: Array<{ name: string; model?: string }>) => ({
  runtime: { subagents: helpers },
});
const wants: Expect = {
  subagents: [
    { name: 'sheet-reviewer', model: 'sonnet', count: 1 },
    { name: 'web-researcher', count: 0 },
  ],
};

describe('subagents', () => {
  it('passes when the reviewer is dispatched once on its model and no researcher is', async () => {
    const ctx = context(
      task,
      1,
      observed(built, [], dispatched({ name: 'sheet-reviewer', model: 'sonnet' })),
      {
        expect: wants,
      },
    );
    const verdicts = await run(subagents, ctx);
    expect(outcomes(verdicts)).toEqual({
      'subagents.sheet-reviewer.sonnet': 'pass',
      'subagents.web-researcher': 'pass',
    });
    expect(verdict(verdicts, 'subagents.sheet-reviewer.sonnet').evidence).toBe(
      'sheet-reviewer on model sonnet dispatched 1 time, expected exactly 1; helpers dispatched in this block: sheet-reviewer (sonnet)',
    );
  });

  it('mutation: the reviewer runs on another model; the verdict fails and names what ran', async () => {
    const ctx = context(task, 1, observed(built, [], dispatched({ name: 'sheet-reviewer', model: 'opus' })), {
      expect: wants,
    });
    expect(verdict(await run(subagents, ctx), 'subagents.sheet-reviewer.sonnet')).toMatchObject({
      outcome: 'fail',
      evidence:
        'sheet-reviewer on model sonnet dispatched 0 times, expected exactly 1; helpers dispatched in this block: sheet-reviewer (opus)',
    });
  });

  it('mutation: a helper the block forbids is dispatched; its count 0 fails', async () => {
    const ctx = context(
      task,
      1,
      observed(
        built,
        [],
        dispatched({ name: 'sheet-reviewer', model: 'sonnet' }, { name: 'web-researcher' }),
      ),
      { expect: wants },
    );
    expect(verdict(await run(subagents, ctx), 'subagents.web-researcher').outcome).toBe('fail');
  });

  it('checks nothing when the adapter reports no subagents list', () => {
    expect(subagents.applies(context(task, 1, observed(built, [], { runtime: {} }), { expect: wants }))).toBe(
      false,
    );
  });
});
