import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCaller, ProviderRefused, Recordings } from '../src/call';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from '../src/data';
import { type PairResult, scorePairs } from '../src/score';
import { directItem, escalationReasons, PREMISE_POLICY, premiseLedger, premisePrompt } from './mm-cascade';
import { crowdItem } from './mm-crowd';

const ROOT = 'examples/judge-benchmarks/experiments/mm-results';
const RECORDING = 'examples/judge-benchmarks/recordings/mmeval/haiku.jsonl';
type FrozenConfig = {
  version: 1;
  cascade: boolean;
  premises: boolean;
  contractSha: string;
  devTag: string;
  frozenAt: string;
  sourceHashes: Record<string, string>;
};

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
  if (config.version !== 1 || typeof config.cascade !== 'boolean' || typeof config.premises !== 'boolean')
    throw new Error('Invalid frozen configuration');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== frozenCommit)
    throw new Error('Test must begin at the recorded frozen commit');
  for (const [source, expected] of Object.entries(config.sourceHashes)) {
    const observed = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
    if (observed !== expected) throw new Error(`Frozen source changed: ${source}`);
  }
  // One test submission per frozen design. The manifest is written before the first model call.
  try {
    await readFile(`${ROOT}/${tag}-items.json`);
    throw new Error('Test sample already started; do not submit twice');
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e;
  }
  const prior = (await readFile(RECORDING, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
  const priorSpent = prior
    .filter((r) => String(r.contestant).startsWith('driftbench-mm-'))
    .reduce((s, r) => s + r.costUsd, 0);
  const cap = Math.min(Number(arg('cap-usd') ?? 7.6), 7.6 - priorSpent);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('Task budget exhausted');
  const recordings = await new Recordings(RECORDING).load();
  const caller = createCaller(recordings, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: cap });
  const bench = await loadBenchmark('mmeval');
  const population = bench.items.filter(
    (i): i is PairItem => i.kind === 'pair' && splitOf('mmeval', i.id) === 'test',
  );
  if (n > population.length) throw new Error('Sample exceeds test population');
  const seed = 'mm-frozen-test-sample-v1';
  const items = stratifiedSample(population, n, seed);
  await writeFile(
    `${ROOT}/${tag}-items.json`,
    JSON.stringify(
      {
        label: 'test sample',
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
  process.on('SIGTERM', () => {
    stopped = 'controlled stop requested';
  });
  process.on('SIGINT', () => {
    stopped = 'controlled stop requested';
  });
  let checkpointQueue = Promise.resolve();
  const checkpoint = async () => {
    const report = {
      label: 'test sample',
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
      contestant: 'driftbench-mm-frozen',
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
      newSpendUsd: caller.spent(),
      newCalls: caller.calls(),
      time: new Date().toISOString(),
      ...(stopped ? { stopped } : {}),
    };
    const serialized = JSON.stringify(report);
    checkpointQueue = checkpointQueue.then(async () => {
      await writeFile(`${ROOT}/${tag}.json`, serialized + '\n');
      await appendFile(`${ROOT}/${tag}-rounds.jsonl`, serialized + '\n');
      process.stdout.write(serialized + '\n');
    });
    await checkpointQueue;
    return report;
  };
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (!stopped && next < items.length) {
        const item = items[next++]!;
        let ordinal = 0;
        const ask = async (prompt: { system: string; user: string }, stage: string) => {
          if (stopped) throw new Error(stopped);
          if (Date.now() >= deadline) throw new Error('deadline reached');
          let record;
          try {
            record = await caller.call(prompt, {
              bench: 'mmeval',
              contestant: 'driftbench-mm-frozen',
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
          const direct = await directItem(item, ask, premises);
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
    `| ${report.time.slice(11, 16)} UTC | codex-mm ${tag}: frozen test sample ${results.length}/${n} | haiku | ${caller.calls()} | ${cap.toFixed(4)} | ${caller.spent().toFixed(7)} | frozen ${frozenCommit} |\n`,
  );
  if (stopped) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
