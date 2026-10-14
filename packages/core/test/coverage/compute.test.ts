import { fileURLToPath } from 'node:url';
import {
  type CoverageResult,
  channelUniverse,
  computeCoverage,
  type Inventory,
  type LoadResult,
  loadInventory,
  loadSpecs,
  validateInventory,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

function inventory(raw: unknown): Inventory {
  const result = validateInventory(raw);
  if (!result.ok)
    throw new Error(`expected a valid inventory, got ${JSON.stringify(result.errors, null, 2)}`);
  return result.inventory;
}

/** A valid spec with one block; the fields given replace or add to it. */
function spec(fields: Record<string, unknown>): LoadResult {
  const result = validateSpec(
    { blocks: [{ user: 'hi', expect: { must: ['hello'] } }], ...fields },
    `specs/${String(fields.id)}.yaml`,
  );
  if (!result.ok) throw new Error(`expected a valid spec, got ${JSON.stringify(result.errors, null, 2)}`);
  return result;
}

const perturbed = (id: string, cls: string) => ({ id, class: cls, inject_at: 0, user: 'a deviation' });

/** Behaviour statuses by channel, for short assertions: { 'B-001': { chat: 'covered', ... } }. */
function grid(result: CoverageResult): Record<string, Record<string, string>> {
  return Object.fromEntries(
    result.behaviours.map((behaviour) => [
      behaviour.id,
      Object.fromEntries(behaviour.cells.map((cell) => [cell.channel, cell.status])),
    ]),
  );
}

const TWO_CHANNELS = inventory({
  channels: ['chat', 'whatsapp'],
  behaviours: [
    { id: 'B-001', title: 'Greets once' },
    { id: 'B-002', title: 'Sends the offer card once', channels: ['chat'] },
  ],
  flows: [],
});

describe('behaviour x channel cells', () => {
  it('preserves first-seen spec order and deduplicates ids after channel selection', () => {
    const result = computeCoverage(
      [
        spec({ id: 'z', channel: 'whatsapp', covers: ['B-001'] }),
        spec({ id: 'same', channel: 'chat', covers: ['B-001', 'B-002'] }),
        spec({ id: 'a', covers: ['B-001'] }),
        spec({ id: 'same', channel: 'whatsapp', covers: ['B-001'] }),
        spec({ id: 'last', channel: 'chat', covers: ['B-001'] }),
      ],
      TWO_CHANNELS,
    );
    expect(result.behaviours[0]?.cells.map((cell) => cell.specs)).toEqual([
      ['same', 'a', 'last'],
      ['z', 'a', 'same'],
    ]);
    expect(result.behaviours[1]?.cells.map((cell) => cell.specs)).toEqual([['same'], []]);
  });

  it('is covered on a channel when a valid spec on that channel lists the behaviour, else missing', () => {
    const result = computeCoverage([spec({ id: 'a', channel: 'chat', covers: ['B-001'] })], TWO_CHANNELS);
    expect(grid(result)['B-001']).toEqual({ chat: 'covered', whatsapp: 'missing' });
    expect(result.behaviours[0]?.cells[0]?.specs).toEqual(['a']);
    expect(result.behaviours[0]?.status).toBe('missing');
    expect(result.ok).toBe(false);
  });

  it('counts a spec with no channel for every channel', () => {
    const result = computeCoverage([spec({ id: 'a', covers: ['B-001', 'B-002'] })], TWO_CHANNELS);
    expect(grid(result)).toEqual({
      'B-001': { chat: 'covered', whatsapp: 'covered' },
      'B-002': { chat: 'covered', whatsapp: 'n/a' },
    });
    expect(result.ok).toBe(true);
  });

  it('is n/a where the behaviour does not apply, and n/a never counts as missing', () => {
    const result = computeCoverage(
      [spec({ id: 'a', channel: 'chat', covers: ['B-002'] }), spec({ id: 'b', covers: ['B-001'] })],
      TWO_CHANNELS,
    );
    expect(grid(result)['B-002']).toEqual({ chat: 'covered', whatsapp: 'n/a' });
    expect(result.behaviours[1]?.status).toBe('covered');
    expect(result.perChannel).toEqual([
      { channel: 'chat', applicable: 2, covered: 2, missing: 0 },
      { channel: 'whatsapp', applicable: 1, covered: 1, missing: 0 },
    ]);
    expect(result.summary.behaviours).toEqual({ covered: 2, total: 2 });
    expect(result.ok).toBe(true);
  });

  it('does not count a spec on another channel', () => {
    const result = computeCoverage([spec({ id: 'a', channel: 'whatsapp', covers: ['B-002'] })], TWO_CHANNELS);
    expect(grid(result)['B-002']).toEqual({ chat: 'missing', whatsapp: 'n/a' });
  });

  it('reports a spec covering an id absent from the inventory as a warning, never a failure', () => {
    const result = computeCoverage(
      [spec({ id: 'a', covers: ['B-001', 'B-002', 'B-999'] }), spec({ id: 'b', covers: ['B-999'] })],
      TWO_CHANNELS,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'UNKNOWN_BEHAVIOUR',
        subject: 'B-999',
        specs: ['a', 'b'],
        message: 'covered by a, b, but the inventory has no behaviour B-999',
      },
    ]);
    expect(result.behaviours.map((behaviour) => behaviour.id)).toEqual(['B-001', 'B-002']);
  });

  it('lists an invalid spec with its first error and never counts it', () => {
    const invalid = validateSpec(
      {
        id: 'broken',
        covers: ['B-001'],
        blocks: [{ expect: { must: ['a'] } }, { user: 'hi', when: { user: 'hi' } }],
      },
      'specs/broken.yaml',
    );
    if (invalid.ok) throw new Error('expected an invalid spec');
    expect(invalid.errors.map((issue) => issue.code)).toEqual([
      'BLOCK_STIMULUS_MISSING',
      'BLOCK_STIMULUS_AMBIGUOUS',
    ]);
    const result = computeCoverage([invalid], TWO_CHANNELS);
    expect(grid(result)['B-001']).toEqual({ chat: 'missing', whatsapp: 'missing' });
    expect(result.invalidSpecs).toHaveLength(1);
    expect(result.invalidSpecs[0]?.path).toBe('specs/broken.yaml');
    expect(result.invalidSpecs[0]?.error).toMatchObject({ code: 'BLOCK_STIMULUS_MISSING', path: 'blocks.0' });
  });
});

describe('task behaviours', () => {
  const MIXED = inventory({
    behaviours: [
      { id: 'B-001', title: 'Greets once' },
      { id: 'T-001', title: 'Builds the usage sheet', kind: 'task' },
    ],
    flows: [],
  });

  it('are ordinary rows of the same matrix', () => {
    const task = spec({
      id: 'sheet',
      kind: 'task',
      covers: ['T-001'],
      blocks: [{ user: 'build it', expect: { workspace: { created: ['usage.xlsx'] } } }],
    });
    const result = computeCoverage([task, spec({ id: 'chat', covers: ['B-001'] })], MIXED);
    expect(result.behaviours.map((behaviour) => [behaviour.id, behaviour.kind, behaviour.status])).toEqual([
      ['B-001', 'conversation', 'covered'],
      ['T-001', 'task', 'covered'],
    ]);
    expect(result.summary.behaviours).toEqual({ covered: 2, total: 2 });
    expect(result.warnings).toEqual([]);
  });

  it('warn, without failing, when only conversation specs cover a task behaviour', () => {
    const result = computeCoverage([spec({ id: 'chat', covers: ['B-001', 'T-001'] })], MIXED);
    expect(result.behaviours[1]?.status).toBe('covered');
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'KIND_MISMATCH',
        subject: 'T-001',
        specs: ['chat'],
        message: 'a task behaviour, covered only by conversation specs: chat',
      },
    ]);
  });
});

describe('flow x deviation cells', () => {
  const FLOWS = inventory({
    behaviours: [
      { id: 'B-001', title: 'Greets once' },
      { id: 'B-002', title: 'Confirms before submitting' },
      { id: 'B-003', title: 'Routes billing questions to care' },
    ],
    flows: [
      {
        id: 'upgrade',
        title: 'Plan upgrade',
        behaviours: ['B-001', 'B-002'],
        deviations: ['D1_off_topic', 'D4_loose_confirmation'],
      },
      { id: 'care', title: 'Care routing', behaviours: ['B-003'] },
    ],
  });
  const everything = spec({ id: 'all', covers: ['B-001', 'B-002', 'B-003'] });

  it('counts a spec in a flow when it covers one of the flow behaviours', () => {
    const result = computeCoverage(
      [everything, spec({ id: 'p', covers: ['B-002'], perturbations: [perturbed('x', 'D1_off_topic')] })],
      FLOWS,
    );
    const upgrade = result.flows[0];
    expect(upgrade?.specs).toEqual(['all', 'p']);
    expect(upgrade?.cells).toEqual([
      {
        deviation: 'D1_off_topic',
        status: 'covered',
        specs: ['p'],
        sources: [{ spec: 'p', source: 'perturbation', path: 'perturbations.0' }],
      },
      { deviation: 'D4_loose_confirmation', status: 'missing', specs: [], sources: [] },
    ]);
    expect(upgrade?.status).toBe('missing');
  });

  it('counts a spec in a flow when it carries the tag flow:<id>, even without covering a behaviour', () => {
    const tagged = spec({
      id: 't',
      tags: ['smoke', 'flow:upgrade'],
      perturbations: [perturbed('x', 'D1_off_topic'), perturbed('y', 'D4_loose_confirmation')],
    });
    const result = computeCoverage([everything, tagged], FLOWS);
    expect(result.flows[0]?.status).toBe('covered');
    expect(result.flows[0]?.cells.map((cell) => cell.specs)).toEqual([['t'], ['t']]);
    expect(result.summary.deviations).toEqual({ covered: 2, total: 2 });
    expect(result.ok).toBe(true);
  });

  it('ignores the perturbations of a spec outside the flow', () => {
    const outside = spec({
      id: 'o',
      covers: ['B-003'],
      tags: ['flow:care'],
      perturbations: [perturbed('x', 'D1_off_topic')],
    });
    const result = computeCoverage([everything, outside], FLOWS);
    expect(result.flows[0]?.cells[0]?.status).toBe('missing');
    expect(result.flows[1]?.specs).toEqual(['all', 'o']);
  });

  it('counts a block whose stimulus is an injection like a perturbation, and names each source', () => {
    const injected = spec({
      id: 'i',
      covers: ['B-001'],
      blocks: [
        { user: 'hi', expect: { must: ['hello'] } },
        {
          when: { injection: { class: 'D4_loose_confirmation', user: 'ok perfect' } },
          expect: { must: ['confirm'] },
        },
      ],
      perturbations: [perturbed('x', 'D1_off_topic'), perturbed('y', 'D4_loose_confirmation')],
    });
    const result = computeCoverage([injected], FLOWS);
    expect(result.flows[0]?.cells).toEqual([
      {
        deviation: 'D1_off_topic',
        status: 'covered',
        specs: ['i'],
        sources: [{ spec: 'i', source: 'perturbation', path: 'perturbations.0' }],
      },
      {
        deviation: 'D4_loose_confirmation',
        status: 'covered',
        specs: ['i'],
        sources: [
          { spec: 'i', source: 'injection', path: 'blocks.1' },
          { spec: 'i', source: 'perturbation', path: 'perturbations.1' },
        ],
      },
    ]);
  });

  it('covers a cell with an injection block alone', () => {
    const injected = spec({
      id: 'j',
      tags: ['flow:upgrade'],
      blocks: [
        {
          when: { injection: { class: 'D1_off_topic', user: 'is the shop open?' } },
          expect: { must: ['open'] },
        },
      ],
    });
    const result = computeCoverage([everything, injected], FLOWS);
    expect(result.flows[0]?.cells[0]).toEqual({
      deviation: 'D1_off_topic',
      status: 'covered',
      specs: ['j'],
      sources: [{ spec: 'j', source: 'injection', path: 'blocks.0' }],
    });
    expect(result.flows[0]?.cells[1]?.status).toBe('missing');
  });

  it('ignores an injection of another class, or in a spec outside the flow', () => {
    const otherClass = spec({
      id: 'k',
      tags: ['flow:upgrade'],
      blocks: [
        { when: { injection: { class: 'D9_out_of_scope', user: 'refund me' } }, expect: { must: ['care'] } },
      ],
    });
    const outside = spec({
      id: 'o',
      covers: ['B-003'],
      blocks: [{ when: { injection: { class: 'D1_off_topic', user: 'hey' } }, expect: { must: ['a'] } }],
    });
    const result = computeCoverage([everything, otherClass, outside], FLOWS);
    expect(result.flows[0]?.cells.map((cell) => [cell.status, cell.sources])).toEqual([
      ['missing', []],
      ['missing', []],
    ]);
  });

  it('fails when a required deviation is missing, even with every behaviour covered', () => {
    const result = computeCoverage([everything], FLOWS);
    expect(result.summary.behaviours).toEqual({ covered: 3, total: 3 });
    expect(result.summary.deviations).toEqual({ covered: 0, total: 2 });
    expect(result.ok).toBe(false);
  });

  it('marks a flow that requires no deviation n/a, and it never fails', () => {
    const result = computeCoverage([everything], FLOWS);
    expect(result.flows[1]).toMatchObject({ id: 'care', status: 'n/a', cells: [] });
  });

  it('never counts the perturbations of an invalid spec', () => {
    const invalid = validateSpec(
      {
        id: 'bad',
        tags: ['flow:upgrade'],
        blocks: [{ user: 'hi' }],
        perturbations: [{ id: 'x', class: 'D1_off_topic', inject_at: 9, user: 'hey' }],
      },
      'specs/bad.yaml',
    );
    expect(invalid.ok).toBe(false);
    const result = computeCoverage([everything, invalid], FLOWS);
    expect(result.flows[0]?.cells[0]?.status).toBe('missing');
    expect(result.flows[0]?.specs).toEqual(['all']);
    expect(result.invalidSpecs[0]?.error.code).toBe('PERTURBATION_OUT_OF_RANGE');
  });

  it('warns about a flow tag that names no flow', () => {
    const result = computeCoverage([everything, spec({ id: 't', tags: ['flow:upgrdae'] })], FLOWS);
    expect(result.warnings).toEqual([
      {
        code: 'UNKNOWN_FLOW',
        subject: 'upgrdae',
        specs: ['t'],
        message: 'tagged flow:upgrdae on t, but the inventory has no flow upgrdae',
      },
    ]);
  });
});

describe('the channel filter', () => {
  const FILTERED = inventory({
    channels: ['chat', 'whatsapp'],
    behaviours: [
      { id: 'B-001', title: 'Greets once' },
      { id: 'B-002', title: 'Sends the offer card once', channels: ['chat'] },
    ],
    flows: [{ id: 'greet', title: 'Greeting', behaviours: ['B-001'], deviations: ['D1_off_topic'] }],
  });
  const specs = [
    spec({
      id: 'chat',
      channel: 'chat',
      covers: ['B-001', 'B-002'],
      perturbations: [perturbed('x', 'D1_off_topic')],
    }),
    spec({ id: 'wa', channel: 'whatsapp', covers: ['B-001'] }),
  ];

  it('limits the matrix to one channel and counts only specs on it or on no channel', () => {
    const result = computeCoverage(specs, FILTERED, { channel: 'whatsapp' });
    expect(result.channels).toEqual(['whatsapp']);
    expect(grid(result)).toEqual({ 'B-001': { whatsapp: 'covered' }, 'B-002': { whatsapp: 'n/a' } });
    expect(result.summary.behaviours).toEqual({ covered: 1, total: 1 });
    expect(result.flows[0]?.specs).toEqual(['wa']);
    expect(result.flows[0]?.cells[0]?.status).toBe('missing');
    expect(result.ok).toBe(false);
  });

  it('gives the full picture without the filter', () => {
    const result = computeCoverage(specs, FILTERED);
    expect(result.channels).toEqual(['chat', 'whatsapp']);
    expect(result.flows[0]?.cells[0]).toEqual({
      deviation: 'D1_off_topic',
      status: 'covered',
      specs: ['chat'],
      sources: [{ spec: 'chat', source: 'perturbation', path: 'perturbations.0' }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('the channel universe', () => {
  const OPEN = inventory({
    behaviours: [
      { id: 'B-001', title: 'Greets once' },
      { id: 'B-002', title: 'Sends the offer card once', channels: ['web'] },
      { id: 'B-003', title: 'Opens the app tutorial', channels: ['app'] },
    ],
    flows: [],
  });

  it('keeps the inventory channels, in their order, when declared', () => {
    const declared = inventory({ channels: ['whatsapp', 'chat'], behaviours: [], flows: [] });
    expect(channelUniverse([spec({ id: 'a', channel: 'email' })], declared)).toEqual(['whatsapp', 'chat']);
  });

  it('is the sorted union of behaviour and valid spec channels when not declared', () => {
    const invalid = validateSpec({ id: 'bad', channel: 'fax', blocks: [] }, 'specs/bad.yaml');
    // First seen order is web, app, chat: the result must be sorted, not first seen or reversed.
    expect(channelUniverse([spec({ id: 'a', channel: 'chat' }), invalid], OPEN)).toEqual([
      'app',
      'chat',
      'web',
    ]);
  });

  it('is default when nothing names a channel', () => {
    const plain = inventory({ behaviours: [{ id: 'B-001', title: 'Greets once' }], flows: [] });
    const result = computeCoverage([spec({ id: 'a', covers: ['B-001'] })], plain);
    expect(result.channels).toEqual(['default']);
    expect(grid(result)).toEqual({ 'B-001': { default: 'covered' } });
  });

  it('warns about a spec on a channel the inventory does not list, and never counts it', () => {
    const declared = inventory({
      channels: ['chat'],
      behaviours: [{ id: 'B-001', title: 'Greets once' }],
      flows: [{ id: 'greet', title: 'Greeting', behaviours: ['B-001'], deviations: ['D1_off_topic'] }],
    });
    const stray = spec({
      id: 'mail',
      channel: 'email',
      covers: ['B-001'],
      perturbations: [perturbed('x', 'D1_off_topic')],
    });
    const result = computeCoverage([stray], declared);
    expect(grid(result)).toEqual({ 'B-001': { chat: 'missing' } });
    expect(result.flows[0]?.specs).toEqual([]);
    expect(result.warnings.map((warning) => [warning.code, warning.subject, warning.specs])).toEqual([
      ['UNLISTED_CHANNEL', 'email', ['mail']],
    ]);
  });
});

describe('the synthetic inventory under test/coverage/fixtures', () => {
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

  it('gives the expected matrices, warnings and verdict', async () => {
    const loaded = await loadInventory(`${fixtures}inventory.yaml`);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const specs = await loadSpecs([`${fixtures}specs`]);
    const result = computeCoverage(specs, loaded.inventory);

    expect(result.channels).toEqual(['chat', 'whatsapp']);
    expect(grid(result)).toEqual({
      'B-001': { chat: 'covered', whatsapp: 'covered' },
      'B-002': { chat: 'covered', whatsapp: 'covered' },
      'B-003': { chat: 'covered', whatsapp: 'n/a' },
      'B-004': { chat: 'covered', whatsapp: 'missing' },
      'T-001': { chat: 'covered', whatsapp: 'covered' },
    });
    expect(result.behaviours.find((behaviour) => behaviour.id === 'T-001')?.kind).toBe('task');
    expect(result.perChannel).toEqual([
      { channel: 'chat', applicable: 5, covered: 5, missing: 0 },
      { channel: 'whatsapp', applicable: 4, covered: 3, missing: 1 },
    ]);
    expect(result.flows.map((flow) => [flow.id, flow.status, flow.specs])).toEqual([
      ['plan-upgrade', 'covered', ['upgrade-chat', 'upgrade-whatsapp']],
      ['usage-report', 'missing', ['usage-report']],
      ['offer-card', 'n/a', ['upgrade-chat']],
    ]);
    expect(result.flows[0]?.cells.map((cell) => [cell.deviation, cell.specs])).toEqual([
      ['D1_off_topic', ['upgrade-chat']],
      ['D4_loose_confirmation', ['upgrade-whatsapp']],
    ]);
    // The task spec exercises D2 through an injection block; nothing exercises D8.
    expect(result.flows[1]?.cells).toEqual([
      {
        deviation: 'D2_goal_shift',
        status: 'covered',
        specs: ['usage-report'],
        sources: [{ spec: 'usage-report', source: 'injection', path: 'blocks.1' }],
      },
      { deviation: 'D8_tool_failure', status: 'missing', specs: [], sources: [] },
    ]);
    expect(result.warnings.map((warning) => [warning.code, warning.subject])).toEqual([
      ['UNKNOWN_BEHAVIOUR', 'B-099'],
    ]);
    expect(
      result.invalidSpecs.map((invalid) => [invalid.path.slice(fixtures.length), invalid.error.code]),
    ).toEqual([['specs/broken.yaml', 'BLOCK_STIMULUS_MISSING']]);
    expect(result.summary).toEqual({
      behaviours: { covered: 4, total: 5 },
      deviations: { covered: 3, total: 4 },
    });
    expect(result.ok).toBe(false);
  });
});
