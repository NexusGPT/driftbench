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
const BARE = map.atoms.find((atom) => declaredActs(atom).length === 0) as MapAtom;
const ASK = 'Please propose a supplier email.';
const NOT_SET_OFF = 'Please propose a supplier e-mail.';
const MISS = 'the fake does not set off its act';
const code = (askFrom?: string) => ({ ask: 'code', ...(askFrom === undefined ? {} : { askFrom }) });

function spec(ask: string, estate: Record<string, unknown>, atoms: string[] = [ACTED.id]) {
  return {
    path: 'act.yaml',
    id: 'act',
    atoms,
    testType: 'obligation',
    mode: 'task',
    complete: true,
    spec: { blocks: [{ when: { user: ask } }], metadata: { estate } } as unknown as Spec,
  };
}

async function verdict(specs: ReturnType<typeof spec>[]) {
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
    return (await taskFamily().evaluate(1)).get('gen.task.obligation');
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
    expect(asks[`Please go ahead with ${span}.`]).toContain(GATED.id);
  });

  it('control: an ask of the labelled governed-action span holds for the atom that carries it', async () => {
    const span = declaredActs(GATED)[0]?.text;
    const asked = spec(`Please go ahead with ${span}.`, code(`${GATED.id} (governed-action)`), [GATED.id]);
    const out = await verdict([asked]);
    expect(out).toEqual({ pass: true, detail: 'holds (1)' });
  });

  it('refuses a code ask whose act atom declares no act text in the map', async () => {
    const out = await verdict([spec(ASK, code(`${BARE.id} (title)`), [BARE.id])]);
    expect(out).toMatchObject({ pass: false, detail: expect.stringContaining('declares no act text') });
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
});
