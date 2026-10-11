import { describe, expect, it } from 'vitest';
import { FakeModelPort, ModelError, portFromEnv } from '../../src/model';

describe('FakeModelPort', () => {
  it('replays the recorded answers in order and keeps every request', async () => {
    const port = new FakeModelPort(['first', (request) => `echo ${request.user}`]);
    expect(port.family).toBe('fake');
    expect(port.remaining).toBe(2);
    expect(await port.complete({ system: 's', user: 'one' })).toBe('first');
    expect(await port.complete({ system: 's', user: 'two' })).toBe('echo two');
    expect(port.requests.map((request) => request.user)).toEqual(['one', 'two']);
    expect(port.remaining).toBe(0);
  });

  it('throws a recorded error, then fails with exhausted when the answers run out', async () => {
    const port = new FakeModelPort([new ModelError('http', '503 overloaded_error: busy', { status: 503 })], {
      family: 'other',
      model: 'other-1',
    });
    await expect(port.complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      code: 'http',
      status: 503,
    });
    await expect(port.complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'exhausted' });
    expect(port.model).toBe('other-1');
  });
});

describe('portFromEnv', () => {
  it('prefers Anthropic when both keys are set, and follows an explicit provider', () => {
    const env = { ANTHROPIC_API_KEY: 'a-key', OPENAI_API_KEY: 'o-key', OPENAI_MODEL: 'gpt-5' };
    expect(portFromEnv({ env }).family).toBe('anthropic');
    expect(portFromEnv({ env, provider: 'openai' }).family).toBe('openai');
    expect(portFromEnv({ env: { OPENAI_API_KEY: 'o-key', OPENAI_MODEL: 'gpt-5' } }).family).toBe('openai');
  });

  it('fails with a config error when no key is set or the provider is unknown', () => {
    expect(() => portFromEnv({ env: {} })).toThrowError(/no model key/);
    expect(() => portFromEnv({ env: { ANTHROPIC_API_KEY: 'a-key' }, provider: 'mystery' })).toThrowError(
      /unknown provider "mystery"/,
    );
  });
});
