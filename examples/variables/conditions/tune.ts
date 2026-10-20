/**
 * Runs the condition feed with the real systems (Jev as system 1, Haiku as system 2) on clause files and scores
 * it (see lib.ts for the file format).
 *
 *   pnpm exec tsx examples/variables/conditions/tune.ts <clauses.json[,more.json]> <cache.json> <config>...
 *
 * Answers are cached by clause and question text, so a config that only changes a threshold costs nothing.
 * EXPORT=<file> writes the answers the run used, as a recording a test replays. SHOW_WRONG=1 lists the errors.
 * Keys are read by path and never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicPort, createJevReader } from '../../../packages/generate/src';
import { type Cache, type Clause, configNamed, makeSystems, runConfig, summary } from './lib';

const secret = (name: string) => readFileSync(join(homedir(), '.nexus-secrets', name), 'utf8').trim();
const [clausesArg, cachePath, ...names] = process.argv.slice(2);
if (!clausesArg || !cachePath || names.length === 0) {
  throw new Error('usage: tune.ts <clauses.json[,more.json]> <cache.json> <config>...');
}
const clauses = clausesArg.split(',').flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as Clause[]);
const cache: Cache = existsSync(cachePath)
  ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Cache)
  : { reads: {}, proposals: {} };
const jev = createJevReader({ env: { JEV_ROUTE: 'typesafe', JEV_API_KEY: secret('jev-typesafe.key') } });
const port = createAnthropicPort({
  env: { ANTHROPIC_API_KEY: secret('anthropic-driftbench.key'), ANTHROPIC_MODEL: 'claude-haiku-5-5' },
});
const systems = makeSystems(
  cache,
  { read: (clause, questions) => jev.read(clause, questions) as never, port },
  () => writeFileSync(cachePath, JSON.stringify(cache)),
);

for (const name of names) {
  const run = await runConfig(configNamed(name), clauses, systems);
  console.log(summary(name, run));
  for (const o of run.result.report.outcomes)
    if (o.status === 'failed' || o.status === 'refused') console.log(`   ${o.span} ${o.status}: ${o.reason}`);
  if (process.env.SHOW_WRONG) for (const w of run.score.wrong) console.log(`   ${w}`);
  const out = process.env.EXPORT;
  if (out) {
    const used: Cache = { reads: {}, proposals: {} };
    for (const k of systems.touched.reads) used.reads[k] = cache.reads[k];
    for (const k of systems.touched.proposals) used.proposals[k] = cache.proposals[k];
    writeFileSync(out, `${JSON.stringify(used)}\n`);
  }
}
console.log('live calls this run', JSON.stringify(systems.live), 'jev usage', JSON.stringify(jev.usage()));
