import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultJudge,
  DEFAULT_JUDGE_POLICY,
  type JudgeRequest,
  type PolicyOverride,
} from '@agent-nexus/driftbench-judges';
import { type BenchmarkId, CRITERIA, type Item, loadBenchmark } from './data';

/**
 * Runs the one frozen default judge (createDefaultJudge, policy DEFAULT_JUDGE_POLICY) over the sealed items of a
 * public benchmark, over the Anthropic Messages API, and prints the count right. There is no per-benchmark setting:
 * the only switches are the two measurement overrides, which a shipped client never sets.
 *
 *   tsx examples/judge-benchmarks/src/default-run.ts --bench judgebench --out runs/jb.jsonl \
 *     [--limit 20] [--cap-usd 2] [--concurrency 2] [--length-preference true|false] [--conversation-turns true|false]
 *
 * The key is read from ~/.nexus-secrets/anthropic-driftbench.key inside the process and is never printed. A result
 * file is append-only; an item already in it (same variant label) is not asked again, so a rerun costs only the
 * missing items.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SEALED = join(HERE, '..', '..', 'all-peers-public', 'data');
const NAME: Record<BenchmarkId, string> = {
  judgebench: 'judgebench',
  mmeval: 'mmeval',
  rubricbench: 'rubricbench',
  'longjudge-verify': 'verify',
  'longjudge-wp': 'writing',
};
export const MODEL = 'claude-haiku-5-5';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function sealedIds(bench: BenchmarkId): Promise<Set<string>> {
  const recorded = JSON.parse(await readFile(join(SEALED, NAME[bench], 'recorded.json'), 'utf8'));
  return new Set(Object.keys(recorded.driftbench));
}

function requestOf(item: Item, fallbackCriterion: string): JudgeRequest {
  const criterion = { name: 'bench', rubric: item.criterion ?? fallbackCriterion };
  if (item.kind === 'pair')
    return {
      criterion,
      transcript: [{ role: 'user', text: item.question }],
      candidates: { A: item.a, B: item.b },
    };
  return {
    criterion,
    transcript: [
      { role: 'user', text: item.question },
      { role: 'agent', text: item.response },
    ],
  };
}

async function main(): Promise<void> {
  const bench = arg('bench') as BenchmarkId | undefined;
  const out = arg('out');
  if (!bench || !out || !(bench in NAME)) throw new Error('usage: --bench <id> --out <file.jsonl>');
  const override: PolicyOverride = {
    ...(arg('length-preference') === undefined ? {} : { lengthPreference: arg('length-preference') === 'true' }),
    ...(arg('conversation-turns') === undefined ? {} : { conversationTurns: arg('conversation-turns') === 'true' }),
  };
  const variant = JSON.stringify(override);
  const capUsd = Number(arg('cap-usd') ?? '2');
  const concurrency = Number(arg('concurrency') ?? '2');
  const limit = arg('limit') === undefined ? undefined : Number(arg('limit'));
  const key = (await readFile(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8')).trim();
  const ledger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
  const judge = createDefaultJudge({
    provider: 'anthropic',
    model: MODEL,
    env: { ANTHROPIC_API_KEY: key },
    maxBudgetUsd: 0.5,
    spendCapUsd: capUsd,
    spendLedger: ledger,
    ...(Object.keys(override).length ? { policyOverride: override } : {}),
  });
  const benchmark = await loadBenchmark(bench);
  const ids = await sealedIds(bench);
  const items = benchmark.items.filter((item) => ids.has(item.id));
  const missing = ids.size - items.length;
  const done = new Set<string>();
  try {
    for (const line of (await readFile(out, 'utf8')).split('\n'))
      if (line.trim()) {
        const row = JSON.parse(line);
        if (row.variant === variant) done.add(row.id);
      }
  } catch {
    await mkdir(dirname(out), { recursive: true });
  }
  const todo = items.filter((item) => !done.has(item.id)).slice(0, limit);
  console.log(
    JSON.stringify({ bench, policy: DEFAULT_JUDGE_POLICY.version, variant, sealed: ids.size, loaded: items.length, notLoaded: missing, alreadyDone: done.size, toRun: todo.length }),
  );
  let next = 0;
  let stop = false;
  async function worker(): Promise<void> {
    while (!stop) {
      const item = todo[next++];
      if (!item) return;
      const request = requestOf(item, benchmark.criterion ?? CRITERIA[bench as BenchmarkId]);
      const result = await (item.kind === 'pair' ? judge.judgePair?.(request) ?? judge.judge(request) : judge.judge(request));
      const outcome =
        item.kind === 'pair'
          ? (result.winner ?? 'inconclusive')
          : result.answer.outcome;
      const correct =
        item.kind === 'pair' ? outcome === item.label : outcome === (item.correct ? 'pass' : 'fail');
      const budgetStop = result.defaultJudge?.failure?.kind === 'budget';
      if (budgetStop) {
        stop = true;
        return;
      }
      await appendFile(
        out,
        `${JSON.stringify({
          id: item.id,
          variant,
          policy: result.defaultJudge?.version,
          route: result.defaultJudge?.route,
          outcome,
          correct,
          costUsd: result.costUsd ?? null,
          requestCount: result.requestCount,
          failure: result.defaultJudge?.failure?.kind ?? null,
        })}\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const rows = (await readFile(out, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.variant === variant);
  const routes: Record<string, number> = {};
  for (const row of rows) routes[row.route] = (routes[row.route] ?? 0) + 1;
  console.log(
    JSON.stringify({
      bench,
      variant,
      n: rows.length,
      correct: rows.filter((row) => row.correct).length,
      inconclusive: rows.filter((row) => row.outcome === 'inconclusive').length,
      routes,
      spentUsdThisRun: ledger.spentUsd,
      costIncomplete: ledger.costIncomplete,
      stoppedAtCap: stop,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
