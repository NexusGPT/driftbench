import { z } from 'zod';

/**
 * Shared building blocks for specs (authored in YAML, snake_case keys) and for run records
 * (written by the runner, camelCase keys).
 */

/** A language code such as FR, NL or EN. */
export const Lang = z.string().min(2).max(8);

/** A JavaScript regular expression source. Specs match text with the `m` flag. */
export const Pattern = z.string().min(1);

/** An exact count, or a range with optional bounds. */
export const Count = z.union([
  z.number().int().min(0),
  z.strictObject({
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  }),
]);
export type Count = z.infer<typeof Count>;

/** How one value is asserted. A bare scalar means exact equality. */
export const Assertion = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.strictObject({ exact: z.json() }),
  z.strictObject({ regex: Pattern }),
  z.strictObject({ contains: z.string().min(1) }),
  z.strictObject({ one_of: z.array(z.json()).min(1) }),
  z.strictObject({ nonempty: z.literal(true) }),
  z.strictObject({ absent: z.literal(true) }),
  z.strictObject({ subset: z.record(z.string(), z.json()) }),
]);
export type Assertion = z.infer<typeof Assertion>;

/** The ten deviation classes a perturbed run can inject. */
export const DeviationClass = z.enum([
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
]);
export type DeviationClass = z.infer<typeof DeviationClass>;

/** The five drift classes a failing block can carry. */
export const DriftClass = z.enum(['X1_local', 'X2_contradiction', 'X3_flow', 'X4_format', 'X5_tool']);
export type DriftClass = z.infer<typeof DriftClass>;

/** Which agent a spec runs against. The adapter decides what the other fields mean. */
export const TargetRef = z.strictObject({
  adapter: z.string().min(1),
  agent: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
  deployment: z.string().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type TargetRef = z.infer<typeof TargetRef>;

/** A tool call written in a spec prefix. */
export const PrefixToolCall = z.strictObject({
  id: z.string().optional(),
  label: z.string().min(1),
  input: z.json().optional(),
  output: z.json().optional(),
  error: z.string().optional(),
});

/** One message of a conversation prefix. */
export const Message = z.strictObject({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  tool_calls: z.array(PrefixToolCall).optional(),
});
export type Message = z.infer<typeof Message>;

/** A forced result or error for one tool, from the block where it is set onwards. */
export const ToolOverride = z.strictObject({
  result: z.json().optional(),
  error: z.string().optional(),
  latency_ms: z.number().nonnegative().optional(),
});

/** The world an agent acts on: tool overrides, a seeded store, a seeded workspace, free fixtures. */
export const WorldState = z.strictObject({
  tools: z.record(z.string(), ToolOverride).optional(),
  store: z.record(z.string(), z.unknown()).optional(),
  workspace: z
    .strictObject({
      from: z.string().min(1).optional(),
      files: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  fixtures: z.record(z.string(), z.unknown()).optional(),
});
export type WorldState = z.infer<typeof WorldState>;

/** Limits for one block. */
export const Budget = z.strictObject({
  steps: z.number().int().min(1).optional(),
  cost_usd: z.number().nonnegative().optional(),
  latency_ms: z.number().nonnegative().optional(),
});
