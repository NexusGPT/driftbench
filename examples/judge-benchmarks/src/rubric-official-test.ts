import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wilson } from '@agent-nexus/driftbench-stats';
import { contestantById } from './contestants';
import { loadBenchmark, splitOf, stratifiedSample } from './data';
import { readRecordingRows } from './recording-files';
import { RECORDINGS, type RunReport, runBenchmark } from './run';

/** One frozen confirmation on the previously evaluated split, with no further design selection. */
async function main(): Promise<void> {
  const [directory, ledger, secondsArgument] = process.argv.slice(2);
  if (!directory || !ledger) throw new Error('Pass the authorized result directory and spend ledger');
  const secondsPerCall = Number(secondsArgument);
  if (!Number.isFinite(secondsPerCall) || secondsPerCall <= 0)
    throw new Error('Pass the measured dev campaign seconds per new call');
  const frozen = JSON.parse(await readFile(join(directory, 'frozen-design.json'), 'utf8')) as {
    commit: string;
    configSha256: string;
    uniqueCalls: number;
    devItems: number;
    frozenAt: string;
    frozenBy0430: boolean;
  };
  const configText = await readFile(join(directory, 'best-config.json'), 'utf8');
  if (createHash('sha256').update(configText).digest('hex') !== frozen.configSha256)
    throw new Error('Frozen configuration changed');
  const sourceDiff = execFileSync(
    'git',
    ['diff', frozen.commit, '--', 'examples/judge-benchmarks/src', 'examples/judge-benchmarks/test'],
    { encoding: 'utf8' },
  );
  if (sourceDiff.trim()) throw new Error('Judge source changed after the freeze');
  const config = JSON.parse(configText) as { contestant: string; model: string };
  if (config.model !== 'haiku') throw new Error('The authorized model is haiku');
  const deadlineMs = new Date('2026-10-13T06:30:00+02:00').getTime();
  const secondsAvailable = Math.max(0, (deadlineMs - Date.now()) / 1000);
  if (secondsAvailable === 0) throw new Error('Official test deadline reached');
  const all = (await loadBenchmark('rubricbench')).items;
  const population = all.filter((item) => splitOf('rubricbench', item.id) === 'test');
  const callsPerItem = frozen.uniqueCalls / frozen.devItems;
  const projectedFullSeconds = population.length * callsPerItem * secondsPerCall;
  const sample =
    projectedFullSeconds <= secondsAvailable
      ? undefined
      : Math.max(
          1,
          Math.min(population.length, Math.floor((secondsAvailable * 0.6) / (callsPerItem * secondsPerCall))),
        );
  const seed = 'rubricbench-official-2026-10-13';
  const fallbackSize =
    sample ??
    Math.max(
      1,
      Math.min(population.length - 1, Math.floor((secondsAvailable * 0.6) / (callsPerItem * secondsPerCall))),
    );
  const fallback = stratifiedSample(population, fallbackSize, seed);
  const fallbackIds = new Set(fallback.map((item) => item.id));
  // Judge a predeclared stratified fallback first. If a projected full run overruns,
  // reporting this fixed subset needs no additional model call or post-hoc sample choice.
  const selected = sample
    ? fallback
    : [...fallback, ...population.filter((item) => !fallbackIds.has(item.id))];
  const recording = await readRecordingRows(join(RECORDINGS, 'rubricbench', 'haiku.jsonl'));
  const taskSpend = recording
    .filter(
      (row) => row.contestant?.startsWith('driftbench-rb-') || row.contestant === 'driftbench-checklist',
    )
    .reduce((sum, row) => sum + row.costUsd, 0);
  const capUsd = Math.max(0, 8 - 0.05 - taskSpend);
  const plan = {
    resultClassification: 'confirmation on a previously evaluated split',
    startedAt: new Date().toISOString(),
    frozenCommit: frozen.commit,
    frozenAt: frozen.frozenAt,
    frozenBy0430: frozen.frozenBy0430,
    contestant: config.contestant,
    population: population.length,
    requestedItems: selected.length,
    stratifiedSample: sample !== undefined,
    seed,
    secondsPerCall,
    callsPerItem,
    fallbackSize: fallback.length,
    fallbackIds: [...fallbackIds],
    projectedFullSeconds,
    secondsAvailable,
    capUsd,
    populationDomains: Object.fromEntries(
      [...new Set(population.map((item) => item.group))].map((group) => [
        group,
        population.filter((item) => item.group === group).length,
      ]),
    ),
    domains: Object.fromEntries(
      [...new Set(population.map((item) => item.group))].map((group) => [
        group,
        selected.filter((item) => item.group === group).length,
      ]),
    ),
  };
  // Exclusive creation prevents a second held-out attempt from being mistaken for the first.
  await writeFile(join(directory, 'official-test-start.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
  });
  console.log(JSON.stringify(plan));
  const liveAttempt = await runBenchmark({
    bench: 'rubricbench',
    model: 'haiku',
    split: 'test',
    items: selected,
    contestants: [contestantById(config.contestant)],
    concurrency: 1,
    capUsd,
    deadlineMs,
    onProgress: ({ calls, spentUsd, item }) => {
      if (calls > 0 && calls % 10 === 0)
        console.log(`Frozen confirmation calls=${calls} spend=${spentUsd.toFixed(6)} item=${item}`);
    },
  });
  const usedFallback = !sample && liveAttempt.stopped !== undefined;
  const reportItems = usedFallback ? fallback : selected;
  const run = usedFallback
    ? await runBenchmark({
        bench: 'rubricbench',
        model: 'haiku',
        split: 'test',
        items: fallback,
        contestants: [contestantById(config.contestant)],
        concurrency: 1,
        replayOnly: 'lenient',
      })
    : liveAttempt;
  const result = run.contestants[0];
  if (!result) throw new Error('No official result');
  // Every eligible new design shares one winner across both game entries. Use item n,
  // not doubled game n, for the interval. A partial run never receives a complete-result interval.
  const evaluated = !run.stopped && (!usedFallback || result.summary.missing === 0);
  const interval =
    evaluated && result.summary.n > 0
      ? wilson(Math.round(result.summary.value.estimate * result.summary.n), result.summary.n)
      : undefined;
  const official = {
    ...plan,
    requestedItems: run.items,
    attemptRequestedItems: liveAttempt.items,
    stratifiedSample: sample !== undefined || usedFallback,
    usedFallback,
    measuredAt: new Date().toISOString(),
    run,
    liveAttempt,
    interval,
    intervalMethod: '95% Wilson interval over item outcomes; shared game entries are not independent',
    usdPer100: ((result.uniqueCostUsd ?? result.costUsd) / run.items) * 100,
    attemptUsdPer100ReportedItems:
      ((liveAttempt.contestants[0]?.uniqueCostUsd ?? liveAttempt.contestants[0]?.costUsd ?? 0) / run.items) *
      100,
    complete: evaluated,
  };
  await writeFile(join(directory, 'official-test.json'), `${JSON.stringify(official, null, 2)}\n`);
  const time = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
  });
  await appendFile(
    ledger,
    `| ${time} | codex/rb-judge official frozen test, ${run.items} reported items${official.stratifiedSample ? ', predeclared stratified sample' : ', full set'}${liveAttempt.stopped ? ', full attempt stopped' : ''} | haiku | ${liveAttempt.newCalls} | ${capUsd.toFixed(6)} | ${liveAttempt.newSpendUsd.toFixed(6)} | rb task ${(taskSpend + liveAttempt.newSpendUsd).toFixed(6)} of 8.00 |\n`,
  );
  // Competitors only replay their existing default prompts on the exact selected item set.
  const competitors: RunReport = await runBenchmark({
    bench: 'rubricbench',
    model: 'haiku',
    split: 'test',
    items: reportItems,
    contestants: ['deepeval', 'promptfoo'].map(contestantById),
    concurrency: 1,
    replayOnly: 'lenient',
  });
  await writeFile(
    join(directory, 'official-test-competitors.json'),
    `${JSON.stringify({ frozenCommit: frozen.commit, run: competitors }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      contestant: config.contestant,
      items: run.items,
      accuracy: result.summary.value.estimate,
      interval,
      usdPer100: official.usdPer100,
      stopped: run.stopped,
    }),
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
