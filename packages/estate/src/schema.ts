import { z } from 'zod';

/**
 * The estate contract (design note of 2026-10-11, "Testing a code-interpreter agent: the estate design").
 * An estate is everything that specifies a code-interpreter agent's behaviour: standing instructions, skills,
 * subagents, guards, tools, settings, stages, output rules, the runtime's hazards and the estate's own invariants.
 * Each place that specifies behaviour is an atom with a quote and a hash. Atoms and edges form the estate graph.
 * A plan is derived from the approved map by code; tests are generated from the plan. Nothing here names a runtime:
 * Claude Code and Nexus are adapters that read their own files into these shapes.
 */

export const AtomKind = z.enum([
  'instruction',
  'gate',
  'route',
  'skill',
  'reference',
  'script',
  'subagent',
  'guard',
  'tool',
  'setting',
  'stage',
  'register',
  'hazard',
  'invariant',
]);
export type AtomKind = z.infer<typeof AtomKind>;

/** Where an atom comes from: the file, the line span, the exact quote and its hash. */
export const Provenance = z.strictObject({
  file: z.string().min(1).describe('Path relative to the estate root'),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  quote: z.string().min(1).describe('The exact text the atom is read from'),
  hash: z
    .string()
    .min(1)
    .describe('SHA-256 of the quote, the file and the span; a change here is a changed atom'),
});
export type Provenance = z.infer<typeof Provenance>;

/** What a trace shows when the atom is obeyed. Every form maps to an existing check of the checks package. */
export const EvidencePredicate = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('skill_loaded'),
    name: z.string().min(1),
    min: z.number().int().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('skill_not_loaded'), name: z.string().min(1) }),
  z.strictObject({
    type: z.literal('guard'),
    name: z.string().min(1),
    verdict: z.string().min(1).optional().describe('Without it, any verdict counts, as in the guards check'),
    min: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    type: z.literal('tool_called'),
    label: z.string().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    min: z.number().int().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('tool_not_called'), label: z.string().min(1) }),
  z.strictObject({
    type: z.literal('ordered'),
    before: z.string().min(1).describe('A tool label, a skill name or a stage name'),
    after: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('stage_reached'), name: z.string().min(1) }),
  z.strictObject({
    type: z.literal('workspace'),
    created: z.array(z.string()).optional(),
    changed: z.array(z.string()).optional(),
    deleted: z.array(z.string()).optional(),
    othersUntouched: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal('artifact'), path: z.string().min(1), kind: z.string().optional() }),
  z.strictObject({
    type: z.literal('text'),
    must: z.array(z.string()).optional(),
    mustNot: z.array(z.string()).optional(),
    lang: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('static'),
    check: z.string().min(1).describe('A property of the estate files, no run'),
  }),
  z.strictObject({
    type: z.literal('custom'),
    name: z.string().min(1),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type EvidencePredicate = z.infer<typeof EvidencePredicate>;

export const Atom = z.strictObject({
  id: z.string().min(1).describe('Stable id: kind, file and a slug of the quote'),
  kind: AtomKind,
  title: z.string().min(1).describe('One line in plain words'),
  provenance: Provenance,
  producedBy: z.enum(['code', 'model']),
  role: z.enum(['axis', 'detail']).default('axis'),
  approved: z.boolean().default(false),
  situation: z.string().optional().describe('When the atom applies, in words; empty means always'),
  evidence: z.array(EvidencePredicate).min(1),
  enforcement: z
    .array(z.string())
    .default([])
    .describe('Ids of guards or tests that already check it; empty means trusted'),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Kind-specific structure read by code: a guard event, a tool schema, a brief field list'),
});
export type Atom = z.infer<typeof Atom>;

export const EdgeKind = z.enum([
  'route',
  'reference',
  'script',
  'dispatch',
  'enforces',
  'event',
  'allows',
  'next',
  'cites',
]);
export const Edge = z.strictObject({ from: z.string().min(1), to: z.string().min(1), kind: EdgeKind });
export type Edge = z.infer<typeof Edge>;

export const EstateMap = z.strictObject({
  version: z.literal(1),
  runtime: z.string().min(1).describe('The adapter that read the estate: claude-code, nexus, ...'),
  root: z
    .string()
    .min(1)
    .describe('The estate root, as given; never an absolute private path in a committed file'),
  readAt: z.string().min(1),
  atoms: z.array(Atom),
  edges: z.array(Edge),
  space: z.string().optional().describe('Path of the exported space map of the situation axes'),
  producedBy: z
    .strictObject({
      family: z.string().min(1).describe('The model family that split the prose, `code` when no model ran'),
      model: z.string().min(1),
      at: z.iso.datetime(),
    })
    .optional()
    .describe('Who proposed the model atoms; code atoms say producedBy: code on the atom itself'),
  hash: z.string().min(1).describe('SHA-256 over the sorted atom hashes and edges'),
});
export type EstateMap = z.infer<typeof EstateMap>;

export const TestType = z.enum([
  'obligation',
  'outside_trigger',
  'twin',
  'ordered_pair',
  'skip_pressure',
  'route_positive',
  'route_near_miss',
  'misroute',
  'read_when',
  'script_fixture',
  'dispatch',
  'contract_alone',
  'stop_resume',
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'guard_speed',
  'guard_register',
  'tool_boundary',
  'tool_denied',
  'tool_deferred',
  'stage_order',
  'stage_skip',
  'stage_anytime',
  'register_sample',
  'hazard_recovery',
  'invariant',
  'journey',
]);
export type TestType = z.infer<typeof TestType>;

export const RunMode = z.enum(['replay', 'unit', 'live']);

export const PlanRow = z.strictObject({
  id: z.string().min(1),
  atomIds: z.array(z.string().min(1)).min(1),
  cell: z.record(z.string(), z.string()).describe('Dimension id to value id on the situation axes'),
  testType: TestType,
  mode: RunMode,
  status: z.enum(['proposed', 'approved', 'struck']).default('proposed'),
  weight: z.number().nonnegative().default(1),
  note: z.string().optional(),
});
export type PlanRow = z.infer<typeof PlanRow>;

export const Plan = z.strictObject({
  version: z.literal(1),
  mapHash: z.string().min(1),
  spaceHash: z.string().optional(),
  rows: z.array(PlanRow),
  summary: z.strictObject({
    cells: z.number().int().min(0),
    coveringArraySize: z.number().int().min(0),
    perKind: z.record(z.string(), z.number().int().min(0)),
    perTestType: z.record(z.string(), z.number().int().min(0)),
    unenforcedAtoms: z.array(z.string()),
    cellsWithoutPhrase: z.number().int().min(0),
    edgesWithoutJourney: z.number().int().min(0),
  }),
});
export type Plan = z.infer<typeof Plan>;
