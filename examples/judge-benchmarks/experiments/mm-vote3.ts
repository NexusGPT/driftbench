import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCaller, promptKey, ProviderRefused, type Recorded, Recordings } from '../src/call';
import { loadBenchmark, type PairItem } from '../src/data';
import type { PairDecision, Prompt } from '../src/contestants';
import { scorePairs, type PairResult } from '../src/score';
import { directItem } from './mm-cascade';
import { priorMMSpend } from './mm-budget';

/** Three native comparisons per order; code pools their declared, validated winners. */
export async function voteChat(item: PairItem, ask: (prompt: Prompt, stage: string) => Promise<Recorded>) {
  const samples: Awaited<ReturnType<typeof directItem>>[] = [];
  for (let sample = 0; sample < 3; sample++)
    samples.push(
      await directItem(item, (prompt, stage) =>
        ask(
          sample === 0
            ? prompt
            : { ...prompt, user: `${prompt.user}\n\n(Independent judgement ${sample + 1} of 3.)` },
          `sample${sample + 1}-${stage}`,
        ),
      ),
    );
  const majority = (games: PairDecision[]): PairDecision => {
    const a = games.filter((g) => g === 'A').length,
      b = games.filter((g) => g === 'B').length;
    return a > b ? 'A' : b > a ? 'B' : 'tie';
  };
  return {
    games: [majority(samples.map((s) => s.games[0]!)), majority(samples.map((s) => s.games[1]!))],
    samples,
    rawComparisons: samples.flatMap((s, sample) =>
      s.rawComparisons.map((r) => ({ ...r, sample: sample + 1 })),
    ),
    parseFailed: samples.some((s) => s.parseFailed),
  };
}

async function main() {
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const root = 'examples/judge-benchmarks/experiments/mm-results',
    recording = 'examples/judge-benchmarks/recordings/mmeval/haiku.jsonl';
  const baseTag = arg('base-tag'),
    tag = arg('tag'),
    ledger = arg('ledger'),
    contractSha = arg('contract-sha');
  const deadline = Date.parse(arg('deadline') ?? '');
  if (!baseTag || !tag || !ledger || !contractSha || !Number.isFinite(deadline) || !/^[a-z0-9-]+$/.test(tag))
    throw new Error('Require base-tag, tag, ledger, contract-sha and deadline');
  const base = JSON.parse(await readFile(`${root}/${baseTag}.json`, 'utf8'));
  if (
    base.directCompleted !== 400 ||
    base.contractSha !== contractSha ||
    base.directSource !== 'current shared prompt'
  )
    throw new Error('Require current-contract DEV400 direct inference before voting');
  const manifest = JSON.parse(await readFile(`${root}/${baseTag}-items.json`, 'utf8'));
  const benchmark = await loadBenchmark('mmeval');
  const byId = new Map(benchmark.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
  const baseline = (await readFile(`${root}/${baseTag}-direct-decisions.jsonl`, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const refused = new Set<string>(base.providerRefusedIds);
  const results: PairResult[] = baseline.map((r) => ({
    item: byId.get(r.id)!,
    games: r.games,
    missing: refused.has(r.id) ? 2 : 0,
    providerRefused: refused.has(r.id),
  }));
  for (const id of refused)
    if (!results.some((r) => r.item.id === id))
      results.push({ item: byId.get(id)!, games: ['tie', 'tie'], missing: 2, providerRefused: true });
  if (results.length !== 400) throw new Error('Baseline cohort mismatch');
  const recordings = await new Recordings(recording).load();
  const prior = (await priorMMSpend(recording, root)).total;
  const cap = Math.min(Number(arg('cap-usd') ?? 7.4), 7.4 - prior);
  if (cap <= 0) throw new Error('Task budget exhausted');
  const caller = createCaller(recordings, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: cap });
  const baselineKeys = new Set<string>(
    baseline.flatMap((r) => r.rawComparisons.map((x: { key: string }) => x.key)),
  );
  const used = new Set(baselineKeys);
  let additionalCostUsd = 0,
    additionalCalls = 0,
    completedChat = 0,
    stopped: string | undefined,
    next = 0;
  const timings: number[] = [];
  const chat = results.filter((r) => r.item.group === 'chat' && !r.providerRefused).map((r) => r.item);
  process.on('SIGTERM', () => {
    stopped = 'controlled stop requested';
  });
  process.on('SIGINT', () => {
    stopped = 'controlled stop requested';
  });
  await writeFile(`${root}/${tag}-items.json`, JSON.stringify(manifest, null, 2) + '\n');
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (!stopped && next < chat.length) {
        const item = chat[next++]!;
        let ordinal = 0;
        try {
          const vote = await voteChat(item, async (prompt, stage) => {
            if (stopped || Date.now() >= deadline) throw new Error(stopped ?? 'deadline reached');
            const hit = recordings.get(promptKey('haiku', prompt)),
              started = Date.now();
            const record = await caller.call(prompt, {
              bench: 'mmeval',
              contestant: 'driftbench-mm-vote3',
              item: item.id,
              order: `${stage}#${++ordinal}`,
            });
            if (!hit) timings.push((Date.now() - started) / 1000);
            if (!used.has(record.key)) {
              used.add(record.key);
              additionalCostUsd += record.costUsd;
              additionalCalls++;
            }
            return record;
          });
          results[results.findIndex((r) => r.item.id === item.id)] = { item, games: vote.games, missing: 0 };
          completedChat++;
          await appendFile(
            `${root}/${tag}-chat-decisions.jsonl`,
            JSON.stringify({ id: item.id, group: item.group, label: item.label, ...vote }) + '\n',
          );
        } catch (e) {
          if (e instanceof ProviderRefused) {
            refused.add(item.id);
            additionalCostUsd += e.costUsd;
            additionalCalls++;
            results[results.findIndex((r) => r.item.id === item.id)] = {
              item,
              games: ['tie', 'tie'],
              missing: 2,
              providerRefused: true,
            };
            completedChat++;
            await appendFile(
              `${root}/${tag}-provider-refusals.jsonl`,
              JSON.stringify({ id: item.id, error: e.message, reportedCostUsd: e.costUsd }) + '\n',
            );
          } else stopped = e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );
  const costUsd = base.phaseCosts.direct.costUsd + additionalCostUsd,
    calls = base.phaseCosts.direct.calls + additionalCalls;
  const report = {
    label: 'DEV400 chat three-sample voting',
    baseTag,
    contractSha,
    requested: 400,
    completedChat,
    requestedChat: chat.length,
    providerRefusedIds: [...refused],
    summary: scorePairs('mmeval', results),
    excludedSummary: scorePairs(
      'mmeval',
      results.filter((r) => !r.providerRefused),
    ),
    costUsd,
    costPer100: costUsd / 4,
    calls,
    callsPerItem: calls / 400,
    additionalCostUsd,
    additionalCalls,
    newSpendUsd: caller.spent(),
    newCalls: caller.calls(),
    meanCallSeconds: timings.reduce((a, b) => a + b, 0) / Math.max(1, timings.length),
    time: new Date().toISOString(),
    ...(stopped ? { stopped } : {}),
  };
  await writeFile(`${root}/${tag}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    `${root}/${tag}-decisions.jsonl`,
    results
      .map((r) =>
        JSON.stringify({
          id: r.item.id,
          group: r.item.group,
          label: r.item.label,
          games: r.games,
          providerRefused: r.providerRefused,
        }),
      )
      .join('\n') + '\n',
  );
  await appendFile(
    ledger,
    `| ${report.time.slice(11, 16)} UTC | codex-mm ${tag}: chat vote3 ${completedChat}/${chat.length} on fixed DEV400 | haiku | ${caller.calls()} | ${cap.toFixed(4)} | ${caller.spent().toFixed(7)} | pooled declared winners; no label in model input |\n`,
  );
  process.stdout.write(JSON.stringify(report) + '\n');
  if (stopped) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
