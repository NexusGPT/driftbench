import { BlockResult, Campaign, Observed, RunResult, Segment, Verdict } from '@driftbench/core';
import { describe, expect, it } from 'vitest';

const observed = {
  segments: [
    { type: 'text', text: 'Hello, I am the Acme assistant.' },
    { type: 'tool_call', id: 'c1', label: 'lookup_plans', input: { speed: 'ultra' } },
    { type: 'tool_result', id: 'c1', label: 'lookup_plans', output: [{ name: 'Ultra', price: 40 }] },
    { type: 'text', text: 'Ultra costs 40 a month.' },
  ],
  text: 'Hello, I am the Acme assistant.\nUltra costs 40 a month.',
  toolCalls: [
    {
      id: 'c1',
      label: 'lookup_plans',
      input: { speed: 'ultra' },
      output: [{ name: 'Ultra', price: 40 }],
      latencyMs: 120,
    },
  ],
  cost: { usd: 0.002, inputTokens: 900, outputTokens: 60 },
  latencyMs: 1800,
};

const verdict = {
  id: 'b0-must-0',
  kind: 'machine',
  name: 'must',
  gating: true,
  outcome: 'pass',
  evidence: 'matched "Acme" at offset 14',
};

describe('run records', () => {
  it('accept an observed block with segments in order', () => {
    expect(Observed.parse(observed).segments).toHaveLength(4);
  });

  it('refuse an unknown segment type', () => {
    expect(Segment.safeParse({ type: 'image', url: 'x' }).success).toBe(false);
  });

  it('accept a judge verdict with its votes, refuse an unknown outcome', () => {
    const judged = {
      ...verdict,
      id: 'b0-greets_once',
      kind: 'judge',
      name: 'greets_once',
      judge: {
        cls: 'system1',
        votes: [
          { judge: 'jev', outcome: 'pass' },
          { judge: 'decisions', outcome: 'pass' },
          { judge: 'jev-2', outcome: 'fail' },
        ],
      },
    };
    expect(Verdict.parse(judged).judge?.votes).toHaveLength(3);
    expect(Verdict.safeParse({ ...verdict, outcome: 'maybe' }).success).toBe(false);
  });

  it('accept a full run result', () => {
    const block = {
      index: 0,
      givenHash: 'abc123abc123',
      observed,
      verdicts: [verdict],
      stepObserved: 'welcome',
      ledgerCheck: { ok: true, contradictions: [] },
      drift: [],
      pass: true,
    };
    expect(BlockResult.parse(block).pass).toBe(true);
    const run = {
      runId: 'r1',
      specId: 'acme-upgrade',
      specHash: 'abc123abc123',
      target: { adapter: 'function', agent: 'acme' },
      mode: 'P',
      repeat: 0,
      perturbationId: 'off-topic',
      status: 'completed',
      blocks: [block],
      succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: true },
      recovery: { injectedAt: 1, turnsToRecover: 0, label: 'immediate', collateral: 0 },
      cost: 0.002,
      latencyMs: 1800,
      startedAt: '2026-10-11T10:00:00Z',
      finishedAt: '2026-10-11T10:00:02Z',
      cacheHit: false,
    };
    expect(RunResult.parse(run).mode).toBe('P');
    expect(RunResult.safeParse({ ...run, mode: 'X' }).success).toBe(false);
  });

  it('accept a campaign and refuse one without modes', () => {
    const campaign = {
      campaignId: 'c1',
      specs: [{ id: 'acme-upgrade', hash: 'abc123abc123' }],
      targets: [{ adapter: 'http', options: { url: 'http://localhost:3000/chat' } }],
      modes: ['T', 'F', 'P'],
      repeats: { T: 2, F: 5, P: 5 },
      budgetUsd: 10,
      judge: { mode: 'hybrid', judges: ['jev', 'openai'] },
      createdAt: '2026-10-11T10:00:00Z',
    };
    expect(Campaign.parse(campaign).repeats.F).toBe(5);
    expect(Campaign.safeParse({ ...campaign, modes: [] }).success).toBe(false);
  });
});
