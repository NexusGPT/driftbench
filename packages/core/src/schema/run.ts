import { z } from 'zod';
import { DriftClass, Message, TargetRef, WorldState } from './common';

/**
 * Run records written by the runner. Keys are camelCase. A run is one spec, on one target, in one
 * mode, for one repeat.
 */

export const RunMode = z.enum(['T', 'F', 'P']);
export type RunMode = z.infer<typeof RunMode>;

export const Outcome = z.enum(['pass', 'fail', 'inconclusive']);
export type Outcome = z.infer<typeof Outcome>;

/** The fully resolved initial conditions of a block. */
export const ResolvedGiven = z.strictObject({
  prefix: z.array(Message),
  ledger: z.record(z.string(), z.unknown()),
  world: WorldState,
  vars: z.record(z.string(), z.unknown()),
  target: TargetRef,
  hash: z.string().min(1),
});
export type ResolvedGiven = z.infer<typeof ResolvedGiven>;

export const ToolCall = z.strictObject({
  id: z.string().optional(),
  label: z.string().min(1),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
});
export type ToolCall = z.infer<typeof ToolCall>;

/** One piece of what the agent produced in a block, in order. */
export const Segment = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: z.string().optional(),
    label: z.string().min(1),
    input: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('tool_result'),
    id: z.string().optional(),
    label: z.string().min(1),
    output: z.unknown(),
    error: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('card'), name: z.string().min(1), data: z.unknown().optional() }),
]);
export type Segment = z.infer<typeof Segment>;

/** What an agent harness did around the model: skills, hooks, process steps, board operations. */
export const RuntimeTrace = z.strictObject({
  skillsLoaded: z.array(z.strictObject({ name: z.string(), at: z.string().optional() })).optional(),
  hooks: z
    .array(z.strictObject({ check: z.string(), verdict: z.string(), at: z.string().optional() }))
    .optional(),
  steps: z.array(z.strictObject({ id: z.string(), at: z.string().optional() })).optional(),
  boardOps: z.array(z.strictObject({ op: z.string(), at: z.string().optional() })).optional(),
});

export const Cost = z.strictObject({
  usd: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

/** Everything observed in one block. */
export const Observed = z.strictObject({
  segments: z.array(Segment),
  text: z.string(),
  toolCalls: z.array(ToolCall),
  runtime: RuntimeTrace.optional(),
  artifacts: z
    .array(z.strictObject({ path: z.string(), kind: z.string().optional(), sha256: z.string().optional() }))
    .optional(),
  workspaceDiff: z
    .strictObject({
      created: z.array(z.string()),
      changed: z.array(z.string()),
      deleted: z.array(z.string()),
    })
    .optional(),
  executions: z
    .array(
      z.strictObject({
        command: z.string(),
        exitCode: z.number().int(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
      }),
    )
    .optional(),
  cost: Cost,
  latencyMs: z.number().nonnegative(),
  raw: z.unknown().optional(),
});
export type Observed = z.infer<typeof Observed>;

export const Vote = z.strictObject({
  judge: z.string().min(1),
  outcome: Outcome,
  score: z.number().optional(),
  reasoning: z.string().optional(),
});

/** One check's result on one block. Machine verdicts are final; judge verdicts carry their votes. */
export const Verdict = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['machine', 'judge']),
  name: z.string().min(1),
  gating: z.boolean(),
  outcome: Outcome,
  score: z.number().optional(),
  evidence: z.string(),
  reasoning: z.string().optional(),
  judge: z.strictObject({ cls: z.enum(['system1', 'system2']), votes: z.array(Vote) }).optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export const BlockResult = z.strictObject({
  index: z.number().int().min(0),
  blockId: z.string().optional(),
  injected: z.boolean().optional(),
  givenHash: z.string().min(1),
  observed: Observed,
  verdicts: z.array(Verdict),
  stepObserved: z.string().optional(),
  ledgerCheck: z.strictObject({ ok: z.boolean(), contradictions: z.array(z.string()) }),
  drift: z.array(DriftClass),
  pass: z.boolean(),
});
export type BlockResult = z.infer<typeof BlockResult>;

export const Succession = z.strictObject({
  firstDriftBlock: z.number().int().min(0).optional(),
  driftCount: z.number().int().min(0),
  driftRate: z.number().min(0).max(1),
  longestClean: z.number().int().min(0),
  minOverBlocks: z.boolean(),
});

export const Recovery = z.strictObject({
  injectedAt: z.number().int().min(0),
  turnsToRecover: z.number().int().min(0).optional(),
  label: z.enum(['immediate', 'late', 'never']),
  collateral: z.number().int().min(0),
  safeAction: z.boolean().optional(),
  clarified: z.boolean().optional(),
});

export const RunResult = z.strictObject({
  runId: z.string().min(1),
  specId: z.string().min(1),
  specHash: z.string().min(1),
  target: TargetRef,
  mode: RunMode,
  repeat: z.number().int().min(0),
  perturbationId: z.string().optional(),
  status: z.enum(['completed', 'failed', 'stopped']),
  error: z.string().optional(),
  blocks: z.array(BlockResult),
  succession: Succession,
  recovery: Recovery.optional(),
  endState: z
    .strictObject({
      match: z.boolean(),
      diff: z.array(z.strictObject({ field: z.string(), expected: z.unknown(), observed: z.unknown() })),
    })
    .optional(),
  cost: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  cacheHit: z.boolean(),
});
export type RunResult = z.infer<typeof RunResult>;

export const JudgeConfig = z.strictObject({
  mode: z.enum(['system1', 'hybrid', 'llm']),
  judges: z.array(z.string().min(1)),
  assignment: z.string().optional(),
});

/** A campaign pins spec versions, targets, modes and repeats. A re-run is a new campaign. */
export const Campaign = z.strictObject({
  campaignId: z.string().min(1),
  specs: z.array(z.strictObject({ id: z.string().min(1), hash: z.string().min(1) })).min(1),
  targets: z.array(TargetRef).min(1),
  modes: z.array(RunMode).min(1),
  repeats: z.strictObject({
    T: z.number().int().min(0),
    F: z.number().int().min(0),
    P: z.number().int().min(0),
  }),
  budgetUsd: z.number().nonnegative(),
  judge: JudgeConfig,
  createdAt: z.string().min(1),
});
export type Campaign = z.infer<typeof Campaign>;
