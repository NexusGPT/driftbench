import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { DEVIATION_TITLES, type InventoryPrepass, inventoryPrepass, QuoteIndex } from '../../src/extract';
import { requoted, tableInventory } from '../../src/extract/tables';
import { ACME, INVENTORY } from './support';

function ok(result: InventoryPrepass) {
  if (!result.ok) throw new Error(`expected a pre-pass, got ${JSON.stringify(result.errors)}`);
  return result;
}

const text = await readFile(`${ACME}inventory.yaml`, 'utf8');
const result = ok(inventoryPrepass(text, '../inventory.yaml'));
const dimension = (id: string) => result.dimensions.find((candidate) => candidate.id === id);

describe('inventoryPrepass on the Acme inventory', () => {
  it('turns behaviours, flows, deviation classes and channels into four dimensions', () => {
    expect(result.dimensions.map((d) => [d.id, d.kind])).toEqual([
      ['behaviour', 'behaviour'],
      ['flow', 'behaviour'],
      ['deviation', 'deviation'],
      ['channel', 'channel'],
    ]);
    expect(dimension('behaviour')?.values.map((value) => value.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `B-${String(index + 1).padStart(3, '0')}`),
    );
    expect(dimension('flow')?.values.map((value) => value.id)).toEqual([
      'upgrade',
      'new-home',
      'porting',
      'order',
      'price-sheet',
    ]);
    expect(dimension('channel')?.values.map((value) => value.id)).toEqual(['chat', 'whatsapp']);
  });

  it('lists the deviation classes the flows require, in class order, with their titles', () => {
    const deviations = dimension('deviation')?.values ?? [];
    expect(deviations.map((value) => value.id)).toEqual([
      'D1_off_topic',
      'D2_goal_shift',
      'D3_contradiction',
      'D4_loose_confirmation',
      'D5_language_switch',
      'D6_instruction_in_data',
      'D8_tool_failure',
      'D10_return',
    ]);
    expect(deviations[0]?.title).toBe(DEVIATION_TITLES.D1_off_topic);
    expect(deviations[1]?.evidence.quote).toBe(
      'deviations: [D2_goal_shift, D3_contradiction, D4_loose_confirmation, D8_tool_failure]',
    );
  });

  it('forbids a channel a behaviour leaves out, and a flow a behaviour does not belong to, and nothing else', () => {
    const forbids = result.constraints.map((constraint) => constraint.forbid);
    expect(forbids.filter((forbid) => 'channel' in forbid)).toEqual([
      { behaviour: 'B-001', channel: 'whatsapp' },
      { behaviour: 'B-013', channel: 'whatsapp' },
      { behaviour: 'B-014', channel: 'whatsapp' },
    ]);
    expect(result.constraints[0]?.reason).toBe('B-001 applies only on chat');
    // 14 behaviours, 5 flows: each behaviour is forbidden in every flow that does not list it.
    const flows = forbids.filter((forbid) => 'flow' in forbid);
    expect(flows).toHaveLength(52);
    expect(flows).toContainEqual({ behaviour: 'B-013', flow: 'order' });
    expect(flows).not.toContainEqual({ behaviour: 'B-008', flow: 'porting' });
    expect(forbids).toHaveLength(55);
  });

  it('quotes the inventory text of every entry, verbatim once white space is folded', () => {
    const b001 = dimension('behaviour')?.values[0];
    expect(b001?.evidence).toEqual({
      source: '../inventory.yaml',
      quote:
        'id: B-001\ntitle: Identify an existing customer by the email on the account before quoting their plan\nchannels: [chat]',
    });
    expect(dimension('channel')?.values[0]?.evidence.quote).toBe('channels: [chat, whatsapp]');
    const quotes = new QuoteIndex(new Map([['../inventory.yaml', text]]));
    const evidence = [
      ...result.dimensions.flatMap((d) => d.values.map((value) => value.evidence)),
      ...result.constraints.map((constraint) => constraint.evidence),
    ];
    expect(evidence.length).toBeGreaterThan(30);
    for (const item of evidence) {
      expect(item.source).toBe('../inventory.yaml');
      expect(quotes.contains(item.source, item.quote), item.quote).toBe(true);
    }
  });

  it('leaves every dimension and constraint for a person to approve, marked as proposed by code', () => {
    expect(result.dimensions.map((d) => [d.id, d.role, d.produced_by, d.approved])).toEqual([
      ['behaviour', 'axis', 'code', false],
      ['flow', 'detail', 'code', false],
      ['deviation', 'axis', 'code', false],
      ['channel', 'axis', 'code', false],
    ]);
    const values = result.dimensions.flatMap((d) => d.values);
    expect(values.every((value) => value.produced_by === 'code' && value.approved === undefined)).toBe(true);
    expect(result.constraints.every((c) => c.produced_by === 'code' && c.approved === false)).toBe(true);
  });

  it('reads the same inventory written as JSON to the same entries', () => {
    const json = JSON.stringify(parseYaml(text), null, 2);
    const fromJson = ok(inventoryPrepass(json, 'inventory.json', 'json'));
    expect(fromJson.dimensions.map((d) => [d.id, d.values.map((value) => value.id)])).toEqual(
      result.dimensions.map((d) => [d.id, d.values.map((value) => value.id)]),
    );
    const quotes = new QuoteIndex(new Map([['inventory.json', json]]));
    for (const value of fromJson.dimensions.flatMap((d) => d.values)) {
      expect(quotes.contains('inventory.json', value.evidence.quote)).toBe(true);
    }
  });
});

describe('inventoryPrepass on small inventories', () => {
  it('takes the channels from the behaviours when the inventory lists none', () => {
    const text = `behaviours:
  - { id: B-001, title: Greets, channels: [chat] }
  - { id: B-002, title: Sends a card, channels: [web, chat] }
  - { id: B-003, title: Says goodbye }
flows: []
`;
    const result = ok(inventoryPrepass(text, 'inventory.yaml'));
    const channel = result.dimensions.find((d) => d.id === 'channel');
    expect(channel?.values.map((value) => [value.id, value.evidence.quote])).toEqual([
      ['chat', 'channels: [chat]'],
      ['web', 'channels: [web, chat]'],
    ]);
    expect(result.constraints.map((constraint) => constraint.forbid)).toEqual([
      { behaviour: 'B-001', channel: 'web' },
    ]);
    expect(result.notes).toEqual(['the inventory lists no flow', 'no flow requires a deviation class']);
  });

  it('proposes no channel dimension and says so when nothing names a channel', () => {
    const result = ok(
      inventoryPrepass('behaviours: [{ id: B-001, title: Greets }]\nflows: []\n', 'inv.yaml'),
    );
    expect(result.dimensions.map((d) => d.id)).toEqual(['behaviour']);
    expect(result.notes).toContain('the inventory names no channel, so no channel dimension');
  });

  it('refuses an invalid inventory with the core codes', () => {
    const result = inventoryPrepass(
      INVENTORY.replace('behaviours: [B-001]', 'behaviours: [B-009]'),
      'inv.yaml',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((issue) => issue.code)).toEqual(['INVENTORY_UNKNOWN_BEHAVIOUR']);
  });
});

describe('inventoryPrepass on an item whose title alone is over 1000 characters', () => {
  it('quotes a passage of the source within the limit', () => {
    const long = `${'a very long title '.repeat(80)}end`;
    const source = `behaviours:\n  - id: B-001\n    title: ${long}\nflows:\n  - id: f1\n    title: ${long}\n    behaviours: [B-001]\n`;
    const read = ok(inventoryPrepass(source, 'inventory.yaml'));
    for (const dim of read.dimensions) {
      for (const value of dim.values) {
        expect(value.evidence.quote.length).toBeLessThanOrEqual(1000);
        expect(source).toContain(value.evidence.quote);
      }
    }
  });
});

describe('an inventory kept as markdown tables or CSV', () => {
  const markdown = `# Behaviour inventory

Channels: web, phone

## Behaviours

| id | title | channels |
|---|---|---|
| B-001 | Greets the caller | web, phone |
| B-002 | Takes a booking | web |

## Flows

| id | title | behaviours | deviations |
|---|---|---|---|
| book | A booking | B-001, B-002 | D1_off_topic |
`;
  const csv = `section,id,title,channels,behaviours,deviations
channels,,,web phone,,
behaviour,B-001,"Greets the caller",web phone,,
behaviour,B-002,"Takes a booking",web,,
flow,book,"A booking",,B-001 B-002,D1_off_topic
`;
  for (const [name, source, path] of [
    ['markdown', markdown, 'inventory.md'],
    ['csv', csv, 'inventory.csv'],
  ] as const) {
    it(`reads ${name} into dimensions whose quotes are rows of the file`, () => {
      const table = tableInventory(source, name === 'csv' ? 'csv' : 'markdown');
      if (!table) throw new Error('no table');
      const read = requoted(inventoryPrepass(table.yaml, path, 'yaml'), table.requote);
      if (!read.ok) throw new Error(JSON.stringify(read.errors));
      const dims = Object.fromEntries(read.dimensions.map((d) => [d.id, d.values.map((v) => v.id)]));
      expect(dims.behaviour).toEqual(['B-001', 'B-002']);
      expect(dims.flow).toEqual(['book']);
      expect(dims.channel).toEqual(['web', 'phone']);
      for (const d of read.dimensions) for (const v of d.values) expect(source).toContain(v.evidence.quote);
    });
  }
});
