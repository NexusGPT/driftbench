import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParallelRunner } from './parallel-runner.mts';
import { createPR115Client, pr115Runtime } from './pr115.mts';
import { here } from './runner.mts';
import { type StructuredCase, trustedRequest } from './trusted-adapter-v2.mts';

const file = join(here, 'recorded/longtrace-v2-pr115.json');
const record = JSON.parse(readFileSync(file, 'utf8'));
const items = JSON.parse(readFileSync(join(here, 'longtrace-v2/hard.json'), 'utf8')) as StructuredCase[];
pr115Runtime();
const completed = new Map(record.answers.map((answer: { id: string }) => [answer.id, answer]));
const runner = new ParallelRunner();
let next = 0;
const remaining = items.filter((item) => !completed.has(item.id));
const save = () => {
  record.answers = items.flatMap((item) => (completed.has(item.id) ? [completed.get(item.id)] : []));
  record.complete = record.answers.length === 120;
  record.transport = {
    transportCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    parallelism: 6,
    budgetUsd: 16,
    stop: '2026-10-13T06:35:00+02:00',
    authorization:
      'Lead authorized six simultaneous calls and doubled cap after 23 cases; frozen input/procedure bytes unchanged',
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
};
async function worker() {
  while (next < remaining.length) {
    const item = remaining[next++];
    if (!item) break;
    const request_sha256s: string[] = [],
      predictions: Array<string | null> = [],
      details: unknown[] = [];
    let costUsd = 0;
    const client = createPR115Client(runner, (call) => {
      request_sha256s.push(call.request_sha256);
      costUsd += call.costUsd;
    });
    for (const [index] of item.criteria.entries()) {
      const result = await client.judge(trustedRequest(item, index));
      predictions.push(result.unparsed ? null : result.answer.outcome);
      details.push({ answer: result.answer, checks: result.checks, unparsed: result.unparsed });
    }
    completed.set(item.id, {
      id: item.id,
      predictions,
      details,
      request_sha256s,
      costUsd,
      transportRecovered: false,
      unscored: false,
    });
    save();
    console.log('PR115 long completed', record.answers.length, '/120');
  }
}
const results = await Promise.allSettled(Array.from({ length: 6 }, () => worker()));
save();
for (const result of results) if (result.status === 'rejected') console.error(String(result.reason));
console.log(
  JSON.stringify({
    complete: record.complete,
    cases: record.answers.length,
    freshUsd: runner.fresh,
    calls: runner.calls,
  }),
);
