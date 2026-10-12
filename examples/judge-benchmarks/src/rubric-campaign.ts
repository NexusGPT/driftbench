import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Contestant, contestantById } from './contestants';
import { RECORDINGS, type RunReport, runBenchmark } from './run';

/** Sequential, dev-only campaign with a task-wide cap and a fixed local deadline. */
const DIRECTORY = join(fileURLToPath(new URL('..', import.meta.url)), 'experiments', 'rb');
const DEADLINE = new Date('2026-10-13T07:00:00+02:00').getTime();
const RESERVE = 0.05;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function taskSpend(): Promise<number> {
  const text = await readFile(join(RECORDINGS, 'rubricbench', 'haiku.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => {
      const r = JSON.parse(line) as { contestant?: string; costUsd: number };
      return (
        sum +
        (r.contestant?.startsWith('driftbench-rb-') || r.contestant === 'driftbench-checklist'
          ? r.costUsd
          : 0)
      );
    }, 0);
}

const won = (report: RunReport) =>
  report.contestants.some(
    (r) => r.summary.n === 357 && r.summary.missing === 0 && r.summary.value.estimate >= 0.9,
  );

async function main(): Promise<void> {
  const ledger = process.argv[2];
  if (!ledger) throw new Error('Pass the authorized spend ledger path');
  // The first run is owned by the foreground experiment process. Never overlap its model calls.
  let initial: RunReport | undefined;
  while (!initial && Date.now() < DEADLINE) {
    try {
      initial = JSON.parse(await readFile(join(DIRECTORY, 'atomic-canonical-dev.json'), 'utf8')) as RunReport;
    } catch {
      await wait(5000);
    }
  }
  if (!initial || won(initial)) return;
  const stages: { name: string; contestants: Contestant[] }[] = [
    { name: 'checklist-dev', contestants: [contestantById('driftbench-checklist')] },
    { name: 'contract-dev', contestants: [contestantById('driftbench-rb-contract')] },
    { name: 'literal-dev', contestants: [contestantById('driftbench-rb-literal')] },
    {
      name: 'contrast-dev',
      contestants: ['driftbench-rb-contrast-equal', 'driftbench-rb-contrast-holistic'].map(contestantById),
    },
    { name: 'ensemble-dev', contestants: [contestantById('driftbench-rb-ensemble')] },
    {
      name: 'atomic-sampled3-dev',
      contestants: ['binary', 'equal', 'weighted', 'holistic'].map((method) => ({
        ...contestantById(`driftbench-rb-${method}-canonical`),
        id: `driftbench-rb-${method}-sampled3`,
        samples: 3,
      })),
    },
    {
      name: 'contrast-sampled3-dev',
      contestants: ['equal', 'holistic'].map((method) => ({
        ...contestantById(`driftbench-rb-contrast-${method}`),
        id: `driftbench-rb-contrast-${method}-sampled3`,
        samples: 3,
      })),
    },
    {
      name: 'ensemble-sampled3-dev',
      contestants: [
        { ...contestantById('driftbench-rb-ensemble'), id: 'driftbench-rb-ensemble-sampled3', samples: 3 },
      ],
    },
  ];
  let nextSampleCount = 5;
  for (const stage of stages) {
    let attempt = 0;
    while (Date.now() < DEADLINE && (await taskSpend()) < 8 - RESERVE) {
      const spend = await taskSpend();
      const cap = Math.min(1.8, 8 - RESERVE - spend);
      await writeFile(
        join(DIRECTORY, 'campaign-state.json'),
        JSON.stringify(
          { stage: stage.name, attempt, spend, cap, deadline: new Date(DEADLINE).toISOString() },
          null,
          2,
        ),
      );
      console.log(`Starting ${stage.name}, task spend ${spend.toFixed(6)}, cap ${cap.toFixed(6)}`);
      const report = await runBenchmark({
        bench: 'rubricbench',
        model: 'haiku',
        split: 'dev',
        concurrency: 1,
        capUsd: cap,
        deadlineMs: DEADLINE,
        contestants: stage.contestants,
        onProgress: ({ calls, spentUsd, item }) => {
          if (calls > 0 && calls % 10 === 0)
            console.log(`${stage.name} calls=${calls} spend=${spentUsd.toFixed(4)} item=${item}`);
        },
      });
      const reportName = `${stage.name}${attempt ? `-resume${attempt}` : ''}`;
      await writeFile(join(DIRECTORY, `${reportName}.json`), `${JSON.stringify(report, null, 2)}\n`);
      const time = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Brussels',
        hour: '2-digit',
        minute: '2-digit',
      });
      await appendFile(
        ledger,
        `| ${time} | codex/rb-judge ${reportName}, all dev${report.stopped ? ', partial' : ''} | haiku | ${report.newCalls} | ${cap.toFixed(6)} | ${report.newSpendUsd.toFixed(6)} | rb task ${(await taskSpend()).toFixed(6)} of 8.00 |\n`,
      );
      console.log(
        JSON.stringify({
          stage: stage.name,
          scores: report.contestants.map((r) => ({
            id: r.contestant,
            score: r.summary.value.estimate,
            missing: r.summary.missing,
            usdPer100: ((r.uniqueCostUsd ?? r.costUsd) / 357) * 100,
          })),
          stopped: report.stopped,
        }),
      );
      if (won(report)) {
        await writeFile(
          join(DIRECTORY, 'campaign-stop.json'),
          JSON.stringify({ reason: 'full-dev target reached', stage: stage.name }),
        );
        return;
      }
      if (!report.stopped) break;
      attempt += 1;
      if (Date.now() >= DEADLINE || (await taskSpend()) >= 8 - RESERVE) break;
      // The same recorded prompts resume a capped or rate-limited run; no configuration is retuned here.
      await wait(30_000);
    }
    // If the earlier configurations do not meet the target, spend the remaining authorized
    // budget on further independent rubric judgments, never on a held-out item or label rule.
    if (stage === stages.at(-1) && Date.now() < DEADLINE && (await taskSpend()) < 8 - RESERVE) {
      stages.push({
        name: `ensemble-sampled${nextSampleCount}-dev`,
        contestants: [
          {
            ...contestantById('driftbench-rb-ensemble'),
            id: `driftbench-rb-ensemble-sampled${nextSampleCount}`,
            samples: nextSampleCount,
          },
        ],
      });
      nextSampleCount += 2;
    }
  }
  await writeFile(
    join(DIRECTORY, 'campaign-stop.json'),
    JSON.stringify({
      reason: Date.now() >= DEADLINE ? 'deadline' : 'task cap reserve reached',
      spend: await taskSpend(),
    }),
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
