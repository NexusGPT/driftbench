/** Compare the committed Acme suite with the refreshed suite on the original shortcut agents. */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { loadSpecs, parseSpecText, type Spec } from '../../packages/core/src/index';
import { blockOutcome, runOnce, trivialAdapter } from '../../packages/generate/src/gate';
import { runContext } from '../../packages/validators/src/ladders/generator/measure';

const [base = 'a0fedc3b27508ff342a18f5957f1485a253a2719', output = '.exec/opening-acme.json'] =
  process.argv.slice(2);
const folder = 'examples/acme/generated/specs';
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', base, folder], { encoding: 'utf8' })
  .trim()
  .split('\n');
const before = paths.map((path) => {
  const parsed = parseSpecText(
    execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }),
    'yaml',
    path,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  return parsed.spec;
});
const loaded = await loadSpecs([folder]);
const after = loaded.map((entry) => {
  if (!entry.ok) throw new Error(JSON.stringify(entry));
  return entry.spec;
});
async function measure(specs: Spec[]) {
  const counts = { constant: 0, echo: 0, 'first-tool': 0 };
  for (const spec of specs) {
    for (const name of ['constant', 'echo', 'first-tool'] as const) {
      const result = await runOnce(spec, trivialAdapter(name, spec), 1, runContext());
      if (result.status !== 'completed') throw new Error(`${spec.id}: ${result.status}`);
      counts[name] += spec.blocks.filter((_, index) => blockOutcome(result, index) === 'pass').length;
    }
  }
  return {
    specs: specs.length,
    blocks: specs.reduce((sum, spec) => sum + spec.blocks.length, 0),
    cheaterBlockPasses: counts,
  };
}
const report = {
  base,
  at: new Date().toISOString(),
  before: await measure(before),
  after: await measure(after),
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
