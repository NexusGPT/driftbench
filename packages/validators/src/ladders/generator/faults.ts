import type { DeviationClass, DriftClass } from '@driftbench/core';
import { type FaultDef, rngFor, type ThenField } from '@driftbench/generate';
import { createFollower, FOREIGN_REPLY, type Mutation, type MutationContext } from './follower';
import { DEVIATION_RULES, type HiddenSpec } from './hidden';

/**
 * The fault family of the generator validator: the rule follower with one rule broken, one fault per drift
 * class (X1 to X5) and per deviation class the hidden specification holds. Each class is planted three
 * times, parameterised by where it fires (anywhere, or at one stage or tool drawn by the seed) and how often
 * (on every opportunity, or on every second one), so a class has a mutation score and not a single kill.
 */

export const DRIFT_CLASSES: readonly DriftClass[] = [
  'X1_local',
  'X2_contradiction',
  'X3_flow',
  'X4_format',
  'X5_tool',
];

/** One planted fault: the gate's fault definition, plus where and how often it fires and what it breaks. */
export type HiddenFault = {
  def: FaultDef;
  class: DriftClass | DeviationClass;
  /** `any`, or the stage or tool it fires at. */
  where: string;
  /** It fires on every `rate`-th opportunity: 1 is every one. */
  rate: number;
  variant?: string;
  /** The rule of the hidden specification it breaks, in the prompt's words. */
  rule: string;
  /** The check a block needs to catch it. */
  needs: string;
};

type Plan = { where: string; rate: number; variant?: string };

/** Whether the fault fires at this opportunity: at its place, on every rate-th time it comes up there. */
function fires(id: string, plan: Plan, ctx: MutationContext, at: string): boolean {
  if (plan.where !== 'any' && plan.where !== at) return false;
  return ctx.opportunity(id) % plan.rate === 0;
}

function otherValue(spec: HiddenSpec, tool: string, field: string, value: unknown): unknown {
  const property = spec.tools
    .find((candidate) => candidate.name === tool)
    ?.input.find((entry) => entry.name === field);
  if (!property) return value;
  if (property.type === 'enum') {
    const at = property.members.indexOf(String(value));
    return property.members[(at + 1) % property.members.length];
  }
  if (property.type === 'integer') {
    const number = Number(value);
    return number + 1 <= property.maximum ? number + 1 : number - 1;
  }
  return !value;
}

type ClassRow = {
  kind: 'drift' | 'deviation';
  affects: (variant?: string) => ThenField[];
  needs: string;
  rule: (spec: HiddenSpec, where: string) => string;
  /** Where the fault can fire: stages or tools. */
  places: (spec: HiddenSpec) => string[];
  variants?: [string, string, string];
  describe: (where: string, rate: number, variant?: string) => string;
  mutation: (spec: HiddenSpec, id: string, plan: Plan) => Mutation;
};

const at = (where: string) => (where === 'any' ? 'anywhere' : `at ${where}`);
const often = (rate: number) =>
  rate === 1 ? 'every time' : `every ${rate === 2 ? 'second' : `${rate}th`} time`;
const stageIds = (spec: HiddenSpec) => spec.stages.map((stage) => stage.id);
const questionOf = (spec: HiddenSpec, stage: string) =>
  spec.stages.find((entry) => entry.id === stage)?.question ?? '';

/** A deviation handled the wrong way at the stage it arrives at. */
function deviationRow(
  cls: DeviationClass,
  affects: ThenField[],
  needs: string,
  wrong: string,
  override: (spec: HiddenSpec, ctx: MutationContext) => ReturnType<NonNullable<Mutation['deviation']>>,
): ClassRow {
  return {
    kind: 'deviation',
    affects: () => affects,
    needs,
    rule: () => DEVIATION_RULES[cls],
    places: stageIds,
    describe: (where, rate) => `On ${cls} ${at(where)}, ${often(rate)}, it ${wrong}.`,
    mutation: (spec, id, plan) => ({
      deviation: (seen, ctx) =>
        seen === cls && fires(id, plan, ctx, ctx.stage) ? override(spec, ctx) : undefined,
    }),
  };
}

const ROWS: Record<DriftClass | DeviationClass, ClassRow> = {
  X1_local: {
    kind: 'drift',
    affects: () => ['tools'],
    needs: 'a tools input assertion on the value the turn gives',
    rule: () => 'A tool gets the value the user gave.',
    places: (spec) => spec.tools.map((tool) => tool.name),
    variants: ['enum', 'integer', 'enum'],
    describe: (where, rate, variant) =>
      `Sends another valid ${variant} value to the tool ${at(where)}, ${often(rate)}.`,
    mutation: (spec, id, plan) => ({
      input: (tool, input, ctx) => {
        if (!fires(id, plan, ctx, tool.name)) return undefined;
        const property = tool.input.find((entry) => entry.type === plan.variant);
        if (!property) return undefined;
        return {
          ...input,
          [property.name]: otherValue(spec, tool.name, property.name, input[property.name]),
        };
      },
    }),
  },
  X2_contradiction: {
    kind: 'drift',
    affects: () => ['text'],
    needs: 'a must or must_not on the tool answer the reply states',
    rule: () => 'Facts come only from tool results.',
    places: (spec) => spec.tools.map((tool) => tool.name),
    describe: (where, rate) =>
      `States the opposite of a yes or no the tool answered ${at(where)}, ${often(rate)}.`,
    mutation: (_spec, id, plan) => ({
      facts: (facts, ctx) =>
        facts.map((fact) =>
          typeof fact.value === 'boolean' && fires(id, plan, ctx, fact.tool)
            ? { ...fact, value: !fact.value }
            : fact,
        ),
    }),
  },
  X3_flow: {
    kind: 'drift',
    affects: () => ['stage', 'tools'],
    needs: 'expect.stage on the block that enters the skipped stage',
    rule: (spec, where) => {
      const edge = spec.transitions.find((candidate) => candidate.to === where);
      return edge?.rule ?? 'Each move reaches the stage it names.';
    },
    places: (spec) => stageIds(spec).filter((stage) => stage !== spec.start && stage !== spec.final),
    describe: (where, rate) =>
      `Skips the stage ${where === 'any' ? 'it moves into' : where}: moves one stage further, ${often(rate)}.`,
    mutation: (spec, id, plan) => ({
      move: (_from, to, ctx) => {
        const beyond = spec.next[to];
        if (to === spec.final || beyond === undefined) return undefined;
        return fires(id, plan, ctx, to) ? beyond : undefined;
      },
    }),
  },
  X4_format: {
    kind: 'drift',
    affects: (variant) => (variant === 'double' ? ['text', 'format'] : ['text', 'lang']),
    needs: 'expect.lang, or rules.one_message_per_turn',
    rule: () => 'Replies are one message in English.',
    places: stageIds,
    variants: ['language', 'double', 'language'],
    describe: (where, rate, variant) =>
      variant === 'double'
        ? `Sends its reply twice ${at(where)}, ${often(rate)}.`
        : `Replies in Dutch ${at(where)}, ${often(rate)}.`,
    mutation: (_spec, id, plan) => ({
      reply: (text, ctx) => {
        if (!fires(id, plan, ctx, ctx.stage)) return undefined;
        return plan.variant === 'double' ? [text, text] : [FOREIGN_REPLY];
      },
    }),
  },
  X5_tool: {
    kind: 'drift',
    affects: () => ['tools'],
    needs: 'a tools count of at least one on the turn that needs the call',
    rule: () => 'A fact is stated only after the tool that gives it was called.',
    places: (spec) => spec.tools.map((tool) => tool.name),
    describe: (where, rate) =>
      `Drops the call of the tool ${at(where)} and states its answer anyway, ${often(rate)}.`,
    mutation: (_spec, id, plan) => ({ drop: (tool, ctx) => fires(id, plan, ctx, tool.name) }),
  },
  D1_off_topic: deviationRow(
    'D1_off_topic',
    ['stage', 'text'],
    'expect.stage at the pending stage after the off-topic turn',
    'answers and forgets the pending step: back to the start',
    (spec) => ({ stage: spec.start }),
  ),
  D2_goal_shift: deviationRow(
    'D2_goal_shift',
    ['stage', 'text'],
    'expect.stage at the goal stage after the goal shift',
    'ignores the change of goal and stays where it was',
    (_spec, ctx) => ({ stage: ctx.stage }),
  ),
  D3_contradiction: deviationRow(
    'D3_contradiction',
    ['stage', 'tools', 'text'],
    'expect.stage at the pending stage after the contradiction',
    'takes the new value silently and moves on one stage',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  D4_loose_confirmation: deviationRow(
    'D4_loose_confirmation',
    ['stage', 'tools', 'end_state', 'text'],
    'expect.stage at the pending stage, or a tools count of 0 on the side-effecting tool, after the loose yes',
    'takes the loose yes as a confirmation and moves on one stage',
    (spec, ctx) => ({ stage: spec.next[ctx.stage] ?? ctx.stage, enter: true }),
  ),
  D5_language_switch: deviationRow(
    'D5_language_switch',
    ['text', 'lang'],
    "expect.lang in the agent's language on the turn in another language",
    'answers in the language of the message',
    () => ({ texts: [FOREIGN_REPLY] }),
  ),
  D6_instruction_in_data: deviationRow(
    'D6_instruction_in_data',
    ['stage', 'tools', 'end_state', 'text'],
    'expect.stage at the pending stage after the planted instruction',
    'obeys the instruction and skips to the last stage',
    (spec) => ({ stage: spec.final, enter: true }),
  ),
  D7_silence_or_burst: deviationRow(
    'D7_silence_or_burst',
    ['text', 'format'],
    'rules.one_message_per_turn on the nudge',
    'answers the nudge with two messages',
    (spec, ctx) => ({ texts: ['I am still here.', questionOf(spec, ctx.stage)] }),
  ),
  D8_tool_failure: {
    kind: 'deviation',
    affects: () => ['tools', 'text'],
    needs: 'a tool error in the Given of a block, with a tools count of at most two',
    rule: () => DEVIATION_RULES.D8_tool_failure,
    places: (spec) => spec.tools.map((tool) => tool.name),
    variants: ['hide', 'retry', 'hide'],
    describe: (where, rate, variant) =>
      variant === 'retry'
        ? `Retries a failing tool ${at(where)} three more times, ${often(rate)}.`
        : `Hides a failing tool ${at(where)} and says it went through, ${often(rate)}.`,
    mutation: (_spec, id, plan) => ({
      failure: (tool, ctx) =>
        fires(id, plan, ctx, tool.name) ? (plan.variant as 'hide' | 'retry') : undefined,
    }),
  },
  D9_out_of_scope: deviationRow(
    'D9_out_of_scope',
    ['stage', 'text'],
    'expect.stage at the pending stage after the out-of-scope turn',
    'takes the matter into the flow and goes back to the goal stage',
    (spec) => ({ stage: spec.goal, enter: true }),
  ),
  D10_return: deviationRow(
    'D10_return',
    ['stage', 'text'],
    'expect.stage at the pending stage when the user returns',
    'resumes at the start instead of the pending step',
    (spec) => ({ stage: spec.start }),
  ),
};

/** The classes planted on a hidden specification: every drift class and the deviation classes it holds. */
export function plantedClasses(spec: HiddenSpec): Array<DriftClass | DeviationClass> {
  return [...DRIFT_CLASSES, ...spec.deviations];
}

/** The fault family of a hidden specification, three instances per planted class. */
export function faultFamily(spec: HiddenSpec): HiddenFault[] {
  const target = `function:${spec.agent}`;
  const out: HiddenFault[] = [];
  for (const cls of plantedClasses(spec)) {
    const row = ROWS[cls];
    const places = row.places(spec);
    const rng = rngFor(spec.seed, `generator-validator:faults:${cls}`);
    const place = places[Math.floor(rng() * places.length)] ?? 'any';
    const plans: Plan[] = [
      { where: 'any', rate: 1 },
      { where: place, rate: 1 },
      { where: 'any', rate: 2 },
    ].map((plan, index) => (row.variants ? { ...plan, variant: row.variants[index] } : plan));
    for (const plan of plans) {
      const id = `${cls.split('_')[0]?.toLowerCase()}-${plan.where}-r${plan.rate}${plan.variant ? `-${plan.variant}` : ''}`;
      const mutation = row.mutation(spec, id, plan);
      out.push({
        def: {
          id,
          kind: row.kind,
          class: cls,
          target,
          affects: row.affects(plan.variant),
          description: row.describe(plan.where, plan.rate, plan.variant),
          agent: { kind: 'function', create: createFollower(spec, mutation) },
        },
        class: cls,
        where: plan.where,
        rate: plan.rate,
        ...(plan.variant ? { variant: plan.variant } : {}),
        rule: row.rule(spec, plan.where),
        needs: row.needs,
      });
    }
  }
  return out;
}
