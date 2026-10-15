import * as core from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

type Stamp = { object: string; item: string; impl: string; layer: core.Layer };
type Output = { summary: string; by?: Stamp };
type F5Context = {
  readonly scope: 'block' | 'run' | 'campaign';
  readonly check?: core.CheckContext;
  readonly run?: core.RunResult;
  readonly runs?: readonly core.RunResult[];
  readonly verdicts: readonly core.Verdict[];
  readonly objects: readonly { object: core.ResolvedObject }[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly earlier: readonly Output[];
};

type F5Api = {
  registerDiagnosticStep?: (
    name: string,
    step: {
      params: z.ZodType;
      cost: 'static' | 'run' | 'model';
      run: (ctx: F5Context) => Output | Output[] | undefined;
    },
    registry?: core.ObjectRegistry,
  ) => void;
  runDiagnostics?: (
    diagnostics: readonly core.ResolvedObject[],
    input: {
      check: core.CheckContext;
      verdicts: readonly core.Verdict[];
      objects: readonly [];
    },
    budget?: { runs?: number },
  ) => Promise<{
    diagnoses: Array<Output & { diagnostic: string; step?: string }>;
    skippedForBudget: number;
  }>;
};

/**
 * These expectations deliberately fail until F5 lands AND resolves these two contract gaps. Once an
 * expectation passes, Vitest reports it.fails as an unexpected pass: remove that marker after the rebase.
 * Never substitute the test fixture kind above for the actual core kind in these pending assertions.
 */
describe('pending F5 integration contracts', () => {
  it.fails('TODO PR 453: real runDiagnostics preserves the deciding item output.by stamp', async () => {
    const api = core as unknown as F5Api;
    expect(api.registerDiagnosticStep, 'requires the real F5 registrar').toBeTypeOf('function');
    expect(api.runDiagnostics, 'requires the real F5 runner').toBeTypeOf('function');
    if (!api.registerDiagnosticStep || !api.runDiagnostics) throw new Error('F5 API is not available');

    const registry = new core.ObjectRegistry();
    for (const kind of core.BUILTIN_KINDS) registry.registerKind(kind);
    const deciding: Stamp = {
      object: 'policy/blame:project@12345678',
      item: 'project_rule',
      impl: 'plugin:project-blame',
      layer: 'project',
    };
    const impl = 'plugin:blame-pending-f5-deciding-stamp';
    api.registerDiagnosticStep(
      impl,
      {
        params: z.strictObject({}),
        cost: 'static',
        run: () => ({ summary: 'decided', by: deciding }),
      },
      registry,
    );
    registry.registerShipped(
      {
        kind: 'diagnostic',
        id: 'blame-pending-f5-stamp',
        scope: 'block',
        steps: [{ id: 'attribute', title: 'Attribute the finding', impl }],
      },
      'test diagnostic:blame-pending-f5-stamp',
    );
    const diagnostic = new core.ObjectStore(registry).resolve('diagnostic', 'blame-pending-f5-stamp');
    const result = await api.runDiagnostics([diagnostic], {
      // This step does not read the check; exercise real registration, execution, schema and stamping only.
      check: {} as core.CheckContext,
      verdicts: [],
      objects: [],
    });
    expect(result.skippedForBudget).toBe(0);
    expect(result.diagnoses).toHaveLength(1);
    expect(result.diagnoses[0]).toMatchObject({
      summary: 'decided',
      diagnostic: diagnostic.ref,
      step: 'attribute',
      by: deciding,
    });
  });

  it.fails('TODO PR 453: diagnostic schema accepts and retains any_verdict.gating', () => {
    const when = core.objectRegistry.kind('diagnostic')?.fields?.when;
    expect(when, 'requires the real F5 diagnostic kind').toBeDefined();
    const trigger = { any_verdict: { gating: true, outcome: 'fail' } };
    expect(when && z.safeParse(when, trigger)).toMatchObject({
      success: true,
      data: trigger,
    });
  });

  it.fails('TODO PR 453: diagnostic schema accepts and retains any_diagnosis.confidence', () => {
    const when = core.objectRegistry.kind('diagnostic')?.fields?.when;
    expect(when, 'requires the real F5 diagnostic kind').toBeDefined();
    const trigger = { any_diagnosis: { confidence: ['static', 'undecided'] } };
    expect(when && z.safeParse(when, trigger)).toMatchObject({
      success: true,
      data: trigger,
    });
  });
});
