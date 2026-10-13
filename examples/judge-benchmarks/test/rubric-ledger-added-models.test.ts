import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { responsesBody, responsesCompletion, responsesPrice, responsesTransport,
  sonnetCompletion, sonnetEnvironment } from '../src/rubric-ledger-added-transports';

describe('added RubricBench model boundaries', () => {
  it('uses Responses medium with a total output cap, no temperature, and schema only for ledger', () => {
    const plain = responsesBody({ system: 's', user: 'u' });
    expect(plain).toMatchObject({ model: 'gpt-6.1-sol', service_tier: 'default', max_output_tokens: 8192, reasoning: { effort: 'medium' } });
    expect(plain).not.toHaveProperty('temperature'); expect(plain).not.toHaveProperty('text');
    const schema = { type: 'object', additionalProperties: false };
    expect(responsesBody({ system: 's', user: 'u', schema }).text?.format).toEqual({ type: 'json_schema', name: 'judge_answer', strict: true, schema });
  });
  it('retains an empty token-limited answer and does not expose thinking text as output', async () => {
    let sent = 0;
    const raw = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [{ text: 'hidden' }] }], usage: { input_tokens: 1500, output_tokens: 8192 } };
    const fake = async () => { sent++; return new Response(JSON.stringify(raw)); };
    const value = await responsesTransport('test-only', fake as typeof fetch).complete({ system: 's', user: 'u' });
    expect(sent).toBe(1); expect(value.text).toBe(''); expect(value.truncated).toBe(true);
    expect(value.usage?.output).toBe(8192); expect(JSON.parse(value.raw)).toEqual(raw);
  });
  it('distinguishes provider blocks and prices cached input without double-counting reasoning', () => {
    const value = responsesCompletion({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'blocked' }] }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 100 } } });
    expect(value.refusal).toBe('blocked'); expect(value.text).toBe('');
    expect(responsesPrice({ ...value, fingerprint: 'x' })).toBeCloseTo(.00324, 9);
  });
  it('caps Sonnet output and disables CLI retries without loading API keys', () => {
    const env = sonnetEnvironment({ PATH: '/bin', ANTHROPIC_API_KEY: 'do-not-use', OPENAI_API_KEY: 'do-not-use', MAX_THINKING_TOKENS: '65536', CLAUDE_CODE_RETRY_WATCHDOG: '1' });
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('8192'); expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('0'); expect(env).not.toHaveProperty('MAX_THINKING_TOKENS');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY'); expect(env).not.toHaveProperty('OPENAI_API_KEY');
  });
  it('keeps a billed Sonnet truncation as a judge result, while network errors remain transport failures', () => {
    const value = sonnetCompletion({ type: 'result', is_error: true, subtype: 'error_max_turns', total_cost_usd: .12, usage: { input_tokens: 100, output_tokens: 8192 } });
    expect(value.truncated).toBe(true); expect(value.text).toBe(''); expect(value.costUsd).toBe(.12);
    expect(() => sonnetCompletion({ type: 'result', is_error: true, subtype: 'error_during_execution', errors: ['network disconnected'] })).toThrow('claude process error');
  });
  it('copies the frozen judge exactly except model family, reservation, type and pricing boundary', () => {
    const old = readFileSync('examples/judge-benchmarks/src/rubric-ledger-live.ts', 'utf8');
    const expected = old.slice(old.indexOf('export async function evaluate('), old.indexOf('\nexport const sourcePaths'))
      .replace('export async function evaluate(', 'export async function evaluateAdded(').replace('model: Model,', 'model: AddedModel,')
      .replace('Promise<DecisionRow>', 'Promise<AddedDecisionRow>').replace('SETTINGS.reserveUsd,', 'ADDED_LIMITS.reserveUsd,')
      .replace("model === 'gpt-6-luna' ? 'openai' : model.startsWith('gemini-') ? 'google' : 'anthropic'", "model === 'gpt-6.1-sol' ? 'openai' : 'anthropic'")
      .replace('runtime.price ?? ((completion) => usagePrice(model, completion))', 'runtime.price ?? (() => undefined)');
    const added = readFileSync('examples/judge-benchmarks/src/rubric-ledger-added-evaluate.ts', 'utf8');
    expect(added.slice(added.indexOf('export async function evaluateAdded(')).trim()).toBe(expected.trim());
  });
});
