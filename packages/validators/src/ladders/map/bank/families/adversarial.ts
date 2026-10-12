import { stringify } from 'yaml';
import type { Draw } from '../../spec';
import {
  BANK_COMPONENTS,
  blockOf,
  drawFor,
  fieldId,
  inventoryCode,
  inventorySource,
  MEMBER_POOL,
  type MiniInventory,
  miniInventory,
  TOOL_POOL,
} from '../common';
import type { CodeEntry } from '../facts';
import type { PlantedValue } from '../perfect';
import { mapItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';

/**
 * Family adversarial: blind items, each aimed at one shortcut an extractor is likely to take. The oracles
 * follow the documented contract of the pre-passes (tool dimensions `<toolSlug>.<in|out>.<path>` with values
 * `<dimension>.<partition>`; inventory dimensions behaviour, flow, deviation, channel). Where the contract is
 * silent the item title states the convention the oracle uses.
 */

const PARTS = { values: true, produced: true, constraints: true, relations: true } as const;

type Schema = Record<string, unknown>;
type ToolEntry = { name: string; description?: string; input_schema?: Schema; output_schema?: Schema };
type Expect = { dimension: string; partitions: string[] };
type ToolCase = {
  slug: string;
  cause: string;
  tier: Tier;
  title: string;
  make(draw: Draw): { tools: ToolEntry[]; expected: Expect[] };
};

const BOOLEAN = ['true', 'false'];
const FORMAT = ['well-formed', 'malformed'];
const MIN = ['below-minimum', 'at-minimum', 'above-minimum'];
const ARRAY = ['empty', 'one-item', 'several-items'];

/** An object schema from properties and the names that are required. */
const object = (properties: Record<string, unknown>, required: string[]): Schema => ({
  type: 'object',
  required,
  properties,
});
const members = (draw: Draw) => [...draw.pick(MEMBER_POOL)];
/** The slug of an enum member by the documented rule: runs outside `[A-Za-z0-9_.-]` become `-`. */
const header = '# Tool schemas written by the map validator. Every name is fictional.\n';

/** One required input property named `name` with this schema, and its expected partitions. */
function inputOf(draw: Draw, name: string, schema: Schema, partitions: string[], optional = false) {
  const tool = draw.pick(TOOL_POOL);
  return {
    tools: [{ name: tool, input_schema: object({ [name]: schema }, optional ? [] : [name]) }] as ToolEntry[],
    expected: [{ dimension: `${tool}.in.${fieldId(name)}`, partitions }] as Array<{
      dimension: string;
      partitions: string[];
      quoteKey?: string;
    }>,
  };
}

const TOOL_CASES: readonly ToolCase[] = [
  {
    slug: 'property-named-type',
    cause: 'tools:property-named-like-a-keyword-type',
    tier: 1,
    title: 'a property named type is a property, not the keyword: its enum gives one value per member',
    make: (d) => {
      const list = members(d);
      return inputOf(d, 'type', { type: 'string', enum: list }, list);
    },
  },
  {
    slug: 'property-named-properties',
    cause: 'tools:property-named-like-a-keyword-properties',
    tier: 1,
    title: 'a property named properties is a property: its enum gives one value per member',
    make: (d) => {
      const list = members(d);
      return inputOf(d, 'properties', { type: 'string', enum: list }, list);
    },
  },
  {
    slug: 'property-named-required',
    cause: 'tools:property-named-like-a-keyword-required',
    tier: 1,
    title: 'a boolean property named required gives true and false',
    make: (d) => inputOf(d, 'required', { type: 'boolean' }, BOOLEAN),
  },
  {
    slug: 'property-named-enum',
    cause: 'tools:property-named-like-a-keyword-enum',
    tier: 2,
    title: 'an integer property named enum with a minimum gives below, at and above',
    make: (d) => inputOf(d, 'enum', { type: 'integer', minimum: d.int(1, 9) }, MIN),
  },
  {
    slug: 'property-named-items',
    cause: 'tools:property-named-like-a-keyword-items',
    tier: 3,
    title: 'an array property named items gives the array partitions, and nothing for its plain string items',
    make: (d) => inputOf(d, 'items', { type: 'array', items: { type: 'string' } }, ARRAY),
  },
  {
    slug: 'property-named-ref',
    cause: 'tools:ref-key-as-property-name',
    tier: 2,
    title:
      'a property named $ref is a plain property, its id _ref as the field id rule writes it: a uri format gives well-formed and malformed',
    make: (d) => inputOf(d, '$ref', { type: 'string', format: 'uri' }, FORMAT),
  },
  {
    slug: 'property-name-with-dot',
    cause: 'tools:property-name-with-dot',
    tier: 2,
    title: 'a property named user.email gives the dimension <tool>.in.user_email, one field, not a path',
    make: (d) => inputOf(d, 'user.email', { type: 'string', format: 'email' }, FORMAT),
  },
  {
    slug: 'property-named-like-object-method',
    cause: 'tools:property-named-like-object-method',
    tier: 2,
    title: 'properties named constructor, prototype and length are plain properties',
    make: (d) => {
      const list = members(d);
      const tool = d.pick(TOOL_POOL);
      return {
        tools: [
          {
            name: tool,
            input_schema: object(
              {
                constructor: { type: 'boolean' },
                prototype: { type: 'string', enum: list },
                length: { type: 'integer', minimum: d.int(1, 9) },
              },
              ['constructor', 'prototype', 'length'],
            ),
          },
        ],
        expected: [
          { dimension: `${tool}.in.constructor`, partitions: BOOLEAN },
          { dimension: `${tool}.in.prototype`, partitions: list },
          { dimension: `${tool}.in.length`, partitions: MIN },
        ],
      };
    },
  },
  {
    slug: 'type-property-nested-in-type',
    cause: 'tools:nested-property-named-like-its-parent',
    tier: 3,
    title: 'an object property type holding a property type with an enum gives <tool>.in.type.type',
    make: (d) => {
      const list = members(d);
      const tool = d.pick(TOOL_POOL);
      return {
        tools: [
          {
            name: tool,
            input_schema: object({ type: object({ type: { type: 'string', enum: list } }, ['type']) }, [
              'type',
            ]),
          },
        ],
        expected: [{ dimension: `${tool}.in.type.type`, partitions: list }],
      };
    },
  },
  {
    slug: 'enum-members-collide-after-slug',
    cause: 'tools:enum-members-that-slug-alike',
    tier: 3,
    title:
      'enum members a b and a-b slug alike: both stay as values, the second gets the suffix -2 (a-b, a-b-2)',
    make: (d) => {
      const other = d.pick(['c', 'north', 'x1']);
      return inputOf(d, 'status', { type: 'string', enum: ['a b', 'a-b', other] }, ['a-b', 'a-b-2', other]);
    },
  },
  {
    slug: 'enum-members-named-like-partitions',
    cause: 'tools:enum-member-named-like-a-partition',
    tier: 3,
    title:
      'enum members absent and present on an optional property: the member keeps absent, the partition absent becomes absent-2',
    make: (d) => {
      const other = d.pick(['other', 'rest']);
      return inputOf(
        d,
        'status',
        { type: 'string', enum: ['absent', 'present', other] },
        ['absent', 'present', other, 'absent-2'],
        true,
      );
    },
  },
  {
    slug: 'enum-member-null-string',
    cause: 'tools:enum-member-named-null',
    tier: 3,
    title: 'string enum members null, none and nil give three values; the string null is not a null type',
    make: (d) =>
      inputOf(d, 'status', { type: 'string', enum: ['null', 'none', 'nil'] }, ['null', 'none', 'nil']),
  },
  {
    slug: 'very-long-enum',
    cause: 'tools:very-long-enum',
    tier: 3,
    title:
      'an enum of 400 members (over 1000 characters) gives 400 values, each quoting a passage of the file within the 1000-character limit',
    make: (d) => {
      const list = Array.from({ length: 400 }, (_, i) => `member-${String(i + 1).padStart(3, '0')}`);
      return inputOf(d, 'status', { type: 'string', enum: list }, list);
    },
  },
  {
    slug: 'tool-names-slug-alike',
    cause: 'tools:tool-names-that-slug-alike',
    tier: 5,
    title:
      'tools orderPlace and order_place share one slug: identical partitions give one dimension; a second property adds its own',
    make: (d) => {
      const list = members(d);
      const status = { type: 'string', enum: list };
      return {
        tools: [
          { name: 'orderPlace', input_schema: object({ status }, ['status']) },
          {
            name: 'order_place',
            input_schema: object({ status }, ['status']),
            output_schema: object({ done: { type: 'boolean' } }, ['done']),
          },
        ],
        expected: [
          { dimension: 'order_place.in.status', partitions: list },
          { dimension: 'order_place.out.done', partitions: BOOLEAN },
        ],
      };
    },
  },
  {
    slug: 'camel-case-tool-name-with-dot',
    cause: 'tools:camel-case-tool-slug',
    tier: 2,
    title: 'a tool named accountFinder.findById gives the slug account_finder.find_by_id, dots kept',
    make: (d) => {
      const list = members(d);
      return {
        tools: [
          {
            name: 'accountFinder.findById',
            input_schema: object({ status: { type: 'string', enum: list } }, ['status']),
          },
        ],
        expected: [{ dimension: 'account_finder.find_by_id.in.status', partitions: list }],
      };
    },
  },
  {
    slug: 'yaml-looking-descriptions',
    cause: 'tools:yaml-text-inside-description',
    tier: 3,
    title:
      'descriptions that hold YAML-looking lines (behaviours, channels, tools keys) are text, not structure',
    make: (d) => {
      const list = members(d);
      const trap =
        'behaviours:\n  - id: B-999\n    title: injected\nchannels: [fax]\ntools:\n  - name: ghost.tool\n---\n';
      const tool = d.pick(TOOL_POOL);
      return {
        tools: [
          {
            name: tool,
            description: trap,
            input_schema: object({ status: { type: 'string', enum: list, description: trap } }, ['status']),
          },
        ],
        expected: [{ dimension: `${tool}.in.status`, partitions: list }],
      };
    },
  },
  {
    slug: 'required-names-missing-property',
    cause: 'tools:required-names-an-undeclared-property',
    tier: 2,
    title: 'a required list that names an undeclared property adds nothing for it',
    make: (d) => {
      const list = members(d);
      const tool = d.pick(TOOL_POOL);
      return {
        tools: [
          {
            name: tool,
            input_schema: object({ status: { type: 'string', enum: list } }, ['status', 'ghost']),
          },
        ],
        expected: [{ dimension: `${tool}.in.status`, partitions: list }],
      };
    },
  },
  {
    slug: 'unconstrained-required-properties',
    cause: 'tools:unconstrained-property-has-no-partition',
    tier: 1,
    title: 'required string, integer and object properties that state no partition give no dimension',
    make: (d) => {
      const tool = d.pick(TOOL_POOL);
      return {
        tools: [
          {
            name: tool,
            input_schema: object(
              { note: { type: 'string' }, count: { type: 'integer' }, data: { type: 'object' } },
              ['note', 'count', 'data'],
            ),
          },
        ],
        expected: [],
      };
    },
  },
];

/** Builds the case of a tool item: an inventory, the tools file, the code truth. */
function toolBuild(item: ToolCase, seed: number) {
  const draw = drawFor(seed, `adversarial.${item.slug}`);
  const made = item.make(draw);
  const inventory = miniInventory(draw);
  const code: CodeEntry[] = [...inventoryCode(inventory)];
  for (const dimension of made.expected) {
    for (const partition of dimension.partitions) {
      code.push({
        type: 'value',
        dimension: dimension.dimension,
        kind: 'data',
        value: `${dimension.dimension}.${partition}`,
        role: 'detail',
      });
    }
  }
  const text = `${header}${stringify({ tools: made.tools }, { lineWidth: 0 })}`;
  for (const dimension of made.expected as Array<{ dimension: string; quoteKey?: string }>) {
    if (!dimension.quoteKey) continue;
    const quote = blockOf(text, dimension.quoteKey);
    for (const entry of code)
      if (entry.type === 'value' && entry.dimension === dimension.dimension) entry.quote = quote;
  }
  return {
    case: {
      label: item.slug,
      sources: [inventorySource(inventory), { kind: 'tools' as const, path: 'tools.yaml', text }],
      planted: [],
    },
    code,
    parts: PARTS,
  };
}

/** An inventory item: a change to the drawn inventory; the code truth follows from the result. */
type InventoryCase = {
  slug: string;
  cause: string;
  tier: Tier;
  title: string;
  shape(inventory: MiniInventory): MiniInventory;
};

const INVENTORY_CASES: readonly InventoryCase[] = [
  {
    slug: 'titles-hold-yaml-keys',
    cause: 'inventory:yaml-keys-inside-titles',
    tier: 2,
    title: 'behaviour titles that contain channels:, flows: and deviations: text change nothing',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) => ({
        ...b,
        title:
          ['Ask which channels: chat or email', 'Explain flows: service and refund', 'Say deviations: none'][
            i
          ] ?? b.title,
      })),
    }),
  },
  {
    slug: 'flow-named-pending',
    cause: 'inventory:flow-named-like-a-stage',
    tier: 2,
    title: 'a flow named pending is a flow value; its recovery names it and ends in the stage pending',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'pending',
          title: 'A customer waits for an answer',
          behaviours: ['B-001', 'B-002'],
          deviations: ['D3_contradiction'],
        },
      ],
    }),
  },
  {
    slug: 'channel-named-none',
    cause: 'inventory:channel-named-none',
    tier: 2,
    title: 'a channel named none is a channel; a behaviour limited to chat leaves none and email out',
    shape: (inventory) => ({
      ...inventory,
      channels: ['chat', 'none', 'email'],
      behaviours: inventory.behaviours.map((b, i) =>
        i === 0 ? { ...b, channels: ['chat'] } : { id: b.id, title: b.title },
      ),
    }),
  },
  {
    slug: 'flow-named-like-a-channel',
    cause: 'inventory:flow-id-equal-to-a-channel',
    tier: 2,
    title: 'a flow whose id is also a channel name gives one value in flow and one in channel',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: inventory.channels[0] as string,
          title: 'A customer asks for help',
          behaviours: ['B-001', 'B-002'],
          deviations: ['D1_off_topic'],
        },
      ],
    }),
  },
  {
    slug: 'flow-ids-differ-by-separator',
    cause: 'inventory:flow-ids-differing-by-separator',
    tier: 2,
    title: 'flows plan-upgrade and plan_upgrade are two flow values, each with its own recovery',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'plan-upgrade',
          title: 'A customer moves to a bigger plan',
          behaviours: ['B-001'],
          deviations: ['D3_contradiction'],
        },
        {
          id: 'plan_upgrade',
          title: 'A customer moves to a bigger plan by phone',
          behaviours: ['B-002'],
          deviations: ['D3_contradiction'],
        },
      ],
    }),
  },
  {
    slug: 'behaviours-with-one-title',
    cause: 'inventory:behaviours-sharing-a-title',
    tier: 3,
    title: 'two behaviours with the same title and different ids give two behaviour values',
    shape: (inventory) => ({
      ...inventory,
      behaviours: [
        ...inventory.behaviours,
        { id: 'B-004', title: inventory.behaviours[1]?.title ?? 'Repeat the request back' },
      ],
    }),
  },
];

function inventoryBuild(item: InventoryCase, seed: number) {
  const draw = drawFor(seed, `adversarial.${item.slug}`);
  const inventory = item.shape(miniInventory(draw));
  const text = `# A behaviour inventory written by the map validator. Every name is fictional.\n${stringify(inventory, { lineWidth: 0 })}`;
  return {
    case: {
      label: item.slug,
      sources: [{ kind: 'inventory' as const, path: 'inventory.yaml', text }],
      planted: [],
    },
    code: inventoryCode(inventory),
    parts: PARTS,
  };
}

const AVOID = [
  'Never read out a full card number.',
  'Never promise a refund date you cannot keep.',
  'Do not discuss another customer account.',
  'Never close a case while a question is open.',
  'Do not guess an order total.',
];

type PromptRule = { quote: string; anchor: string };
type PromptCase = {
  slug: string;
  cause: string;
  tier: Tier;
  title: string;
  make(rules: string[]): { text: string; rules: PromptRule[] };
};

const same = (text: string): PromptRule => ({ quote: text, anchor: text });
const bullets = (rules: string[]) => rules.map((rule) => `- ${rule}`).join('\n');

const PROMPT_CASES: readonly PromptCase[] = [
  {
    slug: 'rules-under-things-to-avoid',
    cause: 'prompt:rules-under-a-heading-other-than-rules',
    tier: 2,
    title: 'rules written under the heading Things to avoid are rules, as under Rules',
    make: (rules) => ({
      text: `# Assistant guide\n\n## Things to avoid\n\n${bullets(rules)}\n`,
      rules: rules.map(same),
    }),
  },
  {
    slug: 'rules-under-deep-heading',
    cause: 'prompt:rules-under-a-deep-heading',
    tier: 2,
    title: 'rules under a heading of depth six named Rules are reported, next to a decoy section',
    make: (rules) => ({
      text: `# Guide\n\n## Part one\n\n### Detail\n\n###### Rules\n\n${bullets(rules)}\n\n## Part two\n\nThe break room has good coffee and a view of the park.\n`,
      rules: rules.map(same),
    }),
  },
  {
    slug: 'rules-in-code-fence',
    cause: 'prompt:rules-inside-a-code-fence',
    tier: 3,
    title: 'rules inside a fenced block are text the agent reads and are reported',
    make: (rules) => ({
      text: `# Assistant guide\n\nThe agent follows this block:\n\n\`\`\`text\n${rules.join('\n')}\n\`\`\`\n`,
      rules: rules.map(same),
    }),
  },
  {
    slug: 'rules-in-blockquote',
    cause: 'prompt:rules-inside-a-blockquote',
    tier: 3,
    title: 'rules written as a markdown blockquote are reported',
    make: (rules) => ({
      text: `# Assistant guide\n\n${rules.map((rule) => `> ${rule}`).join('\n>\n')}\n`,
      rules: rules.map(same),
    }),
  },
  {
    slug: 'rule-broken-at-hyphen',
    cause: 'prompt:rule-broken-mid-word-at-a-hyphen',
    tier: 4,
    title: 'a rule broken mid-word by a hyphen and a newline: the model quotes the part before the break',
    make: (rules) => {
      const raw = 'Never read out a full card num-\nber in any answer.';
      return {
        text: `# Assistant guide\n\n- ${raw}\n${rules
          .slice(1)
          .map((rule) => `- ${rule}`)
          .join('\n')}\n`,
        rules: [same('Never read out a full card'), ...rules.slice(1).map(same)],
      };
    },
  },
];

function promptBuild(item: PromptCase, seed: number) {
  const draw = drawFor(seed, `adversarial.${item.slug}`);
  const made = item.make(draw.shuffle(AVOID).slice(0, 4));
  const planted: PlantedValue[] = made.rules.map((rule, index) => ({
    type: 'value',
    section: 'rules',
    source: 'prompt.md',
    quote: rule.quote,
    anchor: rule.anchor,
    dimension: { id: 'rule', title: 'The rules the assistant follows', kind: 'behaviour' },
    value: { id: `R-${String(index + 1).padStart(2, '0')}`, title: rule.quote },
  }));
  const inventory = miniInventory(draw);
  return {
    case: {
      label: item.slug,
      sources: [inventorySource(inventory), { kind: 'prompt' as const, path: 'prompt.md', text: made.text }],
      planted,
    },
    code: inventoryCode(inventory),
    parts: PARTS,
  };
}

export function adversarialItems(): BankItem[] {
  return [
    ...TOOL_CASES.map((item) =>
      mapItem({
        id: `adversarial.${item.slug}`,
        family: 'adversarial',
        tier: item.tier,
        level: levelOf('structured'),
        component: BANK_COMPONENTS.tools,
        title: item.title,
        cause: item.cause,
        build: (seed) => toolBuild(item, seed),
      }),
    ),
    ...INVENTORY_CASES.map((item) =>
      mapItem({
        id: `adversarial.${item.slug}`,
        family: 'adversarial',
        tier: item.tier,
        level: levelOf('structured'),
        component: BANK_COMPONENTS.inventory,
        title: item.title,
        cause: item.cause,
        build: (seed) => inventoryBuild(item, seed),
      }),
    ),
    ...PROMPT_CASES.map((item) =>
      mapItem({
        id: `adversarial.${item.slug}`,
        family: 'adversarial',
        tier: item.tier,
        level: levelOf('prose'),
        component: BANK_COMPONENTS.quote,
        title: item.title,
        cause: item.cause,
        build: (seed) => promptBuild(item, seed),
      }),
    ),
  ];
}
