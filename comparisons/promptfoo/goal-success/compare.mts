// Goal success on 100 fictional sessions: our deterministic end-state check against model judges that read only the reply.
// Ground truth is the recorded end state (cases.json). Run: npx tsx comparisons/promptfoo/goal-success/compare.mts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareEndState } from '../../../packages/core/src/runner/assertion';

const dir = fileURLToPath(new URL('.', import.meta.url));
const { cases } = JSON.parse(readFileSync(`${dir}cases.json`, 'utf8')) as {
  cases: Array<{ id: string; endState: unknown; truth: 'pass' | 'fail'; replyKind: string }>;
};
// The end-state spec of the goal: the order payload must name the mobile M plan.
const spec = {
  source: 'tool:order.create',
  mode: 'subset' as const,
  expect: { plan_id: { one_of: ['mobile-m'] } },
};

const tally = (rows: Array<{ outcome: string; truth: string }>) => {
  const decided = rows.filter((r) => r.outcome === 'pass' || r.outcome === 'fail');
  const right = decided.filter((r) => r.outcome === r.truth).length;
  return {
    decided: decided.length,
    right,
    wrong: decided.length - right,
    inconclusive: rows.length - decided.length,
  };
};

const ours = cases.map((c) => ({
  id: c.id,
  truth: c.truth,
  outcome: c.endState === undefined ? 'fail' : compareEndState(spec, c.endState).match ? 'pass' : 'fail',
}));
const result: Record<string, unknown> = { ours: tally(ours) };
for (const model of ['haiku', 'sonnet']) {
  const file = `${dir}recorded-${model}.json`;
  if (!existsSync(file)) continue;
  const rows = (
    JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<{ id: string; truth: string; outcome: string }> }
  ).rows;
  result[model] = {
    ...tally(rows),
    costUsd: Number(JSON.parse(readFileSync(file, 'utf8')).costUsd.toFixed(4)),
  };
}
console.log(JSON.stringify(result, null, 2));
