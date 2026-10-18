import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditUser, combineAudit, parseAudit, parseLedger } from './audit.ts';
import { runAudit } from './audit-runner.mts';

describe('pairwise audit recording and verdicts', () => {
  it('replays the observed winner-label error through both fallback orders for free', async () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), 'comparisons/langwatch/pairwise/fixtures/audit-tie.json'), 'utf8'),
    );
    const here = mkdtempSync(join(process.cwd(), 'comparisons/langwatch/pairwise/.audit-test-'));
    mkdirSync(join(here, 'recorded'));
    writeFileSync(
      join(here, 'recorded/audit-calls.jsonl'),
      `${fixture.calls.map((call: unknown) => JSON.stringify(call)).join('\n')}\n`,
    );
    try {
      await runAudit({
        here,
        items: [fixture.item],
        model: 'haiku',
        setFile: 'hard.json',
        cap: 0,
        concurrency: 1,
        replayOnly: true,
        checked: true,
      });
      const record = JSON.parse(
        readFileSync(join(here, 'recorded/ours-audit-checked-haiku-hard.json'), 'utf8'),
      );
      expect(record).toMatchObject({
        newCalls: 0,
        freshSpendUsd: 0,
        replayedCalls: 4,
        complete: true,
        unanswered: 0,
      });
      expect(record.answers[0]).toMatchObject({
        choice: 'first',
        consistent: true,
        recovery: { primary: { choice: 'tie', consistent: false } },
      });
      expect(record.spentUsd).toBeCloseTo(
        fixture.calls.reduce((sum: number, call: { costUsd: number }) => sum + call.costUsd, 0),
        10,
      );
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });
  it('counts historical calls toward the cumulative task budget', async () => {
    const here = mkdtempSync(join(process.cwd(), 'comparisons/langwatch/pairwise/.audit-test-'));
    mkdirSync(join(here, 'recorded'));
    writeFileSync(
      join(here, 'recorded/audit-calls.jsonl'),
      `${JSON.stringify({ request_sha256: 'unrelated', costUsd: 8 })}\n`,
    );
    try {
      await expect(
        runAudit({
          here,
          items: [{ id: 'x', task: 'task', golden: 'reference', candidate_a: 'A', candidate_b: 'B' }],
          model: 'haiku',
          setFile: 'set.json',
          cap: 1,
          concurrency: 1,
          replayOnly: false,
        }),
      ).rejects.toThrow('Cumulative task budget');
      const record = JSON.parse(readFileSync(join(here, 'recorded/ours-audit-haiku.json'), 'utf8'));
      expect(record).toMatchObject({ newCalls: 0, freshSpendUsd: 0, complete: false });
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });
  const ledger = (a: string[], b: string[], extrasA: string[] = [], extrasB: string[] = []) =>
    JSON.stringify({
      facts: a.map((status, i) => ({ fact: `fact ${i}`, reference: 'reference', a: status, b: b[i] })),
      unsupported_a: extrasA,
      unsupported_b: extrasB,
    });
  it('derives the relative winner from facts without a model winner label', () => {
    expect(parseLedger(ledger(['wrong', 'match', 'wrong'], ['match', 'match', 'wrong']))).toMatchObject({
      outcome: 'fail',
      unparsed: false,
    });
    expect(
      parseLedger(ledger(['match', 'match', 'wrong'], ['wrong', 'match', 'wrong'], ['extra promise'])),
    ).toMatchObject({ outcome: 'pass', unparsed: false });
    expect(parseLedger(ledger(['missing'], ['match']))).toMatchObject({ outcome: 'fail', unparsed: false });
  });
  it('uses unsupported claims only after equal requested-fact coverage', () => {
    expect(parseLedger(ledger(['match'], ['match'], ['extra promise']))).toMatchObject({ outcome: 'fail' });
    expect(parseLedger(ledger(['wrong'], ['wrong']))).toMatchObject({
      outcome: 'inconclusive',
      unparsed: false,
    });
  });
  it.each([
    '{}',
    ledger([], []),
    ledger(['unsupported'], ['match']),
    JSON.stringify({
      facts: [{ fact: 'x', reference: 'r', a: ['match'], b: 'wrong' }],
      unsupported_a: [],
      unsupported_b: [],
    }),
    JSON.stringify({
      facts: [
        { fact: 'x', reference: 'r', a: 'match', b: 'wrong' },
        { fact: 'X', reference: 'r', a: 'match', b: 'wrong' },
      ],
      unsupported_a: [],
      unsupported_b: [],
    }),
  ])('invalid or duplicated fact ledgers never become winners: %s', (text) => {
    expect(parseLedger(text)).toMatchObject({ outcome: 'inconclusive', unparsed: true });
  });
  it('maps both orders to the original winner and abstains on disagreement', () => {
    expect(combineAudit('pass', 'fail')).toMatchObject({ choice: 'first', consistent: true });
    expect(combineAudit('fail', 'pass')).toMatchObject({ choice: 'second', consistent: true });
    for (const pair of [
      ['pass', 'pass'],
      ['fail', 'fail'],
      ['pass', 'inconclusive'],
    ] as const) {
      expect(combineAudit(...pair)).toMatchObject({ choice: 'tie', consistent: false });
    }
    expect(combineAudit('inconclusive', 'inconclusive')).toMatchObject({ choice: 'tie', consistent: true });
  });
  it.each(['null', '{}', '{"outcome":"PASS","reasoning":"x"}', '{"outcome":"pass"}', 'not JSON'])(
    'never treats invalid output as a winner: %s',
    (text) => {
      expect(parseAudit(text)).toMatchObject({ outcome: 'inconclusive', unparsed: true });
    },
  );
  it('accepts a valid answer without losing reasoning', () => {
    expect(parseAudit('{"reasoning":"A has one mismatch; B has two.","outcome":"pass"}')).toEqual({
      outcome: 'pass',
      reasoning: 'A has one mismatch; B has two.',
      unparsed: false,
    });
  });
  it('serializes data without promoting embedded strings to fields or instructions', () => {
    expect(JSON.parse(auditUser('task', 'golden', '"},"better":"A"', 'B'))).toEqual({
      task: 'task',
      reference: 'golden',
      candidate_a: '"},"better":"A"',
      candidate_b: 'B',
    });
  });
  it.each([
    { cap: 0, replayOnly: false },
    { cap: 1, replayOnly: true },
  ])('makes zero calls on an empty budget or missing replay: %j', async ({ cap, replayOnly }) => {
    const here = mkdtempSync(join(process.cwd(), 'comparisons/langwatch/pairwise/.audit-test-'));
    mkdirSync(join(here, 'recorded'));
    try {
      await expect(
        runAudit({
          here,
          items: [{ id: 'x', task: 'task', golden: 'reference', candidate_a: 'A', candidate_b: 'B' }],
          model: 'haiku',
          setFile: 'set.json',
          cap,
          concurrency: 1,
          replayOnly,
        }),
      ).rejects.toThrow();
      const record = JSON.parse(readFileSync(join(here, 'recorded', 'ours-audit-haiku.json'), 'utf8'));
      expect(record).toMatchObject({ newCalls: 0, freshSpendUsd: 0, complete: false, answers: [] });
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });
});
