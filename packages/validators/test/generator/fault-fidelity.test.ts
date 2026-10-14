import type { Spec } from '@agent-nexus/driftbench-core';
import { blockOutcome, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { combinedFault, faultFamily } from '../../src/ladders/generator/faults';
import { createFollower } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, runContext } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}
const hidden = hiddenSpec(1);
const hand = required(baselineSuite(hidden)[0]).spec;
const fault = (id: string) =>
  required(faultFamily(hidden).find((f) => f.class === id && f.where === 'any' && f.rate === 1));
async function run(spec: Spec, ids: string[] = []) {
  const mutation =
    ids.length === 1
      ? fault(required(ids[0])).mutation
      : ids.length > 1
        ? combinedFault(hidden, ids).mutation
        : {};
  return runOnce(spec, followerAdapter(createFollower(hidden, mutation)), 1, runContext());
}
async function proof(spec: Spec, index: number, ids: string[], weaken: (spec: Spec) => void) {
  const good = await run(spec);
  expect(good.blocks.every((block) => block.pass)).toBe(true);
  const bad = await run(spec, ids);
  expect(blockOutcome(bad, index)).toBe('fail');
  expect(bad.blocks[index]?.observed).not.toEqual(good.blocks[index]?.observed);
  const mutant = structuredClone(spec);
  weaken(mutant);
  // A generator omitting the discriminating assertion no longer catches this fault.
  expect(blockOutcome(await run(mutant, ids), index)).toBe('pass');
  expect(blockOutcome(await run(spec, ids), index)).toBe('fail');
  expect(blockOutcome(await run(spec), index)).toBe('pass');
}

describe('fault agents violate their named rule', () => {
  it('no-reask removes the real confirmation request even at recap', async () => {
    const spec = structuredClone(hand);
    spec.blocks = spec.blocks.slice(0, -1);
    const phrase = required(
      hidden.phrases.find((p) => p.intent.kind === 'deviation' && p.intent.class === 'D4_loose_confirmation'),
    );
    spec.blocks.push({
      id: 'loose-confirmation',
      when: { injection: { class: 'D4_loose_confirmation', user: phrase.text } },
      expect: { stage: hidden.confirm, must: ['CONFIRM'] },
    });
    const index = spec.blocks.length - 1;
    await proof(spec, index, ['D4.no-reask'], (mutant) => {
      required(mutant.blocks[index]).expect = { stage: hidden.confirm };
    });
  });
  it('fact-invent fabricates a fact from an uncalled tool on the submission turn', async () => {
    const spec = structuredClone(hand);
    const last = required(spec.blocks.at(-1));
    last.expect = {
      ...last.expect,
      must_not: hidden.tools
        .filter((tool) => !tool.sideEffect)
        .map((tool) => `${tool.name.replace(/_/g, ' ')} says `),
    };
    const index = spec.blocks.length - 1;
    await proof(spec, index, ['X2.fact-invent'], (mutant) => {
      delete required(required(mutant.blocks[index]).expect).must_not;
    });
  });
  for (const duplicate of ['X5.duplicate', 'X5.write-twice']) {
    it(`${duplicate} remains a fault alone and when composed with dropping calls`, async () => {
      const spec = structuredClone(hand);
      for (const block of spec.blocks) for (const call of block.expect?.tools ?? []) call.count = 1;
      const tool = required(
        hidden.tools.find((tool) => (duplicate === 'X5.duplicate' ? tool.role === 'read' : tool.sideEffect)),
      );
      const index = spec.blocks.findIndex((block) =>
        block.expect?.tools?.some((call) => call.label === tool.name),
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const weaken = (mutant: Spec) => {
        delete required(required(mutant.blocks[index]).expect).tools;
      };
      await proof(spec, index, [duplicate], weaken);
      await proof(spec, index, ['X5.drop', duplicate], weaken);
      await proof(spec, index, [duplicate, 'X5.drop'], weaken);
    });
  }
});
