import * as core from '@agent-nexus/driftbench-core';
import {
  type ObjectRegistry,
  ObjectStore,
  objectRegistry,
  type ResolvedObject,
} from '@agent-nexus/driftbench-core';
import { PLACEMENT_IMPLS } from '../placement/apply';
import { SHIPPED_DIAGNOSTICS } from './diagnostics';
import { BLAME_IMPLS } from './impls';
import { SHIPPED_OBJECTS } from './shipped';
import {
  BLOCK_STEPS,
  type BlameStep,
  type BlockStepContext,
  CAMPAIGN_STEPS,
  type CampaignStepContext,
} from './steps';

export { SHIPPED_DIAGNOSTICS } from './diagnostics';
export { SHIPPED_OBJECTS } from './shipped';
export const DIAGNOSTIC_FIELDS = ['scope', 'when', 'reads', 'output', 'cost'] as const;

export type DiagnosticContext = Omit<BlockStepContext, 'check'> & {
  scope: 'block' | 'run' | 'campaign';
  check?: BlockStepContext['check'];
  runs?: CampaignStepContext['runs'];
};
export type RegisterDiagnosticStep = (
  name: string,
  step: BlameStep<DiagnosticContext>,
  registry: ObjectRegistry,
) => void;
const framework = core as unknown as {
  registerDiagnosticStep?: RegisterDiagnosticStep;
  diagnosticStep?: (name: string) => BlameStep<DiagnosticContext> | undefined;
};

function registerData(registry: ObjectRegistry, data: Record<string, unknown>): void {
  for (const [key, raw] of Object.entries(data)) {
    if (
      !registry.shipped().some((entry) => {
        const value = entry.raw as { kind: string; id: string };
        return `${value.kind}:${value.id}` === key;
      })
    )
      registry.registerShipped(raw, `@agent-nexus/driftbench-checks ${key}`);
  }
}

/** F5 supplies both the kind schema and the executable registrar; neither is backported here. */
export function diagnosticKindReady(registry: ObjectRegistry = objectRegistry): boolean {
  const fields = registry.kind('diagnostic')?.fields ?? {};
  return DIAGNOSTIC_FIELDS.every((name) => name in fields);
}

/** Checks load registers shipped TS data. The injected registrar is for isolated framework contract tests. */
export function registerBlameObjects(
  registry: ObjectRegistry = objectRegistry,
  registerDiagnosticStep = framework.registerDiagnosticStep,
): ObjectRegistry {
  for (const [name, impl] of [...Object.entries(BLAME_IMPLS), ...Object.entries(PLACEMENT_IMPLS)]) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: impl.params, summary: impl.summary });
  }
  registerData(registry, SHIPPED_OBJECTS);
  if (!diagnosticKindReady(registry) || !registerDiagnosticStep) return registry;
  for (const [name, source] of [...Object.entries(BLOCK_STEPS), ...Object.entries(CAMPAIGN_STEPS)]) {
    if (registry.impl(name)) continue;
    // F5's executable map is process-wide. Additional isolated registries share its executable.
    const known =
      registerDiagnosticStep === framework.registerDiagnosticStep
        ? framework.diagnosticStep?.(name)
        : undefined;
    if (known) {
      const metadata = { params: known.params, summary: known.summary, kinds: ['diagnostic'] };
      registry.registerImpl(name, metadata);
      continue;
    }
    const step: BlameStep<DiagnosticContext> = {
      params: source.params,
      cost: source.cost,
      summary: source.summary,
      run: (ctx) => {
        // TODO PR 453: F5 must preserve an explicit output.by beside its own diagnostic-step stamp.
        if (name in BLOCK_STEPS) {
          if (ctx.scope !== 'block' || !ctx.check) return undefined;
          return BLOCK_STEPS[name]?.run({ ...ctx, check: ctx.check });
        }
        if (ctx.scope !== 'campaign') return undefined;
        return CAMPAIGN_STEPS[name]?.run({ ...ctx, runs: ctx.runs ?? [] });
      },
    };
    registerDiagnosticStep(name, step, registry);
  }
  registerData(registry, SHIPPED_DIAGNOSTICS);
  return registry;
}

export function shippedPolicy(
  kind: 'policy/blame' | 'policy/placement',
  registry: ObjectRegistry = objectRegistry,
): ResolvedObject {
  registerBlameObjects(registry);
  return new ObjectStore(registry).resolve(kind, 'default');
}
