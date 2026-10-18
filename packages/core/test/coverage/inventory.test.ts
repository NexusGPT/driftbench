import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type InventoryResult, loadInventory, parseInventoryText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

const VALID = `
channels: [chat, whatsapp]
behaviours:
  - id: B-001
    title: Greets the customer once
  - id: B-002
    title: Sends the offer card once
    channels: [chat]
  - id: T-001
    title: Builds the usage sheet
    kind: task
flows:
  - id: plan-upgrade
    title: Plan upgrade
    behaviours: [B-001, B-002]
    deviations: [D1_off_topic, D8_tool_failure]
  - id: usage_report
    title: Usage report
    behaviours: [T-001]
`;

function ok(result: InventoryResult) {
  if (!result.ok)
    throw new Error(`expected a valid inventory, got ${JSON.stringify(result.errors, null, 2)}`);
  return result;
}

function codes(result: InventoryResult): string[] {
  if (result.ok) throw new Error('expected an invalid inventory');
  return result.errors.map((issue) => issue.code);
}

describe('parseInventoryText', () => {
  it('accepts a full inventory and defaults kind to conversation', () => {
    const { inventory } = ok(parseInventoryText(VALID, 'yaml'));
    expect(inventory.channels).toEqual(['chat', 'whatsapp']);
    expect(inventory.behaviours.map((behaviour) => behaviour.kind)).toEqual([
      'conversation',
      'conversation',
      'task',
    ]);
    expect(inventory.behaviours[0]?.channels).toBeUndefined();
    expect(inventory.flows[0]?.deviations).toEqual(['D1_off_topic', 'D8_tool_failure']);
    expect(inventory.flows[1]?.deviations).toBeUndefined();
  });

  it('reads JSON to the same inventory', () => {
    const fromYaml = ok(parseInventoryText(VALID, 'yaml'));
    const fromJson = ok(parseInventoryText(JSON.stringify(fromYaml.inventory), 'json'));
    expect(fromJson.inventory).toEqual(fromYaml.inventory);
  });

  it('accepts empty behaviour and flow lists and no channels', () => {
    const { inventory } = ok(parseInventoryText('behaviours: []\nflows: []\n', 'yaml'));
    expect(inventory).toEqual({ behaviours: [], flows: [] });
  });
});

const BASE = 'behaviours:\n  - { id: B-001, title: a }\n';

const INVALID: Array<{ name: string; text: string; code: string; path?: string; message?: string }> = [
  { name: 'YAML syntax', text: 'behaviours: [\n', code: 'INVENTORY_PARSE', path: '' },
  { name: 'empty file', text: '', code: 'INVENTORY_NOT_OBJECT', path: '' },
  { name: 'top level is a list', text: '- id: B-001\n', code: 'INVENTORY_NOT_OBJECT' },
  {
    name: 'missing flows',
    text: BASE,
    code: 'SCHEMA_INVALID_TYPE',
    path: 'flows',
    message: 'Invalid input: expected array, missing',
  },
  {
    name: 'unknown key',
    text: `${BASE}flows: []\nowner: someone\n`,
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: '',
    message: 'unknown key: owner',
  },
  {
    name: 'misspelt behaviour key',
    text: 'behaviours:\n  - { id: B-001, title: a, channel: [chat] }\nflows: []\n',
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: 'behaviours.0',
  },
  {
    name: 'behaviour id in the wrong shape',
    text: 'behaviours:\n  - { id: b1, title: a }\nflows: []\n',
    code: 'SCHEMA_INVALID_FORMAT',
    path: 'behaviours.0.id',
    message: 'expected an id such as B-001: capital letters, a hyphen, then digits',
  },
  {
    name: 'behaviour without a title',
    text: 'behaviours:\n  - { id: B-001 }\nflows: []\n',
    code: 'SCHEMA_INVALID_TYPE',
    path: 'behaviours.0.title',
  },
  {
    name: 'unknown kind',
    text: 'behaviours:\n  - { id: B-001, title: a, kind: code }\nflows: []\n',
    code: 'SCHEMA_INVALID_VALUE',
    path: 'behaviours.0.kind',
  },
  {
    name: 'empty channel list',
    text: 'behaviours:\n  - { id: B-001, title: a, channels: [] }\nflows: []\n',
    code: 'SCHEMA_TOO_SMALL',
    path: 'behaviours.0.channels',
    message: 'list at least one channel, or leave the key out',
  },
  {
    name: 'flow id that is not a slug',
    text: `${BASE}flows:\n  - { id: Plan Upgrade, title: p, behaviours: [B-001] }\n`,
    code: 'SCHEMA_INVALID_FORMAT',
    path: 'flows.0.id',
  },
  {
    name: 'unknown deviation class',
    text: `${BASE}flows:\n  - { id: p, title: p, behaviours: [B-001], deviations: [D11_chaos] }\n`,
    code: 'SCHEMA_INVALID_VALUE',
    path: 'flows.0.deviations.0',
  },
  {
    name: 'duplicate behaviour id',
    text: 'behaviours:\n  - { id: B-001, title: a }\n  - { id: B-001, title: b }\nflows: []\n',
    code: 'INVENTORY_DUPLICATE',
    path: 'behaviours.1.id',
    message: 'behaviour "B-001" is listed twice',
  },
  {
    name: 'duplicate flow id',
    text: `${BASE}flows:\n  - { id: p, title: p, behaviours: [] }\n  - { id: p, title: q, behaviours: [] }\n`,
    code: 'INVENTORY_DUPLICATE',
    path: 'flows.1.id',
  },
  {
    name: 'flow naming a behaviour the inventory lacks',
    text: `${BASE}flows:\n  - { id: p, title: p, behaviours: [B-001, B-002] }\n`,
    code: 'INVENTORY_UNKNOWN_BEHAVIOUR',
    path: 'flows.0.behaviours.1',
    message: 'behaviour "B-002" is not in the inventory\'s behaviours',
  },
  {
    name: 'behaviour channel outside the declared channels',
    text: 'channels: [chat]\nbehaviours:\n  - { id: B-001, title: a, channels: [chat, email] }\nflows: []\n',
    code: 'INVENTORY_UNKNOWN_CHANNEL',
    path: 'behaviours.0.channels.1',
    message: 'channel "email" is not in the inventory\'s channels (chat)',
  },
  {
    name: 'duplicate deviation class in a flow',
    text: `${BASE}flows:\n  - { id: p, title: p, behaviours: [B-001], deviations: [D1_off_topic, D1_off_topic] }\n`,
    code: 'INVENTORY_DUPLICATE',
    path: 'flows.0.deviations.1',
  },
  {
    name: 'duplicate declared channel',
    text: `channels: [chat, chat]\n${BASE}flows: []\n`,
    code: 'INVENTORY_DUPLICATE',
    path: 'channels.1',
  },
];

describe('invalid inventories are refused with a named error', () => {
  for (const { name, text, code, path, message } of INVALID) {
    it(name, () => {
      const result = parseInventoryText(text, 'yaml');
      expect(codes(result)).toContain(code);
      if (result.ok) return;
      const issue = result.errors.find((candidate) => candidate.code === code);
      if (path !== undefined) expect(issue?.path).toBe(path);
      if (message !== undefined) expect(issue?.message).toBe(message);
    });
  }

  it('reports every cross reference problem at once', () => {
    const result = parseInventoryText(
      `${BASE}  - { id: B-001, title: again }\nflows:\n  - { id: p, title: p, behaviours: [B-404, B-405] }\n`,
      'yaml',
    );
    expect(codes(result)).toEqual([
      'INVENTORY_DUPLICATE',
      'INVENTORY_UNKNOWN_BEHAVIOUR',
      'INVENTORY_UNKNOWN_BEHAVIOUR',
    ]);
  });
});

describe('loadInventory', () => {
  it('reads .json as JSON and any other file as YAML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-inventory-'));
    const inventory = { behaviours: [{ id: 'B-001', title: 'a' }], flows: [] };
    await writeFile(join(dir, 'inventory.json'), JSON.stringify(inventory));
    await writeFile(join(dir, 'inventory.yml'), 'behaviours:\n  - { id: B-001, title: a }\nflows: []\n');
    const fromJson = ok(await loadInventory(join(dir, 'inventory.json')));
    const fromYaml = ok(await loadInventory(join(dir, 'inventory.yml')));
    expect(fromJson.inventory).toEqual(fromYaml.inventory);
    expect(fromJson.path).toBe(join(dir, 'inventory.json'));
  });

  it('reports a missing file as an invalid inventory, not a crash', async () => {
    const result = await loadInventory('/definitely/not/here/inventory.yaml');
    expect(codes(result)).toEqual(['INVENTORY_PARSE']);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/^cannot read the file: /);
  });
});
