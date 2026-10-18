/** The benchmark engine uses only the shipped judge and statistics APIs. No benchmark prompt lives here. */
import { createHash } from 'node:crypto';
import {
  type Cassette,
  type JudgeClient,
  type JudgeRequest,
  PROMPT_FINGERPRINT,
  parseJudgeText,
  playerClient,
  recordingClient,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import {
  bootstrapCI,
  mcnemar,
  nonInferiority,
  wilson,
  zeroFailureBound,
} from '@agent-nexus/driftbench-stats';

export interface BenchCase {
  id: string;
  family: string;
  expected: 'pass' | 'fail';
  request: JudgeRequest;
}
export interface BenchSlice {
  name: string;
  version: number;
  /** Content hash of the immutable dataset version in the registry. */
  hash: string;
  cases: BenchCase[];
}
export interface CaseResult {
  id: string;
  family: string;
  expected: 'pass' | 'fail';
  outcome: 'pass' | 'fail' | 'inconclusive';
  correct: boolean;
}
export interface BenchReport {
  format: 'driftbench-bench-v1';
  slice: string;
  datasetVersion: number;
  datasetHash: string;
  judge: string;
  model: string;
  settings: string | null;
  fingerprint: string;
  head: string;
  startedAt: string;
  finishedAt: string;
  n: number;
  correct: number;
  wilson: ReturnType<typeof wilson>;
  familyBootstrap: ReturnType<typeof bootstrapCI>;
  zeroFailure: { requiredCleanCases: number; independentCasesRequired: true; observedClean: boolean };
  results: CaseResult[];
}
export interface BenchFloor {
  slice: string;
  datasetVersion: number;
  datasetHash: string;
  judge: string;
  model: string;
  n: number;
  correct: number;
  wilsonLower: number;
  fingerprint: string;
  head: string;
  results: CaseResult[];
  evidenceHash: string;
}
export function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}
const TRANSPORT_UNPARSED = 'bench:transport-unparsed';
/** Keep a transport rejection that the public raw-text parser alone cannot reconstruct. */
export function recordBenchClient(client: JudgeClient, cassette: Cassette): JudgeClient {
  const recorder = recordingClient(client, cassette);
  const record = async (request: JudgeRequest) => {
    const result = await recorder.judge(request);
    if (result.unparsed && !parseJudgeText(result.raw, request).unparsed) {
      const key = requestKey(request, client);
      const entry = cassette.entries.findLast((row) => row.judge === client.id && row.key === key);
      if (!entry) throw new Error('Recorded response is missing');
      entry.note = TRANSPORT_UNPARSED;
    }
    return result;
  };
  let initialized: ReturnType<typeof record> | undefined;
  return {
    ...recorder,
    async judge(request) {
      // Let the public client settle model-specific first-call negotiation before fan-out.
      if (!initialized) {
        initialized = record(request);
        return initialized;
      }
      await initialized;
      return record(request);
    },
  };
}
export function playBenchClient(cassette: Cassette, judge: string): JudgeClient {
  const player = playerClient(cassette, judge, { answerContract: 'ledger' });
  const byKey = new Map<string, Cassette['entries']>();
  for (const entry of cassette.entries) {
    if (entry.judge === judge) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  }
  const used = new Map<string, number>();
  return {
    ...player,
    async judge(request) {
      const key = requestKey(request, player);
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      const result = await player.judge(request);
      return byKey.get(key)?.[index]?.note === TRANSPORT_UNPARSED ? { ...result, unparsed: true } : result;
    },
  };
}
export function validateSlice(slice: BenchSlice): void {
  if (
    !slice ||
    !/^[a-z0-9][a-z0-9-]*$/.test(slice.name) ||
    !Number.isInteger(slice.version) ||
    slice.version < 1 ||
    !/^[a-f0-9]{64}$/.test(slice.hash)
  )
    throw new Error('Invalid bench dataset identity');
  if (!Array.isArray(slice.cases) || !slice.cases.length) throw new Error('A slice needs cases');
  const ids = new Set<string>();
  for (const row of slice.cases) {
    if (!row.id || ids.has(row.id)) throw new Error(`Missing or duplicate case id: ${row.id}`);
    ids.add(row.id);
    if (!row.family || !['pass', 'fail'].includes(row.expected))
      throw new Error(`Invalid label or family: ${row.id}`);
    const request = row.request;
    // The floor measures the default, so data cannot opt into a different contract or prompt.
    const allowed = new Set(['criterion', 'transcript', 'inputs', 'reference', 'artifact', 'given']);
    if (!request || Object.keys(request).some((key) => !allowed.has(key)))
      throw new Error(`${row.id}: only the shipped default is allowed`);
    if (
      !request.criterion?.name ||
      !request.criterion.rubric ||
      !Array.isArray(request.transcript) ||
      request.transcript.length === 0
    )
      throw new Error(`${row.id}: invalid judge request`);
    if (
      request.transcript.some(
        (entry) =>
          !['agent', 'user', 'tool_call', 'tool_result', 'context', 'card'].includes(entry.role) ||
          typeof entry.text !== 'string',
      )
    )
      throw new Error(`${row.id}: invalid transcript`);
  }
}
export async function scoreSlice(
  slice: BenchSlice,
  client: JudgeClient,
  options: { head: string; concurrency?: number; onResult?: (index: number, result: CaseResult) => void },
): Promise<BenchReport> {
  validateSlice(slice);
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(slice.cases.length);
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('concurrency must be 1..16');
  let next = 0;
  let failure: unknown;
  const pending = new Map<string, Promise<void>>();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, slice.cases.length) }, async () => {
      while (!failure) {
        const index = next++;
        const row = slice.cases[index];
        if (!row) break;
        const key = requestKey(row.request, client);
        const previous = pending.get(key);
        let release: () => void = () => {};
        pending.set(
          key,
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        );
        try {
          // Duplicate data still needs one call per case, in stable cassette order.
          await previous;
          if (failure) break;
          // Labels, ids and construction families never enter the model request.
          const answer = await client.judge(row.request);
          const outcome = answer.unparsed ? 'inconclusive' : answer.answer.outcome;
          const result: CaseResult = {
            id: row.id,
            family: row.family,
            expected: row.expected,
            outcome,
            correct: outcome === row.expected,
          };
          results[index] = result;
          options.onResult?.(index, result);
        } catch (cause) {
          failure = cause;
        } finally {
          release();
        }
      }
    }),
  );
  if (failure) throw failure;
  const correct = results.filter((row) => row.correct).length;
  return {
    format: 'driftbench-bench-v1',
    slice: slice.name,
    datasetVersion: slice.version,
    datasetHash: slice.hash,
    judge: client.id,
    model: client.model ?? client.id,
    settings: client.settings ?? null,
    fingerprint: PROMPT_FINGERPRINT,
    head: options.head,
    startedAt,
    finishedAt: new Date().toISOString(),
    n: results.length,
    correct,
    wilson: wilson(correct, results.length),
    familyBootstrap: bootstrapCI(
      results.map((row) => Number(row.correct)),
      { clusters: results.map((row) => row.family), seed: 1 },
    ),
    zeroFailure: {
      requiredCleanCases: zeroFailureBound(0.05),
      independentCasesRequired: true,
      observedClean: correct === results.length,
    },
    results,
  };
}
export async function replaySlice(
  slice: BenchSlice,
  cassette: Cassette,
  judge: string,
  options: { head: string },
): Promise<BenchReport> {
  validateSlice(slice);
  const descriptor = cassette.judges.find((item) => item.id === judge);
  if (!descriptor) throw new Error(`re-record needed: no judge ${judge}`);
  const needed = new Map<string, number>();
  for (const row of slice.cases) {
    const key = requestKey(row.request, descriptor);
    needed.set(key, (needed.get(key) ?? 0) + 1);
  }
  for (const entry of cassette.entries) {
    const count = needed.get(entry.key) ?? 0;
    if (entry.judge !== judge || count === 0)
      throw new Error(`re-record needed: ${slice.name}/${judge}: unexpected request occurrence`);
    needed.set(entry.key, count - 1);
  }
  if ([...needed.values()].some((count) => count !== 0))
    throw new Error(`re-record needed: ${slice.name}/${judge}: missing request occurrences`);
  try {
    return await scoreSlice(slice, playBenchClient(cassette, judge), options);
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'cassette_miss')
      throw new Error(
        `re-record needed: ${slice.name}/${judge}: data, prompt fingerprint or client settings changed`,
        { cause },
      );
    throw cause;
  }
}
function validateResults(report: Pick<BenchReport, 'n' | 'correct' | 'results'>): void {
  if (
    !Number.isInteger(report.n) ||
    report.n < 1 ||
    !Array.isArray(report.results) ||
    report.results.length !== report.n
  )
    throw new Error('Evidence has an invalid case count');
  if (new Set(report.results.map((r) => r.id)).size !== report.n)
    throw new Error('Evidence has duplicate case IDs');
  for (const row of report.results) {
    if (
      !row.id ||
      !row.family ||
      !['pass', 'fail'].includes(row.expected) ||
      !['pass', 'fail', 'inconclusive'].includes(row.outcome) ||
      row.correct !== (row.expected === row.outcome)
    )
      throw new Error('Evidence verdict does not match its label');
  }
  if (report.correct !== report.results.filter((r) => r.correct).length)
    throw new Error('Evidence score does not match its case verdicts');
}
export function validateReport(report: BenchReport): void {
  if (report.format !== 'driftbench-bench-v1' || report.fingerprint !== PROMPT_FINGERPRINT)
    throw new Error('Evidence fingerprint does not match the shipped default; re-record needed');
  if (
    !/^[a-f0-9]{40}$/.test(report.head) ||
    !/^[a-f0-9]{64}$/.test(report.datasetHash) ||
    !Number.isInteger(report.datasetVersion) ||
    report.datasetVersion < 1
  )
    throw new Error('Evidence must name a commit and dataset version');
  if (
    !report.model ||
    !report.judge ||
    !report.slice ||
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !Number.isFinite(Date.parse(report.finishedAt))
  )
    throw new Error('Evidence metadata is incomplete');
  validateResults(report);
  const expected = wilson(report.correct, report.n);
  for (const key of ['lower', 'upper', 'estimate'] as const) {
    if (!Number.isFinite(report.wilson?.[key]) || Math.abs(report.wilson[key] - expected[key]) > 1e-12)
      throw new Error('Evidence Wilson interval is inconsistent');
  }
}
/** Baseline self-comparison sets the smallest half percentage point margin that passes. */
export function comparePaired(baseline: CaseResult[], candidate: CaseResult[]) {
  const byId = new Map(candidate.map((r) => [r.id, r]));
  if (baseline.length !== candidate.length || byId.size !== baseline.length)
    throw new Error('Paired evidence needs exactly the same case IDs');
  const old = baseline.map((r) => r.correct);
  const now = baseline.map((r) => {
    const c = byId.get(r.id);
    if (!c || c.expected !== r.expected || c.family !== r.family)
      throw new Error('Paired labels or families changed; use a new dataset version');
    return c.correct;
  });
  const self = nonInferiority({ baseline: old, candidate: old, margin: 0.5 });
  const margin = Math.max(0.005, (Math.floor(self.effect.upper / 0.005) + 1) * 0.005);
  if (margin >= 1) throw new Error('Too few cases for non-inferiority');
  const ni = nonInferiority({ baseline: old, candidate: now, margin, pairs: baseline.map((r) => r.id) });
  const exact = mcnemar(ni.discordant.regressed, ni.discordant.improved, { exact: true });
  const familyBootstrap = bootstrapCI(
    old.map((x, i) => Number(now[i]) - Number(x)),
    { clusters: baseline.map((r) => r.family), seed: 1 },
  );
  return {
    mcnemar: exact,
    nonInferiority: ni,
    familyBootstrap,
    regression: (ni.effect.estimate > 0 && exact.pValue < 0.05) || !ni.nonInferior,
  };
}
export function checkFloor(report: BenchReport, floor: BenchFloor | undefined) {
  validateResults(report);
  const problems: string[] = [];
  if (report.fingerprint !== PROMPT_FINGERPRINT) problems.push('re-record needed: stale fingerprint');
  if (!floor)
    return { holds: false, problems: [...problems, `No floor for ${report.slice}/${report.judge}`] };
  validateResults(floor);
  if (
    floor.slice !== report.slice ||
    floor.judge !== report.judge ||
    floor.model !== report.model ||
    floor.datasetVersion !== report.datasetVersion ||
    floor.datasetHash !== report.datasetHash ||
    floor.n !== report.n
  )
    return { holds: false, problems: [...problems, 'Floor and run name different datasets or models'] };
  if (report.correct < floor.correct)
    problems.push(`${report.correct}/${report.n} is below the floor ${floor.correct}/${floor.n}`);
  const paired = comparePaired(floor.results, report.results);
  if (paired.regression) problems.push(`Paired regression: ${paired.nonInferiority.reason}`);
  return { holds: problems.length === 0, problems, paired };
}
/** Equal counts can update evidence at a new fingerprint, but the numeric floor never falls. */
export function raiseFloor(previous: BenchFloor | undefined, evidence: BenchReport): BenchFloor {
  validateReport(evidence);
  if (previous) {
    if (evidence.datasetVersion < previous.datasetVersion) throw new Error('Dataset versions only rise');
    if (evidence.datasetVersion === previous.datasetVersion) {
      const checked = checkFloor(evidence, previous);
      if (!checked.holds) throw new Error(checked.problems.join('; '));
      if (evidence.correct === previous.correct && evidence.fingerprint === previous.fingerprint)
        throw new Error('The floor only rises within a dataset version');
    }
  }
  return {
    slice: evidence.slice,
    datasetVersion: evidence.datasetVersion,
    datasetHash: evidence.datasetHash,
    judge: evidence.judge,
    model: evidence.model,
    n: evidence.n,
    correct: evidence.correct,
    wilsonLower: evidence.wilson.lower,
    fingerprint: evidence.fingerprint,
    head: evidence.head,
    results: structuredClone(evidence.results),
    evidenceHash: sha256(JSON.stringify(evidence)),
  };
}
