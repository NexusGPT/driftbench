/**
 * The child process of one scale run: `node --import tsx scale-child.ts <factor> <seed> <budgetMs>`. It
 * generates the scaled hidden specification twice, measures the time, reads the report, runs the rule
 * follower on every complete spec, and prints one JSON line (a ScaleReport). The parent kills it at the
 * budget.
 */
import { blockOutcome, runOnce, thenFields } from '@driftbench/generate';
import { createFollower } from './follower';
import { followerAdapter, generateFrom, runContext } from './measure';
import { renderMap } from './render';
import { type ScaleReport, scaledSpec } from './scale';

const [factorText, seedText, budgetText] = process.argv.slice(2);
const factor = Number(factorText);
const seed = Number(seedText);
const budgetMs = Number(budgetText);
const spec = scaledSpec(seed, factor);
const started = Date.now();
const generated = await generateFrom(spec, renderMap(spec), seed);
const ms = Date.now() - started;
const report = generated.report;
const adapter = followerAdapter(createFollower(spec));
let followerPass = 0;
let followerTotal = 0;
for (const { spec: generatedSpec } of generated.complete) {
  const run = await runOnce(generatedSpec, adapter, 1, runContext());
  generatedSpec.blocks.forEach((_block, index) => {
    if (thenFields(generatedSpec, index).length === 0) return;
    followerTotal += 1;
    if (blockOutcome(run, index) === 'pass') followerPass += 1;
  });
}
const differ = [...new Set([...generated.first.keys(), ...generated.second.keys()])].filter(
  (path) => generated.first.get(path) !== generated.second.get(path),
);
const graph = report?.graph;
const boundaryValues = spec.data.length;
const out: ScaleReport = {
  factor,
  budgetMs,
  ...(generated.refused ? { error: `refused: ${generated.refused.message}` } : {}),
  ms,
  invalid: (report?.invalid.length ?? 0) + generated.loaded.filter((result) => !result.ok).length,
  lint: report?.lint.length ?? 0,
  bytesSame: differ.length === 0,
  graphOk:
    graph !== undefined &&
    graph.blocked.length === 0 &&
    graph.covered === graph.edges - graph.unreachable.length,
  graphDetail: graph
    ? `${graph.covered} of ${graph.edges} edges covered, ${graph.blocked.length} blocked`
    : 'no report',
  twiseShare: report?.twise.share ?? 0,
  boundaryOk: (report?.boundary.values ?? 0) >= boundaryValues,
  boundaryMissing: Math.max(0, boundaryValues - (report?.boundary.values ?? 0)),
  deviationOk: (report?.deviation.probes.length ?? 0) >= spec.deviations.length,
  deviationMissing: Math.max(0, spec.deviations.length - (report?.deviation.probes.length ?? 0)),
  unwalked: graph?.unwalked?.length ?? 0,
  completeShare: report && report.summary.specs > 0 ? report.summary.complete / report.summary.specs : 0,
  followerPass,
  followerTotal,
};
process.stdout.write(`${JSON.stringify(out)}\n`);
