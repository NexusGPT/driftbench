import { describe, expect, it } from 'vitest';
import { usageFromResponse } from '../src/index';

describe('usageFromResponse', () => {
  it('reads OpenAI, Anthropic and Google token counts', () => {
    expect(usageFromResponse('openai', { usage: { prompt_tokens: 120, completion_tokens: 30 } })).toEqual({
      input: 120,
      output: 30,
    });
    expect(usageFromResponse('anthropic', { usage: { input_tokens: 90, output_tokens: 12 } })).toEqual({
      input: 90,
      output: 12,
    });
    expect(
      usageFromResponse('google', { usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 9 } }),
    ).toEqual({ input: 70, output: 9 });
  });

  it('gives an empty object for a body with no usage, and ignores a count that is not a number', () => {
    expect(usageFromResponse('openai', {})).toEqual({});
    expect(usageFromResponse('openai', null)).toEqual({});
    expect(usageFromResponse('anthropic', { usage: { input_tokens: '90', output_tokens: -1 } })).toEqual({});
    expect(usageFromResponse('google', { usage: { prompt_tokens: 1 } })).toEqual({});
  });
});
