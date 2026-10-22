import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import type { EstateGenerateInput } from '../../src/estate/generate-types';
import { compilePredicate } from '../../src/estate/predicates';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

const REGISTER = 'register.invoice-reconcile.end-with-one-line-per-invoice';
const SITUATION = 'invoice-reconcile';

/** Whether a reply passes the compiled check, as the must and must_not checks read it (flags m and i). */
function keeps(items: unknown, reply: string): boolean {
  const compiled = compilePredicate('one_line_per_item', { items });
  if (!compiled) throw new Error('not compiled');
  const subjects = [reply, reply.replace(/[.,!?;:]+$/, '')];
  const found = (source: string) => subjects.some((subject) => new RegExp(source, 'mi').test(subject));
  return (compiled.must ?? []).every(found) && !(compiled.mustNot ?? []).some(found);
}

describe('one_line_per_item: the reply ends with one line per declared input item', () => {
  it('passes a reply that ends with one line per item, after any lines before them', () => {
    expect(keeps(['INV-1001'], 'Done.\nINV-1001: matched, 0.00 EUR')).toBe(true);
    expect(keeps(['INV-1001'], 'Summary\n\nINV-1001: matched 1250.00 EUR.\n\n')).toBe(true);
    expect(keeps(['INV-1', 'INV-2'], 'Report\nINV-2: short 3.00 EUR\n\nINV-1: matched')).toBe(true);
  });

  it('fails a reply with no line for an item, with a line after the item lines, or with two items on one line', () => {
    expect(keeps(['INV-1001'], 'Done. Here is what I did, in short.')).toBe(false);
    expect(keeps(['INV-1001'], 'INV-1001: matched\nThanks!')).toBe(false);
    expect(keeps(['INV-1', 'INV-2'], 'INV-1: matched\nINV-2: short\nThat is all')).toBe(false);
    expect(keeps(['INV-1', 'INV-2'], 'INV-1 and INV-2: matched\nINV-1: matched')).toBe(false);
    expect(keeps(['INV-1', 'INV-2'], 'INV-2: short')).toBe(false);
  });

  it('reads an item as a whole token: INV-1 is not found inside INV-10', () => {
    expect(keeps(['INV-1', 'INV-10'], 'INV-10: over\nINV-10: over')).toBe(false);
    expect(keeps(['INV-1', 'INV-10'], 'INV-10: over\nINV-1: short')).toBe(true);
  });

  it('compiles nothing without a list of distinct items: no count is taken from words', () => {
    expect(compilePredicate('one_line_per_item')).toBeUndefined();
    expect(compilePredicate('one_line_per_item', { items: [] })).toBeUndefined();
    expect(compilePredicate('one_line_per_item', { items: ['INV-1', 'INV-1'] })).toBeUndefined();
    expect(compilePredicate('one_line_per_item', { items: [''] })).toBeUndefined();
  });
});

/** The fixture inputs with the register declaring the shape, as the labeller writes it, and the bank as given. */
async function inputs(withInputs: boolean): Promise<EstateGenerateInput> {
  const base = await fixtureInputs(APPROVED_PLAN);
  const atoms = base.map.atoms.map((atom) =>
    atom.id === REGISTER
      ? {
          ...atom,
          fields: { ...atom.fields, replyShape: 'one_line_per_item' },
          evidence: [...atom.evidence, { type: 'custom', name: 'one_line_per_item' } as (typeof atom.evidence)[number]],
        }
      : atom,
  );
  const situations = base.bank.situations.map((situation) => {
    if (situation.id !== SITUATION || withInputs) return situation;
    const { inputs: _drop, ...rest } = situation;
    return rest;
  });
  return { ...base, map: { ...base.map, atoms }, bank: { ...base.bank, situations } };
}

function registerSamples(result: ReturnType<typeof generateEstateSuite>) {
  return result.specs
    .filter((record) => record.mode === 'live' && record.testType === 'register_sample' && record.atoms.includes(REGISTER))
    .map((record) => {
      const file = result.files.find((entry) => entry.path === record.path);
      const parsed = parseSpecText(file?.text ?? '', 'yaml', record.path);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      const situation = (parsed.spec.metadata?.estate as { situation?: string } | undefined)?.situation;
      return { record, spec: parsed.spec, situation };
    });
}

describe('a register of one line per item in the generated suite', () => {
  it('compiles to must checks over the situation inputs, and the spec is complete', async () => {
    const samples = registerSamples(generateEstateSuite(await inputs(true), { paths: PLANNER_PATHS }));
    const asked = samples.filter((sample) => sample.situation === SITUATION);
    expect(asked.length).toBeGreaterThan(0);
    for (const { record, spec } of asked) {
      expect(record.complete, record.id).toBe(true);
      const expect0 = spec.blocks[0]?.expect as { must?: string[] } | undefined;
      const must = expect0?.must ?? [];
      expect(must.some((source) => source.includes('INV-1001')), record.id).toBe(true);
      const keep = (reply: string) => must.every((source) => new RegExp(source, 'mi').test(reply));
      expect(keep('Done. Here is what I did, in short.\nINV-1001: done.'), record.id).toBe(true);
      expect(keep('Done. Here is what I did, in short.'), record.id).toBe(false);
    }
  }, 180_000);

  it('leaves the spec incomplete under needs-registered-check when the situation declares no inputs', async () => {
    const result = generateEstateSuite(await inputs(false), { paths: PLANNER_PATHS });
    const asked = registerSamples(result).filter((sample) => sample.situation === SITUATION);
    expect(asked.length).toBeGreaterThan(0);
    for (const { record, spec } of asked) {
      expect(record.complete, record.id).toBe(false);
      expect(record.markers, record.id).toContain('needs-registered-check');
      const expect0 = spec.blocks[0]?.expect as { must?: string[] } | undefined;
      expect((expect0?.must ?? []).some((source) => source.includes('INV-1001')), record.id).toBe(false);
      const reasons = result.report.incomplete.find((entry) => entry.spec === record.id)?.reasons ?? [];
      expect(
        reasons.some((gap) => gap.atom === REGISTER && gap.detail.startsWith('one_line_per_item:')),
        record.id,
      ).toBe(true);
    }
  }, 180_000);
});
