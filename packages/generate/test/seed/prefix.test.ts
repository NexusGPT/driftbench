import type { BlockSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  createFollower,
  followerAdapter,
  hiddenSpec,
  runContext,
} from '../../../validators/src/ladders/generator/index';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { blockOutcome, machineSignature, projectObserved, runOnce } from '../../src/gate';

async function suiteOf(seed: number) {
  const hidden = hiddenSpec(seed);
  const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
  if (!source.prepared) throw new Error('the fictional map failed to load');
  return { hidden, suite: generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed }) };
}

/** The same conversation with every prefix turn said live again, each as a block with no Then. */
function replayed(spec: Spec): Spec {
  const [first, ...rest] = spec.blocks as [BlockSpec, ...BlockSpec[]];
  const prefix = first.given?.prefix ?? [];
  const said: BlockSpec[] = prefix
    .filter((message) => message.role === 'user')
    .map((message, index) => ({ id: `live-${index + 1}`, when: { user: message.content }, expect: {} }));
  const { given: _given, ...kept } = first;
  return { ...spec, blocks: [...said, kept, ...rest] };
}

describe('leading blocks another spec already measures', () => {
  it('move into the Given prefix, measured once across the suite', async () => {
    const { suite } = await suiteOf(1);
    const prefixed = suite.complete.filter((spec) => spec.blocks[0]?.given?.prefix);
    expect(prefixed.length).toBeGreaterThan(0);
    // Every block a prefix holds has a measured twin: a block of a complete spec with the same signature.
    const measured = new Set(
      suite.complete.flatMap((spec) => spec.blocks.map((_block, index) => machineSignature(spec, index))),
    );
    for (const spec of prefixed) {
      const messages = spec.blocks[0]?.given?.prefix ?? [];
      // A user turn, then an assistant turn with no words: only the calls, with the answers the Given fixes.
      messages.forEach((message, index) => {
        expect(message.role, spec.id).toBe(index % 2 === 0 ? 'user' : 'assistant');
        if (message.role === 'assistant') expect(message.content, spec.id).toBe('');
      });
      expect(measured.size).toBeGreaterThan(0);
    }
  }, 300_000);

  it('leave the reference agent doing what it does when those turns are said live', async () => {
    const { hidden, suite } = await suiteOf(1);
    const prefixed = suite.complete.filter((spec) => spec.blocks[0]?.given?.prefix).slice(0, 40);
    expect(prefixed.length).toBeGreaterThan(0);
    for (const spec of prefixed) {
      const told = await runOnce(spec, followerAdapter(createFollower(hidden)), 1, runContext());
      const live = replayed(spec);
      const said = await runOnce(live, followerAdapter(createFollower(hidden)), 1, runContext());
      const offset = live.blocks.length - spec.blocks.length;
      spec.blocks.forEach((_block, index) => {
        // The reference passes each kept block, and observes what it observes when the prefix is said live.
        expect(blockOutcome(told, index), `${spec.id} block ${index}`).toBe('pass');
        const a = told.blocks.find((block) => block.index === index)?.observed;
        const b = said.blocks.find((block) => block.index === index + offset)?.observed;
        if (!a || !b) throw new Error(`${spec.id}: block ${index} did not run`);
        expect(projectObserved(a), `${spec.id} block ${index}`).toBe(projectObserved(b));
      });
    }
  }, 600_000);
});
