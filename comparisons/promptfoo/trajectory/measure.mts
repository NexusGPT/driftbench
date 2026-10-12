// Tool-sequence diagnosis on 100 fictional traces. Each trace's first wrong call is at a known position.
// Ours: the tool_order check (exact mode) names the first difference by call position.
// Promptfoo: its tool-sequence reason (src/assertions/trajectory.ts, handleTrajectoryToolSequence, exact mode) lists the
// expected names and the observed names, and does not name the position of the first wrong call.
// Run: npx tsx comparisons/promptfoo/trajectory/measure.mts
import { tools } from '../../../packages/checks/src/checks/tools';
import { acme } from '../../../packages/checks/test/support/acme';
import { context, observed, run, verdict } from '../../../packages/checks/test/support/context';

const TOOLS = ['coverage.check', 'catalog.search', 'notify_sales', 'order.create'];
let seed = 20261012;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;

const base = acme('acme-new-customer-coverage');
const cases = Array.from({ length: 100 }, (_, i) => {
  const expected = [...TOOLS].sort(() => next() - 0.5).slice(0, 3);
  const observedLabels = [...expected];
  const at = Math.floor(next() * expected.length);
  const kind = pick(['wrong-name', 'missing', 'extra']);
  if (kind === 'wrong-name')
    observedLabels[at] = TOOLS.find((t) => !expected.includes(t) || t !== expected[at]) ?? 'other.tool';
  if (kind === 'wrong-name' && observedLabels[at] === expected[at]) observedLabels[at] = 'other.tool';
  if (kind === 'missing') observedLabels.splice(at, 1);
  if (kind === 'extra') observedLabels.splice(at, 0, 'extra.tool');
  return { id: `trace.${i + 1}`, expected, observedLabels, firstWrong: at + 1 };
});

let oursNamesPosition = 0;
let theirsNamesPosition = 0;
for (const c of cases) {
  const spec = {
    ...base,
    blocks: base.blocks.map((b, bi) =>
      bi === 0
        ? {
            ...b,
            expect: {
              ...(b.expect ?? {}),
              tools: c.expected.map((label) => ({ label, count: 1 })),
              tool_order: 'exact',
            },
          }
        : b,
    ),
  };
  const calls = c.observedLabels.map((label) => ({ label, input: {} }));
  const verdicts = await run(tools, context(spec, 0, observed('ok', calls)));
  const order = verdicts.find((v) => v.id.endsWith('.order'));
  const evidence = order?.evidence ?? '';
  if (new RegExp(`call ${c.firstWrong}\\b`).test(evidence)) oursNamesPosition += 1;
  // Promptfoo's exact-mode reason has no call position; it names the expected and actual lists only.
  const promptfooReason = `Expected exact tool sequence of ${c.expected.join(', ')}, but actual tools were ${c.observedLabels.join(', ')}`;
  if (/call \d+|position|step \d+/.test(promptfooReason)) theirsNamesPosition += 1;
  void verdict;
}
console.log(
  JSON.stringify(
    {
      traces: cases.length,
      ours: { namesFirstWrongPosition: oursNamesPosition },
      promptfooExactReason: { namesFirstWrongPosition: theirsNamesPosition },
    },
    null,
    2,
  ),
);
