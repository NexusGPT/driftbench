import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlockResult, Campaign, Observed, RunResult, TargetRef } from '@agent-nexus/driftbench-core';
import { cellId, StoreError } from '../src/index';

/** Fictional data only: Acme Telecom, Acmeville, local endpoints. */

export const SALES: TargetRef = {
  adapter: 'function',
  agent: 'acme-sales',
  variant: 'prompt-v2',
  options: { temperature: 0, region: 'acmeville' },
};

export const SUPPORT: TargetRef = {
  adapter: 'http',
  agent: 'acme-support',
  options: { url: 'http://localhost:3000/chat' },
};

/** Everything an Observed can carry, segment cost and latency included. */
export function observed(
  text = 'Fiber is not available at 88 Summit Avenue. Acme Air 5G is $35 a month.',
): Observed {
  return {
    segments: [
      {
        type: 'tool_call',
        id: 'call-1',
        label: 'coverage.check',
        input: { address: '88 Summit Avenue, Acmeville' },
        cost: { usd: 0.0004 },
        latencyMs: 210,
      },
      {
        type: 'tool_result',
        id: 'call-1',
        label: 'coverage.check',
        output: { address_id: 'addr-103', fiber_mbps: 0 },
        latencyMs: 35,
      },
      { type: 'text', text, cost: { usd: 0.0011, inputTokens: 820, outputTokens: 41 }, latencyMs: 940 },
      { type: 'card', name: 'plan_card', data: { plan: 'Acme Air 5G', price: 35 } },
    ],
    text,
    toolCalls: [
      {
        id: 'call-1',
        label: 'coverage.check',
        input: { address: '88 Summit Avenue, Acmeville' },
        output: { address_id: 'addr-103', fiber_mbps: 0 },
        startedAt: '2026-10-11T10:00:00.100Z',
        latencyMs: 245,
      },
    ],
    runtime: {
      skills: [{ name: 'catalog', at: '2026-10-11T10:00:00.050Z' }],
      guards: [{ name: 'no_pii_out', verdict: 'pass' }],
      stages: [{ name: 'offer' }],
    },
    artifacts: [{ path: 'out/quote.md', kind: 'markdown', bytes: 120 }],
    workspaceDiff: { created: ['out/quote.md'], changed: [], deleted: [] },
    executions: [{ command: 'node quote.js', exitCode: 0, stdout: 'ok', latencyMs: 80, truncated: false }],
    cost: { usd: 0.0015, inputTokens: 820, outputTokens: 41 },
    latencyMs: 1185,
    raw: {
      trace: {
        spans: [
          { name: 'generate', ms: 940 },
          { name: 'tool', ms: 245 },
        ],
      },
    },
  };
}

export function block(index: number, overrides: Partial<BlockResult> = {}): BlockResult {
  return {
    index,
    blockId: `b${index}`,
    givenHash: `given-${index}`,
    observed: observed(),
    verdicts: [
      {
        id: `b${index}-must-0`,
        kind: 'machine',
        name: 'must',
        gating: true,
        outcome: 'pass',
        evidence: 'matched "Acme Air 5G"',
      },
      {
        id: `b${index}-coverage_before_offer`,
        kind: 'judge',
        name: 'coverage_before_offer',
        gating: true,
        outcome: 'pass',
        score: 1,
        evidence: 'the plan is named after coverage.check returned it',
        reasoning: 'coverage.check ran first',
        judge: {
          cls: 'system1',
          votes: [
            { judge: 'jev', outcome: 'pass' },
            { judge: 'decisions', outcome: 'pass', score: 0.9 },
            { judge: 'jev-2', outcome: 'fail', reasoning: 'too terse' },
          ],
        },
      },
    ],
    stageObserved: 'offer',
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: true,
    ...overrides,
  };
}

type RunInput = Partial<RunResult>;

/** A run whose id is its cell id unless the overrides set one. */
export function run(overrides: RunInput = {}): RunResult {
  const { runId, ...rest } = overrides;
  const base: Omit<RunResult, 'runId'> = {
    specId: 'acme-new-customer-coverage',
    specHash: 'abc123abc123',
    target: SALES,
    mode: 'F',
    repeat: 0,
    status: 'completed',
    blocks: [block(0), block(1)],
    succession: { driftCount: 0, driftRate: 0, longestClean: 2, minOverBlocks: true },
    cost: 0.003,
    latencyMs: 2370,
    startedAt: '2026-10-11T10:00:00.000Z',
    finishedAt: '2026-10-11T10:00:02.370Z',
    cacheHit: false,
    ...rest,
  };
  return { runId: runId ?? cellId(base), ...base };
}

/** A perturbed run that drifted and recovered late, with every optional field set. */
export function perturbedRun(overrides: RunInput = {}): RunResult {
  const { blockId: _blockId, stageObserved: _stageObserved, ...bare } = block(2);
  return run({
    mode: 'P',
    repeat: 1,
    perturbationId: 'off-topic',
    blocks: [
      block(0),
      block(1, {
        injected: true,
        stageObserved: 'details',
        ledgerCheck: { ok: false, contradictions: ['the reply says fiber, the ledger says fiber_mbps 0'] },
        drift: ['X2_contradiction', 'X3_flow'],
        pass: false,
      }),
      bare,
    ],
    succession: {
      firstDriftBlock: 1,
      driftCount: 1,
      driftRate: 1 / 3,
      longestClean: 1,
      minOverBlocks: false,
    },
    recovery: {
      injectedAt: 1,
      turnsToRecover: 1,
      label: 'late',
      collateral: 0,
      safeAction: true,
      clarified: false,
    },
    endState: { match: false, diff: [{ field: 'order.plan', expected: 'Acme Air 5G', observed: null }] },
    cost: 0.0045,
    startedAt: '2026-10-11T10:05:00.000Z',
    finishedAt: '2026-10-11T10:05:04.000Z',
    ...overrides,
  });
}

export function campaign(campaignId = 'acme-2026-10-11', overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId,
    specs: [{ id: 'acme-new-customer-coverage', hash: 'abc123abc123' }],
    targets: [SALES, SUPPORT],
    modes: ['T', 'F', 'P'],
    repeats: { T: 1, F: 3, P: 2 },
    budgetUsd: 2.5,
    judge: { mode: 'hybrid', judges: ['jev', 'openai'], assignment: 'calibration-2026-10' },
    createdAt: '2026-10-11T09:59:00.000Z',
    ...overrides,
  };
}

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'driftbench-store-'));
}

/** Runs the call and returns the StoreError it raised; any other outcome fails the test. */
export async function storeError(call: () => unknown): Promise<StoreError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error('expected a StoreError, the call succeeded');
}
