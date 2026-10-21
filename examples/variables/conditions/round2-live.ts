import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicPort } from '../../../packages/generate/src';
import { createJevJudge } from '../../../packages/judges/src';
import { ROUND2_MODELS } from './round2';

export const secret = (file: string) => readFileSync(join(homedir(), '.nexus-secrets', file), 'utf8').trim();
export const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Published list prices verified 2026-10-21:
 * https://docs.typesafe.ai/models ($0.042/M input, output free, jev-1.13.0)
 * https://platform.claude.com/docs/en/about-claude/pricing ($2/M input, $10/M output, Sonnet 5.5)
 */
export function liveRound2(budgetFile: string, receiptFile: string, run: string) {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8')) as {
    totalUsd: number;
    calls: unknown[];
    [key: string]: unknown;
  };
  let spentUsd = 0;
  let calls = 0;
  let firstProviderDate: string | null = null;
  let lastProviderDate: string | null = null;
  const reservations = { jev: 64_000 * 0.042 / 1e6, anthropic: (1_000_000 * 2 + 2000 * 10) / 1e6 };
  let reservedUsd = 0;
  const transport = (family: 'jev' | 'anthropic', sealed = false) => async (url: string, init: RequestInit) => {
    // Reserve the published full context window plus the configured output ceiling,
    // not an invented token rate. Actual response usage releases the reservation.
    const reserve = reservations[family];
    if (budget.totalUsd + reservedUsd + reserve > 13) throw new Error('USD 13 actual-price lane cap');
    reservedUsd += reserve;
    try {
      const body = String(init.body);
      const request = JSON.parse(body);
      const expected = family === 'jev' ? ROUND2_MODELS.reader : ROUND2_MODELS.proposer;
      if (request.model !== expected) throw new Error('unexpected model');
      const response = await fetch(url, init);
      const payload = await response.clone().json();
      const usage = payload.usage;
      if (response.ok && (!usage || typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number')) {
        throw new Error('successful response lacks token usage');
      }
      const input = usage?.input_tokens ?? 0;
      const output = usage?.output_tokens ?? 0;
      const creation = usage?.cache_creation_input_tokens ?? 0;
      const cached = usage?.cache_read_input_tokens ?? 0;
      const costUsd = family === 'jev' ? input * 0.042 / 1e6
        : (input * 2 + output * 10 + creation * 2.5 + cached * 0.1) / 1e6;
      spentUsd += costUsd;
      budget.totalUsd += costUsd;
      calls++;
      const date = response.headers.get('date');
      firstProviderDate ??= date;
      lastProviderDate = date;
      const receipt = {
        run, family, phase: sealed ? 'secondary' : 'reader', model: payload.model ?? expected,
        id: payload.id ?? response.headers.get('request-id'), providerDate: date,
        status: response.status, usage, costUsd, requestHash: hash(body),
      };
      budget.calls.push(receipt);
      // No authorization headers are saved. Secondary requests contain sealed
      // titles: only their hashes and usage may leave memory.
      appendFileSync(receiptFile, JSON.stringify(sealed ? receipt : { ...receipt, request, response: payload }) + '\n');
      writeFileSync(budgetFile, JSON.stringify(budget) + '\n');
      return response;
    } finally {
      reservedUsd -= reserve;
    }
  };
  const judge = (sealed: boolean) => createJevJudge({
    env: { JEV_ROUTE: 'typesafe', JEV_API_KEY: secret('jev-typesafe.key'), JEV_MODEL: ROUND2_MODELS.reader },
    fetch: transport('jev', sealed), maxRetries: 0,
  });
  return {
    judge: judge(false),
    secondaryJudge: judge(true),
    port: createAnthropicPort({
      env: { ANTHROPIC_API_KEY: secret('anthropic-driftbench.key'), ANTHROPIC_MODEL: ROUND2_MODELS.proposer },
      fetch: transport('anthropic'), maxRetries: 0,
    }),
    totals: () => ({ spentUsd, totalLaneUsd: budget.totalUsd, calls, firstProviderDate, lastProviderDate }),
  };
}
