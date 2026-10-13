import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createEscalation,
  type JudgeClient,
  type JudgeOutcome,
  type JudgeResult,
  judgePairwise,
  parseAnswerText,
} from '@agent-nexus/driftbench-judges';

type Side = 'A' | 'B' | 'tie';
type Games = readonly [Side, Side] | null;
type Comparison = {
  key: string;
  order: 'AB' | 'BA';
  rawWinner: 'A' | 'B' | 'tie' | 'inconclusive' | null;
  unparsed: boolean;
  textSha256: string;
};
type RawSeat = readonly { key: string; order: 'AB' | 'BA'; text: string }[];
export type RecordingRow = {
  id: string;
  subset: string;
  language: string;
  label: 'A' | 'B';
  generatorFamily: null;
  first: { kind: 'direct' | 'chat-vote3' | 'provider-refusal'; samples: Comparison[][] };
  then: {
    'gpt-5.4-mini': RawSeat;
    'gemini-3.8-flash': RawSeat;
    /** Historical decoded votes, already mapped to original candidates, in AB/BA/AB-prefer order. */
    jev: readonly Side[];
  } | null;
};
export type Fixture = {
  schema: 1;
  ids: string[];
  rows: RecordingRow[];
  sources: { commit: string; path: string; gitBlob: string; sha256: string }[];
  scorer: { commit: string; path: string; sha256: string };
};

const fixtureUrl = new URL('../fixtures/mm-dev400.jsonl', import.meta.url);
export function loadFixture(): Fixture {
  const [header, ...rows] = readFileSync(fixtureUrl, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  return { ...header, rows } as Fixture;
}

const flip = (side: Side): Side => (side === 'A' ? 'B' : side === 'B' ? 'A' : 'tie');
const sideOf = (outcome: JudgeOutcome): Side => (outcome === 'pass' ? 'A' : outcome === 'fail' ? 'B' : 'tie');
const outcomeOf = (side: Side): JudgeOutcome =>
  side === 'A' ? 'pass' : side === 'B' ? 'fail' : 'inconclusive';
const net = (sides: readonly Side[]): Side => {
  const a = sides.filter((side) => side === 'A').length;
  const b = sides.filter((side) => side === 'B').length;
  return a > b ? 'A' : b > a ? 'B' : 'tie';
};

/** Decode only historical per-call results. Repairs replace the prior attempt in that order. */
export function firstGames(first: RecordingRow['first']): Games {
  if (first.kind === 'provider-refusal') {
    if (first.samples.length !== 0) throw new Error('A provider refusal cannot contain successful samples');
    return null;
  }
  const expectedSamples = first.kind === 'chat-vote3' ? 3 : 1;
  if (first.samples.length !== expectedSamples) throw new Error('Incomplete first-seat sample coverage');
  const samples = first.samples.map((comparisons): readonly [Side, Side] => {
    const decode = (order: 'AB' | 'BA'): Side => {
      // The historical recorder infers order from candidate text. Identical candidates
      // therefore record AB twice, with the same request key and response hash.
      const [first, second] = comparisons;
      const symmetric =
        comparisons.length === 2 &&
        first &&
        second &&
        first.key === second.key &&
        first.textSha256 === second.textSha256;
      const comparison = symmetric
        ? comparisons[order === 'AB' ? 0 : 1]
        : comparisons.filter((row) => row.order === order).at(-1);
      if (!comparison) throw new Error(`Missing first-seat ${order} recording`);
      const side =
        !comparison.unparsed && (comparison.rawWinner === 'A' || comparison.rawWinner === 'B')
          ? comparison.rawWinner
          : 'tie';
      return order === 'BA' ? flip(side) : side;
    };
    return [decode('AB'), decode('BA')];
  });
  return [net(samples.map((sample) => sample[0])), net(samples.map((sample) => sample[1]))];
}

function chatVote(recordings: RawSeat): Side {
  if (recordings.length !== 2 || new Set(recordings.map((row) => row.order)).size !== 2)
    throw new Error('Incomplete later-seat order coverage');
  return net(
    recordings.map((recording) => {
      const parsed = parseAnswerText(recording.text);
      const side = parsed.unparsed ? 'tie' : sideOf(parsed.answer.outcome);
      return recording.order === 'BA' ? flip(side) : side;
    }),
  );
}

function recordedResult(side: Side): JudgeResult {
  // The historical cascade treats every undecided game, including an explicit tie,
  // as eligible for escalation. Preserve that policy without changing stored rawWinner.
  const winner = side === 'tie' ? 'inconclusive' : side;
  return {
    winner,
    answer: { outcome: outcomeOf(side), reasoning: 'Decoded historical recording; no provider call.' },
    raw: JSON.stringify({ winner }),
    costUsd: 0,
  };
}

/** No labels, subset names, expected scores or provider clients reach these adapters. */
function recordedClients(first: RecordingRow['first'], later: RecordingRow['then']) {
  const games = firstGames(first);
  let calls = 0;
  const recordingErrors: Error[] = [];
  const firstSeat: JudgeClient = {
    id: 'haiku-frozen-recording',
    family: 'anthropic',
    cls: 'system2',
    cost: 0,
    async judge(request) {
      calls += 1;
      const reverse = request.candidates?.A === 'recorded-B';
      const side = games?.[reverse ? 1 : 0] ?? 'tie';
      return recordedResult(reverse ? flip(side) : side);
    },
  };
  const seat = (
    id: string,
    family: string,
    vote: (recordings: NonNullable<RecordingRow['then']>) => Side,
  ): JudgeClient => ({
    id,
    family,
    cls: family === 'jev' ? 'system1' : 'system2',
    cost: 0,
    async judge(request) {
      calls += 1;
      try {
        if (!later)
          throw new Error(`Recording missing for requested later seat ${id}; live fallback forbidden`);
        const side = vote(later);
        // Historical later-seat "tie" is no net preference or no Jev quorum, so it abstains.
        return recordedResult(request.candidates?.A === 'recorded-B' ? flip(side) : side);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        recordingErrors.push(error);
        throw error;
      }
    },
  });
  return {
    first: firstSeat,
    laterSeats: [
      seat('gpt-5.4-mini-recording', 'openai', (recordings) => chatVote(recordings['gpt-5.4-mini'])),
      seat('gemini-3.8-flash-recording', 'google', (recordings) => chatVote(recordings['gemini-3.8-flash'])),
      seat('jev-three-framing-recording', 'jev', (recordings) => {
        const votes = recordings.jev;
        if (votes.length !== 3) throw new Error('Incomplete Jev framing coverage');
        return votes.filter((vote) => vote === 'A').length >= 2
          ? 'A'
          : votes.filter((vote) => vote === 'B').length >= 2
            ? 'B'
            : 'tie';
      }),
    ],
    calls: () => calls,
    verify: () => {
      // A council tolerates a failed seat. A reproducibility replay must reject a missing recording.
      if (recordingErrors[0]) throw recordingErrors[0];
    },
  };
}

const itemScore = (label: 'A' | 'B', games: Games): number =>
  games === null
    ? 0
    : games.reduce((sum, game) => sum + (game === label ? 1 : game === 'tie' ? 0.5 : 0), 0) / 2;
const round = (n: number) => Math.round(n * 100) / 100;

function summary(rows: readonly { subset: string; value: number }[]) {
  const groups = [...new Set(rows.map((row) => row.subset))].sort();
  const means = groups.map((subset) => {
    const values = rows.filter((row) => row.subset === subset);
    return {
      subset,
      n: values.length,
      value: values.reduce((sum, row) => sum + row.value, 0) / values.length,
    };
  });
  return {
    total: round((means.reduce((sum, row) => sum + row.value, 0) / means.length) * 100),
    bySubset: Object.fromEntries(
      means.map((row) => [row.subset, { n: row.n, score: round(row.value * 100) }]),
    ),
  };
}

function assertCoverage(fixture: Fixture) {
  if (new Set(fixture.rows.map((row) => row.id)).size !== fixture.rows.length)
    throw new Error('Duplicate recording row');
  if (fixture.ids.length !== 400 || new Set(fixture.ids).size !== 400 || fixture.rows.length !== 400)
    throw new Error('DEV400 coverage must contain exactly 400 distinct IDs');
  const expected = new Set(fixture.ids);
  for (const row of fixture.rows) {
    if (!expected.has(row.id)) throw new Error(`Unexpected ID in coverage: ${row.id}`);
    if (!['A', 'B'].includes(row.label)) throw new Error(`Invalid scoring label: ${row.id}`);
    if (row.generatorFamily !== null) throw new Error('Historical family provenance must stay unknown');
    firstGames(row.first);
  }
}

export async function replay(fixture: Fixture) {
  assertCoverage(fixture);
  const rows = [];
  let replayedCalls = 0;
  for (const recording of fixture.rows) {
    const clients = recordedClients(recording.first, recording.then);
    const judge = createEscalation({
      first: clients.first,
      // biome-ignore lint/suspicious/noThenProperty: Public escalation configuration uses an array named then.
      then: clients.laterSeats,
      on: ['order-split', 'inconclusive'],
      decide: 'first-stands',
      // Historical metadata is missing. This explicitly makes no family-independence claim.
      agentFamily: 'unknown',
    });
    const verdict = await judgePairwise(
      judge,
      { name: 'recording-replay', rubric: 'Replay the recorded candidate preference.' },
      [],
      'recorded-A',
      'recorded-B',
      { audit: false },
    );
    clients.verify();
    const baselineGames = firstGames(recording.first);
    const games: Games =
      baselineGames === null && verdict.escalation?.decision !== 'majority'
        ? null
        : [sideOf(verdict.ordered), flip(sideOf(verdict.swapped))];
    replayedCalls += clients.calls();
    rows.push({
      id: recording.id,
      subset: recording.subset,
      baselineGames,
      games,
      baselineScore: itemScore(recording.label, baselineGames),
      score: itemScore(recording.label, games),
      escalated: verdict.escalation?.escalated ?? false,
      triggers: verdict.escalation?.triggers ?? [],
      decision: verdict.escalation?.decision,
    });
  }
  return {
    benchmark: 'MM-Eval DEV400',
    provenance: fixture.scorer,
    familyRule: 'UNVERIFIED: generator family is missing for all 400 historical rows.',
    baseline: summary(rows.map((row) => ({ subset: row.subset, value: row.baselineScore }))),
    cascade: summary(rows.map((row) => ({ subset: row.subset, value: row.score }))),
    wins: rows.filter((row) => row.score > row.baselineScore).length,
    losses: rows.filter((row) => row.score < row.baselineScore).length,
    coverage: {
      rows: rows.length,
      chatVote3: fixture.rows.filter((row) => row.first.kind === 'chat-vote3').length,
      providerRefusals: fixture.rows.filter((row) => row.first.kind === 'provider-refusal').length,
      escalated: rows.filter((row) => row.escalated).length,
      replayedCalls,
      liveCalls: 0,
    },
    rows,
  };
}

export function verifyReport(report: Awaited<ReturnType<typeof replay>>) {
  if (report.baseline.total !== 89.65 || report.cascade.total !== 91.16)
    throw new Error(
      `Score mismatch: expected baseline 89.65 and cascade 91.16; got ${report.baseline.total} and ${report.cascade.total}`,
    );
  if (report.wins !== 11 || report.losses !== 4)
    throw new Error('Paired row score mismatch: expected 11 wins and 4 losses');
  if (report.coverage.rows !== 400 || report.coverage.escalated !== 26)
    throw new Error('Row coverage mismatch: expected 400 rows and 26 escalations');
}

export function fixtureHash(): string {
  return createHash('sha256').update(readFileSync(fixtureUrl)).digest('hex');
}
