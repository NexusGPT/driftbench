/** Fill missing default-peer recordings on the already-frozen TEST sample. Never retune our judge. */
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCaller, promptKey, ProviderRefused, Recordings } from '../src/call';
import { contestantById } from '../src/contestants';
import { CRITERIA, loadBenchmark, type PairItem } from '../src/data';
import { priorMMSpend } from './mm-budget';
import { replayPair } from './mm-dev';
import { interleavedSample } from './mm-test-sample';

async function main() {
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const ledger = arg('ledger'),
    deadline = Date.parse(arg('deadline') ?? '');
  if (!ledger || !Number.isFinite(deadline)) throw Error('Require ledger and deadline');
  const root = 'examples/judge-benchmarks/experiments/mm-results',
    tag = 'test-peer-completion';
  const run = JSON.parse(await readFile(`${root}/test-sample-frozen.json`, 'utf8'));
  const resume = process.argv.includes('--resume');
  const previous = resume ? JSON.parse(await readFile(`${root}/${tag}.json`, 'utf8')) : undefined;
  const originalPlan = resume ? JSON.parse(await readFile(`${root}/${tag}-plan.json`, 'utf8')) : undefined;
  if (run.completed !== run.requested || run.stopped)
    throw Error('Require complete frozen TEST sample first');
  const paired = JSON.parse(await readFile(`${root}/test-peer-paired-free.json`, 'utf8'));
  const official = paired.cohorts[0].views.find((v: { view: string }) => v.view === 'official');
  const inconclusive = official.pairedDifferences.some(
    (d: { holmAdjustedP: number; interval95: { lower: number; upper: number } }) =>
      d.holmAdjustedP >= 0.05 || (d.interval95.lower <= 0 && d.interval95.upper >= 0),
  );
  if (!inconclusive) {
    await writeFile(
      `${root}/post-test-budget-choice.json`,
      JSON.stringify(
        {
          choice: 'continue frozen DEV',
          reason:
            'Both free267 paired contrasts are conclusive by exact sign test with Holm adjustment and paired macro interval.',
          newModelCalls: 0,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('CONCLUSIVE: continue frozen DEV');
    return;
  }
  for (const [path, hash] of Object.entries(run.config.sourceHashes))
    if (
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex') !== hash
    )
      throw Error(`Frozen source changed: ${path}`);
  const recording = 'examples/judge-benchmarks/recordings/mmeval/haiku.jsonl';
  const records = await new Recordings(recording).load(),
    prior = await priorMMSpend(recording, root);
  const cap = 7.4 - prior.total;
  if (cap <= 0.15) throw Error('Insufficient reported budget while keeping USD0.6 reserve');
  const bench = await loadBenchmark('mmeval');
  const manifest = JSON.parse(await readFile(`${root}/test-sample-frozen-items.json`, 'utf8'));
  const ids = new Set<string>(manifest.items.map((i: { id: string }) => i.id));
  const peers = ['deepeval', 'promptfoo'].map(contestantById);
  const population = bench.items.filter((i): i is PairItem => i.kind === 'pair' && ids.has(i.id));
  const knownRefused = new Set<string>(run.providerRefusedIds);
  const missing = population.filter(
    (i) => !knownRefused.has(i.id) && peers.some((c) => !replayPair(i, c, records).complete),
  );
  const seed = 'mm-test-peer-coverage-v1';
  const byId = new Map(population.map((i) => [i.id, i]));
  if (resume && (originalPlan.frozenCommit !== run.frozenCommit || originalPlan.seed !== seed))
    throw Error('Resume must preserve original frozen peer cohort');
  const items: PairItem[] = resume
    ? originalPlan.items.map((i: { id: string }) => {
        const item = byId.get(i.id);
        if (!item) throw Error('Peer resume outside original TEST cohort');
        return item;
      })
    : interleavedSample(missing, missing.length, seed);
  const plan = {
    label: 'paid default-peer coverage plan',
    frozenCommit: run.frozenCommit,
    frozenSampleItems: run.requested,
    requestedCompletionItems: items.length,
    seed,
    priorReportedUsd: prior.total,
    capUsd: cap,
    unknownChargeReserveUsd: 0.6,
    concurrency: 3,
    maxCliCallUsd: 0.05,
    maxThreeAttemptRequestReservationUsd: 0.15,
    selection:
      'Only missing peer coverage inside the fixed950 sample, hash-ranked and interleaved by subset. No selection by labels or our correctness.',
    items: items.map(({ id, group }) => ({ id, group })),
    time: new Date().toISOString(),
  };
  await writeFile(
    `${root}/${tag}${resume ? '-resume-plan' : '-plan'}.json`,
    JSON.stringify(plan, null, 2) + '\n',
  );
  await writeFile(
    `${root}/post-test-budget-choice.json`,
    JSON.stringify(
      {
        choice: 'matched default-peer TEST coverage',
        reason:
          'At least one free267 contrast is inconclusive under the predeclared exact sign and paired macro-interval rule.',
        authorization:
          "If the free 267-item paired comparison is inconclusive, spend the remainder on matched DeepEval and promptfoo coverage of tonight's frozen test sample items.",
        plan,
      },
      null,
      2,
    ) + '\n',
  );
  // Default generated DeepEval criterion steps are already recorded. Never change either peer template.
  const setups = new Map<string, string | undefined>();
  for (const c of peers) {
    const p = c.setup?.pair?.(CRITERIA.mmeval);
    const r = p ? records.get(promptKey('haiku', p)) : undefined;
    if (p && !r) throw Error('Default peer setup must already be cached');
    setups.set(c.id, r?.text);
  }
  const caller = createCaller(records, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: cap });
  let activeRequests = 0,
    next = 0,
    completed = previous?.completed ?? 0,
    stopped: string | undefined;
  const budgetWaiters = new Set<() => void>();
  const refused = new Set<string>(previous?.providerRefusedIds ?? []);
  const completedIds: string[] = previous?.completedIds ?? [];
  const alreadyCompleted = new Set(completedIds);
  process.on('SIGTERM', () => {
    stopped = 'controlled stop requested';
  });
  process.on('SIGINT', () => {
    stopped = 'controlled stop requested';
  });
  const ask = async (prompt: { system: string; user: string }, id: string, peer: string, order: string) => {
    const hit = records.get(promptKey('haiku', prompt));
    if (hit) return hit;
    if (stopped || Date.now() >= deadline) throw Error(stopped ?? 'deadline reached');
    // A harness request can retry three CLI invocations. Synchronous reservations bound the three-worker overhang.
    while (caller.spent() + activeRequests * 0.15 + 0.15 > cap) {
      if (activeRequests === 0) throw Error('reported budget limit with USD0.6 reserve');
      // Let current calls finish, then use fewer workers near the limit instead of leaving their reserve idle.
      await new Promise<void>((resolve) => budgetWaiters.add(resolve));
      if (stopped || Date.now() >= deadline) throw Error(stopped ?? 'deadline reached');
    }
    activeRequests++;
    try {
      return await caller.call(prompt, {
        bench: 'mmeval',
        contestant: `driftbench-mm-peer-${peer}`,
        item: id,
        order,
      });
    } finally {
      activeRequests--;
      for (const wake of budgetWaiters) wake();
      budgetWaiters.clear();
    }
  };
  const checkpoint = async () => {
    const report = {
      label: 'paid default-peer coverage',
      frozenCommit: run.frozenCommit,
      requested: items.length,
      completed,
      completedIds,
      providerRefusedIds: [...refused],
      newCalls: (previous?.newCalls ?? 0) + caller.calls(),
      newSpendUsd: (previous?.newSpendUsd ?? 0) + caller.spent(),
      additionalCallsThisInvocation: caller.calls(),
      additionalSpendUsdThisInvocation: caller.spent(),
      resumed: resume,
      capUsd: cap,
      priorReportedUsd: prior.total,
      seed,
      stopped,
      time: new Date().toISOString(),
    };
    await writeFile(`${root}/${tag}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        completed,
        requested: items.length,
        newCalls: report.newCalls,
        newSpendUsd: report.newSpendUsd,
        stopped,
      }),
    );
    return report;
  };
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (!stopped && next < items.length) {
        const item = items[next++]!;
        if (alreadyCompleted.has(item.id)) continue;
        let activePeer = '';
        try {
          for (const c of peers) {
            activePeer = c.id;
            const setup = setups.get(c.id);
            for (const [order, a, b] of [
              ['AB', item.a, item.b],
              ['BA', item.b, item.a],
            ] as const) {
              const prompt = c.pair!({ question: item.question, a, b, criterion: CRITERIA.mmeval, setup });
              await ask(prompt, item.id, c.id, order);
            }
          }
          if (!peers.every((c) => replayPair(item, c, records).complete))
            throw Error('Peer completion did not persist');
          completed++;
          completedIds.push(item.id);
          if (completed % 25 === 0) await checkpoint();
        } catch (e) {
          if (e instanceof ProviderRefused) {
            refused.add(item.id);
            completed++;
            completedIds.push(item.id);
            await appendFile(
              `${root}/${tag}-provider-refusals.jsonl`,
              JSON.stringify({
                id: item.id,
                peer: activePeer,
                error: e.message,
                reportedCostUsd: e.costUsd,
              }) + '\n',
            );
          } else stopped = e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );
  const report = await checkpoint();
  await appendFile(
    ledger,
    `| ${report.time.slice(11, 16)} UTC | codex-mm default DeepEval/promptfoo coverage on frozen TEST${resume ? ' resume' : ''}: ${completed}/${items.length} | haiku | ${caller.calls()} | ${cap.toFixed(5)} | ${caller.spent().toFixed(7)} | unchanged peer templates; USD0.6 reserve; frozen ${run.frozenCommit} |\n`,
  );
  if (stopped && !stopped.startsWith('reported budget limit')) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
