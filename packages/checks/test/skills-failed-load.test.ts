import { describe, expect, it } from 'vitest';
import { skills } from '../src/checks/skills';
import { acme } from './support/acme';
import { context, observed, run, verdict } from './support/context';

describe('a skill whose load failed is not a use of the skill', () => {
  it('counts only the loads that succeeded', async () => {
    const base = acme('acme-new-customer-coverage');
    const spec = {
      ...base,
      blocks: base.blocks.map((b, i) =>
        i === 0 ? { ...b, expect: { ...(b.expect ?? {}), skills: [{ name: 'pdf', count: 1 }] } } : b,
      ),
    };
    const runtime = {
      skills: [{ name: 'pdf', failed: true }, { name: 'pdf' }],
    };
    const ok = await run(skills, context(spec, 0, observed('ok', [], { runtime } as never)));
    expect(verdict(ok, 'skills.pdf').outcome).toBe('pass');
    expect(verdict(ok, 'skills.pdf').evidence).toContain('1 time');
    expect(verdict(ok, 'skills.pdf').evidence).toContain('1 failed load not counted');
  });

  it('a skill that only failed to load is not used, so a count of one fails', async () => {
    const base = acme('acme-new-customer-coverage');
    const spec = {
      ...base,
      blocks: base.blocks.map((b, i) =>
        i === 0 ? { ...b, expect: { ...(b.expect ?? {}), skills: [{ name: 'pdf', count: 1 }] } } : b,
      ),
    };
    const runtime = { skills: [{ name: 'pdf', failed: true }] };
    const verdicts = await run(skills, context(spec, 0, observed('ok', [], { runtime } as never)));
    expect(verdict(verdicts, 'skills.pdf').outcome).toBe('fail');
  });
});
