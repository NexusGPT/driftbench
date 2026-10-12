import { describe, expect, it } from 'vitest';
import { FakeJudge } from '../src/clients/fake';
import { judgePersonalData, PII_CRITERION } from '../src/pii-judge';

describe('judgePersonalData: a judge reads one message for a person name or a personal address', () => {
  it('maps pass to personal data and fail to none', async () => {
    expect(await judgePersonalData(new FakeJudge('j', [{ outcome: 'pass', reasoning: 'a name' }]), 'x')).toBe(
      'personal',
    );
    expect(await judgePersonalData(new FakeJudge('j', [{ outcome: 'fail', reasoning: 'none' }]), 'x')).toBe(
      'none',
    );
  });

  it('names company, product, shop, place and city names as not personal data', () => {
    expect(PII_CRITERION.fail).toMatch(/company/i);
    expect(PII_CRITERION.fail).toMatch(/product/i);
    expect(PII_CRITERION.fail).toMatch(/city/i);
  });

  it('a judge that gives no answer throws', async () => {
    await expect(judgePersonalData(new FakeJudge('j', [new Error('down')]), 'x')).rejects.toThrow(/down/);
  });

  it('an inconclusive answer throws too: it is never read as no personal data', async () => {
    await expect(
      judgePersonalData(new FakeJudge('j', [{ outcome: 'inconclusive', reasoning: 'unparsed' }]), 'x'),
    ).rejects.toThrow(/no answer/);
  });
});
