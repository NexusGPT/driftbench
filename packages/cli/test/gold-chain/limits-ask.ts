import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type EstateName, estateFolder } from '../../../estate/test/gold/gold';

/**
 * The numbers of a gold estate, asked one instruction at a time. After the labels, each instruction or gate atom
 * gets one structured request with its own quote: does it state a number that limits it? The answer lands on that
 * atom, so nothing is located and nothing is bound. The answers are recorded once (`record-asks.ts`) and replayed;
 * code reads no word of any quote.
 */
export const ASK_MODEL = 'claude-haiku-5-5';
export const COMPARISONS = ['lt', 'le', 'gt', 'ge'] as const;
export type Limit = { limit: number; comparison: (typeof COMPARISONS)[number]; unit?: string };

export const ASK_SYSTEM =
  'You read one instruction from the prompt of an AI agent. Say whether the instruction states a number that limits ' +
  'it: a count, a duration, a size or a threshold that the instruction itself sets. Answer with one JSON object and ' +
  'nothing else: {"limits": [{"limit": <the number as a JSON number>, "comparison": "lt" | "le" | "gt" | "ge", ' +
  '"unit": <what the number counts, a short text, or leave it out>}]}. The comparison says how a quantity is compared ' +
  'with the number for the instruction to hold: lt less than, le at most, gt more than, ge at least. Give an empty ' +
  'list when the instruction states no such number. A number that only names a thing, such as a version or an ' +
  'identifier, is not a limit.';

export const askBody = (model: string, quote: string): Record<string, unknown> => ({
  model,
  max_tokens: 400,
  ...(model === ASK_MODEL ? { thinking: { type: 'disabled' } } : {}),
  system: ASK_SYSTEM,
  messages: [{ role: 'user', content: `INSTRUCTION:\n${quote}` }],
});

export const askKey = (body: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

type Entry = { key: string; quote: string; text: string; usage: { input: number; output: number } };

export const askPath = (estate: EstateName, model: string): string =>
  join(estateFolder(estate), `limits.ask.${model}.jsonl`);

function load(estate: EstateName, model: string): Map<string, Entry> {
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

/** The limits an answer text states, or why it cannot be read. The answer is JSON; anything else gives no limit. */
export function limitsOfAnswer(text: string): { limits: Limit[]; problem?: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return { limits: [], problem: 'no JSON object' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { limits: [], problem: 'the JSON does not parse' };
  }
  const list = (parsed as { limits?: unknown }).limits;
  if (!Array.isArray(list)) return { limits: [], problem: 'no limits list' };
  const limits: Limit[] = [];
  for (const item of list) {
    const { limit, comparison, unit } = (item ?? {}) as Record<string, unknown>;
    if (typeof limit !== 'number' || !Number.isFinite(limit))
      return { limits: [], problem: 'a limit is no number' };
    if (!(COMPARISONS as readonly unknown[]).includes(comparison))
      return { limits: [], problem: 'a comparison is unknown' };
    limits.push({
      limit,
      comparison: comparison as Limit['comparison'],
      ...(typeof unit === 'string' && unit.trim() !== '' ? { unit: unit.trim() } : {}),
    });
  }
  return { limits };
}

export type Spent = { input: number; output: number; requests: number };

/** The answer for a quote: replayed from the cassette; recorded live only when the recorder asks for it. */
export async function answerFor(
  estate: EstateName,
  model: string,
  quote: string,
  cache: Map<string, Entry>,
  spent: Spent,
  record?: { key: string; capIn: number; capOut: number },
): Promise<string> {
  const body = askBody(model, quote);
  const key = askKey(body);
  const hit = cache.get(key);
  if (hit) return hit.text;
  if (!record)
    throw new Error(`no recorded answer for a quote of estate ${estate} (${model}): run record-asks.ts`);
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
  if (!response.ok)
    throw new Error(`the provider answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
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
    quote,
    text,
    usage: { input: payload.usage.input_tokens, output: payload.usage.output_tokens },
  };
  appendFileSync(askPath(estate, model), `${JSON.stringify(entry)}\n`);
  cache.set(key, entry);
  spent.input += entry.usage.input;
  spent.output += entry.usage.output;
  spent.requests++;
  return text;
}

export const loadAsks = load;
export const readKey = (): string =>
  readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();
