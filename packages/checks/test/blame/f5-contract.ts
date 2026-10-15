import * as core from '@agent-nexus/driftbench-core';
import { z } from 'zod';
/** Exact F5 fields at PR 453 572d92e56; test-only compatibility fixture, never production registration. */
export const F5_DIAGNOSTIC_FIELDS = {
  scope: z.enum(['block', 'run', 'campaign']).optional(),
  when: z
    .strictObject({
      always: z.literal(true).optional(),
      any_verdict: z
        .strictObject({
          name: z.string().min(1).optional(),
          outcome: z.enum(['pass', 'fail', 'inconclusive', 'not_applicable']).optional(),
          id_contains: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  reads: z.array(z.string().min(1)).optional(),
  output: z.strictObject({ fields: z.array(z.string().min(1)) }).optional(),
  default: z.boolean().optional(),
  cost: z
    .strictObject({
      model_calls: z.enum(['none', 'conditional', 'always']).optional(),
      agent_runs: z.enum(['none', 'conditional', 'always']).optional(),
    })
    .optional(),
};

/** Isolated registries can use this kind while testing against the actual F5 schema contract. */
export function f5DiagnosticKind() {
  const kind = core.BUILTIN_KINDS.find((one) => one.kind === 'diagnostic');
  if (!kind) throw new Error('the builtin diagnostic kind is missing');
  return { ...kind, ownImpls: true, fields: F5_DIAGNOSTIC_FIELDS };
}
