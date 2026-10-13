#!/usr/bin/env node
// A stand-in for `claude -p --output-format json` that answers through the OpenAI or Gemini HTTP API, so the
// benchmark harness runs any contestant's prompt, unchanged, on a non-Anthropic model. It prints the same
// JSON the claude command prints: { result, total_cost_usd, is_error }. Keys come from the environment only.
import { appendFileSync } from 'node:fs';

const PRICES = {
  // USD per 1M tokens, standard tier, read from the providers' pricing pages on 2026-10-13.
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
};
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const model = flag('--model');
const system = flag('--system-prompt') ?? '';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const user = Buffer.concat(chunks).toString('utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, headers, body) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
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

function out(result, cost, isError, usage) {
  if (process.env.SHIM_USAGE_LOG)
    appendFileSync(
      process.env.SHIM_USAGE_LOG,
      `${JSON.stringify({ t: Date.now(), model, cost, isError, ...usage })}\n`,
    );
  process.stdout.write(JSON.stringify({ result, total_cost_usd: cost, is_error: isError }));
}

try {
  const price = PRICES[model];
  if (!price) throw new Error(`no price for model ${model}`);
  if (model.startsWith('gpt-')) {
    const payload = await post(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      {
        model,
        reasoning_effort: process.env.SHIM_OPENAI_EFFORT || 'low',
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      },
    );
    const input = payload.usage?.prompt_tokens ?? 0;
    const output = payload.usage?.completion_tokens ?? 0;
    const cost = (input * price.input + output * price.output) / 1e6;
    out(payload.choices?.[0]?.message?.content ?? '', cost, false, { input, output });
  } else if (model.startsWith('gemini-')) {
    const payload = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: user }] }],
        ...(model.includes('lite')
          ? {}
          : {
              generationConfig: {
                thinkingConfig: { thinkingLevel: process.env.SHIM_GEMINI_THINKING || 'low' },
              },
            }),
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
      out(`provider refused: ${JSON.stringify(payload.promptFeedback ?? {})}`, cost, false, {
        input,
        output,
      });
    else out(text, cost, false, { input, output });
  } else throw new Error(`unknown provider for ${model}`);
} catch (cause) {
  const message = String(cause instanceof Error ? cause.message : cause).replace(
    /sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/g,
    '[redacted]',
  );
  out(`shim error: ${message}`, 0, true, {});
}
