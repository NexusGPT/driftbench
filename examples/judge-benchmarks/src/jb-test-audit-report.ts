/** Post-freeze diagnostic audit. Reads a documented audit; never edits the judge or official labels. */
import { readFile, writeFile } from 'node:fs/promises';
import type { RunReport } from './run';
import { type PairResult, scorePairs } from './score';

const out = 'examples/judge-benchmarks/jb-results';
const sample = JSON.parse(await readFile(`${out}/final-test-sample.json`, 'utf8')) as {
  population: number;
  n: number;
  seed: string;
  ids: string[];
  groups: unknown;
};
const audit = JSON.parse(await readFile(`${out}/test-label-audit.json`, 'utf8')) as {
  policy: string;
  reviewed: string[];
  excluded: { id: string; reason: string; sources?: string[] }[];
};
const reviewed = new Set(audit.reviewed),
  excluded = new Set(audit.excluded.map((x) => x.id));
if (sample.ids.some((id) => !reviewed.has(id)))
  throw new Error('Every sampled item needs a documented audit review.');
if (audit.excluded.some((x) => !sample.ids.includes(x.id) || !x.reason.trim()))
  throw new Error('Invalid audit exclusions.');
const run = JSON.parse(await readFile(`${out}/final-test.json`, 'utf8')) as RunReport;
const decisions = JSON.parse(await readFile(`${out}/final-test-decisions.json`, 'utf8')) as Record<
  string,
  PairResult[]
>;
const rows = run.contestants.map((c) => {
  const results = decisions[c.contestant];
  if (!results || results.length !== sample.n || results.some((r) => r.missing))
    throw new Error('Audit scoring requires complete test decisions.');
  return {
    id: c.contestant,
    official: scorePairs('judgebench', results),
    audited: scorePairs(
      'judgebench',
      results.filter((r) => !excluded.has(r.item.id)),
    ),
    cost100: (c.costUsd / results.length) * 100,
  };
});
const result = {
  stamp: new Date().toISOString(),
  sample,
  audit,
  rows,
  interval:
    '95 percent Wilson interval over sampled pair outcomes; proportional stratification and rounding shown separately; no full-population score claimed for a sample.',
};
await writeFile(`${out}/final-test-audited.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
