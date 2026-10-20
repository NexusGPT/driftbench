import { resolve } from 'node:path';
import { loadSpecFile, type RunResult, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { classes } from '../../src/index';
import { FakeModelPort } from '../../src/model';
import { LABELLERS, plantedAudit } from '../fixtures/classes/planted/load';

const DIR = resolve(import.meta.dirname, '../../../../examples/acme/classes');
const PLANTED = resolve(import.meta.dirname, '../fixtures/classes/planted');

async function example() {
  const loaded = await classes.loadClassFile(resolve(DIR, 'order-fiber-address.yaml'));
  if (!loaded.ok) throw new Error('example class');
  const set = await classes.readSet(resolve(DIR, 'order-fiber-address.set.json'));
  return { cls: loaded.class, set };
}

describe('the frozen realisation set', () => {
  it('replays the recorded realise run to the committed set, hash for hash', async () => {
    const { cls, set } = await example();
    const cassette = await classes.readCassette(resolve(DIR, 'order-fiber-address.cassette.jsonl.gz'));
    const realiser = cassette.port({ family: 'openai', model: 'gpt-6-luna' });
    const judge = cassette.port({ family: 'anthropic', model: 'claude-haiku-5-5' });
    const { set: replayed } = await classes.realiseClass(cls, { realiser, models: { judge }, rows: 56 });
    expect(replayed).toEqual(set);
    expect(cassette.live).toBe(0);
  });

  it('meets the bar of the plan: post-gate 2-way coverage at least 0.95, and only approved spellings', async () => {
    const { cls, set } = await example();
    expect(classes.verifySet(set, cls)).toEqual({ ok: true });
    expect(set.gate.coverage.share).toBeGreaterThanOrEqual(0.95);
    expect(set.items.length).toBeGreaterThanOrEqual(50);
    for (const item of set.items) {
      expect(item.text.includes('gigabit'), item.id).toBe(false);
      expect(
        classes.deterministicStages(cls, item.text, item.cell).every((s) => s.ok),
        item.id,
      ).toBe(true);
    }
  });

  it('refuses an edited item, an edited set hash and a class file changed since the freeze', async () => {
    const { cls, set } = await example();
    const edited = structuredClone(set);
    (edited.items[0] as classes.SetItem).text += ' Thanks.';
    expect(classes.verifySet(edited, cls)).toMatchObject({ ok: false });
    const check = classes.verifySet(edited, cls);
    expect(check.ok ? [] : check.errors).toContain(
      'item r001 changed after the set was frozen: its text no longer matches its sha',
    );
    const rehashed = { ...structuredClone(set), set: '000000000000' };
    expect(classes.verifySet(rehashed, cls).ok).toBe(false);
    const approved = classes.validateClass({
      ...cls,
      slots: cls.slots.map((slot) => ({
        ...slot,
        surface_forms: slot.surface_forms.map((f) => ({ ...f, approved: true })),
      })),
    });
    if (!approved.ok) throw new Error('approved');
    const after = classes.verifySet(set, approved.class);
    expect(after.ok ? '' : after.errors[0]).toMatch(/^the class file changed since the set was frozen/);
  });

  it('expands a classed block into one spec per realisation, each its own spec hash, and refuses a stale set', async () => {
    const { cls, set } = await example();
    const loaded = await loadSpecFile(resolve(DIR, 'specs/order-loose-confirmation.yaml'));
    if (!loaded.ok) throw new Error('spec');
    const sets = new Map([[cls.id, { set, class: cls }]]);
    const expansion = classes.expandClassSpec(loaded.spec, sets);
    if (!expansion.ok) throw new Error(expansion.errors.join('\n'));
    expect(expansion.specs).toHaveLength(set.items.length);
    const first = expansion.specs[0] as Spec;
    expect(first.id).toBe('acme-order-loose-confirmation-class.c0.r001');
    expect(first.blocks[0]?.when).toEqual({ user: set.items[0]?.text });
    expect(classes.classVariantOf(first)).toMatchObject({ id: cls.id, set: set.set, block: 0, item: 'r001' });
    // The other blocks are untouched.
    expect(first.blocks.slice(1)).toEqual(loaded.spec.blocks.slice(1));
    const stale = classes.expandClassSpec(
      loaded.spec,
      new Map([[cls.id, { set: { ...set, set: 'ffffffffffff' }, class: cls }]]),
    );
    expect(stale.ok ? [] : stale.errors[0]).toMatch(
      /names set 2c9ce562b65c of class acme\.order\.fiber-address, the set file holds ffffffffffff/,
    );
  });
});

describe('the envelope report', () => {
  const items: classes.EnvelopeItem[] = [
    { item: 'r1', cell: 'slot_surface=s0|register=formal', outcomes: [1, 1, 1, 1] },
    { item: 'r2', cell: 'slot_surface=s0|register=casual', outcomes: [1, 1, 1, 0] },
    { item: 'r3', cell: 'slot_surface=s1|register=formal', outcomes: [0, 0, 0, 0] },
    { item: 'r4', cell: 'slot_surface=s1|register=casual', outcomes: [0, 0, 1, 0] },
  ];

  it('reports per-cell rates, MinP, the phrasing share and a clustered interval wider than the naive one', () => {
    const e = classes.envelope(items);
    expect(e).toMatchObject({ n: 4, runs: 16, passes: 8, rate: 0.5, minP: 0 });
    expect(e.cells[0]?.cell).toBe('slot_surface=s1|register=formal');
    expect(e.phrasingShare).toBeGreaterThan(0.5);
    expect(e.designEffect).toBeGreaterThan(1);
    const naive = 1.96 * Math.sqrt((0.5 * 0.5) / 16);
    expect(e.interval.upper - e.interval.lower).toBeGreaterThan(2 * naive);
    expect(e.byValue[0]).toMatchObject({ value: 'slot_surface=s1', rate: 0.125 });
    expect(e.suspects.map((x) => x.tuple)).toContain('slot_surface=s1');
    // slot_surface=s0 alone is held by r1, which passed every run: never a suspect.
    expect(e.suspects.map((x) => x.tuple)).not.toContain('slot_surface=s0');
  });

  it('never averages a class block with single-string blocks', () => {
    const block = (pass: boolean, index = 0) =>
      ({
        index,
        pass,
        verdicts: [],
        observed: {},
        givenHash: 'g',
        ledgerCheck: { ok: true, contradictions: [] },
        drift: [],
      }) as never;
    const classed = (item: string, cell: string) =>
      ({
        id: `s.c0.${item}`,
        blocks: [],
        metadata: { class: { id: 'k', set: 'abcabcabcabc', block: 0, item, cell } },
      }) as unknown as Spec;
    const specs = new Map<string, Spec | undefined>([
      ['s.c0.r1', classed('r1', 'slot_surface=s0')],
      ['s.c0.r2', classed('r2', 'slot_surface=s1')],
      ['plain', undefined],
    ]);
    const runs = [
      { specId: 's.c0.r1', specHash: 'h', blocks: [block(true)] },
      { specId: 's.c0.r2', specHash: 'h', blocks: [block(false)] },
      { specId: 'plain', specHash: 'h', blocks: [block(true), block(true, 1), block(true, 2)] },
    ] as unknown as RunResult[];
    const report = classes.classReport(runs, (run) => specs.get(run.specId));
    expect(report.classes).toHaveLength(1);
    expect(report.classes[0]?.envelope).toMatchObject({ n: 2, runs: 2, passes: 1, rate: 0.5 });
    expect(report.single).toEqual({ specs: 1, runs: 3, passes: 3, rate: 1 });
  });
});

describe('the model-labeller audit', () => {
  it('passes the example set: at most 1 of its accepted items invalid by the union of two families (recorded)', async () => {
    const { cls, set } = await example();
    const cassette = await classes.readCassette(resolve(DIR, 'order-fiber-address.cassette.jsonl.gz'));
    const audit = await classes.auditItems(
      cls,
      set,
      LABELLERS.map((l) => cassette.port(l)),
    );
    expect(audit.items).toBe(set.items.length);
    expect(audit.items).toBeGreaterThanOrEqual(50);
    expect(audit.invalid).toBeLessThanOrEqual(classes.AUDIT_MAX_INVALID);
    expect(audit.pass).toBe(true);
  });

  it('can say no: the same labellers call 20 of the 20 planted items invalid (recorded)', async () => {
    const cassette = await classes.readCassette(resolve(PLANTED, 'labellers.cassette.jsonl.gz'));
    const result = await plantedAudit(LABELLERS.map((l) => cassette.port(l)));
    expect(result.invalid).toBe(20);
  });

  it('counts an item invalid when any labeller says so or gives no readable answer, and wants two families', async () => {
    const { cls, set } = await example();
    const two = { set: set.set, items: set.items.slice(0, 2) };
    const a = new FakeModelPort(['{"valid": true}', '{"valid": true}'], { family: 'anthropic' });
    const b = new FakeModelPort(['{"valid": false, "reason": "x"}', 'garbled'], { family: 'openai' });
    const audit = await classes.auditItems(cls, two, [a, b]);
    expect(audit).toMatchObject({ items: 2, invalid: 2, disagreements: 2, pass: false });
    await expect(
      classes.auditItems(cls, two, [a, new FakeModelPort([], { family: 'anthropic' })]),
    ).rejects.toThrow(/two model families/);
  });
});
