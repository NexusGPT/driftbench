import { priorMMSpend } from './mm-budget';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCaller, ProviderRefused, Recordings } from '../src/call';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from '../src/data';
import { type PairResult, scorePairs } from '../src/score';
import { directItem, escalationReasons, PREMISE_POLICY, premiseLedger, premisePrompt } from './mm-cascade';
import { crowdItem } from './mm-crowd';
import { voteChat } from './mm-vote3';

const ROOT = 'examples/judge-benchmarks/experiments/mm-results';
const RECORDING = 'examples/judge-benchmarks/recordings/mmeval/haiku.jsonl';
type FrozenConfig = {
  version: 1;
  cascade: boolean;
  premises: boolean;
  chatSamples: 1 | 3;
  contractSha: string;
  devTag: string;
  frozenAt: string;
  sourceHashes: Record<string, string>;
};

/** Same proportional cohort, hash-ranked within subsets and interleaved for honest partial coverage. */
export function interleavedSample(population: PairItem[], n: number, seed: string) {
  const chosen = stratifiedSample(population, n, seed);
  const groups = ['reasoning', 'chat', 'linguistics', 'language mixing', 'safety'];
  const rank = (item: PairItem) => createHash('sha256').update(`${seed}:${item.id}`).digest('hex');
  const queues = groups.map((group) =>
    chosen.filter((i) => i.group === group).sort((a, b) => rank(a).localeCompare(rank(b))),
  );
  if (queues.reduce((sum, rows) => sum + rows.length, 0) !== chosen.length)
    throw new Error('Unknown MM subset');
  const items: PairItem[] = [];
  for (let i = 0; queues.some((q) => q[i]); i++)
    for (const queue of queues) if (queue[i]) items.push(queue[i]!);
  return items;
}

export function stratifiedInterval(results: readonly PairResult[], repeats = 10000) {
  if (!results.length || !Number.isInteger(repeats) || repeats < 40)
    throw new Error('Bootstrap needs observations and at least 40 repetitions');
  const groups = new Map<string, number[]>();
  for (const r of results) {
    const values = groups.get(r.item.group) ?? [];
    values.push(
      r.providerRefused
        ? 0
        : r.games.reduce((s, g) => s + (g === r.item.label ? 1 : g === 'tie' ? 0.5 : 0), 0) / r.games.length,
    );
    groups.set(r.item.group, values);
  }
  let seed = 251013;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const means: number[] = [];
  for (let iteration = 0; iteration < repeats; iteration++) {
    let sum = 0;
    for (const values of groups.values()) {
      let total = 0;
      for (let i = 0; i < values.length; i++) total += values[Math.floor(random() * values.length)]!;
      sum += total / values.length;
    }
    means.push(sum / groups.size);
  }
  means.sort((a, b) => a - b);
  return {
    level: 0.95,
    method: 'percentile bootstrap, pairs resampled within each subset, fixed seed 251013',
    repeats,
    lower: means[Math.floor(repeats * 0.025)]!,
    upper: means[Math.floor(repeats * 0.975)]!,
  };
}

async function main() {
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const tag = arg('tag'),
    ledger = arg('ledger'),
    path = arg('config'),
    frozenCommit = arg('frozen-commit');
  const split = arg('split') ?? 'test';
  if (split !== 'test' && split !== 'dev') throw new Error('Split must be test or dev');
  const runLabel = split === 'test' ? 'test sample' : 'DEV remainder';
  const n = Number(arg('items')),
    deadline = Date.parse(arg('deadline') ?? '');
  if (
    !tag ||
    !/^[a-z0-9-]+$/.test(tag) ||
    !ledger ||
    !path ||
    !frozenCommit ||
    !Number.isInteger(n) ||
    n < 5 ||
    !Number.isFinite(deadline)
  )
    throw new Error('Require tag, ledger, config, frozen-commit, items and deadline');
  const config = JSON.parse(await readFile(path, 'utf8')) as FrozenConfig;
  if (
    config.version !== 1 ||
    typeof config.cascade !== 'boolean' ||
    typeof config.premises !== 'boolean' ||
    ![1, 3].includes(config.chatSamples)
  )
    throw new Error('Invalid frozen configuration');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== frozenCommit)
    throw new Error('Test must begin at the recorded frozen commit');
  for (const [source, expected] of Object.entries(config.sourceHashes)) {
    const observed = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
    if (observed !== expected) throw new Error(`Frozen source changed: ${source}`);
  }
  // A resume continues the same predeclared cohort and reuses cached outputs.
  const resume = process.argv.includes('--resume');
  let previousManifest: { frozenCommit: string; n: number; seed: string } | undefined;
  try {
    previousManifest = JSON.parse(await readFile(`${ROOT}/${tag}-items.json`, 'utf8'));
    if (!resume) throw new Error('Sample already started; use resume for the same cohort');
    if (previousManifest!.frozenCommit !== frozenCommit || previousManifest!.n !== n)
      throw new Error('Resume cannot change the frozen commit or sample size');
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e;
    if (resume) throw new Error('No predeclared cohort exists to resume');
  }
  const priorSpent = (await priorMMSpend(RECORDING, ROOT)).total;
  const cap = Math.min(Number(arg('cap-usd') ?? 7.4), 7.4 - priorSpent);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('Task budget exhausted');
  const recordings = await new Recordings(RECORDING).load();
  const caller = createCaller(recordings, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: cap });
  const bench = await loadBenchmark('mmeval');
  const population = bench.items.filter(
    (i): i is PairItem => i.kind === 'pair' && splitOf('mmeval', i.id) === split,
  );
  const excludedManifest = arg('exclude-dev-manifest');
  if (split === 'dev') {
    if (!excludedManifest) throw new Error('DEV continuation must exclude the fixed DEV selection');
    const excluded = JSON.parse(await readFile(excludedManifest, 'utf8'));
    const ids = new Set((excluded.batches[0] as { id: string }[]).map((i) => i.id));
    population.splice(0, population.length, ...population.filter((i) => !ids.has(i.id)));
  }
  if (n > population.length) throw new Error('Sample exceeds test population');
  const seed = split === 'test' ? 'mm-frozen-test-sample-v1' : 'mm-frozen-dev-remainder-v1';
  const items = interleavedSample(population, n, seed);
  if (!resume)
    await writeFile(
      `${ROOT}/${tag}-items.json`,
      JSON.stringify(
        {
          label: runLabel,
          n,
          seed,
          frozenCommit,
          config,
          items: items.map(({ id, group, language }) => ({ id, group, language })),
        },
        null,
        2,
      ) + '\n',
    );
  const results: PairResult[] = [];
  const providerRefusedIds = new Set<string>();
  const seen = new Set<string>();
  let calls = 0,
    costUsd = 0,
    escalated = 0,
    invalidPremises = 0,
    next = 0,
    stopped: string | undefined;
  if (resume) {
    const previous = JSON.parse(await readFile(`${ROOT}/${tag}.json`, 'utf8'));
    calls = previous.calls;
    costUsd = previous.costUsd;
    escalated = previous.escalated;
    invalidPremises = previous.invalidPremises;
    for (const key of previous.usedKeys ?? []) seen.add(key);
    const byId = new Map(items.map((i) => [i.id, i]));
    try {
      for (const line of (await readFile(`${ROOT}/${tag}-decisions.jsonl`, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)) {
        const row = JSON.parse(line);
        const item = byId.get(row.id);
        if (!item) throw new Error('Stored result outside declared cohort');
        results.push({ item, games: row.games, missing: 0 });
      }
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e;
    }
    for (const id of previous.providerRefusedIds ?? []) {
      const item = byId.get(id);
      if (!item) throw new Error('Refusal outside declared cohort');
      providerRefusedIds.add(id);
      results.push({ item, games: ['tie', 'tie'], missing: 2, providerRefused: true });
    }
  }
  const completedIds = new Set(results.map((r) => r.item.id));
  process.on('SIGTERM', () => {
    stopped = 'controlled stop requested';
  });
  process.on('SIGINT', () => {
    stopped = 'controlled stop requested';
  });
  let checkpointQueue = Promise.resolve();
  const checkpoint = async () => {
    const report = {
      label: runLabel,
      providerRefusedCount: providerRefusedIds.size,
      providerRefusedIds: [...providerRefusedIds],
      ...(results.length > providerRefusedIds.size
        ? {
            excludedSummary: scorePairs(
              'mmeval',
              results.filter((r) => !r.providerRefused),
            ),
            excludedInterval95: stratifiedInterval(results.filter((r) => !r.providerRefused)),
          }
        : {}),
      contestant: split === 'test' ? 'driftbench-mm-frozen-test' : 'driftbench-mm-frozen-dev',
      requested: n,
      completed: results.length,
      missingItems: n - results.length,
      seed,
      frozenCommit,
      config,
      ...(results.length
        ? { summary: scorePairs('mmeval', results), interval95: stratifiedInterval(results) }
        : {}),
      costUsd,
      costPer100: (costUsd * 100) / Math.max(1, results.length),
      calls,
      callsPerItem: calls / Math.max(1, results.length),
      escalated,
      escalatedShare: escalated / Math.max(1, results.length),
      invalidPremises,
      usedKeys: [...seen],
      newSpendUsd: caller.spent(),
      newCalls: caller.calls(),
      time: new Date().toISOString(),
      ...(stopped ? { stopped } : {}),
    };
    const serialized = JSON.stringify(report);
    checkpointQueue = checkpointQueue.then(async () => {
      await writeFile(`${ROOT}/${tag}.json`, serialized + '\n');
      await appendFile(`${ROOT}/${tag}-rounds.jsonl`, serialized + '\n');
      process.stdout.write(
        JSON.stringify({
          label: report.label,
          completed: report.completed,
          requested: report.requested,
          score: report.summary?.value.estimate,
          interval95: report.interval95,
          costPer100: report.costPer100,
          newSpendUsd: report.newSpendUsd,
          stopped: report.stopped,
        }) + '\n',
      );
    });
    await checkpointQueue;
    return report;
  };
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (!stopped && next < items.length) {
        const item = items[next++]!;
        if (completedIds.has(item.id)) continue;
        let ordinal = 0;
        const ask = async (prompt: { system: string; user: string }, stage: string) => {
          if (stopped) throw new Error(stopped);
          if (Date.now() >= deadline) throw new Error('deadline reached');
          let record;
          try {
            record = await caller.call(prompt, {
              bench: 'mmeval',
              contestant: split === 'test' ? 'driftbench-mm-frozen-test' : 'driftbench-mm-frozen-dev',
              item: item.id,
              order: `${stage}#${++ordinal}`,
            });
          } catch (e) {
            if (e instanceof ProviderRefused) {
              calls++;
              costUsd += e.costUsd;
            }
            throw e;
          }
          if (!seen.has(record.key)) {
            seen.add(record.key);
            calls++;
            costUsd += record.costUsd;
          }
          return record;
        };
        try {
          let premises: string | undefined;
          if (config.premises && item.group === 'safety') {
            const extracted = premiseLedger(
              (await ask(premisePrompt(item.question), 'premise')).text,
              item.question,
            );
            if (!extracted.valid) invalidPremises++;
            premises = JSON.stringify({ ...extracted, policy: PREMISE_POLICY });
          }
          const direct =
            config.chatSamples === 3 && item.group === 'chat'
              ? await voteChat(item, ask)
              : await directItem(item, ask, premises);
          const reasons = config.cascade
            ? escalationReasons(item.group, direct.games, direct.parseFailed)
            : [];
          const crowd = reasons.length
            ? await crowdItem(item, (prompt, stage) => ask(prompt, `crowd-${stage}`), premises)
            : undefined;
          if (crowd) escalated++;
          results.push({ item, games: crowd?.games ?? direct.games, missing: 0 });
          await appendFile(
            `${ROOT}/${tag}-decisions.jsonl`,
            JSON.stringify({
              id: item.id,
              group: item.group,
              language: item.language,
              label: item.label,
              premises,
              reasons,
              direct,
              crowd,
              games: crowd?.games ?? direct.games,
            }) + '\n',
          );
          if (results.length % 25 === 0) await checkpoint();
        } catch (e) {
          if (e instanceof ProviderRefused) {
            providerRefusedIds.add(item.id);
            results.push({ item, games: ['tie', 'tie'], missing: 2, providerRefused: true });
            await appendFile(
              `${ROOT}/${tag}-provider-refusals.jsonl`,
              JSON.stringify({ id: item.id, error: e.message, reportedCostUsd: e.costUsd }) + '\n',
            );
          } else stopped = e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );
  const report = await checkpoint();
  await appendFile(
    ledger,
    `| ${report.time.slice(11, 16)} UTC | codex-mm ${tag}: frozen ${runLabel} ${results.length}/${n} | haiku | ${caller.calls()} | ${cap.toFixed(4)} | ${caller.spent().toFixed(7)} | frozen ${frozenCommit} |\n`,
  );
  if (stopped) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
