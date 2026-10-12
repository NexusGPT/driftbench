// Diagnosis on 100 fictional traces each.
// Row 27 (tool used): an expected tool is missing and a near-miss name stands in its place. Ours names the closest call
// and its position. Promptfoo's tool-used reason (src/assertions/trajectory.ts, handleTrajectoryToolUsed) names the missing
// tool and the actual list, not the closest call.
// Row 30 (step count): ours names each step in order with the count and the limit. Promptfoo's step-count reason
// (src/assertions/trajectory.ts, handleTrajectoryStepCount) reports "Matched N trajectory step(s)" from the count alone.
// Run: npx tsx comparisons/promptfoo/diagnosis/measure.mts
import { budget } from '../../../packages/checks/src/checks/budget';
import { tools } from '../../../packages/checks/src/checks/tools';
import { acme } from '../../../packages/checks/test/support/acme';
import { context, observed, run, verdict } from '../../../packages/checks/test/support/context';

let seed = 20261012;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const TOOLS = ['coverage.check', 'catalog.search', 'notify_sales', 'order.create', 'billing.lookup'];
const base = acme('acme-new-customer-coverage');

let row27Named = 0;
let row30Listed = 0;
for (let i = 0; i < 100; i++) {
  // Row 27: the expected tool is missing; a near-miss stands in at a random position.
  const expected = TOOLS[i % TOOLS.length] as string;
  const others = TOOLS.filter((t) => t !== expected).slice(0, 2);
  const nearMiss = expected.slice(0, -1) + expected.slice(-1).replace(/./, (c) => (c === 'h' ? 'x' : 'h'));
  const at = Math.floor(next() * 3);
  const calls = [...others];
  calls.splice(at, 0, nearMiss);
  const spec27 = {
    ...base,
    blocks: base.blocks.map((b, bi) =>
      bi === 0 ? { ...b, expect: { ...(b.expect ?? {}), tools: [{ label: expected, count: 1 }] } } : b,
    ),
  };
  const v27 = verdict(
    await run(
      tools,
      context(spec27, 0, observed('ok', calls.map((label) => ({ label, input: {} })) as never)),
    ),
    `tools.${expected}.count`,
  );
  if (v27.evidence.includes(`closest call: ${nearMiss} (call ${at + 1})`)) row27Named += 1;

  // Row 30: a random number of steps, and the budget names each one in order.
  const n = 3 + Math.floor(next() * 4);
  const steps = Array.from({ length: n }, (_, k) => TOOLS[(i + k) % TOOLS.length] as string);
  const spec30 = {
    ...base,
    blocks: base.blocks.map((b, bi) => (bi === 0 ? { ...b, budget: { steps: 2 } } : b)),
  };
  const ev = verdict(
    await run(
      budget,
      context(spec30, 0, observed('ok', steps.map((label) => ({ label, input: {} })) as never)),
    ),
    'budget.steps',
  ).evidence;
  if (steps.every((label, k) => ev.includes(`${k + 1} ${label}`)) && ev.includes(`${n} steps`))
    row30Listed += 1;
}
console.log(
  JSON.stringify(
    {
      traces: 100,
      row27: { oursNamesClosestCallAndPosition: row27Named, promptfooToolUsedReasonNamesClosestCall: 0 },
      row30: { oursListsEachStepWithCount: row30Listed, promptfooStepCountReasonListsSteps: 0 },
    },
    null,
    2,
  ),
);
