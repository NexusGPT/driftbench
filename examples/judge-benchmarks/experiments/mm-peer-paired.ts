/** Free matched TEST replay and exact item-level paired tests; this never creates a model caller. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings, type Recorded } from '../src/call';
import { contestantById, type Prompt } from '../src/contestants';
import { CRITERIA, loadBenchmark, splitOf, type PairItem } from '../src/data';
import { scorePairs, type PairResult } from '../src/score';
import { directItem } from './mm-cascade';
import { replayPair } from './mm-dev';
import { voteChat } from './mm-vote3';
import { stratifiedInterval } from './mm-test-sample';

async function optionalJson(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return undefined;
    throw e;
  }
}

function pairScore(r: PairResult) {
  return r.providerRefused
    ? 0
    : r.games.reduce((sum, g) => sum + (g === r.item.label ? 1 : g === 'tie' ? 0.5 : 0), 0) / r.games.length;
}

export function exactSignTest(wins: number, losses: number) {
  if (![wins, losses].every((n) => Number.isInteger(n) && n >= 0))
    throw new Error('Counts must be nonnegative integers');
  const n = wins + losses,
    tail = Math.min(wins, losses);
  let coefficient = 1n,
    sum = 1n;
  for (let i = 1; i <= tail; i++) {
    coefficient = (coefficient * BigInt(n - i + 1)) / BigInt(i);
    sum += coefficient;
  }
  const denominator = 1n << BigInt(n);
  const numerator = sum * 2n > denominator ? denominator : sum * 2n;
  const a = numerator.toString(),
    b = denominator.toString();
  const log10 = (s: string) => Math.log10(Number(s.slice(0, 15))) + Math.max(0, s.length - 15);
  return {
    wins,
    losses,
    nonzeroPairs: n,
    pTwoSided: 10 ** (log10(a) - log10(b)),
    exactNumerator: a,
    exactDenominator: b,
    method: 'two-sided exact paired sign test on item scores; ties removed; binomial(n, 0.5)',
    limitation:
      'Tests the direction of paired item differences, not equality of the weighted subset macro mean; paired orders are not treated as independent.',
  };
}

export function pairedDifference(ours: PairResult[], peer: PairResult[]) {
  if (ours.length !== peer.length || ours.some((r, i) => r.item.id !== peer[i]!.item.id))
    throw new Error('Paired cohorts must match exactly');
  const groups = new Map<string, number[]>();
  let wins = 0,
    losses = 0,
    ties = 0;
  for (let i = 0; i < ours.length; i++) {
    const delta = pairScore(ours[i]!) - pairScore(peer[i]!);
    delta > 0 ? wins++ : delta < 0 ? losses++ : ties++;
    groups.set(ours[i]!.item.group, [...(groups.get(ours[i]!.item.group) ?? []), delta]);
  }
  const macroDifference =
    [...groups.values()].reduce((sum, xs) => sum + xs.reduce((a, b) => a + b, 0) / xs.length, 0) /
    groups.size;
  let seed = 251013;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const draws: number[] = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    let sum = 0;
    for (const xs of groups.values()) {
      let subtotal = 0;
      for (let i = 0; i < xs.length; i++) subtotal += xs[Math.floor(random() * xs.length)]!;
      sum += subtotal / xs.length;
    }
    draws.push(sum / groups.size);
  }
  draws.sort((a, b) => a - b);
  return {
    macroDifference,
    interval95: {
      lower: draws[250]!,
      upper: draws[9750]!,
      method: 'paired percentile bootstrap within subsets, seed 251013, 10000 repetitions',
    },
    wins,
    losses,
    ties,
    exactPairedTest: exactSignTest(wins, losses),
  };
}

async function main() {
  const root = 'examples/judge-benchmarks/experiments/mm-results';
  const config = JSON.parse(await readFile(`${root}/frozen-config.json`, 'utf8'));
  for (const [source, hash] of Object.entries(config.sourceHashes))
    if (
      createHash('sha256')
        .update(await readFile(source))
        .digest('hex') !== hash
    )
      throw new Error(`Frozen source changed: ${source}`);
  const run = JSON.parse(await readFile(`${root}/test-sample-frozen.json`, 'utf8'));
  if (run.completed !== run.requested || run.stopped) throw new Error('Require complete frozen test sample');
  const manifest = JSON.parse(await readFile(`${root}/test-sample-frozen-items.json`, 'utf8'));
  const requestedIds = new Set<string>(manifest.items.map((r: { id: string }) => r.id));
  const prior = JSON.parse(await readFile(`${root}/prior-test-scoring-audit.json`, 'utf8'));
  const oldCommon = new Set<string>(prior.commonCompleteIds);
  const bench = await loadBenchmark('mmeval');
  const population = bench.items.filter(
    (i): i is PairItem => i.kind === 'pair' && splitOf('mmeval', i.id) === 'test',
  );
  const byId = new Map(population.map((i) => [i.id, i]));
  const records = await new Recordings('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl').load();
  const stored = (await readFile(`${root}/test-sample-frozen-decisions.jsonl`, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const refused = new Set<string>(run.providerRefusedIds);
  const completion = await optionalJson(`${root}/test-peer-completion.json`);
  for (const id of completion?.providerRefusedIds ?? []) refused.add(id);
  const rawRecorded = (await readFile('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const refusalCharges = new Map<string, number>();
  if (run.providerRefusedIds.length)
    for (const line of (await readFile(`${root}/test-sample-frozen-provider-refusals.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)) {
      const row = JSON.parse(line);
      refusalCharges.set(row.id, row.reportedCostUsd);
    }
  const peerRefusalCharges: { id: string; peer: string; reportedCostUsd: number }[] = [];
  if (completion?.providerRefusedIds.length)
    for (const line of (await readFile(`${root}/test-peer-completion-provider-refusals.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean))
      peerRefusalCharges.push(JSON.parse(line));
  const ours = new Map<string, { result: PairResult; keys: string[] }>();
  for (const row of stored)
    ours.set(row.id, {
      result: { item: byId.get(row.id)!, games: row.games, missing: 0 },
      keys: row.direct.rawComparisons.map((r: { key: string }) => r.key),
    });
  for (const id of refused)
    ours.set(id, {
      result: { item: byId.get(id)!, games: ['tie', 'tie'], missing: 2, providerRefused: true },
      keys: [
        ...new Set([
          ...(ours.get(id)?.keys ?? []),
          ...rawRecorded
            .filter((r) => r.contestant === 'driftbench-mm-frozen-test' && r.item === id)
            .map((r) => r.key),
        ]),
      ],
    });
  if (ours.size !== requestedIds.size) throw new Error('Stored frozen sample incomplete');
  const freeRows: unknown[] = [];
  for (const item of population.filter((i) => !requestedIds.has(i.id))) {
    const keys: string[] = [];
    const ask = async (prompt: Prompt): Promise<Recorded> => {
      const key = promptKey('haiku', prompt),
        record = records.get(key);
      if (!record) throw new Error('cache miss');
      keys.push(key);
      return record;
    };
    try {
      const result =
        item.group === 'chat' && config.chatSamples === 3
          ? await voteChat(item, ask)
          : await directItem(item, ask);
      ours.set(item.id, { result: { item, games: result.games, missing: 0 }, keys });
      freeRows.push({
        id: item.id,
        group: item.group,
        games: result.games,
        rawComparisons: result.rawComparisons,
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'cache miss') throw e;
    }
  }
  const peers = ['deepeval', 'promptfoo'];
  const available = [...ours.values()]
    .map((row) => ({
      ...row,
      baselines: peers.map((name) => replayPair(row.result.item, contestantById(name), records)),
    }))
    .filter((row) => refused.has(row.result.item.id) || row.baselines.every((b) => b.complete));
  const cohorts = [
    {
      name: '267 earlier common test items inside tonight sample',
      rows: available.filter((r) => requestedIds.has(r.result.item.id) && oldCommon.has(r.result.item.id)),
    },
    ...(completion
      ? [
          {
            name: 'additional peer-completion items, separate from the earlier267',
            rows: available.filter(
              (r) => completion.completedIds.includes(r.result.item.id) && !oldCommon.has(r.result.item.id),
            ),
          },
        ]
      : []),
    {
      name: completion
        ? 'all matched items after conditional peer completion, exploratory'
        : 'all matched test items available without new peer calls',
      rows: available,
    },
  ];
  if (cohorts[0]!.rows.length !== prior.tonightPredeclaredOverlapWithEarlierCommonCompleteItems)
    throw new Error('Earlier overlap coverage mismatch');
  const reports = cohorts.map((cohort) => {
    const variants = [
      {
        name: 'frozen native direct plus chat vote3',
        rows: cohort.rows.map((r) => r.result),
        keys: cohort.rows.flatMap((r) => r.keys),
      },
      ...peers.map((name, i) => ({
        name,
        rows: cohort.rows.map(
          (r): PairResult => ({
            item: r.result.item,
            games: r.baselines[i]!.games,
            missing: 0,
            providerRefused: refused.has(r.result.item.id),
          }),
        ),
        keys: cohort.rows.flatMap((r) => r.baselines[i]!.keys.filter((k): k is string => !!k)),
      })),
    ];
    const views = ['official', 'refusal-excluded'].map((view) => {
      const selected = variants.map((v) => ({
        ...v,
        rows: v.rows.filter((r) => view === 'official' || !refused.has(r.item.id)),
      }));
      const diffs = selected
        .slice(1)
        .map((v) => ({ peer: v.name, ...pairedDifference(selected[0]!.rows, v.rows) }));
      const sorted = [...diffs].sort((a, b) => a.exactPairedTest.pTwoSided - b.exactPairedTest.pTwoSided);
      let last = 0;
      const adjusted = new Map(
        sorted.map((d, i) => {
          last = Math.max(last, Math.min(1, d.exactPairedTest.pTwoSided * (sorted.length - i)));
          return [d.peer, last] as const;
        }),
      );
      return {
        view,
        variants: selected.map((v) => ({ name: v.name, summary: scorePairs('mmeval', v.rows) })),
        pairedDifferences: diffs.map((d) => ({ ...d, holmAdjustedP: adjusted.get(d.peer) })),
      };
    });
    return {
      name: cohort.name,
      items: cohort.rows.length,
      ids: cohort.rows.map((r) => r.result.item.id),
      additionalItemsOutsideTonightSample: cohort.rows.filter((r) => !requestedIds.has(r.result.item.id))
        .length,
      refusedItems: cohort.rows.filter((r) => refused.has(r.result.item.id)).length,
      views,
      costs: variants.map((v) => {
        const keys = new Set(v.keys);
        const setup = peers.includes(v.name)
          ? contestantById(v.name).setup?.pair?.(CRITERIA.mmeval)
          : undefined;
        if (setup) keys.add(promptKey('haiku', setup));
        const successfulCost = [...keys].reduce((s, k) => s + records.get(k)!.costUsd, 0);
        const failedCost =
          v.name === variants[0]!.name
            ? cohort.rows.reduce((sum, r) => sum + (refusalCharges.get(r.result.item.id) ?? 0), 0)
            : peerRefusalCharges
                .filter((e) => e.peer === v.name && cohort.rows.some((r) => r.result.item.id === e.id))
                .reduce((sum, e) => sum + e.reportedCostUsd, 0);
        const cost = successfulCost + failedCost;
        return {
          name: v.name,
          recordedCostUsd: cost,
          recordedCostPer100: (cost * 100) / cohort.rows.length,
          uniqueCalls: keys.size,
          chargedCalls:
            keys.size +
            (v.name === variants[0]!.name
              ? cohort.rows.filter((r) => refusalCharges.has(r.result.item.id)).length
              : peerRefusalCharges.filter(
                  (e) => e.peer === v.name && cohort.rows.some((r) => r.result.item.id === e.id),
                ).length),
          note: 'Recorded successful inference cost plus reported refusal charges in this cohort; cached calls priced. Both views retain the requested-cohort cost denominator.',
        };
      }),
    };
  });
  const uniformResults = [...ours.values()]
    .filter((r) => requestedIds.has(r.result.item.id))
    .map((r) => ({
      ...r.result,
      providerRefused: refused.has(r.result.item.id),
      missing: refused.has(r.result.item.id) ? 2 : 0,
    }));
  const excludedResults = uniformResults.filter((r) => !r.providerRefused);
  await writeFile(
    `${root}/test-sample-uniform-availability.json`,
    JSON.stringify(
      {
        ...run,
        nativeInferenceCompletedAt: run.time,
        time: new Date().toISOString(),
        availabilityProtocol:
          'Union of provider-refused sample IDs across frozen judge and peer completion; the identical wrong/excluded rule applies to every contestant.',
        providerRefusedCount: refused.size,
        providerRefusedIds: [...refused],
        summary: scorePairs('mmeval', uniformResults),
        interval95: stratifiedInterval(uniformResults),
        excludedSummary: scorePairs('mmeval', excludedResults),
        excludedInterval95: stratifiedInterval(excludedResults),
      },
      null,
      2,
    ) + '\n',
  );
  const report = {
    label: 'frozen test paired peer comparison',
    frozenCommit: run.frozenCommit,
    contractSha: config.contractSha,
    newModelCalls: 0,
    newSpendUsd: 0,
    additionalFreeScoredItems: freeRows.length,
    conditionalPeerCoverage: completion ?? null,
    sequentialInferenceNote: completion
      ? 'Extra coverage is triggered by an inconclusive initial267 comparison. Pooled p values and intervals are exploratory after this data-dependent extension. The initial267 and separate additional-cohort contrasts are retained.'
      : 'This is the fixed initial free comparison before any conditional paid coverage.',
    cohorts: reports,
    limitation:
      'Confirmation on a previously evaluated split; common recorded coverage can be selection biased. The exact sign test and the paired macro difference address different estimands. No tuning follows test.',
    time: new Date().toISOString(),
  };
  await writeFile(`${root}/test-peer-paired.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    `${root}/test-extra-free-decisions.jsonl`,
    freeRows.map((r) => JSON.stringify(r)).join('\n') + (freeRows.length ? '\n' : ''),
  );
  process.stdout.write(
    JSON.stringify({
      additionalFreeScoredItems: freeRows.length,
      conditionalPeerCoverage: completion ?? null,
      sequentialInferenceNote: completion
        ? 'Extra coverage is triggered by an inconclusive initial267 comparison. Pooled p values and intervals are exploratory after this data-dependent extension. The initial267 and separate additional-cohort contrasts are retained.'
        : 'This is the fixed initial free comparison before any conditional paid coverage.',
      cohorts: reports.map((r) => ({ name: r.name, items: r.items, views: r.views })),
    }) + '\n',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
