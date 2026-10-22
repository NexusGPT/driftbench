// Reads the report of `driftbench validate stats --items --json` run on one Node.js version and prints each failing
// item. On Node.js 24 the shifted bootstrap item fails on some runs with a correct package (an engine issue, see
// validators/stats/GATE.md, "Node 24 and the shifted bootstrap item"): that one failure is labelled and does not
// fail the run. Any other failing item fails it, and on any other Node.js version nothing is labelled. The gate and
// the floor never read this script: they run on Node.js 22 with `--check-floor`.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KNOWN_ENGINE_ITEM = 'stability.bootstrap-shift-1000000000';
const DOC = 'validators/stats/GATE.md, "Node 24 and the shifted bootstrap item"';

/** Sorts the failing items of a report into the known engine issue and the unexpected ones. */
export function labelFailures(report, nodeMajor) {
  const failing = (report.failingItems ?? []).map((item) => item.id);
  const known = nodeMajor === 24 ? failing.filter((id) => id === KNOWN_ENGINE_ITEM) : [];
  const unexpected = failing.filter((id) => !known.includes(id));
  const seeds = (id) =>
    ((report.failingItems ?? []).find((item) => item.id === id)?.seeds ?? []).join(', ') || 'unknown';
  const lines = [`Node ${nodeMajor}: level ${report.level}.`];
  if (failing.length === 0) lines.push('no failing item.');
  for (const id of known)
    lines.push(
      `${id} failed on seeds ${seeds(id)}: known engine issue of Node 24 (V8), not counted against the package; see ${DOC}.`,
    );
  for (const id of unexpected) lines.push(`${id} failed on seeds ${seeds(id)}: unexpected.`);
  return { known, unexpected, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, major] = process.argv.slice(2);
  if (!file || !major) {
    console.error('usage: engine-label.mjs <report.json> <node major>');
    process.exit(2);
  }
  const got = labelFailures(JSON.parse(readFileSync(file, 'utf8')), Number(major));
  console.log(got.lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${got.lines.map((line) => `- ${line}`).join('\n')}\n`);
  for (const id of got.known) console.log(`::notice::${id}: known engine issue of Node ${major}`);
  for (const id of got.unexpected) console.log(`::error::${id} failed on Node ${major}`);
  process.exit(got.unexpected.length > 0 ? 1 : 0);
}
