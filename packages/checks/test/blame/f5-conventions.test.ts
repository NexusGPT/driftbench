import { readFileSync } from 'node:fs';
import {
  BUILTIN_KINDS,
  ObjectRegistry,
  ObjectStore,
  parseObjectText,
  type RunResult,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { blame } from '../../src';
import { f7 } from '../fixtures/blame/cases';
import { f5DiagnosticKind } from './f5-contract';

describe('F5 conventions', () => {
  it('registers executable steps through the F5 registrar and matches all reviewed YAML', async () => {
    const registry = new ObjectRegistry();
    for (const kind of BUILTIN_KINDS)
      registry.registerKind(kind.kind === 'diagnostic' ? f5DiagnosticKind() : kind);
    const registered = new Map<string, blame.BlameStep<blame.DiagnosticContext>>();
    const registrar: blame.RegisterDiagnosticStep = (name, step, target) => {
      expect(registered.has(name)).toBe(false);
      registered.set(name, step);
      target.registerImpl(name, step);
    };
    blame.registerBlameObjects(registry, registrar);
    blame.registerBlameObjects(registry, registrar);
    expect([...registered.keys()].sort()).toEqual(blame.blameStepNames());
    const store = new ObjectStore(registry);
    for (const [key, raw] of Object.entries(blame.SHIPPED_DIAGNOSTICS)) {
      const source = new URL(`../../objects/diagnostic/${raw.id}.yaml`, import.meta.url);
      expect(raw).toEqual(parseObjectText(readFileSync(source, 'utf8'), source.pathname).raw);
      expect(registry.shipped().find((entry) => (entry.raw as { id: string }).id === raw.id)?.path).toBe(
        `@agent-nexus/driftbench-checks ${key}`,
      );
      expect(store.resolve('diagnostic', raw.id).items.length).toBeGreaterThan(0);
    }
    const output = await registered.get('builtin:flaky/repeat-disagreement')?.run({
      scope: 'campaign',
      runs: [],
      verdicts: [],
      objects: [],
      params: { min_repeats: 2 },
      earlier: [],
    });
    expect(output).toEqual([]);
  });

  it('uses enum cost classes in every shipped diagnostic', () => {
    for (const id of [
      'code-agent-liability',
      'fix-plan',
      'liability-confirm',
      'value-mismatch',
      'flaky-block',
    ]) {
      const path = new URL(`../../objects/diagnostic/${id}.yaml`, import.meta.url);
      const raw = parseObjectText(readFileSync(path, 'utf8'), path.pathname).raw as { cost: unknown };
      expect(
        z
          .strictObject({
            model_calls: z.enum(['none', 'conditional', 'always']).optional(),
            agent_runs: z.enum(['none', 'conditional', 'always']).optional(),
          })
          .safeParse(raw.cost).success,
        id,
      ).toBe(true);
    }
  });

  it('campaign steps read stored block diagnoses with no extra F5 context', async () => {
    const one = f7(1);
    const diagnoses = blame.diagnoseBlock({
      verdicts: one.verdicts,
      evidenceFor: one.input,
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    }).diagnoses;
    const runs = [
      { runId: 'r', blocks: [{ index: 0, diagnoses: diagnoses.map(blame.toStepOutput) }] },
    ] as unknown as RunResult[];
    expect(blame.campaignDiagnoses(runs)).toMatchObject(diagnoses.map((one) => ({ ...one, block: 'r:0' })));
    const mixed = [
      ...runs,
      {
        runId: 's',
        blocks: [
          {
            index: 0,
            diagnoses: [
              ...diagnoses.map(blame.toStepOutput),
              { summary: 'unrelated diagnostic', confidence: 'static' },
            ],
          },
        ],
      },
    ] as unknown as RunResult[];
    expect(blame.campaignDiagnoses(mixed).map((one) => one.block)).toEqual(['r:0', 's:0']);
    const ctx = { runs, objects: [], earlier: [], params: { n: 10, by: [] } };
    const ranked = await blame.CAMPAIGN_STEPS['builtin:rank/top-n']?.run(ctx);
    expect(ranked).toHaveLength(1);
    expect(ranked?.[0]).toMatchObject({ score: 1, evidence: { blocks: 1 } });
    const plan = await blame.CAMPAIGN_STEPS['builtin:confirm/plan']?.run({ ...ctx, params: { runs: 3 } });
    expect(plan?.[0]?.evidence?.plan).toEqual(expect.any(Array));
    expect(((plan?.[0]?.evidence?.plan ?? []) as unknown[]).length).toBeGreaterThan(0);
    const rejudge = await blame.CAMPAIGN_STEPS['builtin:diagnostic/rerun']?.run(ctx);
    expect(rejudge?.[0]?.evidence?.block).toBe('r:0');
    const confirmation = await blame.CAMPAIGN_STEPS['builtin:confirm/run']?.run({
      ...ctx,
      params: { runs: 3, budget_usd: 0, reference_target: null },
    });
    expect(confirmation?.[0]?.evidence).toMatchObject({ runs_made: 0, cost_usd: 0 });
  });
});
