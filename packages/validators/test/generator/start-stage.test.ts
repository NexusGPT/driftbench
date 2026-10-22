import { canonicalGiven } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { type Generation, startStageOf } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * A walk that starts from a prefix says where it starts (given.stage): the start stage of its first block and
 * the stage the recovery check expects after an injection read it. A walk with no declared stage reads as before.
 */
describe('a prefix-started walk says where it starts', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  // A written walk with an injection after a block whose stage differs from the first stage of the spec.
  const source = required(
    generated.complete.find(({ spec }) =>
      spec.blocks.some(
        (block, index) =>
          index >= 2 &&
          block.when &&
          'injection' in block.when &&
          spec.blocks[index - 1]?.expect?.stage !== undefined &&
          spec.blocks[index - 1]?.expect?.stage !== generated.hidden.start,
      ),
    ),
  );
  const at = source.spec.blocks.findIndex(
    (block, index) => index >= 2 && block.when && 'injection' in block.when,
  );
  const cls = (required(source.spec.blocks[at]).when as { injection: { class: string } }).injection.class;
  const real = required(source.spec.blocks[at - 1]?.expect?.stage);

  // The same walk started from the prefix its first `at` blocks leave, with the stage it declares (or none).
  const started = (stage: string | undefined): Generation['complete'][number] => {
    const spec = structuredClone(source.spec);
    const start = canonicalGiven(source.spec, at);
    const rest = spec.blocks.slice(at);
    const first = required(rest[0]);
    first.given = {
      prefix: start.prefix,
      origin: 'canonical',
      ...(stage === undefined ? {} : { stage }),
    };
    spec.blocks = rest;
    spec.perturbations = undefined;
    return { ...source, spec };
  };

  const recovery = async (entry: Generation['complete'][number]) => {
    const mini: Generation = { ...generated, complete: [entry] };
    const data = new SeedData(1, {}, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    const item = required(bankItems().find((each) => each.id === `perturbation.recovery.${cls}`));
    return item.check(data);
  };

  it('reads the declared stage as the start of the walk', () => {
    expect(startStageOf(started(real).spec, 0)).toBe(real);
    expect(startStageOf(started(undefined).spec, 0)).toBe(source.spec.stages?.[0] ?? '');
  });

  it('passes the recovery check when the declared stage is the true one', async () => {
    expect((await recovery(started(real))).pass).toBe(true);
  }, 600_000);

  it('fails the recovery check when the declared stage is wrong', async () => {
    const wrong = required(source.spec.stages?.find((stage) => stage !== real));
    const verdict = await recovery(started(wrong));
    expect(verdict.pass).toBe(false);
  }, 600_000);

  it('reads a walk with no declared stage as before', async () => {
    const verdict = await recovery(started(undefined));
    const before = (await recovery(source)).pass;
    // With no stage the check falls back to the hidden start, as it did: it cannot see the stage the prefix leaves.
    expect(before).toBe(true);
    expect(verdict.pass).toBe(false);
  }, 600_000);
});
