import type { SourceText } from '@agent-nexus/driftbench-generate';
import { stringify } from 'yaml';
import { Draw, mixSeed } from '../spec';
import type { CodeEntry } from './facts';

/** Shared pieces of the families: a small inventory with its code truth, seeded draws, the component table. */

export const BANK_COMPONENTS = {
  inventory: 'packages/generate/src/extract/prepass.ts',
  tools: 'packages/generate/src/extract/tools.ts',
  quote: 'packages/generate/src/extract/quote.ts',
  accept: 'packages/generate/src/extract/accept.ts',
  contract: 'packages/generate/src/extract/contract.ts',
  extract: 'packages/generate/src/extract/extract.ts',
  proposal: 'packages/generate/src/extract/proposal.ts',
  roles: 'packages/generate/src/extract/space.ts',
  space: 'packages/space/src/load.ts',
} as const;

/** A seeded generator for one item: the seed mixed with the item id, so items draw apart. */
export function drawFor(seed: number, id: string): Draw {
  let hash = 0x811c9dc5;
  for (const char of id) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return new Draw(mixSeed(seed, hash));
}

export type MiniInventory = {
  channels: string[];
  behaviours: Array<{ id: string; title: string; channels?: string[] }>;
  flows: Array<{ id: string; title: string; behaviours: string[]; deviations?: string[] }>;
};

const DETOURS = new Set([
  'D1_off_topic',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D9_out_of_scope',
  'D10_return',
]);
const DEVIATION_ORDER = [
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

/** A small inventory drawn from the seed: two or three channels, three behaviours, one or two flows. */
export function miniInventory(draw: Draw): MiniInventory {
  const channels = draw.subset(['chat', 'email', 'sms', 'voice', 'web'], draw.int(2, 3));
  const behaviours = [
    { id: 'B-001', title: 'Greet the customer by the name on the account' },
    { id: 'B-002', title: 'Repeat the request back before acting on it' },
    { id: 'B-003', title: 'Report a failed lookup honestly and offer a callback' },
  ].map((behaviour, index) =>
    index === 0 ? { ...behaviour, channels: [channels[0] as string] } : behaviour,
  );
  const flows = [
    {
      id: 'service',
      title: 'A customer asks for help with a plan',
      behaviours: ['B-001', 'B-002'],
      deviations: ['D1_off_topic'],
    },
    ...(draw.chance(0.5)
      ? [
          {
            id: 'refund',
            title: 'A customer asks for money back',
            behaviours: ['B-002', 'B-003'],
            deviations: ['D8_tool_failure'],
          },
        ]
      : []),
  ];
  return { channels, behaviours, flows };
}

export function inventoryYaml(inventory: MiniInventory): string {
  return `# A behaviour inventory written by the map validator. Every name is fictional.\n${stringify(
    inventory,
    {
      lineWidth: 0,
    },
  )}`;
}

/** What the inventory pre-pass must propose for a small inventory, by its documented contract. */
export function inventoryCode(inventory: MiniInventory): CodeEntry[] {
  const out: CodeEntry[] = [];
  for (const behaviour of inventory.behaviours) {
    out.push({ type: 'value', dimension: 'behaviour', kind: 'behaviour', value: behaviour.id, role: 'axis' });
  }
  for (const flow of inventory.flows) {
    out.push({ type: 'value', dimension: 'flow', kind: 'behaviour', value: flow.id, role: 'detail' });
  }
  const deviations = new Set(inventory.flows.flatMap((flow) => flow.deviations ?? []));
  for (const deviation of DEVIATION_ORDER) {
    if (deviations.has(deviation)) {
      out.push({ type: 'value', dimension: 'deviation', kind: 'deviation', value: deviation, role: 'axis' });
    }
  }
  for (const channel of inventory.channels) {
    out.push({ type: 'value', dimension: 'channel', kind: 'channel', value: channel, role: 'axis' });
  }
  for (const behaviour of inventory.behaviours) {
    if (!behaviour.channels) continue;
    for (const channel of inventory.channels) {
      if (!behaviour.channels.includes(channel)) {
        out.push({ type: 'constraint', forbid: { behaviour: behaviour.id, channel } });
      }
    }
  }
  // A behaviour a flow lists belongs to that flow: one constraint per flow that does not list it.
  for (const behaviour of inventory.behaviours) {
    const owners = inventory.flows.filter((flow) => (flow.behaviours ?? []).includes(behaviour.id));
    if (owners.length === 0) continue;
    for (const flow of inventory.flows) {
      if (!owners.includes(flow))
        out.push({ type: 'constraint', forbid: { behaviour: behaviour.id, flow: flow.id } });
    }
  }
  for (const flow of inventory.flows) {
    for (const deviation of flow.deviations ?? []) {
      if (!DETOURS.has(deviation)) continue;
      out.push({
        type: 'relation',
        relation: { kind: 'recovery', class: deviation, flows: [flow.id], stage_after: 'pending' },
      });
    }
  }
  return out;
}

export function inventorySource(inventory: MiniInventory, path = 'inventory.yaml'): SourceText {
  return { kind: 'inventory', path, text: inventoryYaml(inventory) };
}

/** Pools of fictional names. */
export const TOOL_POOL = [
  'account.find',
  'order.place',
  'refund.request',
  'address.check',
  'visit.book',
  'ticket.open',
];
export const PROPERTY_POOL = [
  'status',
  'amount',
  'note',
  'tier',
  'count',
  'items',
  'reason',
  'slot',
  'owner',
  'lines',
];
export const MEMBER_POOL = [
  ['low', 'normal', 'high'],
  ['open', 'pending', 'closed'],
  ['basic', 'plus', 'max'],
  ['moved', 'unhappy', 'duplicate'],
];

/**
 * The block of a YAML key as written: the first line that starts with `key:` after the lines holding each
 * `after` mark in turn (when given),
 * and every following line indented deeper. A quote of that key must hold the whole block.
 */
export function blockOf(text: string, key: string, ...after: string[]): string {
  const lines = text.split('\n');
  let from = 0;
  for (const mark of after) {
    const found = lines.findIndex((line, position) => position >= from && line.includes(mark));
    if (found < 0) throw new Error(`no line holding ${mark} in the file`);
    from = found;
  }
  const index = lines.findIndex(
    (line, position) => position >= from && line.trimStart().startsWith(`${key}:`),
  );
  if (index < 0) throw new Error(`no line ${key}: in the file`);
  const indent = (line: string) => line.length - line.trimStart().length;
  const head = lines[index] as string;
  const block = [head.trimStart()];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() === '' || indent(line) <= indent(head)) break;
    block.push(line);
  }
  return block.join('\n');
}

/**
 * A field name as it enters a dimension id (docs/generating.md, "The code pre-pass"): a capital after a letter or
 * digit is split off with `_`, the name is lower-cased, and each run of characters other than letters, digits,
 * `_` and `-` becomes `_`. `$ref` gives `_ref`, `user.email` gives `user_email`, `getWeather` gives `get_weather`.
 */
export function fieldId(name: string): string {
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');
  return id === '' ? 'p' : id;
}
