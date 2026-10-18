import { stringify } from 'yaml';
import {
  BANK_COMPONENTS,
  blockOf,
  drawFor,
  inventoryCode,
  type MiniInventory,
  miniInventory,
} from '../common';
import type { CodeEntry } from '../facts';
import { mapItem } from '../run';
import type { BankItem, Tier } from '../types';
import { levelOf } from '../types';

/**
 * Family inventory-forms: behaviour inventories in the shapes and sizes a team writes them. The oracle is the
 * inventory pre-pass's documented contract: behaviours, flows, required deviation classes and channels as
 * dimensions; a constraint per channel a limited behaviour leaves out; a recovery to the pending stage per
 * detour class a flow requires.
 */

const ALL_CLASSES = [
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
];

type Form = {
  slug: string;
  tier: Tier;
  title: string;
  path?: string;
  /** Changes the drawn inventory; the code truth follows from the result. */
  shape?: (inventory: MiniInventory, seed: number) => MiniInventory;
  /** Writes the text; YAML by default. */
  write?: (inventory: MiniInventory) => string;
  /** The code truth when it differs from `inventoryCode` of the shaped inventory. */
  code?: (inventory: MiniInventory) => CodeEntry[];
  /** The one change that makes the item pass, when not `inventory:<slug>`. */
  cause?: string;
};

const header = '# A behaviour inventory written by the map validator. Every name is fictional.\n';
const yaml = (value: unknown) => `${header}${stringify(value, { lineWidth: 0 })}`;

const LONG = 'inventory:whole-long-quote';
const longTitle = (start: string) =>
  `${start} ${'and keeps every promise made on the way '.repeat(30)}`.trim();
const manyChannels = Array.from({ length: 80 }, (_, i) => `channel-${String(i + 1).padStart(2, '0')}`);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
/** The quote of an item as JSON writes it: white space folds, so the indentation does not matter. */
const jsonQuote = (value: unknown) => JSON.stringify(value, null, 2);
/** The code entries with every value of one dimension quoting the same block. */
const allQuote = (code: CodeEntry[], dimension: string, quote: string): CodeEntry[] =>
  code.map((entry) =>
    entry.type === 'value' && entry.dimension === dimension ? { ...entry, quote } : entry,
  );

/**
 * Inventory items, lists and titles over 1000 characters, in YAML and JSON: each value quotes the whole item
 * or list as written. One change makes them all pass: a quote may be as long as the item it stands for.
 */
const LONG_QUOTE_FORMS: readonly Form[] = [
  {
    slug: 'long-channel-list',
    tier: 3,
    cause: LONG,
    title: 'a top-level list of 80 channels (over 1000 characters): each channel value quotes the whole list',
    shape: (inventory) => ({
      ...inventory,
      channels: manyChannels,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 0 ? { ...b, channels: [manyChannels[0] as string] } : b,
      ),
    }),
    code: (inventory) => allQuote(inventoryCode(inventory), 'channel', blockOf(yaml(inventory), 'channels')),
  },
  {
    slug: 'long-channel-list-json',
    tier: 3,
    cause: LONG,
    path: 'inventory.json',
    title: 'the list of 80 channels in a JSON inventory: each channel value quotes the whole list',
    shape: (inventory) => ({
      ...inventory,
      channels: manyChannels,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 0 ? { ...b, channels: [manyChannels[0] as string] } : b,
      ),
    }),
    write: json,
    code: (inventory) =>
      allQuote(inventoryCode(inventory), 'channel', `"channels": ${jsonQuote(inventory.channels)}`),
  },
  {
    slug: 'long-behaviour-channels',
    tier: 3,
    cause: LONG,
    title: 'a behaviour that lists 80 channels: its value quotes the whole item, channel list included',
    shape: (inventory) => ({
      ...inventory,
      channels: manyChannels,
      behaviours: inventory.behaviours.map((b, i) => (i === 0 ? { ...b, channels: manyChannels } : b)),
    }),
    code: (inventory) =>
      withQuote(
        inventoryCode(inventory),
        'behaviour',
        'B-001',
        stringify(inventory.behaviours[0], { lineWidth: 0 }),
      ),
  },
  {
    slug: 'long-flow-behaviours',
    tier: 3,
    cause: LONG,
    title: 'a flow that lists 100 behaviours: its value quotes the whole flow item',
    shape: (inventory) => {
      const behaviours = Array.from({ length: 100 }, (_, i) => ({
        id: `B-${String(i + 1).padStart(3, '0')}`,
        title: `Handle fictional request number ${i + 1}`,
      }));
      return {
        ...inventory,
        behaviours,
        flows: inventory.flows.map((f, i) =>
          i === 0 ? { ...f, behaviours: behaviours.map((b) => b.id) } : f,
        ),
      };
    },
    code: (inventory) =>
      withQuote(inventoryCode(inventory), 'flow', 'service', stringify(inventory.flows[0], { lineWidth: 0 })),
  },
  {
    slug: 'long-behaviour-title-line',
    tier: 3,
    cause: LONG,
    title: 'a behaviour whose title line alone is over 1000 characters: its value quotes the whole item',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) => (i === 1 ? { ...b, title: longTitle(b.title) } : b)),
    }),
    code: (inventory) =>
      withQuote(
        inventoryCode(inventory),
        'behaviour',
        'B-002',
        stringify(inventory.behaviours[1], { lineWidth: 0 }),
      ),
  },
  {
    slug: 'long-flow-title-line',
    tier: 3,
    cause: LONG,
    title: 'a flow whose title line alone is over 1000 characters: its value quotes the whole flow item',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map((f, i) => (i === 0 ? { ...f, title: longTitle(f.title) } : f)),
    }),
    code: (inventory) =>
      withQuote(inventoryCode(inventory), 'flow', 'service', stringify(inventory.flows[0], { lineWidth: 0 })),
  },
  {
    slug: 'two-long-items',
    tier: 3,
    cause: LONG,
    title: 'two behaviour items over 1000 characters: each value quotes its own whole item',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) => (i > 0 ? { ...b, title: longTitle(b.title) } : b)),
    }),
    code: (inventory) =>
      withQuote(
        withQuote(
          inventoryCode(inventory),
          'behaviour',
          'B-002',
          stringify(inventory.behaviours[1], { lineWidth: 0 }),
        ),
        'behaviour',
        'B-003',
        stringify(inventory.behaviours[2], { lineWidth: 0 }),
      ),
  },
  {
    slug: 'long-item-json',
    tier: 3,
    cause: LONG,
    path: 'inventory.json',
    title: 'a behaviour item over 1000 characters in a JSON inventory: its value quotes the whole object',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) => (i === 2 ? { ...b, title: longTitle(b.title) } : b)),
    }),
    write: json,
    code: (inventory) =>
      withQuote(inventoryCode(inventory), 'behaviour', 'B-003', jsonQuote(inventory.behaviours[2])),
  },
  {
    slug: 'long-flow-json',
    tier: 3,
    cause: LONG,
    path: 'inventory.json',
    title: 'a flow item over 1000 characters in a JSON inventory: its value quotes the whole object',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map((f, i) => (i === 0 ? { ...f, title: longTitle(f.title) } : f)),
    }),
    write: json,
    code: (inventory) =>
      withQuote(inventoryCode(inventory), 'flow', 'service', jsonQuote(inventory.flows[0])),
  },
];

export const FORMS: readonly Form[] = [
  { slug: 'base', tier: 1, title: 'a small inventory in YAML' },
  {
    slug: 'json',
    tier: 1,
    title: 'the inventory as JSON',
    path: 'inventory.json',
    write: (inventory) => `${JSON.stringify(inventory, null, 2)}\n`,
  },
  {
    slug: 'no-channel-list',
    tier: 2,
    title: 'no top-level channels: the channels named by behaviours',
    write: (inventory) => yaml({ behaviours: inventory.behaviours, flows: inventory.flows }),
    code: (inventory) => {
      const named = [...new Set(inventory.behaviours.flatMap((behaviour) => behaviour.channels ?? []))];
      // Only the channel declaration is omitted; flow membership still constrains behaviours.
      return inventoryCode({ ...inventory, channels: named });
    },
  },
  {
    slug: 'task-behaviour',
    tier: 1,
    title: 'a behaviour of kind task is a behaviour value like the others',
    shape: (inventory) => ({
      ...inventory,
      behaviours: [
        ...inventory.behaviours,
        {
          id: 'B-004',
          title: 'Build the price sheet from the catalog file',
          kind: 'task',
        } as MiniInventory['behaviours'][number],
      ],
    }),
  },
  {
    slug: 'no-deviations',
    tier: 1,
    title: 'flows with no deviation class give no deviation dimension',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map(({ deviations: _d, ...flow }) => flow),
    }),
  },
  {
    slug: 'all-classes',
    tier: 2,
    title: 'a flow that requires all ten classes gives ten values and eight recoveries',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'service',
          title: 'A customer asks for help',
          behaviours: ['B-001'],
          deviations: [...ALL_CLASSES],
        },
      ],
    }),
  },
  {
    slug: 'shared-detour',
    tier: 2,
    title: 'two flows that require one detour class give one recovery each',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'service',
          title: 'A customer asks for help',
          behaviours: ['B-001'],
          deviations: ['D3_contradiction'],
        },
        {
          id: 'refund',
          title: 'A customer asks for money back',
          behaviours: ['B-002'],
          deviations: ['D3_contradiction'],
        },
      ],
    }),
  },
  {
    slug: 'two-of-three',
    tier: 2,
    title: 'a behaviour on two of three channels gives one constraint',
    shape: (inventory) => {
      const channels = ['chat', 'email', 'sms'];
      return {
        ...inventory,
        channels,
        behaviours: inventory.behaviours.map((b, i) =>
          i === 0 ? { ...b, channels: ['chat', 'sms'] } : { id: b.id, title: b.title },
        ),
      };
    },
  },
  {
    slug: 'unicode-titles',
    tier: 2,
    title: 'titles with accents and typographic apostrophes',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 1 ? { ...b, title: 'Use the customer’s own words, même en français' } : b,
      ),
    }),
  },
  {
    slug: 'colon-title',
    tier: 2,
    title: 'a title with a colon, quoted in YAML',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map((f, i) =>
        i === 0 ? { ...f, title: 'Service: a customer asks for help' } : f,
      ),
    }),
  },
  {
    slug: 'long-item',
    tier: 3,
    title:
      'a behaviour item over 1000 characters is quoted by a passage of its source within the 1000-character limit, and the proposal stays valid',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 2
          ? { ...b, title: `Report a failed lookup honestly ${'and offer a callback '.repeat(60)}`.trim() }
          : b,
      ),
    }),
  },
  {
    slug: 'comments',
    tier: 1,
    title: 'comments on every line',
    write: (inventory) =>
      yaml(inventory)
        .replace(/\n(\s*)- id:/g, '\n$1# an item\n$1- id:')
        .replace(/\n/g, ' # note\n')
        .replace(/^# A behaviour.* # note\n/, header),
  },
  {
    slug: 'flow-style',
    tier: 2,
    title: 'the inventory in YAML flow style on few lines',
    write: (inventory) => `${header}${stringify(inventory, { lineWidth: 0, collectionStyle: 'flow' })}`,
  },
  {
    slug: 'reversed-classes',
    tier: 1,
    title: 'deviation classes listed in reverse order',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map((f) => ({
        ...f,
        deviations: [...(f.deviations ?? []), 'D10_return', 'D2_goal_shift'].reverse(),
      })),
    }),
  },
  {
    slug: 'many-behaviours',
    tier: 3,
    title: 'two hundred behaviours',
    shape: (inventory) => ({
      ...inventory,
      behaviours: Array.from({ length: 200 }, (_, i) => ({
        id: `B-${String(i + 1).padStart(3, '0')}`,
        title: `Behaviour number ${i + 1} of the fictional desk`,
      })),
    }),
  },
  {
    slug: 'no-flows',
    tier: 1,
    title: 'an inventory with no flow',
    shape: (inventory) => ({ ...inventory, flows: [] }),
  },
  {
    slug: 'crlf',
    tier: 2,
    title: 'CRLF line endings',
    write: (inventory) => yaml(inventory).replace(/\n/g, '\r\n'),
  },
  {
    slug: 'bom',
    tier: 3,
    title: 'a byte order mark at the start of the file',
    write: (inventory) => `﻿${yaml(inventory)}`,
  },
  {
    slug: 'all-channels',
    tier: 2,
    title: 'a behaviour that names every channel gives no constraint',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 0 ? { ...b, channels: [...inventory.channels] } : b,
      ),
    }),
  },
  {
    slug: 'anchors',
    tier: 3,
    title: 'YAML anchors and aliases: two flows share one behaviour list',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'service',
          title: 'A customer asks for help',
          behaviours: ['B-001', 'B-002'],
          deviations: ['D1_off_topic'],
        },
        { id: 'refund', title: 'A customer asks for money back', behaviours: ['B-001', 'B-002'] },
      ],
    }),
    write: (inventory) =>
      `${header}${stringify({ channels: inventory.channels, behaviours: inventory.behaviours }, { lineWidth: 0 })}flows:\n  - id: service\n    title: A customer asks for help\n    behaviours: &core [B-001, B-002]\n    deviations: [D1_off_topic]\n  - id: refund\n    title: A customer asks for money back\n    behaviours: *core\n`,
  },
  {
    slug: 'tabs-in-titles',
    tier: 2,
    title: 'tabs and double spaces inside titles',
    shape: (inventory) => ({
      ...inventory,
      behaviours: inventory.behaviours.map((b, i) =>
        i === 1 ? { ...b, title: 'Repeat the request\tback  before acting on it' } : b,
      ),
    }),
  },
  {
    slug: 'non-detour-only',
    tier: 2,
    title: 'a flow requiring only a goal shift and a tool failure gives no recovery',
    shape: (inventory) => ({
      ...inventory,
      flows: [
        {
          id: 'service',
          title: 'A customer asks for help',
          behaviours: ['B-001'],
          deviations: ['D2_goal_shift', 'D8_tool_failure'],
        },
      ],
    }),
  },
  {
    slug: 'markdown-tables',
    tier: 4,
    title: 'an inventory kept as markdown tables of behaviours and flows',
    path: 'inventory.md',
    write: (inventory) =>
      [
        '# Behaviour inventory',
        '',
        `Channels: ${inventory.channels.join(', ')}`,
        '',
        '## Behaviours',
        '',
        '| id | title | channels |',
        '|---|---|---|',
        ...inventory.behaviours.map((b) => `| ${b.id} | ${b.title} | ${(b.channels ?? []).join(', ')} |`),
        '',
        '## Flows',
        '',
        '| id | title | behaviours | deviations |',
        '|---|---|---|---|',
        ...inventory.flows.map(
          (f) => `| ${f.id} | ${f.title} | ${f.behaviours.join(', ')} | ${(f.deviations ?? []).join(', ')} |`,
        ),
        '',
      ].join('\n'),
  },
  {
    slug: 'csv',
    tier: 4,
    title: 'an inventory kept as one CSV with a section column',
    path: 'inventory.csv',
    write: (inventory) =>
      [
        'section,id,title,channels,behaviours,deviations',
        `channels,,,${inventory.channels.join(' ')},,`,
        ...inventory.behaviours.map(
          (b) => `behaviour,${b.id},"${b.title}",${(b.channels ?? []).join(' ')},,`,
        ),
        ...inventory.flows.map(
          (f) => `flow,${f.id},"${f.title}",,${f.behaviours.join(' ')},${(f.deviations ?? []).join(' ')}`,
        ),
        '',
      ].join('\n'),
  },
  {
    slug: 'long-flow-title',
    tier: 3,
    title:
      'a flow item over 1000 characters is quoted by a passage of its source within the 1000-character limit, and the proposal stays valid',
    shape: (inventory) => ({
      ...inventory,
      flows: inventory.flows.map((f, i) =>
        i === 0
          ? {
              ...f,
              title: `A customer asks for help ${'with one more detail of the plan '.repeat(40)}`.trim(),
            }
          : f,
      ),
    }),
  },
  {
    slug: 'exact-nested-item',
    tier: 2,
    title:
      'a behaviour item with a nested channel list is quoted exactly as written, its later lines losing only the indentation of its first',
    code: (inventory) =>
      inventoryCode(inventory).map((entry) =>
        entry.type === 'value' && entry.dimension === 'behaviour' && entry.value === 'B-001'
          ? { ...entry, quote: stringify(inventory.behaviours[0], { lineWidth: 0 }).trimEnd(), exact: true }
          : entry,
      ),
  },
  {
    slug: 'pair-quotes',
    tier: 2,
    title:
      "each channel value quotes the whole channels list (key and members) and each deviation value its flow's whole deviations list",
    code: (inventory) => {
      const text = yaml(inventory);
      const channels = blockOf(text, 'channels');
      const deviations = blockOf(text, 'deviations');
      return inventoryCode(inventory).map((entry) => {
        if (entry.type !== 'value') return entry;
        if (entry.dimension === 'channel') return { ...entry, quote: channels };
        if (entry.dimension === 'deviation' && entry.value === 'D1_off_topic')
          return { ...entry, quote: deviations };
        return entry;
      });
    },
  },
  ...LONG_QUOTE_FORMS,
];

/** The code entries with one value's whole quote required. */
function withQuote(code: CodeEntry[], dimension: string, value: string, quote: string): CodeEntry[] {
  return code.map((entry) =>
    entry.type === 'value' && entry.dimension === dimension && entry.value === value
      ? { ...entry, quote }
      : entry,
  );
}

export function inventoryItems(): BankItem[] {
  return [
    ...FORMS.map((form) =>
      mapItem({
        id: `inventory-forms.${form.slug}`,
        family: 'inventory-forms',
        tier: form.tier,
        level: levelOf('structured'),
        component: BANK_COMPONENTS.inventory,
        title: form.title,
        cause: form.cause ?? `inventory:${form.slug}`,
        build: (seed) => {
          const drawn = miniInventory(drawFor(seed, `inventory-forms.${form.slug}`));
          const inventory = form.shape ? form.shape(drawn, seed) : drawn;
          const text = (form.write ?? yaml)(inventory);
          return {
            case: {
              label: form.slug,
              sources: [{ kind: 'inventory', path: form.path ?? 'inventory.yaml', text }],
              planted: [],
            },
            code: (form.code ?? inventoryCode)(inventory),
            parts: { values: true, produced: true, constraints: true, relations: true },
          };
        },
      }),
    ),
    ownQuoteItem(),
  ];
}

/** The flow and behaviour values each quote their own inventory item: the quote holds the id it stands for. */
function ownQuoteItem(): BankItem {
  const build = (seed: number) => {
    const inventory = miniInventory(drawFor(seed, 'inventory-forms.own-quotes'));
    inventory.flows = [
      {
        id: 'service',
        title: 'A customer asks for help',
        behaviours: ['B-001'],
        deviations: ['D1_off_topic'],
      },
      { id: 'refund', title: 'A customer asks for money back', behaviours: ['B-002'] },
      { id: 'renewal', title: 'A customer renews a plan', behaviours: ['B-003'] },
    ];
    return inventory;
  };
  return {
    id: 'inventory-forms.own-quotes',
    family: 'inventory-forms',
    tier: 2,
    level: levelOf('structured'),
    component: BANK_COMPONENTS.inventory,
    title: 'each flow and behaviour value quotes its own item of the inventory: the quote holds its id',
    cause: 'inventory:quote-own-item',
    generate: (seed) => [
      {
        label: 'own-quotes',
        sources: [{ kind: 'inventory', path: 'inventory.yaml', text: yaml(build(seed)) }],
        planted: [],
      },
    ],
    check: (runs) => {
      const run = runs[0];
      if (!run?.result.ok) return { pass: false, detail: 'no proposal' };
      for (const dimension of run.result.proposal.dimensions.filter(
        (d) => d.id === 'flow' || d.id === 'behaviour',
      )) {
        for (const value of dimension.values) {
          if (!value.evidence.quote.includes(value.id)) {
            return {
              pass: false,
              detail: `${dimension.id}/${value.id} quotes "${value.evidence.quote.slice(0, 80)}", which does not name it`,
            };
          }
        }
      }
      return { pass: true, detail: 'every value quotes its own item' };
    },
  };
}
