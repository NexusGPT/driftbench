import { type CheckContext, Expect } from '@agent-nexus/driftbench-core';
import { createCouncil, FakeJudge, judgePersonalData } from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import { type DefaultChecksOptions, defaultChecks } from '../src/defaults';
import { acme } from './support/acme';
import { context, observed, run } from './support/context';

const text = 'Contact the fictional customer Mira Example at 12 Example Lane.';
function ctx(enabled?: boolean, reply = text): CheckContext {
  return context(acme('acme-new-customer-coverage'), 0, observed(reply), {
    expect: enabled === undefined ? {} : { pii_judge: enabled },
  });
}
async function evaluate(enabled?: boolean, options: DefaultChecksOptions = {}, reply = text) {
  const check = defaultChecks(options).find((entry) => entry.name === 'pii');
  if (!check) throw new Error('missing default pii check');
  return run(check, ctx(enabled, reply));
}

describe('personal-data judging is explicit per block', () => {
  it('accepts the boolean spec key, but no truthy strings', () => {
    expect(Expect.parse({ pii_judge: true })).toEqual({ pii_judge: true });
    expect(Expect.parse({ pii_judge: false })).toEqual({ pii_judge: false });
    expect(Expect.safeParse({ pii_judge: 'true' }).success).toBe(false);
  });

  it('calls the exported judge for an opted-in name and address, and keeps regex verdicts', async () => {
    const client = new FakeJudge('pii-test', [{ outcome: 'pass', reasoning: 'fixture name' }]);
    const result = await evaluate(true, { piiJudge: (value) => judgePersonalData(client, value) });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.transcript).toEqual([{ role: 'user', text }]);
    expect(result).toHaveLength(5);
    expect(result.find((v) => v.id === 'pii.personal_data')).toMatchObject({
      kind: 'judge',
      outcome: 'fail',
      gating: true,
    });
    expect(JSON.stringify(result)).not.toContain('Mira Example');
  });

  it('does not spend when the key is absent or false, or the reply is empty', async () => {
    const client = new FakeJudge('pii-test', [{ outcome: 'pass', reasoning: 'fixture name' }]);
    const options = { piiJudge: (value: string) => judgePersonalData(client, value) };
    for (const enabled of [undefined, false]) {
      expect((await evaluate(enabled, options)).every((v) => v.outcome === 'pass')).toBe(true);
    }
    expect(await evaluate(true, options, '')).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it('uses the configured council without a second SDK callback', async () => {
    const client = new FakeJudge('pii-test', [{ outcome: 'pass', reasoning: 'fixture name' }]);
    const council = createCouncil({ mode: 'system1', size: 1, judges: [client], agentFamily: 'none' });
    const result = await evaluate(true, { judges: council });
    expect(client.requests).toHaveLength(1);
    expect(result.find((v) => v.id === 'pii.personal_data')?.outcome).toBe('fail');
  });

  it('passes when the judge finds no name or address', async () => {
    const client = new FakeJudge('pii-test', [{ outcome: 'fail', reasoning: 'no name' }]);
    const result = await evaluate(true, { piiJudge: (value) => judgePersonalData(client, value) });
    expect(result.find((v) => v.id === 'pii.personal_data')).toMatchObject({ outcome: 'pass', gating: true });
  });

  it('gates as inconclusive with no configured judge', async () => {
    expect((await evaluate(true)).find((v) => v.id === 'pii.personal_data')).toMatchObject({
      outcome: 'inconclusive',
      gating: true,
    });
  });

  it('keeps failures and abstentions inconclusive without echoing model errors or personal data', async () => {
    for (const answer of [new Error(text), { outcome: 'inconclusive' as const, reasoning: text }]) {
      const client = new FakeJudge('pii-test', [answer]);
      const result = await evaluate(true, { piiJudge: (value) => judgePersonalData(client, value) });
      expect(result.find((v) => v.id === 'pii.personal_data')).toMatchObject({
        outcome: 'inconclusive',
        gating: true,
      });
      expect(JSON.stringify(result)).not.toContain('Mira Example');
    }
  });
});
