// Independent of package imports: offline tests exercise resumability and the budget gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const hash = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export const readLines = (path) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
export const append = (path, row) => appendFileSync(path, `${JSON.stringify(row)}\n`);

export class Budget {
  constructor(path, cap = 20) {
    this.path = path;
    this.cap = cap;
    this.rows = new Map();
    for (const row of readLines(path)) this.rows.set(row.key, row);
  }
  get used() {
    return [...this.rows.values()].reduce((sum, row) => sum + (row.usd ?? row.reserve), 0);
  }
  reserve(key, usd, metadata) {
    if (this.rows.has(key)) throw new Error('CALL_ALREADY_STARTED');
    if (!(usd > 0) || this.used + usd > this.cap) throw new Error('BUDGET_CAP');
    const row = { key, reserve: usd, status: 'reserved', ...metadata };
    this.rows.set(key, row);
    append(this.path, row);
  }
  settle(key, usd) {
    const previous = this.rows.get(key);
    if (!previous || !Number.isFinite(usd) || usd < 0 || usd > previous.reserve) throw new Error('INVALID_COST');
    const row = { ...previous, status: 'settled', usd };
    this.rows.set(key, row);
    append(this.path, row);
  }
}

export async function workers(tasks, concurrency, run) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < tasks.length) await run(tasks[index++]);
  }));
}

export function redact(error) {
  return String(error?.message ?? error).replace(/sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|nxs_[A-Za-z0-9_-]+/g, '[redacted]');
}

export function costOf(model, response) {
  if (model === 'haiku') {
    if (!Number.isFinite(response.costUsd)) throw new Error('MISSING_HAIKU_COST');
    return response.costUsd;
  }
  const raw = JSON.parse(response.raw);
  if (model === 'gpt-6-luna') {
    const u = raw.usage;
    if (!u) throw new Error('MISSING_OPENAI_USAGE');
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    return ((u.prompt_tokens - cached) * .1 + cached * .01 + u.completion_tokens * .5) / 1e6;
  }
  const u = raw.usageMetadata;
  if (!u) throw new Error('MISSING_GOOGLE_USAGE');
  return ((u.promptTokenCount ?? 0) * .75 + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * 3.75) / 1e6;
}
