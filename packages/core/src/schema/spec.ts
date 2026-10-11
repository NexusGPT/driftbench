import { z } from 'zod';
import {
  Assertion,
  Budget,
  Count,
  DeviationClass,
  Lang,
  Message,
  Pattern,
  TargetRef,
  WorldState,
} from './common';

/**
 * The spec format. A spec is one golden conversation (or one task for a code agent) written as a
 * succession of blocks. Each block is a unit test: Given (initial conditions), When (the stimulus),
 * Then (the expected output and state delta, under `expect`).
 */

/** What reaches the agent in one block. */
export const Stimulus = z.union([
  z.strictObject({ user: z.string() }),
  z.strictObject({ burst: z.array(z.string()).min(2) }),
  z.strictObject({ injection: z.strictObject({ class: DeviationClass, user: z.string() }) }),
]);
export type Stimulus = z.infer<typeof Stimulus>;

/** Initial conditions set on the whole spec. */
export const GivenDefaults = z.strictObject({
  ledger: z.record(z.string(), z.unknown()).optional(),
  world: WorldState.optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
});

/** Initial conditions set on one block. A prefix lets the block start without replaying the ones before. */
export const GivenOverride = z.strictObject({
  prefix: z.array(Message).optional(),
  ledger: z.record(z.string(), z.unknown()).optional(),
  world: WorldState.optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
});

export const ToolExpect = z.strictObject({
  label: z.string().min(1),
  count: Count.optional(),
  input: z.record(z.string(), Assertion).optional(),
});
export type ToolExpect = z.infer<typeof ToolExpect>;

export const CardExpect = z.strictObject({ name: z.string().min(1), count: Count.optional() });

export const SkillExpect = z.strictObject({ name: z.string().min(1), count: Count.optional() });

/** A runtime check that fired during the block: a hook, a guardrail, a policy. The adapter maps the runtime's own names. */
export const GuardExpect = z.strictObject({
  name: z.string().min(1),
  verdict: z.string().min(1).optional(),
  count: Count.optional(),
});
export type GuardExpect = z.infer<typeof GuardExpect>;

export const ExecutionExpect = z.strictObject({
  ran_code: z.boolean().optional(),
  exit_code: z.number().int().optional(),
  max_commands: z.number().int().min(0).optional(),
});

/** One check on a produced file. The key names the check, for example `{ sheets: [North, South] }`. */
export const ArtifactCheck = z.record(z.string(), z.unknown());

export const ArtifactExpect = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(['xlsx', 'docx', 'pptx', 'pdf', 'csv', 'json', 'text', 'code']).optional(),
  checks: z.array(ArtifactCheck).optional(),
});

export const WorkspaceExpect = z.strictObject({
  created: z.array(z.string()).optional(),
  changed: z.array(z.string()).optional(),
  deleted: z.array(z.string()).optional(),
  others_untouched: z.boolean().optional(),
});

export const SafetyExpect = z.strictObject({
  max_destructive_ops: z.number().int().min(0).optional(),
  confirm_before: z.array(z.string().min(1)).optional(),
});

/**
 * The expected output and state delta of a block. Every field is optional.
 * `stage` names the point of its own process the agent must reach; the spec declares the catalogue in `stages`.
 */
export const Expect = z.strictObject({
  stage: z.string().min(1).optional(),
  ledger_add: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(ToolExpect).optional(),
  tool_order: z.enum(['exact', 'in_order', 'any_order']).optional(),
  must: z.array(Pattern).optional(),
  must_not: z.array(Pattern).optional(),
  lang: Lang.optional(),
  cards: z.array(CardExpect).optional(),
  criteria: z.array(z.string().min(1)).optional(),
  skills: z.array(SkillExpect).optional(),
  guards: z.array(GuardExpect).optional(),
  execution: ExecutionExpect.optional(),
  artifacts: z.array(ArtifactExpect).optional(),
  workspace: WorkspaceExpect.optional(),
  safety: SafetyExpect.optional(),
});
export type Expect = z.infer<typeof Expect>;

export const BlockSpec = z.strictObject({
  id: z.string().min(1).optional(),
  when: Stimulus,
  given: GivenOverride.optional(),
  expect: Expect.optional(),
  budget: Budget.optional(),
});
export type BlockSpec = z.infer<typeof BlockSpec>;

/** How the agent should come back after an injected deviation. */
export const RecoveryExpect = z.strictObject({
  within_blocks: z.number().int().min(0),
  stage_after: z.string().min(1).optional(),
  return_message: z.string().optional(),
});

/** A deviation inserted before block `inject_at` (0-based) when the spec runs in perturbed mode. */
export const PerturbationSpec = z.strictObject({
  id: z.string().min(1),
  class: DeviationClass,
  inject_at: z.number().int().min(0),
  user: z.string().optional(),
  burst: z.array(z.string()).min(2).optional(),
  world: WorldState.optional(),
  expect: Expect.optional(),
  recovery: RecoveryExpect.optional(),
});
export type PerturbationSpec = z.infer<typeof PerturbationSpec>;

/** Rules that hold for the whole conversation. */
export const Rules = z.strictObject({
  max_calls: z.record(z.string(), z.number().int().min(0)).optional(),
  forbidden_tools: z.array(z.string().min(1)).optional(),
  lang_stable: z.boolean().optional(),
  one_message_per_turn: z.boolean().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

/** The expected end state of the world, read from a source the adapter knows, such as a tool's recorded payload. */
export const EndStateSpec = z.strictObject({
  source: z.string().min(1),
  mode: z.enum(['subset', 'exact']).optional(),
  expect: z.record(z.string(), Assertion),
});
export const EndState = z.union([z.literal('none'), EndStateSpec, z.array(EndStateSpec).min(1)]);

/** A judged criterion. Blocks reference it by name, with `@gating` when a fail fails the conversation. */
export const CriterionDef = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  rubric: z.string().min(1),
  pass: z.string().optional(),
  fail: z.string().optional(),
  gating: z.boolean().optional(),
  scope: z.enum(['block', 'conversation']).optional(),
  judge_class: z.enum(['system1', 'system2', 'auto']).optional(),
});
export type CriterionDef = z.infer<typeof CriterionDef>;

export const Spec = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  version: z.string().optional(),
  kind: z.enum(['conversation', 'task']),
  title: z.string().optional(),
  description: z.string().optional(),
  channel: z.string().optional(),
  lang: Lang.optional(),
  tier: z.string().optional(),
  tags: z.array(z.string()).optional(),
  covers: z.array(z.string()).optional(),
  target: TargetRef.optional(),
  given: GivenDefaults.optional(),
  stages: z.array(z.string().min(1)).optional(),
  criteria: z.array(CriterionDef).optional(),
  blocks: z.array(BlockSpec).min(1),
  rules: Rules.optional(),
  end_state: EndState.optional(),
  perturbations: z.array(PerturbationSpec).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Spec = z.infer<typeof Spec>;

/** Short names used in the docs: a block, the conditions it starts from, and an injected deviation. */
export const Block = BlockSpec;
export type Block = BlockSpec;
export const Given = GivenOverride;
export type Given = z.infer<typeof GivenOverride>;
export const Perturbation = PerturbationSpec;
export type Perturbation = PerturbationSpec;
