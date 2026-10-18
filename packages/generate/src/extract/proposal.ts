import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Assertion, Count, DeviationClass, GuardExpect, isPlainObject } from '@agent-nexus/driftbench-core';
import { Document, isMap, isSeq, parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { QuoteIndex } from './quote';
import { checkSpaceMap } from './space';

/**
 * The map proposal: the places where an agent's behaviour is specified, as dimensions, values, constraints
 * and a phrase bank. Code and a model propose every entry with the quote that justifies it; each entry says
 * which of the two proposed it. A person approves a dimension with one flag, which its values inherit
 * (a value may override it), and approves each constraint and phrase. A dimension is an axis of the space
 * map or a detail the generator varies inside a cell. Code enumerates blocks later from approved entries.
 */

export const PROPOSAL_VERSION = 1;

export const DIMENSION_KINDS = [
  'stage',
  'behaviour',
  'deviation',
  'persona',
  'channel',
  'data',
  'task',
] as const;
export const DimensionKind = z
  .enum(DIMENSION_KINDS)
  .describe(
    'What the dimension varies: a flow stage, a behaviour or rule, a deviation class, a kind of user, a channel, a data case, or a task setting for code agents.',
  );
export type DimensionKind = z.infer<typeof DimensionKind>;

export const SOURCE_KINDS = ['prompt', 'inventory', 'tools'] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const DimensionId = z.string().regex(/^[a-z][a-z0-9_.-]*$/, {
  error:
    'expected a dimension id such as stage or coverage.check.in.address: lowercase letters, digits, dots, hyphens and underscores',
});

export const ValueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, {
  error:
    'expected a value id such as offer, B-001 or D4_loose_confirmation: letters, digits, dots, hyphens and underscores',
});

export const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
  error: 'expected a language tag such as en, nl or pt-BR',
});

/** The longest quote a proposal accepts. A quote names the passage that justifies one entry, not a file. */
export const MAX_QUOTE_LENGTH = 1000;

const EVIDENCE_MISSING =
  'evidence is missing: every value and constraint quotes the source that justifies it';
const QUOTE_MISSING = 'the quote is missing: copy the source text that justifies the entry';

export const Evidence = z
  .strictObject(
    {
      source: z
        .string({ error: 'the source is missing: name the path of the source, as listed in sources' })
        .min(1)
        .describe('The path of the source, exactly as listed in sources.'),
      quote: z
        .string({ error: QUOTE_MISSING })
        .max(MAX_QUOTE_LENGTH, { error: `a quote is at most ${MAX_QUOTE_LENGTH} characters` })
        .refine((quote) => quote.trim() !== '', { error: QUOTE_MISSING })
        .describe('Text copied word for word from the source: it justifies the entry.'),
    },
    { error: (issue) => (issue.input === undefined ? EVIDENCE_MISSING : undefined) },
  )
  .describe('Where the entry comes from: a source path and a quote from it.');
export type Evidence = z.infer<typeof Evidence>;

const Approved = z
  .boolean({ error: 'approved must be true or false' })
  .describe('False until a person approves the entry.');

export const ORIGINS = ['code', 'model'] as const;
export const Origin = z
  .enum(ORIGINS, { error: 'produced_by is code or model' })
  .describe('Who proposed the entry: code (the pre-pass) or a model (a section answer).');
export type Origin = z.infer<typeof Origin>;

export const ROLES = ['axis', 'detail'] as const;
export const Role = z
  .enum(ROLES, { error: 'role is axis or detail' })
  .describe(
    'axis: a dimension of the space map, crossed with the other axes. detail: varied by the generator inside a cell, as boundary values.',
  );
export type Role = z.infer<typeof Role>;

export const When = z
  .record(DimensionId, z.array(ValueId).min(1))
  .describe('The values the entry applies to, per dimension: { coverage_result: [fiber, 5g-only] }.');
export type When = z.infer<typeof When>;

/** What a rule or a value states beyond its text; every key is optional. */
export const ValueFields = {
  polarity: z
    .enum(['must', 'must_not'])
    .optional()
    .describe('Whether the agent must or must not do what a rule says.'),
  when: When.optional().describe('The cell a rule applies in.'),
  unless: When.optional().describe('The cell a rule does not hold in.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('The most times the action may happen in a conversation.'),
  within: z
    .strictObject({
      minutes: z.number().positive().describe('The number of minutes the action has to happen in.'),
    })
    .optional()
    .describe('The time within which the action happens.'),
  priority: z.literal('first').optional().describe('The rule comes first when rules collide.'),
  weight: z.number().min(0).max(1).optional().describe('The share of users the value stands for.'),
  required: z.boolean().optional().describe('Whether a test plan must include the value.'),
};

export const ProposalValue = z
  .strictObject({
    id: ValueId.describe('A short id, unique among the values of its dimension.'),
    title: z.string().min(1).describe('What the value means, in a few words.'),
    evidence: Evidence,
    ...ValueFields,
    produced_by: Origin,
    approved: Approved.optional().describe(
      "Overrides the dimension's flag for this value. Absent: the value inherits it.",
    ),
  })
  .describe('One value of a dimension.');
export type ProposalValue = z.infer<typeof ProposalValue>;

export const ProposalDimension = z
  .strictObject({
    id: DimensionId.describe(
      'A short id, unique among the dimensions, such as stage or coverage.check.in.address.',
    ),
    title: z.string().min(1).describe('What the dimension varies.'),
    kind: DimensionKind,
    role: Role,
    produced_by: Origin,
    approved: Approved.describe('The approval of the dimension and every value without its own flag.'),
    values: z.array(ProposalValue).min(1, { error: 'a dimension needs at least one value' }),
  })
  .describe('One axis a situation varies on, with its values.');
export type ProposalDimension = z.infer<typeof ProposalDimension>;

/** Approved numeric runtime variables, separate from the categorical coverage dimensions. */
export const NumericSetting = z
  .strictObject({
    id: DimensionId.describe('The key written into the generated spec given.vars.'),
    min: z.number().describe('Inclusive lower bound.'),
    max: z.number().describe('Inclusive upper bound.'),
    integer: z.boolean().optional().describe('Map Latin quantiles to inclusive integer levels.'),
    unit: z.string().min(1).optional().describe('Unit label, retained in the sampling report.'),
    evidence: Evidence,
    produced_by: Origin,
    approved: Approved,
  })
  .superRefine((setting, ctx) => {
    if (setting.max < setting.min || !Number.isFinite(setting.max - setting.min))
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'max must be at least min and the range must be finite',
      });
    if (
      setting.integer &&
      (!Number.isSafeInteger(Math.ceil(setting.min)) ||
        !Number.isSafeInteger(Math.floor(setting.max)) ||
        Math.ceil(setting.min) > Math.floor(setting.max) ||
        !Number.isSafeInteger(Math.floor(setting.max) - Math.ceil(setting.min) + 1))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['integer'],
        message: 'an integer range needs representable integer levels between min and max',
      });
  });
export type NumericSetting = z.infer<typeof NumericSetting>;

export const ProposalConstraint = z
  .strictObject({
    forbid: z
      .record(DimensionId, ValueId)
      .refine((forbid) => Object.keys(forbid).length >= 2, {
        error: 'a constraint forbids a combination: name at least two dimensions',
      })
      .describe('A combination of values, one per dimension, that can never occur together.'),
    reason: z.string().min(1).describe('Why the combination cannot occur.'),
    evidence: Evidence,
    produced_by: Origin,
    approved: Approved,
  })
  .describe('A combination of values that cannot occur.');
export type ProposalConstraint = z.infer<typeof ProposalConstraint>;

/** A slot name: the `{name}` a phrase, a tool input or an end state reads its concrete value from. */
export const SlotName = z.string().regex(/^[a-z][a-z0-9_]*$/, {
  error: 'expected a slot name such as email or address_id: lowercase letters, digits and underscores',
});

/** Concrete values by slot name. Fictional data only. */
export const Slots = z
  .record(SlotName, z.string().min(1))
  .describe('Concrete values by slot name, such as { email: jo.okafor@example.com }.');
export type Slots = z.infer<typeof Slots>;

/**
 * The cell values an entry applies to: per dimension, the values it holds for. Every dimension named must
 * hold one of its listed values; a dimension not named is free.
 */

export const ProposalPhrase = z
  .strictObject({
    dimension: DimensionId.describe('The dimension of the value the phrase expresses.'),
    value: ValueId.describe('The value the phrase expresses: a value of that dimension.'),
    text: z
      .string()
      .min(1)
      .max(500)
      .describe('One user message that expresses the value. `{slot}` takes a value the cell binds.'),
    lang: Lang.describe('The language the phrase is written in, such as en or pt-BR.'),
    when: When.optional().describe('The cell values the phrase fits; absent: every cell of its value.'),
    binds: Slots.optional().describe('Slot values the phrase itself states, such as the plan it names.'),
    evidence: Evidence.optional().describe('The source example the phrase copies, when there is one.'),
    produced_by: Origin,
    approved: Approved,
  })
  .describe('One phrasing of a value, for the phrase bank.');
export type ProposalPhrase = z.infer<typeof ProposalPhrase>;

// Relations: what links values to tools, stages and end states ----------------------------------------

/** A value of a dimension. */
export const ValueRef = z
  .strictObject({
    dimension: DimensionId.describe('The id of the dimension.'),
    value: ValueId.describe('The id of a value of that dimension.'),
  })
  .describe('One value of one dimension.');
export type ValueRef = z.infer<typeof ValueRef>;

/** The dimension a flow id is a value of: the inventory pre-pass names it `flow`. */
export const FLOW_DIMENSION = 'flow';

/** The stage a deviation probe returns to when the class is a detour: the stage the conversation had reached. */
export const PENDING_STAGE = 'pending';

const relationCommon = {
  evidence: Evidence,
  produced_by: Origin,
  approved: Approved,
};

/** An expected argument or state field: an assertion whose strings may read `{slot}`. */
const TemplateAssertion = Assertion.describe(
  'An assertion as a spec writes it; a `{slot}` in a string is replaced by the value the cell binds.',
);

export const EndStateTemplate = z
  .strictObject({
    source: z
      .string()
      .regex(/^tool:./, { error: 'an end state is read from a tool payload: tool:<label>' })
      .describe('Where the state is read, such as tool:order.create.'),
    mode: z.enum(['subset', 'exact']).describe('subset compares the listed fields; exact the whole state.'),
    expect: z.record(z.string(), TemplateAssertion).describe('The fields the state must hold.'),
  })
  .describe('What the side-effect store must hold when the path ends, by slot values.');
export type EndStateTemplate = z.infer<typeof EndStateTemplate>;

export const PathRelation = z
  .strictObject({
    kind: z.literal('path').describe("Marks the relation as a path: a flow's stage order on one branch."),
    id: ValueId.describe('A short id, unique among the paths.'),
    flow: ValueId.describe('The flow the path belongs to: a value of the flow dimension.'),
    when: When.optional(),
    stages: z
      .array(ValueId)
      .min(2, { error: 'a path passes at least two stages' })
      .describe('The stages in the order the conversation passes them, the start first.'),
    behaviours: z.array(ValueId).optional().describe('The behaviours the path exercises.'),
    end_state: EndStateTemplate.optional(),
    ...relationCommon,
  })
  .describe("A flow's stage order on one branch: the stages it passes when the cell holds `when`.");
export type PathRelation = z.infer<typeof PathRelation>;

export const UsesToolRelation = z
  .strictObject({
    kind: z.literal('uses_tool').describe('Marks the relation as a tool call a flow or a behaviour makes.'),
    subject: ValueRef.describe(
      "The flow or behaviour value that calls the tool. A flow's call is made on a move; a behaviour's call is made in the turn that asks for the behaviour, never on a move.",
    ),
    tool: z.string().min(1).describe('The tool label.'),
    stage: ValueId.describe('The stage the call is made at: the turn that leaves this stage.'),
    to: ValueId.optional().describe('Only on the turn that reaches this stage.'),
    when: When.optional(),
    count: Count.optional().describe('Calls in that turn; 1 when absent.'),
    input: z
      .record(z.string(), TemplateAssertion)
      .optional()
      .describe('The arguments, by name; `{slot}` reads the value a data value of the cell binds.'),
    ...relationCommon,
  })
  .describe('A tool a flow or a behaviour calls, the stage it is called at, and what feeds its inputs.');
export type UsesToolRelation = z.infer<typeof UsesToolRelation>;

export const StatesRelation = z
  .strictObject({
    kind: z
      .literal('states')
      .describe('Marks the relation as what the reply of one turn must and must not state.'),
    subject: ValueRef.describe('The flow or behaviour value whose reply states it.'),
    stage: ValueId.describe('The turn that leaves this stage.'),
    to: ValueId.optional().describe('Only on the turn that reaches this stage.'),
    when: When.optional(),
    must: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Patterns the reply of that turn holds, such as a quoted price; `{slot}` reads a bound value.',
      ),
    must_not: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Patterns the reply must not hold; `{slot}` reads a bound value.'),
    ...relationCommon,
  })
  .refine((entry) => entry.must !== undefined || entry.must_not !== undefined, {
    message: 'a states relation needs must or must_not patterns',
  })
  .describe('What the reply of one turn must and must not state, read from the values the cell binds.');
export type StatesRelation = z.infer<typeof StatesRelation>;

export const TaskFamilyRelation = z
  .strictObject({
    kind: z
      .literal('task_family')
      .describe('Marks the relation as a code-agent task family that writes the specs of a flow.'),
    flow: ValueId.describe('The flow whose specs the family writes: a value of the flow dimension.'),
    family: z
      .string()
      .min(1)
      .describe('The family file or its folder, relative to the folder of the proposal.'),
    stages: z
      .array(ValueId)
      .min(1)
      .describe("The stages of the family's blocks, in order, as its specs declare them."),
    holds: When.optional().describe('The cell values every instance of the family holds, per dimension.'),
    instances: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      )
      .optional()
      .describe(
        'The family knob values of the instances this relation places, when the family writes several branches of the flow; without it, every instance.',
      ),
    deviations: z
      .array(DeviationClass)
      .optional()
      .describe(
        "The deviation classes the family's variants carry, such as an instruction planted in a file.",
      ),
    ...relationCommon,
  })
  .describe(
    'A code-agent task family that writes the specs of a flow, with an oracle in code (docs/generating.md).',
  );
export type TaskFamilyRelation = z.infer<typeof TaskFamilyRelation>;

export const BindsRelation = z
  .strictObject({
    kind: z
      .literal('binds')
      .describe('Marks the relation as the concrete slot values a data or persona value stands for.'),
    subject: ValueRef.describe('The data or persona value the slots stand for.'),
    slots: Slots,
    ...relationCommon,
  })
  .describe('The concrete values a data value stands for: what phrases, inputs and end states read.');
export type BindsRelation = z.infer<typeof BindsRelation>;

export const RecoveryTool = z
  .strictObject({
    tool: z.string().min(1).describe('The tool label.'),
    count: Count.optional(),
    input: z
      .record(z.string(), TemplateAssertion)
      .optional()
      .describe('The arguments, by name; `{slot}` reads the value a data value of the cell binds.'),
  })
  .describe('A tool call the recovery turn makes, or must not make (count 0).');
export type RecoveryTool = z.infer<typeof RecoveryTool>;

export const RecoveryRelation = z
  .strictObject({
    kind: z
      .literal('recovery')
      .describe('Marks the relation as how a flow recovers from one deviation class.'),
    class: DeviationClass,
    flows: z.array(ValueId).min(1).describe('The flows the recovery holds in.'),
    at: z
      .array(ValueId)
      .min(1)
      .optional()
      .describe('The stages the class is probed at; absent: any stage the path reaches after its start.'),
    tool: z.string().min(1).optional().describe('For a tool failure: the tool that fails.'),
    stage_after: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
      .optional()
      .describe('The stage after the probe; `pending` is the stage the conversation had reached.'),
    must: z.array(z.string().min(1)).optional().describe('Patterns the reply holds; `{slot}` allowed.'),
    must_not: z.array(z.string().min(1)).optional().describe('Patterns the reply never holds.'),
    guards: z.array(GuardExpect).optional().describe('Runtime checks the probe fires.'),
    tools: z.array(RecoveryTool).optional(),
    ...relationCommon,
  })
  .describe('How a flow recovers from one deviation class: the stage after, the words, the calls.');
export type RecoveryRelation = z.infer<typeof RecoveryRelation>;

export const ReplyLanguageRelation = z
  .strictObject({
    kind: z.literal('reply_language').describe('Marks the relation as the language every reply is in.'),
    subject: ValueRef.describe('The rule value that fixes the language of every reply.'),
    lang: Lang.describe('The language tag of every reply, such as en or nl.'),
    ...relationCommon,
  })
  .describe('The language every reply is in, whatever the user writes.');
export type ReplyLanguageRelation = z.infer<typeof ReplyLanguageRelation>;

export const ToolOrderRelation = z
  .strictObject({
    kind: z.literal('tool_order').describe('Marks the relation as two tools called in a stated order.'),
    before: z.string().min(1).describe('The tool called first.'),
    after: z.string().min(1).describe('The tool called after it.'),
    ...relationCommon,
  })
  .describe('Two tools called in a stated order.');
export type ToolOrderRelation = z.infer<typeof ToolOrderRelation>;

export const RouteRelation = z
  .strictObject({
    kind: z.literal('route').describe('Marks the relation as a rule that sends a topic to a team.'),
    subject: ValueRef.describe('The rule value that sends a topic to a team.'),
    to: z.string().min(1).describe('The team the topic goes to.'),
    ...relationCommon,
  })
  .describe('A rule that sends a topic to a team.');
export type RouteRelation = z.infer<typeof RouteRelation>;

export const ReplyTextRelation = z
  .strictObject({
    kind: z
      .literal('reply_text')
      .describe('Marks the relation as a rule that fixes the exact words of a reply.'),
    subject: ValueRef.describe('The rule value that fixes the exact words of a reply.'),
    text: z.string().min(1).describe('The exact words of the reply.'),
    ...relationCommon,
  })
  .describe('A rule that fixes the exact words of a reply.');
export type ReplyTextRelation = z.infer<typeof ReplyTextRelation>;

export const REPLIES_PER_TURN = ['one', 'any'] as const;

export const ReplyCountRelation = z
  .strictObject({
    kind: z
      .literal('reply_count')
      .describe('Marks the relation as how many replies the agent sends to one user turn.'),
    per_turn: z
      .enum(REPLIES_PER_TURN)
      .describe(
        'one: a single reply to every user turn. any: the agent may send several replies to one turn. Without this relation a map means one.',
      ),
    ...relationCommon,
  })
  .describe(
    'How many replies the agent sends to one user turn. A map without it means one reply per user turn.',
  );
export type ReplyCountRelation = z.infer<typeof ReplyCountRelation>;

export const ProposalRelation = z
  .discriminatedUnion('kind', [
    PathRelation,
    UsesToolRelation,
    StatesRelation,
    TaskFamilyRelation,
    BindsRelation,
    RecoveryRelation,
    ReplyLanguageRelation,
    ToolOrderRelation,
    RouteRelation,
    ReplyTextRelation,
    ReplyCountRelation,
  ])
  .describe(
    'A relation between values: a path, a tool call, what a reply states, concrete values, a recovery, a reply language, the replies per turn.',
  );
export type ProposalRelation = z.infer<typeof ProposalRelation>;
export const RELATION_KINDS = [
  'path',
  'uses_tool',
  'states',
  'task_family',
  'binds',
  'recovery',
  'reply_language',
  'tool_order',
  'route',
  'reply_text',
  'reply_count',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const ProposalSource = z
  .strictObject({
    kind: SourceKind.describe(
      'What the file is: the prompt or policy, the behaviour inventory, or the tool schemas.',
    ),
    path: z.string().min(1).describe('The path of the file, relative to the folder of the proposal.'),
  })
  .describe('A file the entries quote.');
export type ProposalSource = z.infer<typeof ProposalSource>;

export const ProducedBy = z
  .strictObject({
    family: z.string().min(1).describe('The model family, `code` for the code pre-pass alone.'),
    model: z.string().min(1).describe('The model as its provider names it.'),
    at: z.iso.datetime().describe('When the proposal was produced, in UTC.'),
  })
  .describe('Who proposed the entries.');
export type ProducedBy = z.infer<typeof ProducedBy>;

export const Proposal = z
  .strictObject({
    version: z.literal(PROPOSAL_VERSION).describe('The version of the proposal format, 1.'),
    agent: z.string().min(1).describe('The agent the map describes.'),
    produced_by: ProducedBy,
    sources: z.array(ProposalSource).min(1, { error: 'a proposal quotes at least one source' }),
    dimensions: z.array(ProposalDimension),
    constraints: z.array(ProposalConstraint),
    phrases: z.array(ProposalPhrase),
    numeric_settings: z
      .array(NumericSetting)
      .optional()
      .describe('Approved numeric ranges sampled by --budget into given.vars.'),
    relations: z
      .array(ProposalRelation)
      .optional()
      .describe(
        'Paths, tool calls, concrete values, recoveries and the reply language, each with its quote.',
      ),
  })
  .describe(
    'A map proposal: dimensions, values, constraints, phrases and relations, each waiting for approval.',
  );
export type Proposal = z.infer<typeof Proposal>;

export const ProposalIssueCodes = [
  'PROPOSAL_PARSE',
  'PROPOSAL_NOT_OBJECT',
  'PROPOSAL_EVIDENCE_MISSING',
  'PROPOSAL_DUPLICATE',
  'PROPOSAL_UNKNOWN_SOURCE',
  'PROPOSAL_UNKNOWN_DIMENSION',
  'PROPOSAL_UNKNOWN_VALUE',
  'PROPOSAL_SOURCE_UNREADABLE',
  'PROPOSAL_QUOTE_NOT_FOUND',
] as const;
/** `SPACE_*` codes come from `validateSpaceMap`: every proposal must also be a valid space map. */
export type ProposalIssueCode = (typeof ProposalIssueCodes)[number] | `SCHEMA_${string}` | `SPACE_${string}`;

export type ProposalIssue = {
  code: ProposalIssueCode;
  /** Dotted path inside the proposal, such as `dimensions.2.values.0.evidence`. Empty for the whole file. */
  path: string;
  message: string;
};

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; errors: ProposalIssue[] };

/** Parses and validates proposal text (YAML or JSON): the strict schema, then the references. */
export function parseProposalText(text: string): ProposalResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [issue('PROPOSAL_PARSE', '', describe(cause))] };
  }
  return validateProposal(raw);
}

/** Validates an already parsed value: the schema, the references, then the space map rules. Never throws. */
export function validateProposal(raw: unknown): ProposalResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [issue('PROPOSAL_NOT_OBJECT', '', 'a proposal file holds one mapping (an object)')],
    };
  }
  const parsed = Proposal.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(fromZod) };
  const errors = checkReferences(parsed.data);
  if (errors.length > 0) return { ok: false, errors };
  const space = checkSpaceMap(parsed.data);
  return space.length > 0 ? { ok: false, errors: space } : { ok: true, proposal: parsed.data };
}

export type LoadedProposal =
  | { ok: true; path: string; text: string; proposal: Proposal }
  | { ok: false; path: string; errors: ProposalIssue[] };

/**
 * Reads a proposal file and checks everything: the schema, the references, and every quote against its
 * source, read relative to the proposal's folder. An entry whose evidence is gone is refused here.
 */
export async function loadProposal(path: string): Promise<LoadedProposal> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [issue('PROPOSAL_PARSE', '', `cannot read the file: ${describe(cause)}`)],
    };
  }
  const parsed = parseProposalText(text);
  if (!parsed.ok) return { ok: false, path, errors: parsed.errors };
  const errors = await verifyQuotes(parsed.proposal, dirname(path));
  return errors.length > 0
    ? { ok: false, path, errors }
    : { ok: true, path, text, proposal: parsed.proposal };
}

/** Reads every source relative to `baseDir`, then checks every quote. Returns the problems found. */
export async function verifyQuotes(proposal: Proposal, baseDir: string): Promise<ProposalIssue[]> {
  const texts = new Map<string, string>();
  const errors: ProposalIssue[] = [];
  for (const [index, source] of proposal.sources.entries()) {
    try {
      texts.set(source.path, await readFile(resolve(baseDir, source.path), 'utf8'));
    } catch (cause) {
      errors.push(
        issue(
          'PROPOSAL_SOURCE_UNREADABLE',
          `sources.${index}.path`,
          `cannot read ${source.path}, so its quotes cannot be checked: ${describe(cause)}`,
        ),
      );
    }
  }
  return [...errors, ...checkQuotes(proposal, texts)];
}

/** Every evidence whose quote is not in its source's text. Sources missing from `texts` are skipped. */
export function checkQuotes(proposal: Proposal, texts: ReadonlyMap<string, string>): ProposalIssue[] {
  const index = new QuoteIndex(texts);
  const errors: ProposalIssue[] = [];
  for (const { path, evidence } of evidences(proposal)) {
    if (!index.has(evidence.source) || index.contains(evidence.source, evidence.quote)) continue;
    errors.push(
      issue(
        'PROPOSAL_QUOTE_NOT_FOUND',
        `${path}.evidence.quote`,
        `the quote is not in ${evidence.source}: an entry stands only on text its source holds`,
      ),
    );
  }
  return errors;
}

/** Every evidence of the proposal with its path: values, constraints, then phrases that carry one. */
export function evidences(proposal: Proposal): Array<{ path: string; evidence: Evidence }> {
  const found: Array<{ path: string; evidence: Evidence }> = [];
  proposal.dimensions.forEach((dimension, d) => {
    dimension.values.forEach((value, v) => {
      found.push({ path: `dimensions.${d}.values.${v}`, evidence: value.evidence });
    });
  });
  proposal.constraints.forEach((constraint, c) => {
    found.push({ path: `constraints.${c}`, evidence: constraint.evidence });
  });
  proposal.phrases.forEach((phrase, p) => {
    if (phrase.evidence) found.push({ path: `phrases.${p}`, evidence: phrase.evidence });
  });
  (proposal.relations ?? []).forEach((relation, r) => {
    found.push({ path: `relations.${r}`, evidence: relation.evidence });
  });
  (proposal.numeric_settings ?? []).forEach((setting, index) => {
    found.push({ path: `numeric_settings.${index}`, evidence: setting.evidence });
  });
  return found;
}

/** A short label for a relation, for listings and errors. */
export function relationLabel(relation: ProposalRelation): string {
  switch (relation.kind) {
    case 'path':
      return `path ${relation.id} (${relation.flow}: ${relation.stages.join(' > ')})`;
    case 'uses_tool':
      return `${relation.subject.dimension}=${relation.subject.value} uses ${relation.tool} at ${relation.stage}${relation.to ? ` to ${relation.to}` : ''}`;
    case 'states':
      return `${relation.subject.dimension}=${relation.subject.value} states ${(relation.must ?? []).join(', ')}${relation.must_not ? `; forbids ${relation.must_not.join(', ')}` : ''} at ${relation.stage}${relation.to ? ` to ${relation.to}` : ''}`;
    case 'task_family':
      return `task family ${relation.family} writes ${relation.flow} (${relation.stages.join(' > ')})`;
    case 'binds':
      return `${relation.subject.dimension}=${relation.subject.value} binds ${Object.keys(relation.slots).join(', ')}`;
    case 'recovery':
      return `recovery ${relation.class}${relation.tool ? ` of ${relation.tool}` : ''} in ${relation.flows.join(', ')}`;
    case 'reply_language':
      return `${relation.subject.dimension}=${relation.subject.value} sets the reply language ${relation.lang}`;
    case 'tool_order':
      return `${relation.before} is called before ${relation.after}`;
    case 'reply_text':
      return `${relation.subject.dimension}=${relation.subject.value} fixes the reply text`;
    case 'route':
      return `${relation.subject.dimension}=${relation.subject.value} routes to ${relation.to}`;
    case 'reply_count':
      return relation.per_turn === 'one' ? 'one reply per user turn' : 'any number of replies per user turn';
  }
}

/** Whether a value counts as approved: its own flag, else its dimension's. */
export function valueApproved(dimension: ProposalDimension, value: ProposalValue): boolean {
  return value.approved ?? dimension.approved;
}

/**
 * Counts what a person decides: one flag per dimension, constraint and phrase (`total`, `approved`), and
 * the values those flags reach (`valuesApproved`, overrides included).
 */
export function countEntries(proposal: Proposal): {
  dimensions: number;
  values: number;
  constraints: number;
  phrases: number;
  relations: number;
  numeric_settings?: number;
  total: number;
  approved: number;
  valuesApproved: number;
} {
  const relations = proposal.relations ?? [];
  const flags = [
    ...proposal.dimensions.map((dimension) => dimension.approved),
    ...proposal.constraints.map((constraint) => constraint.approved),
    ...proposal.phrases.map((phrase) => phrase.approved),
    ...relations.map((relation) => relation.approved),
    ...(proposal.numeric_settings ?? []).map((setting) => setting.approved),
  ];
  return {
    dimensions: proposal.dimensions.length,
    values: proposal.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
    constraints: proposal.constraints.length,
    phrases: proposal.phrases.length,
    relations: relations.length,
    ...(proposal.numeric_settings === undefined
      ? {}
      : { numeric_settings: proposal.numeric_settings.length }),
    total: flags.length,
    approved: flags.filter(Boolean).length,
    valuesApproved: proposal.dimensions.reduce(
      (sum, dimension) => sum + dimension.values.filter((value) => valueApproved(dimension, value)).length,
      0,
    ),
  };
}

/** The proposal as YAML, with a header that tells the reader how to approve it. */
export function renderProposal(proposal: Proposal): string {
  // No anchors or aliases: a person reads and edits each entry where it stands.
  const doc = new Document(proposal, { aliasDuplicateObjects: false });
  doc.commentBefore = [
    ` driftbench map proposal for ${proposal.agent}: where the agent's behaviour is specified.`,
    ' Code and a model proposed each entry with the quote that justifies it. Nothing counts until a person',
    ' approves it. A dimension has one approved flag, which its values inherit (a value may set its own);',
    ' each constraint and phrase has its own. role axis puts a dimension in the space map; detail keeps it',
    ' for the generator, inside a cell. Approve with',
    '   driftbench extract approve <this file> --dimension <id>   or   --all',
    ' An entry whose quote is missing, or no longer found in its source, is refused.',
  ].join('\n');
  const sources = doc.get('sources', true);
  if (isSeq(sources)) {
    for (const item of sources.items) if (isMap(item)) item.flow = true;
  }
  const constraints = doc.get('constraints', true);
  if (isSeq(constraints)) {
    for (const item of constraints.items) {
      const forbid = isMap(item) ? item.get('forbid', true) : undefined;
      if (isMap(forbid)) forbid.flow = true;
    }
  }
  // Short lists and value references read best on one line.
  const inline = [
    'when',
    'binds',
    'subject',
    'slots',
    'stages',
    'behaviours',
    'flows',
    'at',
    'must',
    'must_not',
  ];
  for (const key of ['phrases', 'relations']) {
    const list = doc.get(key, true);
    if (!isSeq(list)) continue;
    for (const item of list.items) {
      if (!isMap(item)) continue;
      for (const name of inline) {
        const node = item.get(name, true);
        if (isMap(node) || isSeq(node)) node.flow = true;
      }
    }
  }
  return doc.toString({ lineWidth: 0 });
}

/** Rules the schema cannot express: unique entries, and references that resolve. */
function checkReferences(proposal: Proposal): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  const sourcePaths = new Set<string>();
  proposal.sources.forEach((source, index) => {
    if (sourcePaths.has(source.path)) {
      issues.push(
        issue('PROPOSAL_DUPLICATE', `sources.${index}.path`, `source "${source.path}" is listed twice`),
      );
    }
    sourcePaths.add(source.path);
  });
  const checkSource = (evidence: Evidence | undefined, path: string) => {
    if (evidence && !sourcePaths.has(evidence.source)) {
      issues.push(
        issue('PROPOSAL_UNKNOWN_SOURCE', `${path}.evidence.source`, `"${evidence.source}" is not in sources`),
      );
    }
  };

  const dimensions = new Map<string, Set<string>>();
  const numericIds = new Set<string>();
  (proposal.numeric_settings ?? []).forEach((setting, index) => {
    if (numericIds.has(setting.id))
      issues.push(
        issue(
          'PROPOSAL_DUPLICATE',
          `numeric_settings.${index}.id`,
          `numeric setting "${setting.id}" is listed twice`,
        ),
      );
    numericIds.add(setting.id);
    checkSource(setting.evidence, `numeric_settings.${index}`);
  });
  proposal.dimensions.forEach((dimension, d) => {
    const path = `dimensions.${d}`;
    if (dimensions.has(dimension.id)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.id`, `dimension "${dimension.id}" is listed twice`));
    }
    const values = new Set<string>();
    dimension.values.forEach((value, v) => {
      if (values.has(value.id)) {
        issues.push(
          issue(
            'PROPOSAL_DUPLICATE',
            `${path}.values.${v}.id`,
            `value "${value.id}" is listed twice in ${dimension.id}`,
          ),
        );
      }
      values.add(value.id);
      checkSource(value.evidence, `${path}.values.${v}`);
    });
    if (!dimensions.has(dimension.id)) dimensions.set(dimension.id, values);
  });

  const reference = (dimension: string, value: string, path: string) => {
    const values = dimensions.get(dimension);
    if (!values) {
      issues.push(issue('PROPOSAL_UNKNOWN_DIMENSION', path, `dimension "${dimension}" is not in dimensions`));
    } else if (!values.has(value)) {
      issues.push(issue('PROPOSAL_UNKNOWN_VALUE', path, `value "${value}" is not a value of ${dimension}`));
    }
  };

  const forbidden = new Set<string>();
  proposal.constraints.forEach((constraint, c) => {
    const path = `constraints.${c}`;
    for (const [dimension, value] of Object.entries(constraint.forbid)) {
      reference(dimension, value, `${path}.forbid.${dimension}`);
    }
    const key = combinationKey(constraint.forbid);
    if (forbidden.has(key)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.forbid`, 'the same combination is forbidden twice'));
    }
    forbidden.add(key);
    checkSource(constraint.evidence, path);
  });

  const phrases = new Set<string>();
  proposal.phrases.forEach((phrase, p) => {
    const path = `phrases.${p}`;
    reference(phrase.dimension, phrase.value, `${path}.value`);
    const key = JSON.stringify([phrase.dimension, phrase.value, phrase.lang, phrase.text.trim()]);
    if (phrases.has(key)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.text`, 'the same phrase is listed twice'));
    }
    phrases.add(key);
    checkSource(phrase.evidence, path);
    if (phrase.when) checkWhen(phrase.when, `${path}.when`);
  });

  function checkWhen(when: When, path: string): void {
    for (const [dimension, values] of Object.entries(when)) {
      values.forEach((value, index) => {
        reference(dimension, value, `${path}.${dimension}.${index}`);
      });
    }
  }
  const ofKind = (kind: DimensionKind) =>
    proposal.dimensions.find((dimension) => dimension.kind === kind)?.values.map((value) => value.id) ?? [];
  const stages = new Set(ofKind('stage'));
  const checkStage = (stage: string, path: string) => {
    if (!stages.has(stage)) {
      issues.push(issue('PROPOSAL_UNKNOWN_VALUE', path, `"${stage}" is not a value of the stage dimension`));
    }
  };
  const checkFlow = (flow: string, path: string) => reference(FLOW_DIMENSION, flow, path);
  const deviations = new Set(ofKind('deviation'));
  const paths = new Set<string>();
  (proposal.relations ?? []).forEach((relation, r) => {
    const path = `relations.${r}`;
    checkSource(relation.evidence, path);
    switch (relation.kind) {
      case 'path':
        if (paths.has(relation.id)) {
          issues.push(issue('PROPOSAL_DUPLICATE', `${path}.id`, `path "${relation.id}" is listed twice`));
        }
        paths.add(relation.id);
        checkFlow(relation.flow, `${path}.flow`);
        relation.stages.forEach((stage, index) => {
          checkStage(stage, `${path}.stages.${index}`);
        });
        for (const [index, behaviour] of (relation.behaviours ?? []).entries()) {
          const known = proposal.dimensions.some(
            (dimension) =>
              dimension.kind === 'behaviour' && dimension.values.some((value) => value.id === behaviour),
          );
          if (!known) {
            issues.push(
              issue(
                'PROPOSAL_UNKNOWN_VALUE',
                `${path}.behaviours.${index}`,
                `"${behaviour}" is not a behaviour`,
              ),
            );
          }
        }
        if (relation.when) checkWhen(relation.when, `${path}.when`);
        break;
      case 'uses_tool':
      case 'states':
        reference(relation.subject.dimension, relation.subject.value, `${path}.subject`);
        checkStage(relation.stage, `${path}.stage`);
        if (relation.to !== undefined) checkStage(relation.to, `${path}.to`);
        if (relation.when) checkWhen(relation.when, `${path}.when`);
        break;
      case 'binds':
      case 'reply_language':
        reference(relation.subject.dimension, relation.subject.value, `${path}.subject`);
        break;
      case 'tool_order':
        break;
      case 'reply_text':
        reference(relation.subject.dimension, relation.subject.value, `${path}.subject`);
        break;
      case 'route':
        reference(relation.subject.dimension, relation.subject.value, `${path}.subject`);
        break;
      case 'recovery':
        if (!deviations.has(relation.class)) {
          issues.push(
            issue(
              'PROPOSAL_UNKNOWN_VALUE',
              `${path}.class`,
              `"${relation.class}" is not a value of the deviation dimension`,
            ),
          );
        }
        relation.flows.forEach((flow, index) => {
          checkFlow(flow, `${path}.flows.${index}`);
        });
        (relation.at ?? []).forEach((stage, index) => {
          checkStage(stage, `${path}.at.${index}`);
        });
        if (relation.stage_after !== undefined && relation.stage_after !== PENDING_STAGE) {
          checkStage(relation.stage_after, `${path}.stage_after`);
        }
        break;
      case 'task_family':
        checkFlow(relation.flow, `${path}.flow`);
        relation.stages.forEach((stage, index) => {
          checkStage(stage, `${path}.stages.${index}`);
        });
        if (relation.holds) checkWhen(relation.holds, `${path}.holds`);
        (relation.deviations ?? []).forEach((deviation, index) => {
          if (!deviations.has(deviation))
            issues.push(
              issue(
                'PROPOSAL_UNKNOWN_VALUE',
                `${path}.deviations.${index}`,
                `"${deviation}" is not a value of the deviation dimension`,
              ),
            );
        });
        break;
    }
  });
  return issues;
}

/** A key equal for equal combinations, whatever the order of the dimensions. */
export function combinationKey(forbid: Record<string, string>): string {
  return JSON.stringify(Object.entries(forbid).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function issue(code: ProposalIssueCode, path: string, message: string): ProposalIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): ProposalIssue {
  const path = zodIssue.path.map(String).join('.');
  const last = zodIssue.path.at(-1);
  if (zodIssue.message === EVIDENCE_MISSING || zodIssue.message === QUOTE_MISSING) {
    return issue('PROPOSAL_EVIDENCE_MISSING', path, zodIssue.message);
  }
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys') {
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  } else if (zodIssue.code === 'invalid_type') {
    message = message.replace(/received undefined$/, 'missing');
  } else if (last === 'version' && zodIssue.code === 'invalid_value') {
    message = `this reader knows proposal version ${PROPOSAL_VERSION}`;
  }
  return issue(`SCHEMA_${zodIssue.code.toUpperCase()}`, path, message);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
