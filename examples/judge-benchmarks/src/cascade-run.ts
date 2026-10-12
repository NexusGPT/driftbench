import { cascadeReasons } from './cascade';
import { type Contestant, contestantById } from './contestants';
import { loadBenchmark } from './data';
import { type RunOptions, type RunReport, runBenchmark } from './run';
import { type PairResult, scorePairs } from './score';
export async function runReferenceCascade(
  options: Omit<RunOptions, 'contestants'> & { escalation: Contestant; confidenceThreshold?: number },
): Promise<RunReport & { escalated: number; escalationShare: number }> {
  const base = new Map<string, PairResult>();
  const signals = new Map<string, { reference?: string; ab: string[]; ba: string[] }>();
  const baseline = await runBenchmark({
    ...options,
    contestants: [
      contestantById(
        options.escalation.answerFormat ? 'driftbench-reference3-format' : 'driftbench-reference3',
      ),
    ],
    onPairResult: (r) => {
      base.set(r.item.id, r);
    },
    onEvidence: async (s) => {
      await options.onEvidence?.(s);
      const e = signals.get(s.item) ?? { ab: [], ba: [] };
      const d = s.details as { text?: string; order?: string; texts?: string[] } | undefined;
      if (s.kind === 'reference') e.reference = d?.text;
      if (s.kind === 'judgements' && d?.order === 'AB') e.ab = d.texts ?? [];
      if (s.kind === 'judgements' && d?.order === 'BA') e.ba = d.texts ?? [];
      signals.set(s.item, e);
    },
  });
  if (baseline.stopped || baseline.contestants[0]?.summary.missing)
    return { ...baseline, escalated: 0, escalationShare: 0 };
  const selected = new Set(
    [...base.values()]
      .filter(({ item }) => {
        const e = signals.get(item.id);
        return (
          cascadeReasons(
            {
              question: item.question,
              a: item.a,
              b: item.b,
              reference: e?.reference,
              ab: e?.ab ?? [],
              ba: e?.ba ?? [],
            },
            options.confidenceThreshold ?? 0.75,
          ).length > 0
        );
      })
      .map((r) => r.item.id),
  );
  const criterion =
    options.criterion ??
    (options.items ? 'The response is correct.' : (await loadBenchmark(options.bench)).criterion);
  const escalated = new Map<string, PairResult>();
  const r = await runBenchmark({
    ...options,
    items: [...base.values()].filter((r) => selected.has(r.item.id)).map((r) => r.item),
    sample: undefined,
    sampleBeforeSplit: undefined,
    criterion,
    contestants: [options.escalation],
    capUsd: options.capUsd === undefined ? undefined : Math.max(0, options.capUsd - baseline.newSpendUsd),
    onPairResult: (r) => {
      escalated.set(r.item.id, r);
    },
  });
  const results = [...base.values()].map((v) =>
    selected.has(v.item.id)
      ? (escalated.get(v.item.id) ?? { ...v, games: ['tie', 'tie'] as const, missing: 2 })
      : v,
  );
  for (const result of results) options.onPairResult?.(result);
  const first = baseline.contestants[0],
    second = r.contestants[0];
  return {
    ...baseline,
    contestants: [
      {
        contestant: `${options.escalation.id}-cascade`,
        source: 'unchanged reference3, then label-blind uncertainty-gated escalation',
        mode: 'pairwise, both orders',
        summary: scorePairs(options.bench, results),
        costUsd: (first?.costUsd ?? 0) + (second?.costUsd ?? 0),
        calls: (first?.calls ?? 0) + (second?.calls ?? 0),
      },
    ],
    newCalls: baseline.newCalls + r.newCalls,
    newSpendUsd: baseline.newSpendUsd + r.newSpendUsd,
    replayed: baseline.replayed + r.replayed,
    failedCalls: baseline.failedCalls + r.failedCalls,
    ...(r.stopped ? { stopped: r.stopped } : {}),
    escalated: selected.size,
    escalationShare: selected.size / baseline.items,
  };
}
