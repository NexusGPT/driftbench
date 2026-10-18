import type { Draw } from '../../spec';
import { BANK_COMPONENTS, drawFor, inventoryCode, inventorySource, type MiniInventory } from '../common';
import type { Planted, PlantedValue } from '../perfect';
import { mapItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';

/**
 * Family relations: the links between values a prompt states and a map must hold as relations: the stage
 * order of a flow (path), the tool a flow calls at a stage (uses_tool), the concrete values a data case
 * stands for (binds), how a flow recovers from a deviation (recovery), the language of every reply
 * (reply_language). Each item writes one relation sentence into a small prompt that also states the values
 * it names, and the oracle is the whole map of that prompt.
 */

const STAGES = ['greet', 'identify', 'collect', 'recap', 'close'];
const LOOKUP = ['record-found', 'record-missing', 'record-locked'];

type Ctx = { draw: Draw; stage: () => string; tool: () => string };
type Variant = {
  slug: string;
  tier: Tier;
  title: string;
  /** The sentence and the relation it states; a wrapper decides how the sentence is written. */
  make(ctx: Ctx): { sentence: string; relation: Record<string, unknown> & { kind: string } };
  /** How the sentence sits in the prompt. */
  wrap?: 'bullet' | 'table' | 'french' | 'question';
};

const flowIs = { dimension: 'flow', value: 'service' };

export const VARIANTS: readonly Variant[] = [
  {
    slug: 'path',
    tier: 1,
    title: 'the stage order of a flow',
    make: () => ({
      sentence: `The service flow passes ${STAGES.join(', then ')}.`,
      relation: { kind: 'path', id: 'service-main', flow: 'service', stages: STAGES },
    }),
  },
  {
    slug: 'path-when',
    tier: 2,
    title: 'a branch of a flow that holds when a lookup finds the record',
    make: () => ({
      sentence:
        'When the lookup finds the record, the service flow passes greet, identify, recap, then close.',
      relation: {
        kind: 'path',
        id: 'service-found',
        flow: 'service',
        when: { lookup_result: ['record-found'] },
        stages: ['greet', 'identify', 'recap', 'close'],
      },
    }),
  },
  {
    slug: 'path-behaviours',
    tier: 2,
    title: 'a path that names the behaviours it exercises',
    make: () => ({
      sentence: 'The service flow passes greet, identify, then close, and shows behaviours B-001 and B-002.',
      relation: {
        kind: 'path',
        id: 'service-short',
        flow: 'service',
        stages: ['greet', 'identify', 'close'],
        behaviours: ['B-001', 'B-002'],
      },
    }),
  },
  {
    slug: 'path-end-state',
    tier: 3,
    title: 'a path whose end state the order tool must hold',
    make: () => ({
      sentence:
        'The refund flow passes greet, collect, then close, and ends with a refund request whose status is pending.',
      relation: {
        kind: 'path',
        id: 'refund-main',
        flow: 'refund',
        stages: ['greet', 'collect', 'close'],
        end_state: { source: 'tool:refund.request', mode: 'subset', expect: { status: 'pending' } },
      },
    }),
  },
  {
    slug: 'uses-tool',
    tier: 1,
    title: 'a tool the flow calls at a stage',
    make: ({ stage, tool }) => {
      const s = stage();
      const t = tool();
      return {
        sentence: `At the ${s} stage, the service flow calls ${t}.`,
        relation: { kind: 'uses_tool', subject: flowIs, tool: t, stage: s },
      };
    },
  },
  {
    slug: 'uses-tool-to',
    tier: 2,
    title: 'a tool called only on the turn that reaches a stage',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `The service flow calls ${t} on the turn that moves from collect to recap.`,
        relation: { kind: 'uses_tool', subject: flowIs, tool: t, stage: 'collect', to: 'recap' },
      };
    },
  },
  {
    slug: 'uses-tool-when',
    tier: 3,
    title: 'a tool called only when a lookup misses',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `When the lookup finds no record, the service flow calls ${t} at the identify stage.`,
        relation: {
          kind: 'uses_tool',
          subject: flowIs,
          tool: t,
          stage: 'identify',
          when: { lookup_result: ['record-missing'] },
        },
      };
    },
  },
  {
    slug: 'uses-tool-count',
    tier: 2,
    title: 'a tool called twice in one turn',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `At the recap stage, the service flow calls ${t} exactly twice.`,
        relation: { kind: 'uses_tool', subject: flowIs, tool: t, stage: 'recap', count: 2 },
      };
    },
  },
  {
    slug: 'uses-tool-never',
    tier: 3,
    title: 'a tool the flow must not call at a stage',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `At the greet stage, the service flow never calls ${t}.`,
        relation: { kind: 'uses_tool', subject: flowIs, tool: t, stage: 'greet', count: 0 },
      };
    },
  },
  {
    slug: 'uses-tool-input-slot',
    tier: 3,
    title: 'a tool argument fed by the value a data case binds',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `At the identify stage, the service flow calls ${t} with the reference the customer gave.`,
        relation: {
          kind: 'uses_tool',
          subject: flowIs,
          tool: t,
          stage: 'identify',
          input: { reference: '{reference}' },
        },
      };
    },
  },
  {
    slug: 'uses-tool-input-regex',
    tier: 3,
    title: 'a tool argument that must match a pattern',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `At the collect stage, the service flow calls ${t} with a reference of two capital letters and four digits.`,
        relation: {
          kind: 'uses_tool',
          subject: flowIs,
          tool: t,
          stage: 'collect',
          input: { reference: { regex: '^[A-Z]{2}[0-9]{4}$' } },
        },
      };
    },
  },
  {
    slug: 'uses-tool-behaviour',
    tier: 2,
    title: 'a tool a behaviour calls',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `Behaviour B-002 calls ${t} at the recap stage.`,
        relation: {
          kind: 'uses_tool',
          subject: { dimension: 'behaviour', value: 'B-002' },
          tool: t,
          stage: 'recap',
        },
      };
    },
  },
  {
    slug: 'binds-data',
    tier: 2,
    title: 'the concrete values a data case stands for',
    make: ({ draw }) => {
      const ref = `${draw.pick(['AB', 'CD', 'EF'])}${draw.int(1000, 9999)}`;
      return {
        sentence: `A found record has the reference ${ref}.`,
        relation: {
          kind: 'binds',
          subject: { dimension: 'lookup_result', value: 'record-found' },
          slots: { reference: ref },
        },
      };
    },
  },
  {
    slug: 'binds-two-slots',
    tier: 3,
    title: 'a data case that binds two slots',
    make: () => ({
      sentence: 'A locked record has the reference LK0001 and the email locked.user@example.com.',
      relation: {
        kind: 'binds',
        subject: { dimension: 'lookup_result', value: 'record-locked' },
        slots: { reference: 'LK0001', email: 'locked.user@example.com' },
      },
    }),
  },
  {
    slug: 'recovery-at',
    tier: 3,
    title: 'a recovery from an off-topic question at one stage',
    make: () => ({
      sentence:
        'If the customer goes off topic at the collect stage of the service flow, answer briefly and return to the pending step.',
      relation: {
        kind: 'recovery',
        class: 'D1_off_topic',
        flows: ['service'],
        at: ['collect'],
        stage_after: 'pending',
      },
    }),
  },
  {
    slug: 'recovery-tool-failure',
    tier: 3,
    title: 'a recovery from a tool failure that ends on close and offers a callback',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `If ${t} fails in the service flow, say so, offer a callback and close.`,
        relation: {
          kind: 'recovery',
          class: 'D8_tool_failure',
          flows: ['service'],
          tool: t,
          stage_after: 'close',
          must: ['callback'],
        },
      };
    },
  },
  {
    slug: 'recovery-goal-shift',
    tier: 3,
    title: 'a recovery from a goal shift that restarts at identify',
    make: () => ({
      sentence: 'If the customer changes the goal in the service flow, start again at the identify stage.',
      relation: { kind: 'recovery', class: 'D2_goal_shift', flows: ['service'], stage_after: 'identify' },
    }),
  },
  {
    slug: 'recovery-must-not',
    tier: 4,
    title: 'a recovery whose reply must never promise a refund',
    make: () => ({
      sentence: 'If the customer goes off topic in the refund flow, never promise a refund in the reply.',
      relation: {
        kind: 'recovery',
        class: 'D1_off_topic',
        flows: ['refund'],
        must_not: ['promise a refund'],
      },
    }),
  },
  {
    slug: 'recovery-guard',
    tier: 4,
    title: 'a recovery that a runtime check must deny',
    make: () => ({
      sentence: 'If a note carries an instruction in the service flow, the injection check denies it.',
      relation: {
        kind: 'recovery',
        class: 'D6_instruction_in_data',
        flows: ['service'],
        guards: [{ name: 'injection', verdict: 'deny' }],
      },
    }),
  },
  {
    slug: 'recovery-no-call',
    tier: 4,
    title: 'a recovery turn that must not call a tool',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `If the customer goes off topic in the service flow, do not call ${t} on that turn.`,
        relation: {
          kind: 'recovery',
          class: 'D1_off_topic',
          flows: ['service'],
          tools: [{ tool: t, count: 0 }],
        },
      };
    },
  },
  {
    slug: 'reply-language',
    tier: 2,
    title: 'the language of every reply',
    make: () => ({
      sentence: 'Always answer in French.',
      relation: { kind: 'reply_language', subject: { dimension: 'rule', value: 'R-01' }, lang: 'fr' },
    }),
  },
  {
    slug: 'path-in-table',
    tier: 3,
    title: 'a path stated in a table row',
    wrap: 'table',
    make: () => ({
      sentence: `The service flow passes ${STAGES.join(', then ')}.`,
      relation: { kind: 'path', id: 'service-main', flow: 'service', stages: STAGES },
    }),
  },
  {
    slug: 'uses-tool-french',
    tier: 3,
    title: 'a tool call stated in French',
    wrap: 'french',
    make: ({ tool }) => {
      const t = tool();
      return {
        sentence: `À l'étape recap, le parcours service appelle ${t}.`,
        relation: { kind: 'uses_tool', subject: flowIs, tool: t, stage: 'recap' },
      };
    },
  },
  {
    slug: 'recovery-question',
    tier: 4,
    title: 'a recovery stated as a question and its answer',
    wrap: 'question',
    make: () => ({
      sentence:
        'What happens if the customer changes the goal in the refund flow? Start again at the identify stage.',
      relation: { kind: 'recovery', class: 'D2_goal_shift', flows: ['refund'], stage_after: 'identify' },
    }),
  },
];

const INVENTORY: MiniInventory = {
  channels: ['chat', 'email'],
  behaviours: [
    { id: 'B-001', title: 'Greet the customer by the name on the account' },
    { id: 'B-002', title: 'Repeat the request back before acting on it' },
    { id: 'B-003', title: 'Report a failed lookup honestly and offer a callback' },
  ],
  flows: [
    {
      id: 'service',
      title: 'A customer asks for help with a plan',
      behaviours: ['B-001', 'B-002'],
      deviations: ['D1_off_topic', 'D2_goal_shift', 'D6_instruction_in_data', 'D8_tool_failure'],
    },
    {
      id: 'refund',
      title: 'A customer asks for money back',
      behaviours: ['B-002', 'B-003'],
      deviations: ['D1_off_topic', 'D2_goal_shift'],
    },
  ],
};

export function relationItems(): BankItem[] {
  return VARIANTS.map((variant) =>
    mapItem({
      id: `relations.${variant.slug}`,
      family: 'relations',
      tier: variant.tier,
      level: levelOf('relations'),
      component: BANK_COMPONENTS.accept,
      title: variant.title,
      cause: `accept:relation-${variant.slug}`,
      build: (seed) => {
        const draw = drawFor(seed, `relations.${variant.slug}`);
        const ctx: Ctx = {
          draw,
          stage: () => draw.pick(STAGES.slice(1, -1)),
          tool: () => draw.pick(['account.find', 'order.place', 'refund.request']),
        };
        const made = variant.make(ctx);
        const stageLines = STAGES.map((stage) => `${stage}: the ${stage} stage of the desk.`);
        const lookupLines = LOOKUP.map(
          (value) => `${value}: the lookup returns ${value.replace('record-', '')}.`,
        );
        const rule = 'Always answer in French.';
        const line =
          variant.wrap === 'table'
            ? `| Flow | Order |\n|---|---|\n| service | ${made.sentence} |`
            : variant.wrap === 'question'
              ? `Q: ${made.sentence.replace('? ', '?\nA: ')}`
              : `- ${made.sentence}`;
        const prompt = [
          '# Assistant guide',
          '',
          '## Stages',
          '',
          ...stageLines.map((text) => `- ${text}`),
          '',
          '## Lookup results',
          '',
          ...lookupLines.map((text) => `- ${text}`),
          '',
          '## Rules',
          '',
          `- ${rule}`,
          '',
          '## How the flows run',
          '',
          line,
          '',
        ].join('\n');
        const anchor = variant.wrap === 'question' ? (made.sentence.split('? ')[0] as string) : made.sentence;
        const quote =
          variant.wrap === 'question' ? `${made.sentence.replace('? ', '?\nA: ')}` : made.sentence;
        const values: PlantedValue[] = [
          ...STAGES.map((stage, index) => ({
            type: 'value' as const,
            section: 'stages' as const,
            source: 'prompt.md',
            quote: stageLines[index] as string,
            anchor: stageLines[index] as string,
            dimension: { id: 'stage', title: 'The stage', kind: 'stage' },
            value: { id: stage, title: stage },
          })),
          ...LOOKUP.map((value, index) => ({
            type: 'value' as const,
            section: 'data' as const,
            source: 'prompt.md',
            quote: lookupLines[index] as string,
            anchor: lookupLines[index] as string,
            dimension: { id: 'lookup_result', title: 'What a lookup returns', kind: 'data' },
            value: { id: value, title: value },
          })),
          {
            type: 'value',
            section: 'rules',
            source: 'prompt.md',
            quote: rule,
            anchor: rule,
            dimension: { id: 'rule', title: 'The rules', kind: 'behaviour' },
            value: { id: 'R-01', title: rule },
          },
        ];
        const planted: Planted[] = [
          ...values,
          {
            type: 'relation',
            section: 'relations',
            source: 'prompt.md',
            quote,
            anchor,
            relation: made.relation,
          },
        ];
        return {
          case: {
            label: variant.slug,
            sources: [inventorySource(INVENTORY), { kind: 'prompt', path: 'prompt.md', text: prompt }],
            planted,
          },
          code: inventoryCode(INVENTORY),
          parts: { values: true, produced: true, constraints: true, relations: true },
        };
      },
    }),
  );
}
