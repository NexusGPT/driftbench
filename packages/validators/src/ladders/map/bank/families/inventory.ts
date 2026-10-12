import { stringify } from 'yaml';
import { BANK_COMPONENTS, drawFor, inventoryCode, type MiniInventory, miniInventory } from '../common';
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
};

const header = '# A behaviour inventory written by the map validator. Every name is fictional.\n';
const yaml = (value: unknown) => `${header}${stringify(value, { lineWidth: 0 })}`;

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
      return inventoryCode({ ...inventory, channels: named }).filter((entry) => entry.type !== 'constraint');
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
    title: 'a behaviour item longer than a quote may be is quoted by its title line',
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
      'a flow item longer than a quote may be is quoted by a passage within the limit, and the proposal stays valid',
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
];

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
        cause: `inventory:${form.slug}`,
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
