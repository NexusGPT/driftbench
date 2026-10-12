// Skill use on 100 fictional traces. Each trace has the expected skill loaded some number of times, some of them failed.
// Truth: the number of loads that succeeded. Scored three ways:
//   before: our count before the change, which counted every load, failed ones included;
//   ours: our skills check now (a failed load is not a use);
//   promptfoo: its rule (src/assertions/skill.ts, getSkillCalls): skill calls with is_error true are dropped before counting.
// Run: npx tsx comparisons/promptfoo/skill-used/measure.mts
import { skills } from '../../../packages/checks/src/checks/skills';
import { acme } from '../../../packages/checks/test/support/acme';
import { context, observed, run, verdict } from '../../../packages/checks/test/support/context';

let seed = 20261012;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const base = acme('acme-new-customer-coverage');
let beforeRight = 0;
let oursRight = 0;
let promptfooRight = 0;
for (let i = 0; i < 100; i++) {
  const loads = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
    name: 'pdf',
    failed: next() < 0.4,
  }));
  const truth = loads.filter((l) => !l.failed).length;
  const expectCount = 1;
  const spec = {
    ...base,
    blocks: base.blocks.map((b, bi) =>
      bi === 0 ? { ...b, expect: { ...(b.expect ?? {}), skills: [{ name: 'pdf', count: expectCount }] } } : b,
    ),
  };
  const ours = verdict(
    await run(skills, context(spec, 0, observed('ok', [], { runtime: { skills: loads } } as never))),
    'skills.pdf',
  ).outcome;
  const oursTruth = truth === expectCount ? 'pass' : 'fail';
  if (ours === oursTruth) oursRight += 1;
  const before = loads.length === expectCount ? 'pass' : 'fail';
  if (before === oursTruth) beforeRight += 1;
  const promptfooCount = loads.filter((l) => !l.failed).length;
  if ((promptfooCount === expectCount ? 'pass' : 'fail') === oursTruth) promptfooRight += 1;
}
console.log(
  JSON.stringify(
    {
      traces: 100,
      before: { right: beforeRight },
      ours: { right: oursRight },
      promptfoo: { right: promptfooRight },
    },
    null,
    2,
  ),
);
