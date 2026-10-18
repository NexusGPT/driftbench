import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  type ChangeManifest,
  loadChangeManifest,
  loadSpecs,
  type RadiusReport,
  type RadiusSpec,
  radiusOf,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

/**
 * The planted fault test of the blast radius. Each scored Acme fault is a change the agent suffered. For
 * the manifest that names that change, every block the committed gate report marks red on the fault must
 * lie inside the radius: a full run of the suite finds nothing the radius left out. The sizes are pinned,
 * so a mapping that grows to the whole suite fails too. No agent runs and no model is called: the red
 * blocks come from `examples/acme/gated/gate-report.json`, which `driftbench gate` wrote from full runs
 * of every fault on every block.
 */

const ACME = fileURLToPath(new URL('../..', import.meta.url));

type GateBlock = {
  key: string;
  status: string;
  split?: string;
  faults?: Record<string, { outcome: string; changed: boolean }>;
};
type GateReport = {
  blocks: GateBlock[];
  mutation: { by_fault: { id: string; class: string; equivalent: boolean }[] };
};

const report = JSON.parse(await readFile(`${ACME}/gated/gate-report.json`, 'utf8')) as GateReport;
/** The blocks of the gated suite: accepted, and not sealed in the holdout. */
const suite = report.blocks.filter((block) => block.status === 'accepted' && block.split === 'dev');
const red = (fault: string) => suite.filter((block) => block.faults?.[fault]?.outcome === 'fail');

const loaded = await loadSpecs([`${ACME}/gated/specs`]);
const specs: RadiusSpec[] = loaded.flatMap((entry) =>
  entry.ok ? [{ spec: entry.spec, hash: entry.hash }] : [],
);

async function manifest(name: string): Promise<ChangeManifest> {
  const read = await loadChangeManifest(`${ACME}/radius/${name}.yaml`);
  if (!read.ok) throw new Error(`${name}.yaml: ${read.errors.join('; ')}`);
  return read.manifest;
}

function states(radius: RadiusReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of radius.specs) {
    for (const block of spec.blocks) out.set(`${spec.specId}#${block.id}`, block.state.F ?? 'out');
  }
  return out;
}

/** One row per scored fault: the manifest of the change, the red blocks, and the pinned radius in mode F. */
const FAULTS: {
  fault: string;
  manifest: string;
  red: number;
  /** Red blocks that are in only through the forward closure. */
  forwardOnly: number;
  direct: number;
  in: number;
  cells: number;
  sent: number;
}[] = [
  {
    fault: 'x3-skips-recap',
    manifest: 'stage-recap',
    red: 237,
    forwardOnly: 4,
    direct: 233,
    in: 298,
    cells: 102,
    sent: 601,
  },
  {
    fault: 'x5-drops-coverage-check',
    manifest: 'tool-coverage-check-input',
    red: 86,
    forwardOnly: 0,
    direct: 86,
    in: 316,
    cells: 86,
    sent: 413,
  },
  {
    fault: 'x1-invents-price',
    manifest: 'states-offer',
    red: 125,
    forwardOnly: 0,
    direct: 141,
    in: 555,
    cells: 125,
    sent: 692,
  },
  {
    fault: 'd4-order-on-loose-yes',
    manifest: 'confirmation-rule',
    red: 54,
    forwardOnly: 4,
    direct: 233,
    in: 298,
    cells: 102,
    sent: 601,
  },
  {
    fault: 'd2-ignores-goal-shift',
    manifest: 'deviation-goal-shift',
    red: 22,
    forwardOnly: 13,
    direct: 9,
    in: 22,
    cells: 9,
    sent: 55,
  },
  {
    fault: 'd6-obeys-instruction',
    manifest: 'deviation-instruction-in-data',
    red: 13,
    forwardOnly: 0,
    direct: 13,
    in: 44,
    cells: 13,
    sent: 68,
  },
  {
    fault: 'd8-hides-tool-failure',
    manifest: 'deviation-tool-failure',
    red: 15,
    forwardOnly: 0,
    direct: 15,
    in: 15,
    cells: 15,
    sent: 44,
  },
  {
    fault: 'd9-answers-out-of-scope',
    manifest: 'deviation-out-of-scope',
    red: 11,
    forwardOnly: 0,
    direct: 11,
    in: 38,
    cells: 13,
    sent: 70,
  },
  {
    fault: 'ops-x1-wrong-price',
    manifest: 'price-sheet-family',
    red: 33,
    forwardOnly: 0,
    direct: 35,
    in: 35,
    cells: 24,
    sent: 35,
  },
  {
    fault: 'ops-x4-narrates',
    manifest: 'price-sheet-family',
    red: 35,
    forwardOnly: 0,
    direct: 35,
    in: 35,
    cells: 24,
    sent: 35,
  },
  {
    fault: 'ops-x5-skips-check',
    manifest: 'price-sheet-family',
    red: 35,
    forwardOnly: 0,
    direct: 35,
    in: 35,
    cells: 24,
    sent: 35,
  },
  {
    fault: 'ops-d6-deletes-readme',
    manifest: 'price-sheet-family',
    red: 16,
    forwardOnly: 0,
    direct: 35,
    in: 35,
    cells: 24,
    sent: 35,
  },
];
/** The change whose radius is the whole suite by rule, and the fault it stands for. */
const WHOLE = { fault: 'x4-wrong-language', manifest: 'reply-language', red: 826 };
/** A fault no block of this suite can see: its radius has nothing to contain. */
const EQUIVALENT = { fault: 'x2-keeps-first-email', manifest: 'tool-catalog-search-input' };

describe('the gated Acme suite', () => {
  it('is the suite the report describes: 195 specs, 861 scored blocks', () => {
    expect(specs).toHaveLength(195);
    expect(suite).toHaveLength(861);
    const radius = radiusOf(specs, { from: 'acme-v1', to: 'acme-v1', changes: [] });
    expect(radius.totals.F).toMatchObject({ total: 861, in: 0, cells: { in: 0, total: 195 } });
  });

  it('has a manifest for every scored fault of the gate report', () => {
    const scored = report.mutation.by_fault
      .filter((fault) => fault.class !== 'control')
      .map((fault) => fault.id);
    const covered = [...FAULTS.map((row) => row.fault), WHOLE.fault, EQUIVALENT.fault];
    expect([...scored].sort()).toEqual([...covered].sort());
  });
});

describe('a planted fault is caught inside the radius of its change', () => {
  it.each(FAULTS)('$fault: every red block is in the radius of $manifest', async (row) => {
    const radius = radiusOf(specs, await manifest(row.manifest), { modes: ['F'] });
    const state = states(radius);
    const failing = red(row.fault);
    expect(failing).toHaveLength(row.red);
    // No false safe: the full suite finds no red block the radius left out.
    const missed = failing.filter((block) => (state.get(block.key) ?? 'out') === 'out');
    expect(missed.map((block) => block.key)).toEqual([]);
    // The forward closure is needed: these red blocks only follow a direct block in their conversation.
    expect(failing.filter((block) => state.get(block.key) === 'forward')).toHaveLength(row.forwardOnly);
    // The radius is smaller than the suite, at the pinned size.
    expect(radius.whole).toBeNull();
    const count = radius.totals.F;
    expect(count).toMatchObject({
      total: 861,
      direct: row.direct,
      in: row.in,
      cells: { in: row.cells, total: 195 },
      sent: row.sent,
    });
    expect(row.sent).toBeLessThan(861);
  });

  it('x4-wrong-language: the reply language rule is the whole suite, which holds all 826 red blocks', async () => {
    const radius = radiusOf(specs, await manifest(WHOLE.manifest), { modes: ['F'] });
    expect(radius.whole).toEqual({
      change: 'rule:reply_language',
      reason: 'the reply language rule holds on every block',
    });
    expect(red(WHOLE.fault)).toHaveLength(WHOLE.red);
    expect(radius.totals.F).toMatchObject({ in: 861, total: 861, sent: 861, cells: { in: 195, total: 195 } });
  });

  it('x2-keeps-first-email: no block of this suite is red, so there is nothing to contain', async () => {
    const radius = radiusOf(specs, await manifest(EQUIVALENT.manifest), { modes: ['F'] });
    expect(red(EQUIVALENT.fault)).toHaveLength(0);
    expect(radius.whole).toBeNull();
    expect(radius.totals.F?.in).toBe(572);
  });
});

describe('the test can fail', () => {
  it('a manifest that leaves out part of the change misses red blocks', async () => {
    // The loose confirmation fault, declared as a change to the D4 handler alone: the recap is left out.
    const radius = radiusOf(
      specs,
      { from: 'acme-v1', to: 'acme-v2', changes: [{ kind: 'deviation', id: 'D4' }] },
      { modes: ['F'] },
    );
    const state = states(radius);
    const missed = red('d4-order-on-loose-yes').filter((block) => (state.get(block.key) ?? 'out') === 'out');
    expect(missed.length).toBeGreaterThan(0);
  });

  it('without the forward closure, the recap change would miss 4 red blocks and the D2 change 13', async () => {
    for (const [name, fault, lost] of [
      ['stage-recap', 'x3-skips-recap', 4],
      ['deviation-goal-shift', 'd2-ignores-goal-shift', 13],
    ] as const) {
      const state = states(radiusOf(specs, await manifest(name), { modes: ['F'] }));
      expect(red(fault).filter((block) => state.get(block.key) !== 'direct')).toHaveLength(lost);
    }
  });
});

describe('unknown means in', () => {
  it('a tool with no part reads every block that lists it, count 0 included', async () => {
    const wide = radiusOf(specs, await manifest('tool-coverage-check'), { modes: ['F'] });
    const narrow = radiusOf(specs, await manifest('tool-coverage-check-input'), { modes: ['F'] });
    expect(wide.totals.F).toMatchObject({ direct: 810, in: 810, cells: { in: 168, total: 195 } });
    expect(narrow.totals.F?.direct).toBe(86);
  });

  it('a change no block declares is the whole suite: a new tool, a model', async () => {
    const tool = radiusOf(specs, await manifest('new-tool'), { modes: ['F'] });
    expect(tool.whole).toEqual({
      change: 'tool:loyalty.lookup',
      reason: 'no block declares a dependency on it',
    });
    expect(tool.totals.F?.in).toBe(861);
    const model = radiusOf(specs, await manifest('model'), { modes: ['F'] });
    expect(model.whole?.change).toBe('model');
    expect(model.totals.F?.cells.in).toBe(195);
  });

  it('a hand-written spec declares no dependency beyond its Then, so every block of it is in every radius', async () => {
    const hand = (await loadSpecs([`${ACME}/specs/conversations`])).flatMap((entry) =>
      entry.ok ? [{ spec: entry.spec, hash: entry.hash }] : [],
    );
    const radius = radiusOf(hand, await manifest('tool-coverage-check-input'), { modes: ['F'] });
    const count = radius.totals.F;
    expect(radius.whole).toBeNull();
    expect(count?.unknown).toBe(count?.total);
    expect(count?.in).toBe(count?.total);
    expect(count?.cells.in).toBe(hand.length);
    const reasons = new Set(radius.specs.flatMap((spec) => spec.blocks.flatMap((block) => block.why)));
    expect(reasons.has('unknown-deps')).toBe(true);
    expect(reasons.has('tool:coverage.check:input')).toBe(true);
  });
});

describe('mode T', () => {
  it('a block runs alone from its canonical Given: no forward closure on a conversation', async () => {
    const radius = radiusOf(specs, await manifest('tool-coverage-check-input'), { modes: ['T'] });
    expect(radius.totals.T).toMatchObject({ direct: 86, forward: 0, in: 86, total: 861 });
  });

  it('a task step keeps the workspace of the step before, so the closure holds in a sandbox', () => {
    const task = specs.find((entry) => entry.spec.kind === 'task' && entry.spec.blocks.length > 1);
    if (!task) throw new Error('no task spec with two steps');
    const first = task.spec.blocks[0];
    if (!first) throw new Error('no first step');
    // A change only the first step names: the literal of its own instruction.
    const text = 'user' in first.when ? first.when.user : '';
    const radius = radiusOf(
      [task],
      { from: 'a', to: 'b', changes: [{ kind: 'fixture', id: text }] },
      { modes: ['T'] },
    );
    expect(radius.specs[0]?.blocks.map((block) => block.state.T)).toEqual(['direct', 'forward']);
    const noSandbox = radiusOf(
      [task],
      { from: 'a', to: 'b', changes: [{ kind: 'fixture', id: text }] },
      { modes: ['T'], sandbox: () => false },
    );
    expect(noSandbox.specs[0]?.blocks.map((block) => block.state.T)).toEqual(['direct', 'out']);
  });
});
