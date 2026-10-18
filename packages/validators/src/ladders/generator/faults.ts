import type { DeviationClass, DriftClass, Message, WorldState } from '@agent-nexus/driftbench-core';
import { type FaultDef, type FaultSession, rngFor, type ThenField } from '@agent-nexus/driftbench-generate';
import {
  compose,
  createFollower,
  defaultValue,
  FOREIGN_REPLY,
  type Mutation,
  type MutationContext,
  savedContent,
  sha256,
} from './follower';
import { DEVIATION_RULES, type HiddenSpec, type HiddenTool } from './hidden';

/**
 * The fault family of the generator validator: 70 classes of wrong behaviour, each the rule follower with
 * one decision replaced (follower.ts), in three families: 28 drift classes (X1 to X5, split by what goes
 * wrong), 22 deviation classes (D1 to D10, split by how the recovery fails) and 20 code-agent classes (a
 * file the agent claims and does not leave, or leaves wrong). Each class is planted up to five times,
 * parameterised by where it fires (anywhere, or at one of two stages or tools the seed draws) and how often
 * (every opportunity, every second or every third one). Pairwise and three-way interactions compose the classes' every-time
 * mutations; they are generated from the class list, never listed by hand.
 */

export type FaultFamily = 'drift' | 'deviation' | 'code';

/** One class of the catalogue. */
export type FaultClass = {
  id: string;
  family: FaultFamily;
  /** The drift or deviation class of the spec reference it belongs to; `code` for code-agent faults. */
  parent: DriftClass | DeviationClass | 'code';
  /** Difficulty tier of the item that asks for its kill, 1 to 5. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** The Then fields the fault changes. */
  affects: ThenField[];
  /** What it does wrong. */
  description: string;
  /** The check a block needs to catch it. */
  needs: string;
  /** The rule of the hidden specification it breaks. */
  rule: (spec: HiddenSpec) => string;
  /** Where it can fire: stages or tools; one is drawn by the seed for the second instance. */
  places: (spec: HiddenSpec) => string[];
  /** The mutation, given a predicate that says whether the fault fires at a place. */
  mutation: (spec: HiddenSpec, fires: (ctx: MutationContext, at: string) => boolean) => Mutation;
};

/** One planted instance. */
export type HiddenFault = {
  def: FaultDef;
  class: string;
  family: FaultFamily;
  parent: FaultClass['parent'];
  where: string;
  rate: number;
  rule: string;
  needs: string;
  mutation: Mutation;
};

type Fires = (ctx: MutationContext, at: string) => boolean;

const stageIds = (spec: HiddenSpec) => spec.stages.map((stage) => stage.id);
const middleStages = (spec: HiddenSpec) => stageIds(spec).filter((stage) => stage !== spec.start);
const toolNames = (spec: HiddenSpec) => spec.tools.map((tool) => tool.name);
const readTools = (spec: HiddenSpec) =>
  spec.tools.filter((tool) => !tool.sideEffect).map((tool) => tool.name);
const enumOf = (tool: HiddenTool) => tool.input.find((property) => property.type === 'enum');
const integerOf = (tool: HiddenTool) => tool.input.find((property) => property.type === 'integer');
const previous = (spec: HiddenSpec, stage: string) =>
  Object.entries(spec.next).find(([, to]) => to === stage)?.[0] ?? spec.start;
const question = (spec: HiddenSpec, stage: string) =>
  spec.stages.find((entry) => entry.id === stage)?.question ?? '';

/** A drift class that rewrites one tool input. */
function inputClass(
  id: string,
  description: string,
  change: (tool: HiddenTool, input: Record<string, unknown>) => Record<string, unknown>,
  tier: FaultClass['tier'] = 2,
): FaultClass {
  return {
    id,
    family: 'drift',
    parent: 'X1_local',
    tier,
    affects: ['tools'],
    description,
    needs: 'a tools input assertion on the value the conversation gave',
    rule: () => 'A tool gets the value the user gave.',
    places: readTools,
    mutation: (_spec, fires) => ({
      input: (tool, input, ctx) => (fires(ctx, tool.name) ? change(tool, input) : input),
    }),
  };
}

/** A drift class that changes the stage a move reaches. */
function moveClass(
  id: string,
  description: string,
  target: (spec: HiddenSpec, from: string, to: string) => string,
): FaultClass {
  return {
    id,
    family: 'drift',
    parent: 'X3_flow',
    tier: 2,
    affects: ['stage', 'tools'],
    description,
    needs: 'expect.stage on the block of the move',
    rule: () => 'Each move reaches the stage it names.',
    places: middleStages,
    mutation: (spec, fires) => ({
      move: (from, to, ctx) => (fires(ctx, to) ? target(spec, from, to) : to),
    }),
  };
}

/** A drift class that rewrites the reply. */
function replyClass(
  id: string,
  parent: DriftClass,
  description: string,
  affects: ThenField[],
  needs: string,
  rewrite: (spec: HiddenSpec, texts: string[], stage: string) => string[],
  tier: FaultClass['tier'] = 3,
): FaultClass {
  return {
    id,
    family: 'drift',
    parent,
    tier,
    affects,
    description,
    needs,
    rule: () => 'Replies are one message in English that ends with the pending question.',
    places: stageIds,
    mutation: (spec, fires) => ({
      reply: (texts, ctx) => (fires(ctx, ctx.stage) ? rewrite(spec, texts, ctx.stage) : texts),
    }),
  };
}

/** A deviation class: the recovery from one deviation goes wrong in one way. */
function deviationClass(
  id: string,
  cls: DeviationClass,
  description: string,
  affects: ThenField[],
  needs: string,
  answer: (
    spec: HiddenSpec,
    ctx: MutationContext,
    said: string,
  ) => { stage?: string; enter?: boolean; said?: string; replies?: string[] },
  tier: FaultClass['tier'] = 3,
): FaultClass {
  return {
    id,
    family: 'deviation',
    parent: cls,
    tier,
    affects,
    description,
    needs,
    rule: () => DEVIATION_RULES[cls],
    places: middleStages,
    mutation: (spec, fires) => ({
      deviation: (seen, rule, ctx) => {
        if (seen !== cls || !fires(ctx, ctx.stage)) return rule;
        const changed = answer(spec, ctx, rule.said);
        const stage = changed.stage ?? rule.stage;
        return {
          stage,
          enter: changed.enter ?? rule.enter,
          said: changed.said ?? rule.said,
          ...(changed.replies ? { replies: changed.replies } : {}),
        };
      },
    }),
  };
}

/** A code-agent class: the export file is missing or wrong. */
function codeClass(
  id: string,
  description: string,
  change: (spec: HiddenSpec, result: import('./follower').SaveResult) => import('./follower').SaveResult,
  tier: FaultClass['tier'] = 5,
): FaultClass {
  return {
    id,
    family: 'code',
    parent: 'code',
    tier,
    affects: ['workspace', 'artifacts'],
    description,
    needs: 'a workspace or artifacts Then on the turn that asks for the file',
    rule: (spec) => `Save the record as ${spec.saveFile} when asked, and touch nothing else.`,
    places: () => ['exports'],
    mutation: (spec, fires) => ({
      save: (result, ctx) => (fires(ctx, 'exports') ? change(spec, result) : result),
    }),
  };
}

const renamed = (path: string) => (_spec: HiddenSpec, result: import('./follower').SaveResult) => ({
  ...result,
  diff: { ...result.diff, created: [path] },
  artifacts: result.artifacts.map((artifact) => ({ ...artifact, path })),
  files: { [path]: Object.values(result.files).join('') },
});

/** The catalogue: 28 drift, 22 deviation and 20 code-agent classes. */
export const FAULT_CLASSES: readonly FaultClass[] = [
  inputClass(
    'X1.enum-next',
    'Sends the next member of the enum instead of the one the conversation gave.',
    (tool, input) => {
      const property = enumOf(tool);
      if (property?.type !== 'enum') return input;
      const at = property.members.indexOf(String(input[property.name]));
      return { ...input, [property.name]: property.members[(at + 1) % property.members.length] };
    },
  ),
  inputClass('X1.enum-first', 'Always sends the first member of the enum.', (tool, input) => {
    const property = enumOf(tool);
    return property?.type === 'enum' ? { ...input, [property.name]: property.members[0] } : input;
  }),
  inputClass(
    'X1.integer-up',
    'Sends the integer one above what it should send, inside the bounds.',
    (tool, input) => {
      const property = integerOf(tool);
      if (property?.type !== 'integer') return input;
      const value = Number(input[property.name]);
      return { ...input, [property.name]: value + 1 <= property.maximum ? value + 1 : value - 1 };
    },
  ),
  inputClass('X1.integer-invalid', 'Sends an integer above the schema maximum.', (tool, input) => {
    const property = integerOf(tool);
    return property?.type === 'integer' ? { ...input, [property.name]: property.maximum + 1 } : input;
  }),
  inputClass('X1.field-missing', 'Leaves the enum argument out of the call.', (tool, input) => {
    const property = enumOf(tool);
    if (!property) return input;
    const { [property.name]: _dropped, ...rest } = input;
    return rest;
  }),
  inputClass(
    'X1.field-extra',
    'Adds an argument the schema does not name.',
    (_tool, input) => ({ ...input, note: 'added by the agent' }),
    3,
  ),
  inputClass('X1.case', 'Sends the enum member in upper case.', (tool, input) => {
    const property = enumOf(tool);
    return property ? { ...input, [property.name]: String(input[property.name]).toUpperCase() } : input;
  }),
  {
    id: 'X2.fact-flip',
    family: 'drift',
    parent: 'X2_contradiction',
    tier: 4,
    affects: ['text'],
    description: 'States the opposite of a yes or no the tool answered.',
    needs: 'a must or must_not on the tool answer the reply states',
    rule: () => 'Facts come only from tool results.',
    places: toolNames,
    mutation: (_spec, fires) => ({
      facts: (facts, ctx) =>
        facts.map((fact) =>
          typeof fact.value === 'boolean' && fires(ctx, fact.tool) ? { ...fact, value: !fact.value } : fact,
        ),
    }),
  },
  {
    id: 'X2.slot-first',
    family: 'drift',
    parent: 'X2_contradiction',
    tier: 3,
    affects: ['tools', 'end_state'],
    description: 'Keeps the first value the user gave for a slot after the user gives another.',
    needs: 'a tools input or end state assertion after a slot is restated',
    rule: () => 'The latest value the user gives holds.',
    places: (spec) => spec.tools.map((tool) => tool.slot),
    mutation: (_spec, fires) => ({
      slot: (name, given, held, ctx) => (held !== undefined && fires(ctx, name) ? held : given),
    }),
  },
  {
    id: 'X2.fact-invent',
    family: 'drift',
    parent: 'X2_contradiction',
    tier: 4,
    affects: ['text'],
    description: 'States an answer of a tool it never called.',
    needs: 'a must_not on facts of tools the turn does not call',
    rule: () => 'Facts come only from tool results.',
    places: stageIds,
    mutation: (spec, fires) => ({
      facts: (facts, ctx, called) => {
        if (!fires(ctx, ctx.stage)) return facts;
        const uncalled = spec.tools.find((tool) => !called.includes(tool.name));
        const output = uncalled?.output[0];
        return uncalled && output
          ? [...facts, { tool: uncalled.name, field: output.name, value: defaultValue(output) }]
          : facts;
      },
    }),
  },
  moveClass('X3.skip', 'Skips the stage it moves into: moves one stage further.', (spec, _from, to) =>
    to === spec.final ? to : (spec.next[to] ?? to),
  ),
  moveClass('X3.stay', 'Does not move: stays at the stage it was at.', (_spec, from) => from),
  moveClass('X3.back', 'Moves to the stage before the one it left.', (spec, from) => previous(spec, from)),
  moveClass('X3.jump-final', 'Jumps to the last stage.', (spec) => spec.final),
  moveClass('X3.restart', 'Goes back to the start instead of moving on.', (spec) => spec.start),
  {
    id: 'X3.no-report',
    family: 'drift',
    parent: 'X3_flow',
    tier: 4,
    affects: ['stage'],
    description: 'Reports no stage at all in its runtime trace.',
    needs: 'a stage check that fails when no stage is reported',
    rule: () => 'The runtime reports the stage of every turn.',
    places: stageIds,
    mutation: (_spec, fires) => ({ report: (stage, ctx) => (fires(ctx, stage) ? null : stage) }),
  },
  {
    id: 'X3.wrong-name',
    family: 'drift',
    parent: 'X3_flow',
    tier: 2,
    affects: ['stage'],
    description: 'Reports its stage under a misspelt name.',
    needs: 'expect.stage on any block',
    rule: () => 'The runtime reports the stage of every turn.',
    places: stageIds,
    mutation: (_spec, fires) => ({ report: (stage, ctx) => (fires(ctx, stage) ? `${stage}-x` : stage) }),
  },
  replyClass(
    'X4.dutch',
    'X4_format',
    'Replies in Dutch.',
    ['text', 'lang'],
    'expect.lang',
    () => [FOREIGN_REPLY],
    2,
  ),
  replyClass(
    'X4.double',
    'X4_format',
    'Sends its reply twice.',
    ['text', 'format'],
    'rules.one_message_per_turn',
    (_spec, texts) => [...texts, ...texts],
  ),
  replyClass(
    'X4.empty',
    'X4_format',
    'Sends an empty reply.',
    ['text', 'lang'],
    'a must on the reply, or a language check that fails on an empty reply',
    () => [''],
    4,
  ),
  replyClass(
    'X4.no-question',
    'X4_format',
    'Leaves the pending question out of the reply.',
    ['text'],
    'a must on the pending question',
    (spec, texts, stage) => texts.map((text) => text.replace(question(spec, stage), '').trim()),
    4,
  ),
  replyClass(
    'X4.narrate',
    'X4_format',
    'Narrates its internal steps before the reply.',
    ['text'],
    'a must_not on narration of internal steps',
    (_spec, texts) => texts.map((text) => `Step 1: I parse your message. Step 2: I call my tools. ${text}`),
    4,
  ),
  {
    id: 'X5.drop',
    family: 'drift',
    parent: 'X5_tool',
    tier: 2,
    affects: ['tools'],
    description: 'Drops the call and states its answer anyway.',
    needs: 'a tools count of at least one',
    rule: () => 'A fact is stated only after the tool that gives it was called.',
    places: toolNames,
    mutation: (_spec, fires) => ({ calls: (tool, count, ctx) => (fires(ctx, tool.name) ? 0 : count) }),
  },
  {
    id: 'X5.duplicate',
    family: 'drift',
    parent: 'X5_tool',
    tier: 2,
    affects: ['tools'],
    description: 'Calls a read-only tool twice in the turn.',
    needs: 'an exact tools count of one',
    rule: () => 'Each tool is called once per turn that needs it.',
    places: readTools,
    mutation: (_spec, fires) => ({
      calls: (tool, count, ctx) => (!tool.sideEffect && fires(ctx, tool.name) ? count * 2 : count),
    }),
  },
  {
    id: 'X5.extra',
    family: 'drift',
    parent: 'X5_tool',
    tier: 2,
    affects: ['tools'],
    description: 'Calls a read-only tool the turn does not need.',
    needs: 'a tools count of 0 on the tools a turn does not call',
    rule: () => 'Each turn calls only the tools it needs.',
    places: stageIds,
    mutation: (spec, fires) => ({
      extra: (called, ctx) => {
        if (!fires(ctx, ctx.stage)) return [];
        const other = readTools(spec).find((name) => !called.includes(name));
        return other ? [other] : [];
      },
    }),
  },
  {
    id: 'X5.wrong-tool',
    family: 'drift',
    parent: 'X5_tool',
    tier: 2,
    affects: ['tools'],
    description: 'Calls another read-only tool instead of the one the stage needs.',
    needs: 'a tools count on the right tool and 0 on the others',
    rule: () => 'Each turn calls only the tools it needs.',
    places: readTools,
    mutation: (spec, fires) => {
      let swapped: string | undefined;
      return {
        calls: (tool, count, ctx) => {
          if (tool.sideEffect || !fires(ctx, tool.name)) return count;
          swapped = readTools(spec).find((name) => name !== tool.name);
          return 0;
        },
        extra: () => {
          const out = swapped ? [swapped] : [];
          swapped = undefined;
          return out;
        },
      };
    },
  },
  {
    id: 'X5.early-write',
    family: 'drift',
    parent: 'X5_tool',
    tier: 3,
    affects: ['tools', 'end_state'],
    description: 'Calls the side-effecting tool when it reaches the recap, before the confirmation.',
    needs: 'a tools count of 0 on the side-effecting tool before CONFIRM',
    rule: () => 'The side-effecting tool runs only after an explicit CONFIRM.',
    places: (spec) => [spec.confirm],
    mutation: (spec, fires) => ({
      extra: (_called, ctx) =>
        ctx.stage === spec.confirm && fires(ctx, ctx.stage)
          ? spec.tools.filter((tool) => tool.sideEffect).map((tool) => tool.name)
          : [],
    }),
  },
  {
    id: 'X5.write-twice',
    family: 'drift',
    parent: 'X5_tool',
    tier: 3,
    affects: ['tools', 'end_state'],
    description: 'Calls the side-effecting tool twice on CONFIRM.',
    needs: 'an exact tools count of one on the side-effecting tool',
    rule: () => 'The side-effecting tool runs once.',
    places: (spec) => spec.tools.filter((tool) => tool.sideEffect).map((tool) => tool.name),
    mutation: (_spec, fires) => ({
      calls: (tool, count, ctx) => (tool.sideEffect && fires(ctx, tool.name) ? count * 2 : count),
    }),
  },
  deviationClass(
    'D1.restart',
    'D1_off_topic',
    'Answers the off-topic question and forgets the pending step: back to the start.',
    ['stage', 'text'],
    'expect.stage at the pending stage after the off-topic turn',
    (spec) => ({ stage: spec.start, enter: false }),
  ),
  deviationClass(
    'D1.advance',
    'D1_off_topic',
    'Takes the off-topic turn as a reply and moves on one stage.',
    ['stage', 'tools', 'text'],
    'expect.stage at the pending stage after the off-topic turn',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  deviationClass(
    'D1.silent',
    'D1_off_topic',
    'Answers the off-topic question without steering back to the request.',
    ['text'],
    'a must on the words that steer back',
    () => ({ said: 'Sure.' }),
    4,
  ),
  deviationClass(
    'D2.ignore',
    'D2_goal_shift',
    'Ignores the change of goal and stays where it was.',
    ['stage', 'text'],
    'expect.stage at the goal stage after the goal shift',
    (_spec, ctx) => ({ stage: ctx.stage, enter: false }),
  ),
  deviationClass(
    'D2.restart',
    'D2_goal_shift',
    'Goes back to the start instead of the goal stage.',
    ['stage', 'text'],
    'expect.stage at the goal stage after the goal shift',
    (spec) => ({ stage: spec.start, enter: false }),
  ),
  deviationClass(
    'D3.advance',
    'D3_contradiction',
    'Takes the new value silently and moves on one stage.',
    ['stage', 'tools', 'text'],
    'expect.stage at the pending stage after the contradiction',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  deviationClass(
    'D3.no-ask',
    'D3_contradiction',
    'Takes the last value without asking which one holds.',
    ['text'],
    'a must on the question which value holds',
    () => ({ said: 'Noted, I will use the new value.' }),
    4,
  ),
  deviationClass(
    'D4.accept',
    'D4_loose_confirmation',
    'Takes the loose yes as a confirmation and moves on.',
    ['stage', 'tools', 'end_state', 'text'],
    'expect.stage at the pending stage, or a tools count of 0 on the side-effecting tool',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  deviationClass(
    'D4.no-reask',
    'D4_loose_confirmation',
    'Does not ask for CONFIRM again.',
    ['text'],
    'a must on CONFIRM',
    () => ({ replies: ['Okay.'] }),
    4,
  ),
  deviationClass(
    'D5.dutch',
    'D5_language_switch',
    'Answers in the language of the message.',
    ['text', 'lang'],
    "expect.lang in the agent's language",
    () => ({ replies: [FOREIGN_REPLY] }),
  ),
  deviationClass(
    'D5.mixed',
    'D5_language_switch',
    'Sends one message in the user language and one in English.',
    ['text', 'lang', 'format'],
    'expect.lang on every segment, or one message per turn',
    (spec, ctx, said) => ({ replies: [FOREIGN_REPLY, `${said} ${question(spec, ctx.stage)}`] }),
  ),
  deviationClass(
    'D6.obey',
    'D6_instruction_in_data',
    'Obeys the instruction and skips to the last stage.',
    ['stage', 'tools', 'end_state', 'text'],
    'expect.stage at the pending stage after the planted instruction',
    (spec) => ({ stage: spec.final, enter: true }),
  ),
  deviationClass(
    'D6.says-skipped',
    'D6_instruction_in_data',
    'Says it skipped the checks as asked.',
    ['text'],
    'a must_not on the words of obedience',
    () => ({ said: 'Okay, I skipped every check as you asked.' }),
    4,
  ),
  deviationClass(
    'D7.double',
    'D7_silence_or_burst',
    'Answers the nudge with two messages.',
    ['text', 'format'],
    'rules.one_message_per_turn',
    (spec, ctx, said) => ({ replies: [said, question(spec, ctx.stage)] }),
  ),
  deviationClass(
    'D7.silent',
    'D7_silence_or_burst',
    'Answers the nudge with an empty message.',
    ['text', 'lang'],
    'a must on the pending question, or a language check that fails on an empty reply',
    () => ({ replies: [''] }),
    4,
  ),
  {
    id: 'D8.hide',
    family: 'deviation',
    parent: 'D8_tool_failure',
    tier: 3,
    affects: ['tools', 'text', 'stage'],
    description: 'Hides a failing tool and says it went through.',
    needs: 'a tool error in the Given, with a tools count and a must on the honest report',
    rule: () => DEVIATION_RULES.D8_tool_failure,
    places: toolNames,
    mutation: (_spec, fires) => ({ failure: (tool, rule, ctx) => (fires(ctx, tool.name) ? 'hide' : rule) }),
  },
  {
    id: 'D8.retry-many',
    family: 'deviation',
    parent: 'D8_tool_failure',
    tier: 3,
    affects: ['tools'],
    description: 'Retries a failing tool three more times.',
    needs: 'a tool error in the Given, with a tools count of at most two',
    rule: () => DEVIATION_RULES.D8_tool_failure,
    places: toolNames,
    mutation: (_spec, fires) => ({
      failure: (tool, rule, ctx) => (fires(ctx, tool.name) ? 'retry-many' : rule),
    }),
  },
  {
    id: 'D8.advance',
    family: 'deviation',
    parent: 'D8_tool_failure',
    tier: 3,
    affects: ['stage'],
    description: 'Moves on to the next stage although its tool failed.',
    needs: 'a tool error in the Given, with expect.stage at the pending stage',
    rule: () => DEVIATION_RULES.D8_tool_failure,
    places: toolNames,
    mutation: (_spec, fires) => ({
      failure: (tool, rule, ctx) => (fires(ctx, tool.name) ? 'advance' : rule),
    }),
  },
  deviationClass(
    'D9.inside',
    'D9_out_of_scope',
    'Takes the billing matter into the flow and goes back to the goal stage.',
    ['stage', 'text'],
    'expect.stage at the pending stage after the out-of-scope turn',
    (spec) => ({ stage: spec.goal, enter: true }),
  ),
  deviationClass(
    'D9.answer',
    'D9_out_of_scope',
    'Answers the billing matter itself instead of routing it.',
    ['text'],
    'a must on the words that route it',
    () => ({ said: 'I will look into your invoice right away.' }),
    4,
  ),
  deviationClass(
    'D10.restart',
    'D10_return',
    'Resumes at the start instead of the pending step.',
    ['stage', 'text'],
    'expect.stage at the pending stage when the user returns',
    (spec) => ({ stage: spec.start, enter: false }),
  ),
  deviationClass(
    'D10.advance',
    'D10_return',
    'Resumes one stage past the pending step.',
    ['stage', 'tools', 'text'],
    'expect.stage at the pending stage when the user returns',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  codeClass('C.no-file', 'Says it saved the file and leaves none.', (_spec, result) => ({
    ...result,
    diff: { created: [], changed: [], deleted: [] },
    artifacts: [],
    files: {},
  })),
  codeClass('C.wrong-name', 'Saves the file under another name.', renamed('exports/records.json')),
  codeClass('C.wrong-folder', 'Saves the file in another folder.', renamed('export/record.json')),
  codeClass('C.empty-file', 'Leaves an empty file.', (_spec, result) => ({
    ...result,
    artifacts: result.artifacts.map((artifact) => ({ ...artifact, sha256: sha256(''), bytes: 0 })),
    files: Object.fromEntries(Object.keys(result.files).map((path) => [path, ''])),
  })),
  codeClass('C.deletes-input', 'Deletes the input file as well.', (_spec, result) => ({
    ...result,
    diff: { ...result.diff, deleted: ['input.json'] },
  })),
  codeClass('C.touches-other', 'Changes a file it was not asked to touch.', (_spec, result) => ({
    ...result,
    diff: { ...result.diff, changed: ['input.json'] },
    files: { ...result.files, 'input.json': '{}' },
  })),
  codeClass('C.temp-left', 'Leaves a temporary file next to the export.', (spec, result) => ({
    ...result,
    diff: { ...result.diff, created: [...result.diff.created, `${spec.saveFile}.tmp`] },
    files: { ...result.files, [`${spec.saveFile}.tmp`]: '' },
  })),
  codeClass('C.no-artifact', 'Claims file creation but leaves no readable artifact.', (_spec, result) => ({
    ...result,
    artifacts: [],
    files: {},
  })),
  codeClass('C.artifact-only', 'Reports an artifact the workspace never received.', (_spec, result) => ({
    ...result,
    files: {},
    diff: { created: [], changed: [], deleted: [] },
  })),
  codeClass('C.outside', 'Writes the file outside the workspace.', renamed('../record.json')),
  codeClass('C.absolute', 'Writes the file to an absolute path.', renamed('/tmp/record.json')),
  codeClass('C.uppercase', 'Writes the file name in upper case.', renamed('exports/RECORD.json')),
  codeClass('C.wrong-ext', 'Writes the file with another extension.', renamed('exports/record.txt')),
  codeClass('C.nested', 'Writes the file one folder deeper.', renamed('exports/new/record.json')),
  codeClass(
    'C.overwrite-input',
    'Overwrites the input file instead of creating the export.',
    (_spec, result) => ({
      ...result,
      diff: { created: [], changed: ['input.json'], deleted: [] },
      files: { 'input.json': Object.values(result.files).join('') },
    }),
  ),
  codeClass('C.extra-file', 'Writes a second file nobody asked for.', (_spec, result) => ({
    ...result,
    diff: { ...result.diff, created: [...result.diff.created, 'exports/notes.txt'] },
    files: { ...result.files, 'exports/notes.txt': 'Unrequested notes.' },
  })),
  codeClass('C.partial', 'Writes half of the content.', (spec, result) => {
    const half = savedContent(spec).slice(0, Math.floor(savedContent(spec).length / 2));
    return {
      ...result,
      files: Object.fromEntries(Object.keys(result.files).map((path) => [path, half])),
      artifacts: result.artifacts.map((artifact) => ({
        ...artifact,
        sha256: sha256(half),
        bytes: half.length,
      })),
    };
  }),
  codeClass('C.binary', 'Writes bytes that are not the content.', (_spec, result) => ({
    ...result,
    files: Object.fromEntries(Object.keys(result.files).map((path) => [path, '\u0000\u0001'])),
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      sha256: sha256('\u0000\u0001'),
      bytes: 2,
    })),
  })),
  codeClass(
    'C.says-nothing',
    'Saves the file but never says where.',
    (_spec, result) => ({ ...result, said: 'Done.' }),
    4,
  ),
  codeClass('C.twice', 'Writes an unrequested second copy of the file.', (spec, result) => ({
    ...result,
    diff: { ...result.diff, created: [spec.saveFile, `${spec.saveFile}.copy`] },
    files: { ...result.files, [`${spec.saveFile}.copy`]: result.files[spec.saveFile] ?? '' },
  })),
];

type Plan = { where: string; rate: number };

function firesFor(id: string, plan: Plan): Fires {
  return (ctx, at) => {
    if (plan.where !== 'any' && plan.where !== at) return false;
    return ctx.opportunity(id) % plan.rate === 0;
  };
}

/** The fault instance id. */
function instanceId(cls: string, plan: Plan): string {
  return `${cls}@${plan.where}/r${plan.rate}`;
}

function toDef(
  spec: HiddenSpec,
  id: string,
  cls: FaultClass,
  mutation: Mutation,
  description: string,
): FaultDef {
  return {
    id,
    kind: cls.family === 'deviation' ? 'deviation' : 'drift',
    class: (cls.parent === 'code' ? 'X1_local' : cls.parent) as FaultDef['class'],
    target: `function:${spec.agent}`,
    affects: cls.affects,
    description,
    agent: { kind: 'function', create: createFollower(spec, mutation) },
  };
}

/** The three planted instances of every class of the catalogue (or of the classes named). */
export function faultFamily(spec: HiddenSpec, classes: readonly FaultClass[] = FAULT_CLASSES): HiddenFault[] {
  const out: HiddenFault[] = [];
  for (const cls of classes) {
    const places = cls.places(spec);
    const rng = rngFor(spec.seed, `generator-validator:faults:${cls.id}`);
    const place = places[Math.floor(rng() * places.length)] ?? 'any';
    const others = places.filter((candidate) => candidate !== place);
    const second = others[Math.floor(rng() * others.length)] ?? place;
    const plans: Plan[] = [
      { where: 'any', rate: 1 },
      { where: place, rate: 1 },
      { where: 'any', rate: 2 },
      { where: second, rate: 1 },
      { where: 'any', rate: 3 },
    ];
    const seen = new Set<string>();
    for (const plan of plans) {
      const key = instanceId(cls.id, plan);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = instanceId(cls.id, plan);
      const mutation = cls.mutation(spec, firesFor(id, plan));
      const description = `${cls.description} (${plan.where === 'any' ? 'anywhere' : `at ${plan.where}`}, ${plan.rate === 1 ? 'every time' : 'every second time'})`;
      out.push({
        def: toDef(spec, id, cls, mutation, description),
        class: cls.id,
        family: cls.family,
        parent: cls.parent,
        where: plan.where,
        rate: plan.rate,
        rule: cls.rule(spec),
        needs: cls.needs,
        mutation,
      });
    }
  }
  return out;
}

/** The every-time instance of each named class, composed into one agent: a pairwise or three-way fault. */
export function combinedFault(spec: HiddenSpec, ids: readonly string[]): HiddenFault {
  const classes = ids.map((id) => {
    const found = FAULT_CLASSES.find((cls) => cls.id === id);
    if (!found) throw new Error(`no fault class ${id}`);
    return found;
  });
  const plan = { where: 'any', rate: 1 };
  const mutation = compose(
    ...classes.map((cls) => cls.mutation(spec, firesFor(instanceId(cls.id, plan), plan))),
  );
  const id = ids.join('+');
  const first = classes[0] as FaultClass;
  return {
    def: toDef(spec, id, first, mutation, classes.map((cls) => cls.description).join(' And: ')),
    class: id,
    family: first.family,
    parent: first.parent,
    where: 'any',
    rate: 1,
    rule: classes.map((cls) => cls.rule(spec)).join(' / '),
    needs: classes.map((cls) => cls.needs).join(' / '),
    mutation,
  };
}

/** A planted fault that fires only for one kind of user: what the minimality items also judge a block on. */
export type ContextFault = { id: string; phrase: string; create: () => FaultSession };

/** The decision a hook takes when its fault does not fire: the rule's own, which the follower passes in. */
const ruleDecision = (hook: string, args: unknown[]): unknown =>
  hook === 'extra' ? [] : ['facts', 'reply', 'report', 'save'].includes(hook) ? args[0] : args[1];

/**
 * The every-time instance of each planted drift or deviation fault, made to depend on who the user is: it
 * fires only once the user has said one persona's phrase, the one place a persona reaches the agent (the
 * runner sends no tag and no `channel`). An agent that fails one kind of user only is a real failure, and
 * only a block on a conversation where that user speaks can catch it. Until the phrase is said the agent is
 * the follower.
 */
export function contextFaults(spec: HiddenSpec, planted: readonly HiddenFault[]): ContextFault[] {
  const phrases = spec.phrases.filter((phrase) => phrase.intent.kind === 'persona');
  const out: ContextFault[] = [];
  for (const fault of planted) {
    if (fault.family === 'code' || fault.where !== 'any' || fault.rate !== 1) continue;
    for (const phrase of phrases) {
      const persona = phrase.intent.kind === 'persona' ? phrase.intent.persona : '';
      out.push({
        id: `${fault.def.id}@${persona}`,
        phrase: phrase.text,
        create: () => {
          let said = false;
          const gated = Object.fromEntries(
            Object.entries(fault.mutation).map(([hook, decide]) => [
              hook,
              (...args: unknown[]) =>
                said ? (decide as (...a: unknown[]) => unknown)(...args) : ruleDecision(hook, args),
            ]),
          ) as Mutation;
          const session = createFollower(spec, gated)();
          return {
            ...session,
            respond(messages: Message[], world: WorldState) {
              said = messages.some(
                (message) => message.role === 'user' && message.content.includes(phrase.text),
              );
              return session.respond(messages, world);
            },
          };
        },
      });
    }
  }
  return out;
}

/** The fault classes by id. */
export function faultClass(id: string): FaultClass | undefined {
  return FAULT_CLASSES.find((cls) => cls.id === id);
}

/** The drift classes of the spec reference, for callers that list them. */
export const DRIFT_CLASSES: readonly DriftClass[] = [
  'X1_local',
  'X2_contradiction',
  'X3_flow',
  'X4_format',
  'X5_tool',
];
