import type { CheckContext, CheckSet } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { genCompleteFamily } from '../../src/ladders/estate/bank/loop';
import { completionComponents } from '../../src/ladders/estate/completion';
import { completionContract } from '../../src/ladders/estate/completion-contract';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { referenceChecks, referenceRun, required, SUFFIXES, suffix } from './ruling-reference';

async function measure(run: pipeline.EstateRun, checks: CheckSet) {
  const source = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
  const registry = vi.spyOn(pipeline, 'replayChecks').mockReturnValue(checks);
  try {
    return await genCompleteFamily().evaluate(run.estate.seed);
  } finally {
    source.mockRestore();
    registry.mockRestore();
  }
}

/** The replay of a single component: a block with that one expectation and no custom rule. */
const projected = (ctx: CheckContext) =>
  Object.keys(ctx.expect).length === 1 && Object.keys(ctx.spec.rules?.custom ?? {}).length === 0;

describe('gen.complete judges a deletion only on a green component control', { timeout: 600_000 }, () => {
  it('reports a component whose control is already red, and never counts its violation as a kill', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    // A class whose every spec holds two or more expectations in each block, so its own replay is never a
    // projection, and an expect component whose violation is a failing verdict.
    const choice = SUFFIXES.flatMap((key) => {
      const specs = run.specs.filter((spec) => suffix(run, spec) === key && spec.loaded);
      const whole = specs.every((spec) =>
        required(spec.loaded).spec.blocks.every((block) => Object.keys(block.expect ?? {}).length > 1),
      );
      if (specs.length === 0 || !whole) return [];
      const component = completionComponents(completionContract(run, required(specs[0]))).components.find(
        (entry) =>
          entry.channel === 'expect' &&
          entry.controlVerdicts.length > 0 &&
          (entry.violationOutcome === undefined || entry.violationOutcome === 'fail'),
      );
      return component ? [{ key, component }] : [];
    })[0];
    const { key, component } = required(choice);
    const item = `gen.complete.${key}`;
    const checks = referenceChecks();
    expect((await measure({ ...run }, checks)).get(item)).toEqual({ pass: true, detail: 'holds' });
    // The component's own verdicts fail on every one-expectation replay: on the control as on the violation.
    const redControl: CheckSet = checks.map((check) => ({
      ...check,
      async evaluate(ctx) {
        const verdicts = await check.evaluate(ctx);
        return projected(ctx)
          ? verdicts.map((verdict) =>
              component.controlVerdicts.includes(verdict.id)
                ? { ...verdict, outcome: 'fail' as const }
                : verdict,
            )
          : verdicts;
      },
    }));
    expect((await measure({ ...run }, redControl)).get(item)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('component control failed'),
    });
  });
});
