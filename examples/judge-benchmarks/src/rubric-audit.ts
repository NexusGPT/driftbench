import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from './call';
import { contestantById, type PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { readRecordingRows } from './recording-files';
import { atomicChecks } from './rubric-atomic';
import { rubricItems } from './rubric-items';
import { RECORDINGS } from './run';
import { type PairResult, scorePairs } from './score';

/** Partial coverage is explicitly reported and never treated as a full-dev score. No model calls. */
async function main(): Promise<void> {
  const ids = (
    process.argv[2] ??
    ['binary', 'equal', 'weighted', 'holistic']
      .flatMap((method) => [
        `driftbench-rb-${method}-canonical`,
        `driftbench-rb-${method}-canonical-executed`,
      ])
      .join(',')
  ).split(',');
  const benchmark = await loadBenchmark('rubricbench');
  const items = benchmark.items.filter((x) => splitOf('rubricbench', x.id) === 'dev') as PairItem[];
  const recordings = await new Recordings(join(RECORDINGS, 'rubricbench', 'haiku.jsonl')).load();
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const flip = (d: PairDecision): PairDecision => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');
  const reports = [];
  for (const id of ids) {
    const contestant = contestantById(id);
    const results: PairResult[] = [];
    const details = [];
    const unique = new Map<string, number>();
    for (const item of items) {
      if (!contestant.pair || !contestant.parsePair)
        throw new Error('Audit supports direct pairwise contestants only');
      const decisions: PairDecision[] = [];
      let complete = true;
      let invalidChecks = false;
      let invalidParse = false;
      let countMismatch = false;
      for (const [a, b] of [
        [item.a, item.b],
        [item.b, item.a],
      ] as const) {
        const reversed = contestant.canonicalOrder === true && hash(a) > hash(b);
        const presentedA = reversed ? b : a;
        const presentedB = reversed ? a : b;
        const evidence = await contestant.pairEvidence?.({
          question: item.question,
          a: presentedA,
          b: presentedB,
        });
        const prompt = contestant.pair({
          question: item.question,
          a: presentedA,
          b: presentedB,
          criterion: item.criterion ?? benchmark.criterion,
          ...(evidence === undefined ? {} : { reference: evidence }),
        });
        const entry = recordings.get(promptKey('haiku', prompt));
        if (!entry) {
          complete = false;
          break;
        }
        unique.set(entry.key, entry.costUsd);
        const parsed = atomicChecks(entry.text);
        const expected = rubricItems(item.criterion ?? benchmark.criterion).length;
        if (!parsed) invalidParse = true;
        else if (parsed.checks.length !== expected) countMismatch = true;
        invalidChecks ||= invalidParse || countMismatch;
        const d = contestant.parsePair(entry.text);
        decisions.push(reversed ? flip(d) : d);
      }
      if (!complete) continue;
      const games = [decisions[0] ?? 'tie', flip(decisions[1] ?? 'tie')];
      results.push({ item, games, missing: 0 });
      details.push({
        id: item.id,
        group: item.group,
        label: item.label,
        games,
        invalidChecks,
        invalidParse,
        countMismatch,
      });
    }
    const cost = [...unique.values()].reduce((a, b) => a + b, 0);
    reports.push({
      contestant: id,
      completeItems: results.length,
      devItems: items.length,
      summary: scorePairs('rubricbench', results),
      uniqueCostUsd: cost,
      costPer100: results.length ? (cost / results.length) * 100 : 0,
      details,
    });
  }
  const directory = join(fileURLToPath(new URL('..', import.meta.url)), 'experiments', 'rb');
  const rows = await readRecordingRows(join(RECORDINGS, 'rubricbench', 'haiku.jsonl'));
  const taskRows = rows.filter(
    (r) => r.contestant?.startsWith('driftbench-rb-') || r.contestant === 'driftbench-checklist',
  );
  const output = {
    measuredAt: new Date().toISOString(),
    newTaskSpendUsd: taskRows.reduce((s, r) => s + r.costUsd, 0),
    reports,
  };
  await writeFile(join(directory, 'audit.json'), `${JSON.stringify(output, null, 2)}\n`);
  for (const report of reports)
    console.log(
      JSON.stringify({ ...report, details: undefined, summary: { ...report.summary, byGroup: undefined } }),
    );
  console.log(`Task recorded spend ${output.newTaskSpendUsd.toFixed(6)} USD`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
