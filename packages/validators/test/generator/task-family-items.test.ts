import type { Spec } from '@agent-nexus/driftbench-core';
import { generateSuite } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { isCodeTaskSpec } from '../../src/ladders/generator/code-task';
import { faultFamily } from '../../src/ladders/generator/faults';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import {
  type Generation,
  type GeneratorParts,
  generateFrom,
  runAll,
} from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

// The three generator items that read a task spec (docs/generating.md, task families) against the reference
// product and against planted wrong products. Each wrong product must still fail the item.

const hidden = hiddenSpec(1);
const item = (id: string) => {
  const found = bankItems().find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
const generate =
  (edit?: (files: { path: string; text: string }[]) => void): GeneratorParts['generate'] =>
  (prepared, options) => {
    const result = generateSuite(prepared, { ...options, max: 1 });
    edit?.(result.files);
    return result;
  };
const reference = () => generateFrom(hidden, renderMap(hidden), 1, { generate: generate() }, { once: true });
const taskOf = (generated: Generation): Spec => {
  const found = generated.complete.find(({ spec }) => isCodeTaskSpec(spec));
  if (!found) throw new Error('no task spec');
  return found.spec;
};
const turn = (spec: Spec, id: string) => {
  const block = spec.blocks.find((entry) => entry.id === id);
  if (!block?.when || !('user' in block.when)) throw new Error(`no user turn ${id}`);
  return block.when;
};
const withGenerated = (generated: Generation, runs?: Awaited<ReturnType<typeof runAll>>) =>
  ({ generated: async () => generated, runs: async () => runs }) as unknown as SeedData;

describe('generator items on task family specs', () => {
  it('diff.phrases.filled passes the family phrases and fails invented or leaking ones', async () => {
    const generated = await reference();
    const check = (input: Generation) => item('diff.phrases.filled').check(withGenerated(input));
    expect(await check(generated)).toMatchObject({ pass: true });
    const invented = structuredClone(generated);
    turn(taskOf(invented), 'save').user = 'Please export the record to a file of your choice.';
    expect(await check(invented)).toMatchObject({ pass: false });
    const leak = structuredClone(generated);
    turn(taskOf(leak), 'save').user = `Save the record as ${hidden.saveFile} with agent ${hidden.agent}.`;
    expect(await check(leak)).toMatchObject({ pass: false });
    // A conversational spec does not get the family's phrases.
    const borrowed = structuredClone(generated);
    const conversational = borrowed.complete.find(({ spec }) => !isCodeTaskSpec(spec))?.spec;
    if (!conversational?.blocks[0]?.when) throw new Error('no conversational spec');
    conversational.blocks[0].when = { user: `Save the record as ${hidden.saveFile}.` };
    expect(await check(borrowed)).toMatchObject({ pass: false });
  }, 300000);

  it('hostile.empty-phrases passes the family spec and fails a product that completes other text', async () => {
    const check = (parts: GeneratorParts) =>
      item('hostile.empty-phrases').check(
        new SeedData(1, parts, async () => {
          throw new Error('no scale');
        }),
      );
    expect(await check({ generate: generate() })).toMatchObject({ pass: true });
    const saveTurn = `Save the record as ${hidden.saveFile}.`;
    const invented = generate((files) => {
      for (const file of files)
        if (file.text.includes('seeder: task'))
          file.text = file.text.replace(saveTurn, 'Export the record now.');
    });
    expect(await check({ generate: invented })).toMatchObject({ pass: false });
    const relabelled = generate((files) => {
      for (const file of files)
        if (file.text.includes('seeder: task'))
          file.text = file.text.replace('seeder: task', 'seeder: graph');
    });
    expect(await check({ generate: relabelled })).toMatchObject({ pass: false });
  }, 300000);

  it('adequacy tests the task blocks by their fixed checks and fails a product that drops them', async () => {
    const generated = await reference();
    const classes = [
      'X2.fact-invent',
      'X3.no-report',
      'X4.dutch',
      'X4.empty',
      'X4.no-question',
      'X4.narrate',
      'X5.extra',
    ];
    const parts = {
      k: 1,
      cheaters: [] as const,
      faults: () =>
        faultFamily(hidden).filter(
          (fault) => classes.includes(fault.class) && fault.where === 'any' && fault.rate === 1,
        ),
    };
    const verdicts = async (input: Generation) => {
      const runs = await runAll(input, parts);
      expect(runs.errors).toEqual([]);
      const task = taskOf(input).id;
      const out: Record<string, { pass: boolean; taskBlock?: number }> = {};
      for (const id of classes) {
        const record = runs.faults.find((entry) => entry.fault.class === id);
        out[id] = {
          pass: (await item(`adequacy.${id}`).check(withGenerated(input, runs))).pass,
          ...(record?.firstChange[task] === undefined ? {} : { taskBlock: record.firstChange[task] }),
        };
      }
      return out;
    };
    // The reference: every fault first changes the task spec at its opening block, and that block fails.
    const baseline = await verdicts(generated);
    for (const id of classes) expect(baseline[id], id).toEqual({ pass: true, taskBlock: 0 });
    // A product that keeps the oracle's Then and drops the family's fixed checks, and the map's reply rule a
    // task spec holds too (one reply per turn, which also fails an empty reply), fails every item.
    const dropped = structuredClone(generated);
    delete taskOf(dropped).rules;
    for (const block of taskOf(dropped).blocks) {
      if (!block.expect) continue;
      for (const key of ['lang', 'stage_reported', 'tools', 'must_not'] as const) delete block.expect[key];
      block.expect.must = (block.expect.must ?? []).filter((pattern) => !pattern.endsWith('\\?'));
    }
    for (const [id, verdict] of Object.entries(await verdicts(dropped))) expect(verdict.pass, id).toBe(false);
    // A product that drops only the stage report check fails the item for a fault that reports no stage.
    const unreported = structuredClone(generated);
    for (const block of taskOf(unreported).blocks) delete block.expect?.stage_reported;
    expect((await verdicts(unreported))['X3.no-report']?.pass).toBe(false);
  }, 600000);
});
