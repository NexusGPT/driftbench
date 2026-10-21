import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { declaredActs } from '../../src/ladders/estate/ask-grammar';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { fakeDispatch, taskFamily, unsetAsks } from '../../src/ladders/estate/bank/genquality';
import type { MapAtom } from '../../src/ladders/estate/reference-ask';

// The approved map of the Northwind fixture (fictional data): an atom that declares its act, and another one.
const map = parse(readFileSync(join(fixture.FIXTURE, 'approved.yaml'), 'utf8')) as { atoms: MapAtom[] };
const declaredText = (atom: MapAtom) => {
  const ask = (atom.fields as { ask?: unknown } | undefined)?.ask;
  return typeof ask === 'string' ? ask : (ask as { text?: string } | undefined)?.text;
};
const ACTED = map.atoms.find((atom) => declaredText(atom) === 'propose a supplier email') as MapAtom;
const OTHER = map.atoms.find((atom) => atom.id !== ACTED?.id && declaredActs(atom).length > 0) as MapAtom;
// An atom whose act is its labelled governed-action span, and one that declares no act at all.
const governed = (atom: MapAtom) =>
  ((atom.fields as { labelSpans?: Array<{ kind: string }> } | undefined)?.labelSpans ?? []).some(
    (span) => span.kind === 'governed-action',
  );
const GATED = map.atoms.find((atom) => governed(atom) && !(atom.fields as { ask?: unknown }).ask) as MapAtom;
// An atom with no declared act text, no trigger and no quote (fictional): it has no act.
const BARE: MapAtom = { id: 'instruction.bare', kind: 'instruction', title: 'Keep the desk tidy' };
const QUOTED = map.atoms.find((atom) => typeof atom.provenance?.quote === 'string') as MapAtom;
const ASK = 'Please propose a supplier email.';
const NOT_SET_OFF = 'Please propose a supplier e-mail.';
const MISS = 'the fake does not set off its act';
const code = (askFrom?: string) => ({ ask: 'code', ...(askFrom === undefined ? {} : { askFrom }) });

// The approved plan of the fixture: a spec is judged on the row it names there, never on the atoms it lists.
const PLAN = parse(readFileSync(join(fixture.FIXTURE, 'plan.yaml'), 'utf8')) as {
  rows: Array<{ id: string; atomIds: string[]; testType: string }>;
};
const rowFor = (atom: string, testType: string) =>
  PLAN.rows.find((row) => row.atomIds[0] === atom && row.testType === testType);

function spec(
  ask: string | undefined,
  estate: Record<string, unknown>,
  atoms: string[] = [ACTED.id],
  testType = 'obligation',
) {
  const blocks = ask === undefined ? [] : [{ when: { user: ask } }];
  const row = rowFor(atoms[0] as string, testType);
  return {
    path: 'act.yaml',
    id: 'act',
    atoms: row?.atomIds ?? atoms,
    testType,
    mode: 'task',
    complete: true,
    spec: { blocks, metadata: { estate: { planRow: row?.id, ...estate } } } as unknown as Spec,
  };
}

async function verdict(specs: ReturnType<typeof spec>[], testType = 'obligation') {
  const suite: fixture.FixtureSuite = {
    work: fixture.FIXTURE,
    map: join(fixture.FIXTURE, 'approved.yaml'),
    specs,
    natives: [],
    report: {},
    checks: fixture.RUNNER_CHECKS,
  };
  const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
  try {
    return (await taskFamily().evaluate(1)).get(`gen.task.${testType}`);
  } finally {
    mock.mockRestore();
  }
}

/** The fake's dispatch over the fixture's approved map, its bank and the grammar generated from the map. */
const fake = () =>
  fakeDispatch({
    work: fixture.FIXTURE,
    map: join(fixture.FIXTURE, 'approved.yaml'),
    specs: [],
    natives: [],
    report: {},
    checks: fixture.RUNNER_CHECKS,
  });

describe('gen.task judges an ask by the act the fake sets off', () => {
  it('generates the grammar from the map: the declared act in every ask row, with a situation of the map', async () => {
    expect(ACTED).toBeDefined();
    const { setOff } = await fake();
    expect(setOff(ASK)).toEqual([ACTED.id]);
    const late = 'Please propose a supplier email. When a shipment is late by more than two days.';
    expect(setOff(late)).toEqual([ACTED.id]);
    expect(setOff(NOT_SET_OFF)).toEqual([]);
    // A situation slot takes a situation of the map, byte for byte, and nothing else.
    expect(setOff('Please propose a supplier email. When a shipment is late.')).toEqual([]);
    const span = declaredActs(GATED)[0]?.text;
    expect(span).toBeDefined();
    expect(setOff(`Please handle this for me: ${span}.`)).toContain(GATED.id);
  });

  it('control: an ask of the labelled governed-action span holds for the atom that carries it', async () => {
    const span = declaredActs(GATED)[0]?.text;
    const text = `Please handle this for me: ${span}.`;
    const asked = spec(text, code(`${GATED.id} (governed-action)`), [GATED.id], 'ordered_pair');
    const out = await verdict([asked], 'ordered_pair');
    expect(out).toEqual({ pass: true, detail: 'holds (1)' });
  });

  it('takes no act from an atom that declares none, and an atom quote whole, never a slice of it', async () => {
    expect(declaredActs(BARE)).toEqual([]);
    const quote = QUOTED.provenance?.quote as string;
    const { setOff } = await fake();
    expect(setOff(`Please ${quote}.`)).toContain(QUOTED.id);
    const slice = quote.slice(0, quote.lastIndexOf(' '));
    expect(setOff(`Please ${slice}.`)).not.toContain(QUOTED.id);
  });

  it('refuses a code ask whose act id is no atom of the map', async () => {
    const out = await verdict([spec(ASK, code(`${BARE.id} (title)`), [ACTED.id])]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining('is no atom of the map') });
  });

  it('control: a code ask the fake sets off for the act its askFrom names holds', async () => {
    const out = await verdict([spec(ASK, code(`${ACTED.id} (ask)`))]);
    expect(out).toEqual({ pass: true, detail: 'holds (1)' });
  });

  it('refuses a wrong act id: the ask sets off another atom than the one askFrom names', async () => {
    const out = await verdict([spec(ASK, code(`${OTHER.id} (title)`))]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining(`its act ${OTHER.id}`) });
  });

  it('refuses an ask the fake does not set off, one character away from the grammar', async () => {
    const out = await verdict([spec(NOT_SET_OFF, code(`${ACTED.id} (ask)`))]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining(MISS) });
  });

  it('refuses a planted wrong ask: a rule restated where the act is asked', async () => {
    const out = await verdict([spec('Please do this: never guess a status.', code(`${ACTED.id} (ask)`))]);
    expect(out?.pass).toBe(false);
  });

  // The reviewer's bypass (comment 6322228753): a real act, cited on a row it does not belong to.
  it('refuses an act that is no source of the row the plan names, and a spec that names no plan row', async () => {
    const triager = 'instruction.inbox-triager.you-sort-messages-into-three-folders';
    const out = await verdict([spec(ASK, code(`${ACTED.id} (ask)`), [triager])]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining('no source of its row') });
    const unplanned = spec(ASK, code(`${ACTED.id} (ask)`));
    (unplanned.spec.metadata as { estate: Record<string, unknown> }).estate.planRow = undefined;
    expect((await verdict([unplanned]))?.detail).toContain('names no row of the plan');
  });

  it('refuses an act id the map does not hold, and a spec that carries no act', async () => {
    expect((await verdict([spec(ASK, code('missing.atom (title)'))]))?.pass).toBe(false);
    expect((await verdict([spec(ASK, code())]))?.pass).toBe(false);
  });

  it('a neutral ask holds only while it sets off none of the row atoms', async () => {
    const neutral = 'What kinds of things can you help me with? One sentence, and please change nothing.';
    expect(await verdict([spec(neutral, code('neutral'))])).toEqual({ pass: true, detail: 'holds (1)' });
    expect((await verdict([spec(ASK, code('neutral'))]))?.pass).toBe(false);
  });

  // The reviewer's counterexamples (run 39595979728): a neutral ask is a fixed row, built exactly.
  it('refuses a neutral ask that is no fixed row, an empty ask and a spec with no first block', async () => {
    for (const ask of ['Please do this: never guess a status.', 'Banana purple elephant', ''])
      expect((await verdict([spec(ask, code('neutral'))]))?.pass, ask).toBe(false);
    expect((await verdict([spec(undefined, code('neutral'))]))?.pass).toBe(false);
  });

  const HYPOTHETICAL =
    'No need to do anything: just tell me in one sentence what it would mean to propose a supplier email.';

  it('lists a hypothetical frame apart: the fake does not set off its atom, and it never counts as the act', async () => {
    const { setOff, match } = await fake();
    expect(setOff(HYPOTHETICAL)).toEqual([]);
    expect(match(HYPOTHETICAL)).toEqual({ kind: 'hypothetical', atoms: [ACTED.id] });
    const out = await verdict([spec(HYPOTHETICAL, code(`${ACTED.id} (ask)`))]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining('carries no act') });
  });

  it('control: a near miss asks the hypothetical frame about its atom, and sets nothing off', async () => {
    const near = [spec(HYPOTHETICAL, code(`${ACTED.id} (ask)`), [ACTED.id], 'outside_trigger')];
    expect(await verdict(near, 'outside_trigger')).toEqual({ pass: true, detail: 'holds (1)' });
    const asked = [spec(ASK, code(`${ACTED.id} (ask)`), [ACTED.id], 'outside_trigger')];
    expect((await verdict(asked, 'outside_trigger'))?.pass).toBe(false);
  });

  it("holds a recorded session's ask only when it is the session's own message, byte for byte", async () => {
    const recorded = 'Where is shipment NW-55020 from carrier DPX, and is it late?';
    const session = { ask: 'session', session: 'carrier-code-required' };
    expect(await verdict([spec(recorded, session)])).toEqual({ pass: true, detail: 'holds (1)' });
    expect((await verdict([spec(recorded.toLowerCase(), session)]))?.pass).toBe(false);
    const other = { ...session, session: 'force-push-blocked' };
    expect((await verdict([spec(recorded, other)]))?.pass).toBe(false);
  });
});

describe('the generated grammar covers every ask of the real fixture suite', { timeout: 600_000 }, () => {
  it('holds every gen.task item on the real fixture suite (the nine items the word rules failed included)', async () => {
    const out = await taskFamily().evaluate(1);
    const failing = [...out]
      .filter(([, result]) => !result.pass)
      .map(([id, result]) => `${id}: ${result.detail}`);
    expect(failing.map((line) => line.slice(0, 400))).toEqual([]);
  });

  it('counts 0 complete specs whose ask carries an act the fake does not set off', async () => {
    const unset = await unsetAsks(await fixture.fixtureSuite());
    // The distinct asks, most frequent first, so a red run names what the grammar misses.
    const counts = new Map<string, number>();
    for (const one of unset) counts.set(one.ask, (counts.get(one.ask) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30);
    expect(top, `${unset.length} asks set nothing off`).toEqual([]);
  });
});

describe('the fake reads no frames or shapes, and gen.task gets no easier', { timeout: 600_000 }, () => {
  it('refuses a grammar that carries frames or shapes', async () => {
    const fake = (await import(pathToFileURL(join(fixture.FIXTURE, 'live/fake/dispatch.mjs')).href)) as {
      loadDispatch(env: Record<string, string>): unknown;
    };
    const folder = mkdtempSync(join(tmpdir(), 'fake-frames-'));
    for (const [name, grammar] of [
      ['frames.json', { frames: { please: { before: 'Please ', mid: '', after: '.', request: true } } }],
      ['shapes.json', { shapes: { skill: 'the {} skill' }, slot: '{}' }],
    ] as const) {
      const path = join(folder, name);
      writeFileSync(path, JSON.stringify(grammar));
      const env = { FAKE_MAP: join(fixture.FIXTURE, 'approved.yaml'), FAKE_GRAMMAR: path };
      expect(() => fake.loadDispatch(env), name).toThrow(/refuses/);
    }
  });

  it('fails a planted product that drops a declared act for other words, or invents a verb', async () => {
    const suite = await fixture.fixtureSuite();
    const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
    type Meta = { ask?: string; askFrom?: string };
    const actOf = (one: (typeof suite.specs)[number]) => {
      const meta = (one.spec.metadata?.estate ?? {}) as Meta;
      return meta.ask === 'code' ? atoms.get(String(meta.askFrom).split(' ')[0] ?? '') : undefined;
    };
    const target = suite.specs.find((one) => {
      const atom = actOf(one);
      const declared = (atom?.fields as { ask?: unknown } | undefined)?.ask !== undefined;
      return one.complete && one.testType === 'obligation' && declared && !!atom?.situation;
    });
    if (!target) throw new Error('no complete obligation spec asked from a declared act');
    const atom = actOf(target) as MapAtom;
    const drops = `Please handle this for me: ${atom.situation}.`;
    for (const planted of [drops, 'Please reconcile the ledger by hand.']) {
      const copy = structuredClone(target);
      (copy.spec.blocks[0] as { when: { user: string } }).when.user = planted;
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({
        ...suite,
        specs: suite.specs.map((one) => (one === target ? copy : one)),
      });
      try {
        const out = (await taskFamily().evaluate(1)).get('gen.task.obligation');
        expect(out?.pass, planted).toBe(false);
        expect(out?.detail, planted).toContain(target.id);
      } finally {
        mock.mockRestore();
      }
    }
  });
});
