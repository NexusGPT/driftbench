#!/usr/bin/env node
// A stand-in for `claude -p --output-format json` that answers through the OpenAI or Gemini HTTP API, so the
// benchmark harness runs any contestant's prompt, unchanged, on a non-Anthropic model. It prints the same
// JSON the claude command prints: { result, total_cost_usd, is_error }. Keys come from the environment only.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRICES = {
  // USD per 1M tokens, standard tier. Verified 2026-10-13:
  // https://developers.openai.com/api/docs/pricing
  // https://developers.openai.com/api/docs/models/gpt-6-luna
  // Above 272K input tokens: input/cache price doubles, output price increases by 1.5x.
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5, longContext: 272000 },
  // The remaining price rows are retained from examples/council/llm-shim.mjs.
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(fetcher, url, headers, body) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    if (response.ok) return JSON.parse(text);
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < 5 &&
      !/spending cap|quota/i.test(text)
    ) {
      await sleep(1500 * attempt);
      continue;
    }
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  }
}

function googleSchema(value) {
  if (Array.isArray(value)) return value.map(googleSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'additionalProperties' && key !== '$schema')
      .map(([key, nested]) => [key, googleSchema(nested)]),
  );
  if (Array.isArray(value.type)) {
    const nonNull = value.type.filter((type) => type !== 'null');
    if (nonNull.length !== 1) throw new Error('Google responseSchema needs one non-null type');
    result.type = nonNull[0];
    if (value.type.includes('null')) result.nullable = true;
  }
  if (Array.isArray(value.anyOf)) {
    const nonNull = value.anyOf.filter((part) => part.type !== 'null');
    if (nonNull.length === 1 && nonNull.length < value.anyOf.length) {
      delete result.anyOf;
      Object.assign(result, googleSchema(nonNull[0]), { nullable: true });
    }
  }
  return result;
}

/** Import-safe for mocked contract tests. The executable path reads stdin once below. */
export async function runShim({ argv, input: user, env = process.env, fetch: fetcher = globalThis.fetch }) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
  };
  let model;
  const out = (result, cost, isError, usage) => {
    if (env.SHIM_USAGE_LOG)
      appendFileSync(
        env.SHIM_USAGE_LOG,
        `${JSON.stringify({ t: Date.now(), model, cost, isError, ...usage })}\n`,
      );
    return {
      type: 'result',
      subtype: isError ? 'error_during_execution' : 'success',
      result,
      total_cost_usd: cost,
      is_error: isError,
    };
  };
  try {
    model = flag('--model');
    const system = flag('--system-prompt') ?? '';
    const schemaText = flag('--json-schema');
    const schema = schemaText === undefined ? undefined : JSON.parse(schemaText);
    if (schema !== undefined && (!schema || typeof schema !== 'object' || Array.isArray(schema)))
      throw new Error('--json-schema needs a JSON schema object');
    const effortFlag = flag('--reasoning-effort');
    const price = PRICES[model];
    if (!price) throw new Error(`no price for model ${model}`);
    if (model.startsWith('gpt-')) {
      const payload = await post(
        fetcher,
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        {
          model,
          ...((effortFlag ?? env.SHIM_OPENAI_EFFORT)
            ? { reasoning_effort: effortFlag ?? env.SHIM_OPENAI_EFFORT }
            : {}),
          ...(schema === undefined
            ? {}
            : {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'judge_answer', strict: true, schema },
                },
              }),
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user },
          ],
        },
      );
      const input = payload.usage?.prompt_tokens ?? 0;
      const output = payload.usage?.completion_tokens ?? 0;
      const cached = Math.min(input, payload.usage?.prompt_tokens_details?.cached_tokens ?? 0);
      const long = price.longContext !== undefined && input > price.longContext;
      const cost =
        ((input - cached) * price.input * (long ? 2 : 1) +
          cached * (price.cached ?? price.input) * (long ? 2 : 1) +
          output * price.output * (long ? 1.5 : 1)) /
        1e6;
      return out(payload.choices?.[0]?.message?.content ?? '', cost, false, { input, output, cached });
    } else if (model.startsWith('gemini-')) {
      const payload = await post(
        fetcher,
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': env.GEMINI_API_KEY },
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: user }] }],
          ...(schema !== undefined || (effortFlag ?? env.SHIM_GEMINI_THINKING)
            ? {
                generationConfig: {
                  ...(schema === undefined
                    ? {}
                    : { responseMimeType: 'application/json', responseSchema: googleSchema(schema) }),
                  ...((effortFlag ?? env.SHIM_GEMINI_THINKING)
                    ? { thinkingConfig: { thinkingLevel: effortFlag ?? env.SHIM_GEMINI_THINKING } }
                    : {}),
                },
              }
            : {}),
        },
      );
      const meta = payload.usageMetadata ?? {};
      const input = meta.promptTokenCount ?? 0;
      const output = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
      const cost = (input * price.input + output * price.output) / 1e6;
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      if (!payload.candidates?.length)
        return out(`provider refused: ${JSON.stringify(payload.promptFeedback ?? {})}`, cost, false, {
          input,
          output,
        });
      return out(text, cost, false, { input, output });
    } else throw new Error(`unknown provider for ${model}`);
  } catch (cause) {
    let message = String(cause instanceof Error ? cause.message : cause).replace(
      /sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/g,
      '[redacted]',
    );
    for (const key of [env.OPENAI_API_KEY, env.GEMINI_API_KEY])
      if (key) message = message.split(key).join('[redacted]');
    return out(`shim error: ${message}`, 0, true, {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = await runShim({
    argv: process.argv.slice(2),
    input: Buffer.concat(chunks).toString('utf8'),
  });
  process.stdout.write(JSON.stringify(result));
}
