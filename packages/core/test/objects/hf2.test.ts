// HF2 as a CI test: the 259 stored H1 runs (copied byte for byte from research/block-phrasing, sha in
// SHA256SUMS) re-scored by the shipped checks, with each block's spec read through the framework's loader,
// give the stored verdicts: 0 changed verdicts, 0 runs whose pass flag changed. Since the value-check ladder
// (block phase 1, V1) parity holds with every tool's values compared exactly (`compare: { exact }`), and the
// shipped default's change is pinned run by run below: every change is a fail turned pass on the slot field.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbidden, tools } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Expect } from '@agent-nexus/driftbench-core';
import { loadSpecFile, type Spec, type Verdict } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS, failedLikeStored, h1Context, h1Runs, multisetDiff } from './h1';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

const specs = new Map<string, Spec>();
beforeAll(async () => {
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
      const verdicts: Verdict[] = [];
      for (const check of [tools, forbidden])
        if (check.applies(ctx)) verdicts.push(...(await check.evaluate(ctx)));
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

  it('pins the default ladder delta: 48 slot verdicts turn from fail to pass, each by its rung, none the other way', async () => {
    const delta: string[][] = [];
    const runFlips: string[] = [];
    for (const run of h1Runs()) {
      const def = BLOCKS[run.block];
      if (!def) throw new Error(run.block);
      const ctx = h1Context(specs.get(def.spec) as Spec, def.index, run);
      const verdicts: Verdict[] = [];
      for (const check of [tools, forbidden])
        if (check.applies(ctx)) verdicts.push(...(await check.evaluate(ctx)));
      const failed = failedLikeStored(ctx, verdicts);
      expect(
        failed.filter((id) => !run.exactFailed.includes(id)),
        run.id,
      ).toEqual([]);
      for (const id of run.exactFailed.filter((each) => !failed.includes(each))) {
        const evidence = verdicts.find((verdict) => verdict.id === id)?.evidence ?? '';
        delta.push([run.id, id, /\(call 1[^:]*: \S+ (\w+):/.exec(evidence)?.[1] ?? 'none']);
      }
      if (!run.exact && failed.length === 0) runFlips.push(run.id);
    }
    const order = (row: string[]) =>
      (row[0] ?? '')
        .split('#')
        .map((part, at) => (at === 1 ? part.padStart(3, '0') : part))
        .join('#');
    delta.sort((a, b) => order(a).localeCompare(order(b)));
    expect(delta.map((row) => row.join(' '))).toEqual(DELTA.map((row) => row.join(' ')));
    // The 8 B9 runs and 8 of the 9 B3 runs still fail on their other checks (catalog.search never called).
    expect(runFlips.map((id) => id.split('#')[0])).toEqual([
      ...Array(10).fill('B2'),
      'B3',
      ...Array(21).fill('B7'),
    ]);
  });
});

/** The context with every expected tool's values compared exactly, for a reason: today's verdicts. */
function exactly(ctx: CheckContext): CheckContext {
  const expect: Expect = {
    ...ctx.expect,
    tools: ctx.expect.tools?.map((tool) => ({
      ...tool,
      compare: { exact: 'HF2 parity with the stored oracle' },
    })),
  };
  return { ...ctx, expect };
}

/**
 * The published delta of the shipped value-check default on the 259 H1 runs, read with each block's own user
 * turn: run, slot verdict turned from fail to pass, the rung that decided it. A change in this list fails.
 */
const DELTA: string[][] = [
  ['B2#1#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#3#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#7#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#10#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#15#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#16#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#20#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#24#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#27#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B2#29#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B3#2#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#9#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#11#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#12#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#16#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#19#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#22#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#24#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B3#29#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B7#0#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#1#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#3#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#4#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#7#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#8#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#9#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#10#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#12#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#13#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#15#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#16#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#17#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#19#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#21#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#22#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#23#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#24#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#26#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#27#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B7#28#0', 'tools.notify_sales.input.customer', 'rung2b_as_given'],
  ['B9#1#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#3#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#6#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#8#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#16#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#17#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#21#0', 'tools.port.check.input.number', 'rung2b_as_given'],
  ['B9#28#0', 'tools.port.check.input.number', 'rung2b_as_given'],
];
