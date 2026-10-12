// A user check that never finishes, against one that does. 100 fictional runs: 50 hang, 50 finish with a pass.
// Ours: createCustomCheck with a 50 ms limit. A hanging check must come back as a fail inside the limit; a finishing
// check must keep its own verdict. Promptfoo's JavaScript assertion (src/assertions/javascript.ts, the await of the user
// function at the call site) has no limit, so a hanging check never returns; that column is read from its source.
// Run: npx tsx comparisons/promptfoo/user-check-limit/measure.mts

import { machineVerdict } from '@driftbench/core';
import { CheckRegistry, createCustomCheck } from '../../../packages/checks/src/checks/custom';
import { acme } from '../../../packages/checks/test/support/acme';
import { context, observed, run } from '../../../packages/checks/test/support/context';

const base = acme('acme-new-customer-coverage');
let inTime = 0;
for (let i = 0; i < 100; i++) {
  const hangs = i % 2 === 0;
  const registry = new CheckRegistry().register('probe', () =>
    hangs
      ? (new Promise(() => {}) as never)
      : (machineVerdict('probe', 'probe', 'pass', 'finished') as never),
  );
  const spec = { ...base, rules: { custom: { probe: {} } } } as never;
  const started = Date.now();
  const verdicts = await run(
    createCustomCheck(registry, { timeoutMs: 50 }),
    context(spec, 1, observed('hi')),
  );
  const elapsed = Date.now() - started;
  const v = verdicts[0] as { outcome: string };
  const correct = hangs ? v.outcome === 'fail' && elapsed < 1000 : v.outcome === 'pass';
  if (correct) inTime += 1;
}
console.log(
  JSON.stringify(
    {
      runs: 100,
      ours: { correctWithinLimit: inTime },
      promptfooWithoutLimit: { finishingRunsReturn: 50, hangingRunsReturnedFromSource: 0 },
    },
    null,
    2,
  ),
);
