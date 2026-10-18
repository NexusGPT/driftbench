import type { Expect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { toolsOffered } from '../src/checks/tools_offered';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

/**
 * `tools_offered`: which tools the runtime offered the agent in the block, read from
 * `observed.runtime.offered`. A tool a setting denies is not offered, so a deleted deny rule shows here even
 * when the agent never calls the tool.
 */

const task = acme('acme-price-sheet');
const offered = (...tools: string[]) => ({ runtime: { offered: tools } });
const wants: Expect = { tools_offered: { include: ['Read', 'Edit'], exclude: ['WebFetch'] } };

describe('tools_offered', () => {
  it('passes when every included tool is offered and every excluded one is not', async () => {
    const verdicts = await run(
      toolsOffered,
      context(task, 1, observed('Done.', [], offered('Read', 'Edit', 'Bash')), { expect: wants }),
    );
    expect(outcomes(verdicts)).toEqual({
      'tools_offered.include.Read': 'pass',
      'tools_offered.include.Edit': 'pass',
      'tools_offered.exclude.WebFetch': 'pass',
    });
  });

  it('mutation: a denied tool appears in the offered list; the exclude verdict fails and names it', async () => {
    const verdicts = await run(
      toolsOffered,
      context(task, 1, observed('Done.', [], offered('Read', 'Edit', 'WebFetch')), { expect: wants }),
    );
    expect(verdict(verdicts, 'tools_offered.exclude.WebFetch')).toMatchObject({
      outcome: 'fail',
      evidence:
        'WebFetch was offered, expected not offered; tools offered in this block: Read, Edit, WebFetch',
    });
  });

  it('mutation: a tool disappears from the offered list; the include verdict fails', async () => {
    const verdicts = await run(
      toolsOffered,
      context(task, 1, observed('Done.', [], offered('Read')), { expect: wants }),
    );
    expect(verdict(verdicts, 'tools_offered.include.Edit')).toMatchObject({
      outcome: 'fail',
      evidence: 'Edit was not offered, expected offered; tools offered in this block: Read',
    });
  });

  it('is inconclusive when the runtime did not report what it offered, and does not apply without the expectation', async () => {
    const verdicts = await run(
      toolsOffered,
      context(task, 1, observed('Done.', [], { runtime: { skills: [] } }), { expect: wants }),
    );
    expect(new Set(Object.values(outcomes(verdicts)))).toEqual(new Set(['inconclusive']));
    const none = context(task, 1, observed('Done.', [], offered('Read')), { expect: {} });
    expect(toolsOffered.applies(none)).toBe(false);
  });
});
