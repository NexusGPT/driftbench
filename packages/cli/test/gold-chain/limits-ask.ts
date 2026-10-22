import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { variables } from '@agent-nexus/driftbench-estate';
import { type EstateName, estateFolder } from '../../../estate/test/gold/gold';

/**
 * The model port of the limit producer (`variables.produceLimits`) for the gold estates: the answers are recorded
 * once (`record-asks.ts`) in examples/estates/gold-<x>/limits.ask.<model>.jsonl and replayed by the hash of the request.
 * A request with no recorded answer stops the run, so CI never reaches a model.
 */
export const ASK_MODEL = 'claude-haiku-5-5';

export const askBody = (model: string, request: variables.LimitRequest): Record<string, unknown> => ({
  model,
  max_tokens: 400,
  ...(model === ASK_MODEL ? { thinking: { type: 'disabled' } } : {}),
  system: request.system,
  messages: [{ role: 'user', content: request.user }],
});

/** One answer per request: the key is the hash of the body and the run number, which is always 1. */
export const askKey = (body: Record<string, unknown>): string =>
  `${createHash('sha256').update(JSON.stringify(body)).digest('hex')}#1`;

type Entry = { key: string; quote: string; text: string; usage: { input: number; output: number } };
export type Spent = { input: number; output: number; requests: number };

export const askPath = (estate: EstateName, model: string): string =>
  join(estateFolder(estate), `limits.ask.${model}.jsonl`);

export function loadAsks(estate: EstateName, model: string): Map<string, Entry> {
  const path = askPath(estate, model);
  const out = new Map<string, Entry>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line) as Entry;
    out.set(entry.key, entry);
  }
  return out;
}

export const readKey = (): string =>
  readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();

/** The port: replays the recorded answer; with `record`, asks the provider on a miss and appends the answer. */
export function askPort(
  estate: EstateName,
  model: string,
  cache: Map<string, Entry>,
  spent: Spent,
  record?: { key: string; capIn: number; capOut: number },
): variables.LimitAsk {
  return async (request) => {
    const body = askBody(model, request);
    const key = askKey(body);
    const hit = cache.get(key);
    if (hit) return hit.text;
    if (!record) {
      throw new Error(`no recorded answer for a request of estate ${estate} (${model}): run record-asks.ts`);
    }
    if (spent.input >= record.capIn || spent.output >= record.capOut) {
      throw new Error(
        `the token cap is reached (${spent.input} in, ${spent.output} out): nothing more is sent`,
      );
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': record.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`the provider answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const payload = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = payload.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    const entry: Entry = {
      key,
      quote: request.user.slice(request.user.lastIndexOf('INSTRUCTION:\n') + 13),
      text,
      usage: { input: payload.usage.input_tokens, output: payload.usage.output_tokens },
    };
    appendFileSync(askPath(estate, model), `${JSON.stringify(entry)}\n`);
    cache.set(key, entry);
    spent.input += entry.usage.input;
    spent.output += entry.usage.output;
    spent.requests++;
    return text;
  };
}
