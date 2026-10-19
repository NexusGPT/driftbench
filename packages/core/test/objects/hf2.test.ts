// HF2 as a CI test: the 259 stored H1 runs (copied byte for byte from research/block-phrasing, sha in
// SHA256SUMS) re-scored by the shipped checks, with each block's spec read through the framework's loader,
// give the stored verdicts: 0 changed verdicts, 0 runs whose pass flag changed. Since the value-check ladder
// (block phase 1, V1) parity holds with every tool's values compared exactly (`compare: { exact }`), and with the
// shipped default too: with no replayer and no judge, no rung decides a differing value, so it is compared exactly.
// Since the block phase 1 oracle (PR 434) the Acme specs carry normalise rules, which the stored oracle never
// read: parity runs on the Then without them (withoutNormaliseRules), and a third test keeps them and counts the
// runs they flip.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChecks, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Expect } from '@agent-nexus/driftbench-core';
import {
  applyScoringPlan,
  loadSpecFile,
  type Spec,
  scoringPlan,
  shippedObjectContext,
} from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS, failedLikeStored, h1Context, h1Runs, multisetDiff, withoutNormaliseRules } from './h1';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

const specs = new Map<string, Spec>();
beforeAll(async () => {
  initializeShippedObjects();
  for (const def of Object.values(BLOCKS)) {
    if (specs.has(def.spec)) continue;
    const loaded = await loadSpecFile(join(ROOT, def.spec));
    if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
    specs.set(def.spec, loaded.spec);
  }
});

describe('HF2: default parity over the 259 stored H1 runs', () => {
  it('re-scores every stored run to its stored verdicts with every value compared exactly', async () => {
    const runs = h1Runs();
    expect(runs.length).toBe(259);
    let changed = 0;
    let passChanged = 0;
    let gating = 0;
    const rows: string[] = [];
    for (const run of runs) {
      const def = BLOCKS[run.block];
      if (!def) throw new Error(run.block);
      const ctx = exactly(h1Context(specs.get(def.spec) as Spec, def.index, run));
      const plan = scoringPlan(defaultChecks(), shippedObjectContext().store.resolve('check-set', 'default'));
      const verdicts = await applyScoringPlan(plan, ctx);
      expect(
        verdicts.every(
          (verdict) => verdict.by?.object && verdict.by.item && verdict.by.impl && verdict.by.layer,
        ),
      ).toBe(true);
      gating += verdicts.filter((verdict) => verdict.gating).length;
      const failed = failedLikeStored(ctx, verdicts);
      const diff = multisetDiff(run.exactFailed, failed);
      changed += diff;
      if (run.exact !== (failed.length === 0)) passChanged += 1;
      if (diff > 0) rows.push(`${run.id}: stored ${run.exactFailed.join(',')} now ${failed.join(',')}`);
    }
    expect(rows).toEqual([]);
    expect(changed).toBe(0);
    expect(passChanged).toBe(0);
    expect(runs.filter((run) => run.exact).length).toBe(77);
    expect(gating).toBeGreaterThan(1_000);
  });

  it('changes no verdict with the shipped value-check default either: a value nothing decides is compared exactly', async () => {
    const delta: string[] = [];
    for (const run of h1Runs()) {
      const def = BLOCKS[run.block];
      if (!def) throw new Error(run.block);
      const ctx = asStored(h1Context(specs.get(def.spec) as Spec, def.index, run));
      const plan = scoringPlan(defaultChecks(), shippedObjectContext().store.resolve('check-set', 'default'));
      const verdicts = await applyScoringPlan(plan, ctx);
      expect(
        verdicts.every(
          (verdict) => verdict.by?.object && verdict.by.item && verdict.by.impl && verdict.by.layer,
        ),
      ).toBe(true);
      if (multisetDiff(run.exactFailed, failedLikeStored(ctx, verdicts)) > 0) delta.push(run.id);
    }
    expect(delta).toEqual([]);
  });

  it('with the normalise rules of the specs kept, the same runs flip: stored failures that the rules now pass', async () => {
    const runs = h1Runs();
    expect(runs.length).toBe(259);
    const flipped: string[] = [];
    const worse: string[] = [];
    for (const run of runs) {
      const def = BLOCKS[run.block];
      if (!def) throw new Error(run.block);
      // The normal path: the Then as the spec writes it, rules included, values compared exactly.
      const raw = h1Context(specs.get(def.spec) as Spec, def.index, run);
      const ctx = { ...raw, expect: exactlyTools(raw.expect) };
      const plan = scoringPlan(defaultChecks(), shippedObjectContext().store.resolve('check-set', 'default'));
      const failed = failedLikeStored(ctx, await applyScoringPlan(plan, ctx));
      if (multisetDiff(run.exactFailed, failed) === 0) continue;
      flipped.push(run.id);
      if (failed.some((id) => !run.exactFailed.includes(id))) worse.push(run.id);
    }
    expect(flipped).toHaveLength(FLIPPED);
    expect(worse).toEqual([]);
  });
});

/**
 * The runs the specs' normalise rules (block phase 1 oracle, PR 434) score differently from the stored oracle:
 * each one a stored failure that now fails on fewer verdicts.
 */
const FLIPPED = 97;

/** The context with the Then as the stored oracle read it: no normalise rule. */
function asStored(ctx: CheckContext): CheckContext {
  return { ...ctx, expect: withoutNormaliseRules(ctx.expect) };
}

/**
 * The context as the stored oracle read it, with every expected tool's values compared exactly, for a reason:
 * today's verdicts.
 */
function exactly(ctx: CheckContext): CheckContext {
  return { ...ctx, expect: exactlyTools(withoutNormaliseRules(ctx.expect)) };
}

function exactlyTools(expect: Expect): Expect {
  return {
    ...expect,
    tools: expect.tools?.map((tool) => ({
      ...tool,
      compare: { exact: 'HF2 parity with the stored oracle' },
    })),
  };
}
