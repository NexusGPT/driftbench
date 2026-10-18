import assert from 'node:assert/strict';
import { createDialectTransport } from '../../packages/judges/src/clients/transport';
import { normalizeResponses, responsesBody, responsesCost, responsesFetch } from './responses-adapter';

const schema = {
  type: 'object',
  properties: { pass: { type: 'boolean' } },
  required: ['pass'],
  additionalProperties: false,
};
let physical = 0,
  captured: any;
const transport = createDialectTransport({
  provider: 'openai',
  model: 'gpt-6.1-sol',
  env: { OPENAI_API_KEY: 'fixture' },
  reasoning: 'medium',
  maxTokens: 32768,
  maxRetries: 0,
  fetch: responsesFetch(
    async (v) => {
      captured = v;
    },
    async (url, init) => {
      physical++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const b = JSON.parse(String(init.body));
      assert.equal(b.max_output_tokens, 32768);
      assert.equal(b.reasoning.effort, 'medium');
      assert(!('temperature' in b));
      assert.equal(b.service_tier, 'default');
      assert.deepEqual(b.text.format.schema, schema);
      assert.deepEqual(b.input, [
        { role: 'system', content: 'frozen system' },
        { role: 'user', content: 'frozen input' },
      ]);
      return new Response(
        JSON.stringify({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'message', content: [{ type: 'output_text', text: '{"pass":true}' }] },
          ],
          usage: {
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 200 },
            output_tokens: 32768,
            output_tokens_details: { reasoning_tokens: 32760 },
          },
        }),
        { status: 200 },
      );
    },
  ),
});
const r = await transport.complete({ system: 'frozen system', user: 'frozen input', schema });
assert.equal(physical, 1);
assert.equal(r.text, '{"pass":true}');
assert.equal(r.truncated, true);
assert.equal(r.finishReason, 'length');
assert(Math.abs(responsesCost(captured) - 0.3293) < 1e-9);
assert.equal(
  normalizeResponses({
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [],
  }).choices[0].message.content,
  '',
);
assert.throws(() =>
  responsesBody({ model: 'gpt-6.1-sol', reasoning_effort: 'medium', max_completion_tokens: 65536 }),
);
assert.throws(() =>
  responsesBody({
    model: 'gpt-6.1-sol',
    reasoning_effort: 'medium',
    max_completion_tokens: 32768,
    temperature: 0,
  }),
);
assert(
  Math.abs(
    responsesCost({
      usage: {
        input_tokens: 15000,
        input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 },
        output_tokens: 0,
      },
    }) - 0.0087,
  ) < 1e-10,
);
assert.throws(() =>
  responsesCost({
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 80, cache_write_tokens: 80 },
      output_tokens: 0,
    },
  }),
);
console.log(
  JSON.stringify({ tests: 6, providerCalls: 0, coreDialectBound: true, outputLimitPreserved: true }),
);
