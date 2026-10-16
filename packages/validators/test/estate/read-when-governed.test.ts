import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { performsGoverned, taskFamily } from '../../src/ladders/estate/bank/genquality';

describe('a read-before ask performs the act its rule governs', () => {
  const rule = 'Before editing any invoice file, Read `references/rules.md`.';

  it.each([
    'Please edit any invoice file.',
    'Edit the invoice file for April.',
    'Could you edit the invoice files?',
  ])('accepts an ask that edits an invoice file: %s', (ask) =>
    expect(performsGoverned(ask, rule)).toBe(true),
  );

  it.each([
    'Please delete any invoice file.',
    'Please edit the shipment note.',
    'Read the invoice file.',
    'Please sort the inbox.',
  ])('rejects an ask with another verb or another object: %s', (ask) =>
    expect(performsGoverned(ask, rule)).toBe(false),
  );

  it('reads the four documented forms of the clause', () => {
    for (const form of [
      '!! Before writing the report: Read `templates/report.md` !!',
      'Before writing the report, read `templates/report.md`.',
      'Read `templates/report.md` before writing the report.',
      'Do not write the report until you have read `templates/report.md`.',
    ]) {
      expect(performsGoverned('Write up last week in the usual weekly report.', form), form).toBe(true);
      expect(performsGoverned('Send the report to the supplier.', form), form).toBe(false);
    }
  });

  it('holds an ask to nothing when the clause names no act and object', () => {
    expect(performsGoverned('Anything at all.', 'Read `a.md` first.')).toBe(true);
  });
});

describe('gen.task.read_when judges the governed act', { timeout: 120_000 }, () => {
  async function verdict(ask?: string) {
    const suite = await fixture.fixtureSuite();
    const specs = structuredClone(suite.specs);
    if (ask !== undefined) {
      const target = specs.find((spec) => spec.testType === 'read_when' && spec.complete);
      const block = (target?.spec.blocks as Array<{ when: { user: string } }> | undefined)?.[0];
      if (!block) throw new Error('no complete read_when spec');
      block.when.user = ask;
    }
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({ ...suite, specs });
    try {
      return (await taskFamily().evaluate(1)).get('gen.task.read_when');
    } finally {
      mock.mockRestore();
    }
  }

  it('holds on the generated suite', async () => {
    expect(await verdict()).toMatchObject({ pass: true });
  });

  it('fails a read_when ask that is a task, but not the governed one', async () => {
    expect(await verdict('Please sort the shared operations inbox into folders.')).toMatchObject({
      pass: false,
    });
    expect(await verdict('Send the weekly report to the supplier.')).toMatchObject({ pass: false });
  });

  it('is judged from the validator’s own map', async () => {
    const suite = await fixture.fixtureSuite();
    expect((await loadEstateMap(suite.map)).ok).toBe(true);
  });
});
