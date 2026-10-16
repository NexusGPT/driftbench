import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { calibrate, type JudgeClient, loadCriteria } from '../src/index';

const fixtures = fileURLToPath(new URL('../../../examples/acme/criteria', import.meta.url));

it.each(['budget', 'provider', 'config'] as const)(
  'counts a terminal %s result once and retains its cost without reasking',
  async (kind) => {
    const { criteria } = await loadCriteria(fixtures);
    let calls = 0;
    const judge: JudgeClient = {
      id: 'terminal',
      family: 'fixture',
      cls: 'system2',
      cost: 1,
      async judge() {
        calls++;
        return {
          raw: '',
          unparsed: true,
          answer: { outcome: 'inconclusive', reasoning: 'No evaluation was obtained.' },
          costUsd: 0.004,
          defaultJudge: {
            version: 'fixture',
            route: 'criterion',
            receipts: [],
            failure: { kind, message: 'Stopped.' },
          },
        };
      },
    };
    const report = await calibrate({
      judges: [judge],
      criteria: criteria.slice(0, 1),
      labels: new Map(),
      repeats: 1,
    });
    expect(calls).toBe(2);
    expect(report.errors).toBe(2);
    expect(report.spentUsd).toBeCloseTo(0.008, 9);
    expect(report.criteria[0]?.judges[0]).toMatchObject({
      errors: 2,
      calls: 2,
      separation: { pass: ['inconclusive'], fail: ['inconclusive'] },
    });
    expect(report.criteria[0]?.judges[0]?.misses).toContain('2 call(s) gave no answer');
  },
);

it('retains normal reasks but reports a terminal failure at the larger budget', async () => {
  const { criteria } = await loadCriteria(fixtures);
  const budgets: string[] = [];
  const judge: JudgeClient = {
    id: 'terminal',
    family: 'fixture',
    cls: 'system2',
    cost: 1,
    async judge(request) {
      budgets.push(request.budget ?? 'normal');
      return {
        raw: '',
        unparsed: true,
        answer: { outcome: 'inconclusive', reasoning: 'No evaluation was obtained.' },
        ...(request.budget === 'large'
          ? {
              costIncomplete: true as const,
              defaultJudge: {
                version: 'fixture',
                route: 'criterion',
                receipts: [],
                failure: { kind: 'provider' as const, message: 'Unknown billed cost.' },
              },
            }
          : { costUsd: 0.002 }),
      };
    },
  };
  const report = await calibrate({
    judges: [judge],
    criteria: criteria.slice(0, 1),
    labels: new Map(),
    repeats: 1,
  });
  expect(budgets).toEqual(['normal', 'large', 'normal', 'large']);
  expect(report.errors).toBe(2);
  expect(report.spentUsd).toBeCloseTo(0.004, 9);
  expect(report.costIncompleteCalls).toBe(2);
});
