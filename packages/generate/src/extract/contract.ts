import { z } from 'zod';
import type { ModelRequest } from '../model/port';
import {
  BindsRelation,
  DimensionId,
  DimensionKind,
  type DimensionKind as Kind,
  Lang,
  PathRelation,
  type ProposalConstraint,
  type ProposalDimension,
  RecoveryRelation,
  ReplyLanguageRelation,
  ReplyTextRelation,
  Role,
  RouteRelation,
  Slots,
  type SourceKind,
  StatesRelation,
  TaskFamilyRelation,
  ToolOrderRelation,
  UsesToolRelation,
  ValueFields,
  ValueId,
  When,
} from './proposal';

/**
 * The answer contract between the extractor and a model: one call per section, a system prompt that asks
 * for quotes and forbids invention, and a strict JSON answer. The envelope is read strictly (unknown keys
 * make the answer unreadable, and an unreadable answer is retried once); each entry is then checked on its
 * own, so one bad entry is refused without losing the rest.
 */

export const SECTIONS = ['stages', 'rules', 'personas', 'data', 'phrases', 'relations'] as const;
export type Section = (typeof SECTIONS)[number];

/** The dimension kinds each section may propose. The phrases section proposes phrases only. */
export const SECTION_KINDS: Record<Section, readonly Kind[]> = {
  stages: ['stage', 'behaviour'],
  rules: ['behaviour', 'deviation'],
  personas: ['persona', 'channel'],
  data: ['data', 'task'],
  phrases: [],
  relations: [],
};

/** The longest quote the contract accepts from a model: a passage, never a file. */
export const MAX_MODEL_QUOTE = 400;
/** The shortest: a quote this short could be found almost anywhere. */
export const MIN_MODEL_QUOTE = 4;

export const SYSTEM_PROMPT = `You map where an AI agent's behaviour is specified. You read the agent's own sources (its prompt or policy, its behaviour inventory, its tool schemas) and you list every place where they fix what the agent does: stages and their order, rules, tools and the values their arguments take, kinds of users, channels, languages, data cases and task settings. Code later turns the approved list into tests by enumerating combinations, and a person approves every entry first. You never write tests, expected answers or verdicts.

Rules:
1. Quote, never invent. Every entry has "source", one of the source paths given, and "quote", text copied character for character from that source that shows the entry is specified there. Code searches every quote in its source and refuses an entry whose quote it cannot find. Copy one short passage, a line or a sentence, at most ${MAX_MODEL_QUOTE} characters. Never paraphrase inside a quote, never join two passages, never correct the text.
2. List only what the sources state. No entry from general knowledge, no behaviour the agent probably has, no case the sources do not support. When the sources say nothing for this section, answer with empty lists.
3. Ids are short slugs: letters, digits, hyphens and underscores; dimension ids are lowercase and may also use dots. Keep the ids already proposed when you add values to an existing dimension, and never repeat a value already listed. There is one dimension of kind stage, one of kind deviation and one of kind channel: add to it. A spec names a behaviour, persona, data or task value without its dimension, so a value id is unique among the dimensions of its kind. The id "none" is reserved.
4. Any person, email or phone number you write is invented: emails end in @example.com, phone numbers sit between +1 202 555 0100 and +1 202 555 0199.
5. Answer with one JSON object and nothing else: no prose, no code fence. Use only these keys:
{
  "section": "<the section you were asked for>",
  "dimensions": [
    {"id": "<dimension id>", "title": "<what it varies>", "kind": "<kind>", "role": "<axis or detail, only when the source declares it>",
     "values": [{"id": "<value id>", "title": "<what the value means>", "polarity": "<must or must_not, on a rule only>", "when": {"<dimension id>": ["<value id>"]}, "unless": {"<dimension id>": ["<value id>"]}, "limit": 3, "within": {"minutes": 5}, "priority": "first", "weight": <share of users between 0 and 1>, "required": <true when a test plan must include the value>, "source": "<path>", "quote": "<verbatim text>"}]}
  ],
  "constraints": [
    {"forbid": {"<dimension id>": "<value id>", "<other dimension id>": "<value id>"}, "reason": "<why these values never occur together>", "source": "<path>", "quote": "<verbatim text>"}
  ],
  "phrases": [
    {"dimension": "<dimension id>", "value": "<value id>", "text": "<one user message>", "lang": "<language tag such as en>", "when": {"<dimension id>": ["<value id>"]}, "binds": {"<slot>": "<value the text states>"}, "source": "<path, only when the text is copied from a source>", "quote": "<the copied text, only with source>"}
  ],
  "relations": [
    {"kind": "<path, uses_tool, states, task_family, binds, recovery, reply_language, tool_order, route, reply_text or reply_count>", "...": "the keys of that kind, listed in the relations section", "source": "<path>", "quote": "<verbatim text>"}
  ]
}
On a rule, "polarity" says whether the agent must do it or must not do it; leave it out on every other value. On a persona or data value, "required" is true when the source says every test plan must include it; leave it out otherwise. On a kind of customer or other persona value, "weight" is the share of users it stands for, between 0 and 1; leave it out otherwise. On a rule, "priority" is "first" when the source says the rule comes before every other rule; leave it out otherwise. On a rule, "within" gives the minutes within which the action happens; leave it out otherwise. On a rule, "limit" is the most times the action may happen in one conversation; leave it out otherwise. On a rule, "unless" lists the cell values the rule does not hold in ("except on sms"); leave it out otherwise. On a rule, "when" lists the cell values the rule applies in, when the source limits it (a channel, a kind of customer, a stage); leave it out for a rule that holds everywhere. Give a dimension "role" only when a source declares it: "axis" when it says the values make a different kind of conversation, "detail" when it says they can show up inside any conversation; otherwise leave it out. A constraint names values from at least two dimensions, and only when a source states that the combination cannot happen. A phrase may hold {slot} where a value the cell binds goes, such as "It's {email}"; "when" and "binds" are optional. Relations come from the relations section only.`;

const TASKS: Record<Section, string> = {
  stages: `List the stages the agent moves through, and the moves between them that the sources specify.
Dimension "stage" (kind "stage"): one value per stage, in the order the sources give.
Dimension "stage_transition" (kind "behaviour"): one value per move from one stage to the next, with the id "<from>-to-<to>" and a quote that shows the move.
Constraints: a stage that a source ties to one flow, kind of user or channel, as a combination that cannot happen elsewhere.`,
  rules: `List the rules the agent must follow that the dimensions already listed do not hold: what it must always do, what it must never do, guardrails, the order of tool calls, retries, routing and refusals.
Dimension "rule" (kind "behaviour"): one value per rule.
Dimension "deviation" (kind "deviation"): a deviation class the sources handle explicitly that is not already listed. Use these class ids only: D1_off_topic, D2_goal_shift, D3_contradiction, D4_loose_confirmation, D5_language_switch, D6_instruction_in_data, D7_silence_or_burst, D8_tool_failure, D9_out_of_scope, D10_return.`,
  personas: `List the kinds of users and ways of speaking that the sources treat differently: customer types, languages, tones, how much a user says in one message, and channels.
Dimensions of kind "persona", such as "customer_type", "language" or "tone"; channels go in the dimension "channel" (kind "channel"). A value needs a quote that shows the agent treats that kind of user, or that channel, in its own way.`,
  data: `List the data cases the agent's behaviour depends on: the results a tool can return and how the next step changes with them (found or not found, eligible or not, empty lists, errors, answers the agent cannot read), the values a user gives that change the flow, and for a code agent the task settings (the files in the workspace, their formats and sizes, what the agent must leave untouched).
Dimensions of kind "data" for data cases and of kind "task" for task settings. The tool schema dimensions already listed come from code: add only cases they do not hold.`,
  phrases: `Propose user phrasings for the values listed above that a user expresses in a message, such as flows, stage transitions, deviation classes and kinds of users. One phrase is one user message, in the language of its "lang" tag. At most three phrases per value. A phrase may hold {slot} for a value a data case binds (the relations section binds it), may say with "when" the cell values it fits (such as the flow or the stage it is said at), and may state slot values itself with "binds" (the plan it names). When a source holds an example user message for a value, copy it and give its source and quote; otherwise leave source and quote out. Answer with phrases only: "dimensions", "constraints" and "relations" stay empty.`,
  relations: `List the relations the sources state between the values above, so code can derive what to check: which tool a flow calls, at which stage, with which arguments; what a reply states from a tool's answer; the order of stages a flow passes; what the store holds at the end; how a flow recovers from a deviation class; the language of every reply. Answer with relations only. Each relation has "kind", "source", "quote" and the keys of its kind:
- "path": "id", "flow" (a value of the flow dimension), "stages" (the stages in the order the conversation passes them), optional "when" (the cell values the branch needs, per dimension, as lists), optional "behaviours", optional "end_state" ({"source": "tool:<label>", "mode": "subset" or "exact", "expect": {"<field>": <assertion>}}).
- "uses_tool": "subject" ({"dimension", "value"}: the flow or behaviour), "tool", "stage" (the stage the call is made at), optional "to" (only on the turn that reaches it), optional "when", optional "count", optional "input" ({"<argument>": <assertion>}). A flow's call is made on the move that leaves "stage"; a behaviour's call is made in the turn that asks for that behaviour, said at "stage", and never on a move.
- "states": "subject" ({"dimension", "value"}: the flow or behaviour), "stage" (the turn that leaves it), optional "to" (only on the turn that reaches it), optional "when", optional "must" (patterns the reply holds, such as each plan with the tool price), optional "must_not" (patterns the reply forbids). At least one pattern list is required. Both lists support {slot} placeholders from approved binds; inserted values are escaped as literal regex text.
- "task_family": "flow", "family" (the family file, relative to the proposal), "stages" (its blocks' stages in order), optional "holds" (the cell values every instance holds), optional "deviations" (the classes its variants carry).
- "binds": "subject" (a data or persona value), "slots" ({"<slot>": "<concrete value>"}): the fictional values it stands for.
- "recovery": "class" (a deviation class), "flows", optional "at" (the stages it is probed at), optional "tool" (the tool that fails, for D8_tool_failure), optional "stage_after" (a stage, or "pending" for the stage the conversation had reached), optional "must", "must_not" (patterns on the reply), "guards" ([{"name", "verdict"}]), "tools" ([{"tool", "count", "input"}]).
- "reply_language": "subject" (the rule value), "lang" (the language tag every reply is in).
- "tool_order": "before" (a tool name), "after" (a tool name): the sources say the first is called before the second.
- "reply_text": "subject" (the rule value), "text" (the exact words of the reply, as the source gives them).
- "route": "subject" (the rule value), "to" (the team, as the source names it): the rule sends a topic to that team.
- "reply_count": "per_turn" ("one" or "any"): how many replies the agent sends to one user turn. Give it only when a source says so; without it a map means one reply per user turn.
An assertion is a value, or one of {"regex"}, {"contains"}, {"one_of"}, {"subset"}, {"absent": true}, {"nonempty": true}. A string may hold {slot} for a value the cell binds.`,
};

export type SourceText = { kind: SourceKind; path: string; text: string };

/** What a section's model sees of the proposal so far: dimensions and constraints. */
export type ProposalSoFar = {
  dimensions: readonly ProposalDimension[];
  constraints: readonly ProposalConstraint[];
};

/**
 * The request for one section. The first line of the user message names the section, so a recorded answer
 * can be matched to it; the sources follow in full, between markers, without line numbers to copy.
 */
/** The values of one dimension a request lists: a dimension of thousands of values would outgrow the context. */
export const LISTED_VALUES = 40;

export function sectionRequest(
  section: Section,
  sources: readonly SourceText[],
  soFar: ProposalSoFar,
  maxTokens?: number,
): ModelRequest {
  const kinds = SECTION_KINDS[section];
  const listed =
    soFar.dimensions.length === 0
      ? ['(none yet)']
      : soFar.dimensions.flatMap((dimension) => [
          `- ${dimension.id} (${dimension.kind}): ${dimension.title}`,
          ...dimension.values.slice(0, LISTED_VALUES).map((value) => `    ${value.id}: ${value.title}`),
          ...(dimension.values.length > LISTED_VALUES
            ? [
                `    ... and ${dimension.values.length - LISTED_VALUES} more values (ids are kept; a repeated value is ignored)`,
              ]
            : []),
        ]);
  const user = [
    `SECTION: ${section}`,
    '',
    TASKS[section],
    '',
    `Dimension kinds allowed in this section: ${kinds.length > 0 ? kinds.join(', ') : 'none (phrases only)'}.`,
    '',
    'Already proposed (keep these ids; do not repeat these values):',
    ...listed,
    '',
    `Sources (quote from these only; the "source" of an entry is one of these paths):`,
    ...sources.flatMap((source) => [
      '',
      `<<<SOURCE ${source.path} (${source.kind})`,
      source.text.trimEnd(),
      `SOURCE ${source.path}>>>`,
    ]),
  ].join('\n');
  return maxTokens === undefined
    ? { system: SYSTEM_PROMPT, user }
    : { system: SYSTEM_PROMPT, user, maxTokens };
}

/** The section a request is for, read from its first line. */
export function sectionOf(user: string): Section | undefined {
  const match = /^SECTION: ([a-z]+)/.exec(user);
  const name = match?.[1];
  return (SECTIONS as readonly string[]).includes(name ?? '') ? (name as Section) : undefined;
}

/** The note added to the request when an answer could not be read, before the one retry. */
export function retryNote(reason: string): string {
  return `Your previous answer could not be read: ${reason}. Answer again with one JSON object in the shape given, and nothing else.`;
}

const Envelope = z.strictObject({
  section: z.string(),
  dimensions: z.array(z.unknown()).default([]),
  constraints: z.array(z.unknown()).default([]),
  phrases: z.array(z.unknown()).default([]),
  relations: z.array(z.unknown()).default([]),
});
export type Answer = z.infer<typeof Envelope>;

export type AnswerParse = { ok: true; answer: Answer } | { ok: false; reason: string };

/**
 * Reads a model's answer: JSON, optionally inside one code fence, with the strict envelope and the right
 * section. Entries are not checked here (see `acceptAnswer`).
 */
export function parseAnswer(section: Section, text: string): AnswerParse {
  const json = readJson(text);
  if (!json.ok) return json;
  const parsed = Envelope.safeParse(json.value);
  if (!parsed.success)
    return { ok: false, reason: `the answer does not have the agreed shape: ${firstIssue(parsed.error)}` };
  if (parsed.data.section !== section) {
    return { ok: false, reason: `the answer is for the section "${parsed.data.section}", not "${section}"` };
  }
  return { ok: true, answer: parsed.data };
}

function readJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'the answer is empty' };
  const fenced = /^```[A-Za-z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch (cause) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start && (start > 0 || end < body.length - 1)) {
      try {
        return { ok: true, value: JSON.parse(body.slice(start, end + 1)) as unknown };
      } catch {
        // The first error says more than the second.
      }
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, reason: `the answer is not JSON (${message})` };
  }
}

const QUOTE_REQUIRED = 'the quote is missing: every entry quotes the source that justifies it';
const SOURCE_REQUIRED = 'the source is missing: name the path of the source the quote comes from';

export const AnswerValue = z.strictObject({
  id: ValueId,
  title: z.string({ error: 'the title is missing' }).min(1),
  source: z.string({ error: SOURCE_REQUIRED }).min(1, { error: SOURCE_REQUIRED }),
  quote: z.string({ error: QUOTE_REQUIRED }),
  ...ValueFields,
});

export const AnswerDimension = z.strictObject({
  id: DimensionId,
  title: z.string({ error: 'the title is missing' }).min(1),
  kind: DimensionKind,
  role: Role.optional(),
  values: z.array(z.unknown()),
});

export const AnswerConstraint = z.strictObject({
  forbid: z.record(DimensionId, ValueId),
  reason: z.string({ error: 'the reason is missing' }).min(1),
  source: z.string({ error: SOURCE_REQUIRED }).min(1, { error: SOURCE_REQUIRED }),
  quote: z.string({ error: QUOTE_REQUIRED }),
});

export const AnswerPhrase = z.strictObject({
  dimension: DimensionId,
  value: ValueId,
  text: z.string({ error: 'the text is missing' }).min(1).max(500),
  lang: Lang,
  when: When.optional(),
  binds: Slots.optional(),
  source: z.string().min(1).optional(),
  quote: z.string().optional(),
});

const answerEvidence = {
  source: z.string({ error: SOURCE_REQUIRED }).min(1, { error: SOURCE_REQUIRED }),
  quote: z.string({ error: QUOTE_REQUIRED }),
};
const strip = { evidence: true, produced_by: true, approved: true } as const;

/** One relation as a model answers it: the proposal's relation with source and quote for its evidence. */
export const AnswerRelation = z.discriminatedUnion('kind', [
  PathRelation.omit(strip).extend(answerEvidence),
  UsesToolRelation.omit(strip).extend(answerEvidence),
  z
    .strictObject(StatesRelation.shape)
    .omit(strip)
    .extend(answerEvidence)
    .refine((entry) => entry.must !== undefined || entry.must_not !== undefined, {
      message: 'a states relation needs must or must_not patterns',
    }),
  TaskFamilyRelation.omit(strip).extend(answerEvidence),
  BindsRelation.omit(strip).extend(answerEvidence),
  RecoveryRelation.omit(strip).extend(answerEvidence),
  ReplyLanguageRelation.omit(strip).extend(answerEvidence),
  ToolOrderRelation.omit(strip).extend(answerEvidence),
  RouteRelation.omit(strip).extend(answerEvidence),
  ReplyTextRelation.omit(strip).extend(answerEvidence),
]);
export type AnswerRelation = z.infer<typeof AnswerRelation>;

/** The first problem zod found, as `path: message`, with plain words for unknown keys. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'unknown problem';
  const message =
    issue.code === 'unrecognized_keys'
      ? `unknown key${issue.keys.length > 1 ? 's' : ''} ${issue.keys.join(', ')}`
      : issue.message.replace(/received undefined$/, 'missing');
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${message}` : message;
}
