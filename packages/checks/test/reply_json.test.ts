import { describe, expect, it } from 'vitest';
import { replyJson } from '../src/checks/reply_json';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const reply = (text: string, json: Record<string, unknown>) =>
  context(coverage, 1, observed(text), { expect: { json } as never });

describe('json', () => {
  it('passes a reply that is valid JSON with a path that equals its value', async () => {
    const verdicts = await run(
      replyJson,
      reply('{"plan":"mobile","price":35}', { paths: [{ path: 'price', assert: 35 }] }),
    );
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'pass' });
    expect(verdict(verdicts, 'json.valid').evidence).toBe('the reply is valid JSON');
  });

  it('fails a reply that is not JSON, and fails each path it cannot read', async () => {
    const verdicts = await run(
      replyJson,
      reply('Your price is 35.', { paths: [{ path: 'price', assert: 35 }] }),
    );
    expect(failing(verdicts)).toEqual(['json.valid', 'json.path.0']);
    expect(verdict(verdicts, 'json.valid').evidence).toMatch(/^the reply is not valid JSON: /);
  });

  it('reads JSON inside a single Markdown code fence', async () => {
    const verdicts = await run(replyJson, reply('```json\n{"plan":"mobile"}\n```', {}));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass' });
  });

  it('checks a JSON Schema and names the missing key', async () => {
    const schema = { type: 'object', required: ['plan'], properties: { plan: { type: 'string' } } };
    const verdicts = await run(replyJson, reply('{"price":35}', { schema }));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.schema': 'fail' });
    expect(verdict(verdicts, 'json.schema').evidence).toContain('plan');
  });

  it('checks a path that contains a text', async () => {
    const pass = await run(
      replyJson,
      reply('{"note":"Fiber available"}', { paths: [{ path: 'note', assert: { contains: 'Fiber' } }] }),
    );
    const fail = await run(
      replyJson,
      reply('{"note":"5G only"}', { paths: [{ path: 'note', assert: { contains: 'Fiber' } }] }),
    );
    expect(outcomes(pass)['json.path.0']).toBe('pass');
    expect(failing(fail)).toEqual(['json.path.0']);
  });

  it('reads a numeric index in a path', async () => {
    const verdicts = await run(
      replyJson,
      reply('{"plans":[{"name":"Mobile L"}]}', { paths: [{ path: 'plans.0.name', assert: 'Mobile L' }] }),
    );
    expect(outcomes(verdicts)['json.path.0']).toBe('pass');
  });

  it('gives no verdict when the block declares no json', async () => {
    expect(await run(replyJson, context(coverage, 1, observed('{}')))).toEqual([]);
  });

  it('mutation: a price of 36 fails the same path that 35 passes', async () => {
    const passing = await run(replyJson, reply('{"price":35}', { paths: [{ path: 'price', assert: 35 }] }));
    const failed = await run(replyJson, reply('{"price":36}', { paths: [{ path: 'price', assert: 35 }] }));
    expect(outcomes(passing)['json.path.0']).toBe('pass');
    expect(failing(failed)).toEqual(['json.path.0']);
  });
});
