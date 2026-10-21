import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { askGrammar, declaredActs } from '../../src/ladders/estate/ask-grammar';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { taskFamily } from '../../src/ladders/estate/bank/genquality';
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

function spec(
  ask: string | undefined,
  estate: Record<string, unknown>,
  atoms: string[] = [ACTED.id],
  testType = 'obligation',
) {
  const blocks = ask === undefined ? [] : [{ when: { user: ask } }];
  return {
    path: 'act.yaml',
    id: 'act',
    atoms,
    testType,
    mode: 'task',
    complete: true,
    spec: { blocks, metadata: { estate } } as unknown as Spec,
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

describe('gen.task judges an ask by the act the fake sets off', () => {
  it('generates the grammar from the map: the declared act in every ask row, with its context', () => {
    expect(ACTED).toBeDefined();
    const asks = askGrammar(map.atoms).asks;
    expect(asks[ASK]).toEqual([ACTED.id]);
    const late = 'Please propose a supplier email. When a shipment is late by more than two days.';
    expect(asks[late]).toEqual([ACTED.id]);
    expect(asks[NOT_SET_OFF]).toBeUndefined();
    const span = declaredActs(GATED)[0]?.text;
    expect(span).toBeDefined();
    expect(asks[`Please handle this for me: ${span}.`]).toContain(GATED.id);
  });

  it('control: an ask of the labelled governed-action span holds for the atom that carries it', async () => {
    const span = declaredActs(GATED)[0]?.text;
    const text = `Please handle this for me: ${span}.`;
    const asked = spec(text, code(`${GATED.id} (governed-action)`), [GATED.id]);
    const out = await verdict([asked]);
    expect(out).toEqual({ pass: true, detail: 'holds (1)' });
  });

  it('takes no act from an atom that declares none, and an atom quote whole, never a slice of it', () => {
    expect(declaredActs(BARE)).toEqual([]);
    const quote = QUOTED.provenance?.quote as string;
    const asks = askGrammar(map.atoms).asks;
    expect(asks[`Please ${quote}.`]).toContain(QUOTED.id);
    const slice = quote.slice(0, quote.lastIndexOf(' '));
    expect(asks[`Please ${slice}.`] ?? []).not.toContain(QUOTED.id);
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
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining(MISS) });
  });

  it('refuses an ask the fake does not set off, one character away from the grammar', async () => {
    const out = await verdict([spec(NOT_SET_OFF, code(`${ACTED.id} (ask)`))]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining(MISS) });
  });

  it('refuses a planted wrong ask: a rule restated where the act is asked', async () => {
    const out = await verdict([spec('Please do this: never guess a status.', code(`${ACTED.id} (ask)`))]);
    expect(out?.pass).toBe(false);
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
    const grammar = askGrammar(map.atoms);
    expect(grammar.asks[HYPOTHETICAL]).toBeUndefined();
    expect(grammar.hypothetical[HYPOTHETICAL]).toEqual([ACTED.id]);
    const out = await verdict([spec(HYPOTHETICAL, code(`${ACTED.id} (ask)`))]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining('carries no act') });
  });

  it('control: a near miss asks the hypothetical frame about its atom, and sets nothing off', async () => {
    const near = [spec(HYPOTHETICAL, code(`${ACTED.id} (ask)`), [ACTED.id], 'route_near_miss')];
    expect(await verdict(near, 'route_near_miss')).toEqual({ pass: true, detail: 'holds (1)' });
    const asked = [spec(ASK, code(`${ACTED.id} (ask)`), [ACTED.id], 'route_near_miss')];
    expect((await verdict(asked, 'route_near_miss'))?.pass).toBe(false);
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
