// Reads the report of `driftbench validate stats --items --json` run on one Node.js version and prints each failing
// item. On Node.js 24 two failures are the same engine issue (validators/stats/GATE.md, "Node 24 and the shifted
// bootstrap item") and do not fail the run, each labelled:
//  - the shifted bootstrap item, which fails on some runs with a correct package;
//  - a seed the frame tainted because a confined run answered `bootstrapCI` with a result of a shape it never
//    returns (a bootstrap result always has clusters, iterations, method and seed): every item of the seed fails with
//    the frame's message, and the seed counts once.
// Any other failing item fails the run, and on any other Node.js version nothing is labelled. The gate and the floor
// never read this script: they run on Node.js 22 with `--check-floor`.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KNOWN_ENGINE_ITEM = 'stability.bootstrap-shift-1000000000';
const DOC = 'validators/stats/GATE.md, "Node 24 and the shifted bootstrap item"';

const TAINT = /no item of seed (\d+) counts: (\w+)\(.*?run A \(confined[^)]*\) answered (\{[^}]*\}),/s;
const BOOTSTRAP_FIELDS = ['clusters', 'iterations', 'method', 'seed'];

/**
 * The seed a failing item's message taints by the engine issue, or undefined: the frame's taint message, on a
 * `bootstrapCI` call, where the confined run's answer is an object that lacks a field every bootstrap result has.
 */
function engineTaint(detail) {
  const found = TAINT.exec(detail ?? '');
  if (found?.[2] !== 'bootstrapCI') return undefined;
  try {
    const answer = JSON.parse(found[3]);
    return BOOTSTRAP_FIELDS.some((field) => !(field in answer)) ? found[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Sorts the failing items of a report into the known engine issue and the unexpected ones. */
export function labelFailures(report, nodeMajor) {
  const all = report.failingItems ?? [];
  const known = [];
  const lines = [`Node ${nodeMajor}: level ${report.level}.`];
  const seeds = (item) => (item.seeds ?? []).join(', ') || 'unknown';
  // A tainted seed: all its items fail with the frame's message, counted once.
  const taints = new Map();
  if (nodeMajor === 24)
    for (const item of all) {
      const seed = engineTaint(item.detail);
      // An item that also failed on another seed is not all taint: it stays in the list of failures.
      if (seed !== undefined && (item.seeds ?? []).length === 1 && item.seeds[0] === seed)
        taints.set(seed, [...(taints.get(seed) ?? []), item.id]);
    }
  const counted = new Set([...taints.values()].flat());
  for (const [seed, ids] of taints) {
    known.push(`seed ${seed} tainted by the frame`);
    lines.push(
      `seed ${seed}: ${ids.length} items failed the frame's comparison of the runs: a confined run answered bootstrapCI with a result of a shape it never returns, which is the known engine issue of Node 24 (V8), not counted against the package; see ${DOC}.`,
    );
  }
  const failing = all.filter((item) => !counted.has(item.id));
  const asKnown = nodeMajor === 24 ? failing.filter((item) => item.id === KNOWN_ENGINE_ITEM) : [];
  const unexpected = failing.filter((item) => !asKnown.includes(item));
  if (all.length === 0) lines.push('no failing item.');
  for (const item of asKnown) {
    known.push(item.id);
    lines.push(
      `${item.id} failed on seeds ${seeds(item)}: known engine issue of Node 24 (V8), not counted against the package; see ${DOC}.`,
    );
  }
  for (const item of unexpected) lines.push(`${item.id} failed on seeds ${seeds(item)}: unexpected.`);
  return { known, unexpected: unexpected.map((item) => item.id), lines };
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
