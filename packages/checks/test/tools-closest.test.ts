import { describe, expect, it } from 'vitest';
import { tools } from '../src/checks/tools';
import { acme } from './support/acme';
import { context, observed, run, verdict } from './support/context';

describe('a missing expected tool names the closest observed call and its position', () => {
  it('a near-miss name is reported as the closest call, with its position', async () => {
    const base = acme('acme-new-customer-coverage');
    const spec = {
      ...base,
      blocks: base.blocks.map((b, i) =>
        i === 0
          ? { ...b, expect: { ...(b.expect ?? {}), tools: [{ label: 'catalog.search', count: 1 }] } }
          : b,
      ),
    };
    const calls = [{ label: 'coverage.check' }, { label: 'catalog.serch' }, { label: 'notify_sales' }];
    const verdicts = await run(tools, context(spec, 0, observed('ok', calls)));
    const count = verdict(verdicts, 'tools.catalog.search.count');
    expect(count.outcome).toBe('fail');
    expect(count.evidence).toContain('closest call: catalog.serch (call 2)');
  });
});
