import { createHash } from 'node:crypto';
import {
  type JudgeClient,
  type JudgeOutcome,
  type JudgeRequest,
  judgeRepeated,
  majority,
  pairwiseRequest,
  withReferenceConsensus,
} from '@agent-nexus/driftbench-judges';
import { CRITERION, type Prompt, recordedPrompt, routePrompt, solvePrompt } from './historical';
import { parseAnswerText } from './historical-parser';

export type Pair = {
  id: string;
  question: string;
  a: string;
  b: string;
  label: 'A' | 'B';
};
export type Choice = 'A' | 'B' | 'tie';
export type Decision = { item: Pair; games: readonly Choice[] };
export type Recorded = { key: string; model: string; text: string; costUsd: number };
export type Variant = 'reference3' | 'adaptive';
export type Unavailable = { item: string; reference: 'omitted'; orders: readonly ['AB', 'BA'] };

/** Historical hash, including the whole prompt. Labels on a recording never select it. */
export function promptKey(prompt: Prompt): string {
  return createHash('sha256')
    .update(JSON.stringify(['haiku', prompt.system, prompt.user]))
    .digest('hex')
    .slice(0, 20);
}

export class RecordingStore {
  private readonly byKey = new Map<string, Recorded>();
  constructor(rows: readonly Recorded[]) {
    for (const row of rows) {
      if (
        typeof row.key !== 'string' ||
        row.model !== 'haiku' ||
        typeof row.text !== 'string' ||
        !Number.isFinite(row.costUsd) ||
        row.costUsd < 0
      )
        throw new Error('Invalid recording');
      const previous = this.byKey.get(row.key);
      if (previous && (previous.text !== row.text || previous.costUsd !== row.costUsd))
        throw new Error(`Conflicting recording: ${row.key}`);
      this.byKey.set(row.key, row);
    }
  }
  require(prompt: Prompt): Recorded {
    const key = promptKey(prompt);
    const row = this.byKey.get(key);
    if (!row) throw new Error(`Missing recording: ${key}`);
    return row;
  }
}

/** Historical plurality: abstentions do not enter the quorum. Default council quorum is different. */
export function reduceVotes(outcomes: readonly JudgeOutcome[]): Choice {
  const decisive = outcomes.filter((outcome) => outcome !== 'inconclusive');
  const result = majority(
    decisive.map((outcome, index) => ({ judge: String(index), outcome })),
    decisive.length,
  );
  return result === 'pass' ? 'A' : result === 'fail' ? 'B' : 'tie';
}

const flip = (choice: Choice): Choice => (choice === 'A' ? 'B' : choice === 'B' ? 'A' : 'tie');

/** Exact historical route parsing, adapted to the public question-only check port. */
export function routeAnswer(raw: string): 'YES' | 'NO' {
  return /^\s*\**\s*YES/i.test(raw) ? 'YES' : 'NO';
}

/** Official JudgeBench pair score: right +1, wrong -1, tie 0; only a positive sum is correct. */
export function officialCorrect(games: readonly Choice[], label: 'A' | 'B'): boolean {
  return games.reduce((score, game) => score + (game === label ? 1 : game === 'tie' ? 0 : -1), 0) > 0;
}

export async function replay(
  pairs: readonly Pair[],
  store: RecordingStore,
  variant: Variant,
  expected?: readonly Decision[],
  unavailable: readonly Unavailable[] = [],
) {
  if (new Set(pairs.map((pair) => pair.id)).size !== pairs.length) throw new Error('Duplicate pair id');
  const decisions: Decision[] = [];
  let routeReads = 0;
  let solveReads = 0;
  let judgementReads = 0;
  let unavailablePairs = 0;
  for (const item of pairs) {
    if (
      unavailable.some(
        (entry) =>
          entry.item === item.id && entry.reference === 'omitted' && entry.orders.join(',') === 'AB,BA',
      )
    ) {
      // Empty raw-call arrays are recorded evidence, not an implicit cassette fallback.
      decisions.push({ item, games: [reduceVotes([]), reduceVotes([])] });
      unavailablePairs++;
      continue;
    }
    // Preflight before the wrapper, whose production policy intentionally tolerates solve failures.
    // A replay cassette miss must instead fail the run, even on a swallowed solve/check exception.
    const route = variant === 'adaptive' ? store.require(routePrompt(item.question)) : undefined;
    const routed = route === undefined || routeAnswer(route.text) === 'YES';
    const solve = routed ? store.require(solvePrompt(item.question)) : undefined;
    const requests = [false, true].map((swapped) =>
      pairwiseRequest(
        { name: 'benchmark', rubric: CRITERION },
        [{ role: 'user', text: item.question }],
        swapped ? item.b : item.a,
        swapped ? item.a : item.b,
      ),
    );
    for (const request of requests) {
      for (let sample = 0; sample < 3; sample++) {
        store.require(recordedPrompt({ ...request, ...(solve ? { reference: solve.text } : {}) }, sample));
      }
    }
    let sample = 0;
    let solveCached: { answer: string; costUsd: number } | undefined;
    const client: JudgeClient = {
      id: 'recorded-haiku',
      family: 'recording',
      cls: 'system2',
      cost: 0,
      async judge(request: JudgeRequest) {
        if (request.reference !== solve?.text) throw new Error(`Reference mismatch: ${item.id}`);
        const row = store.require(recordedPrompt(request, sample++));
        judgementReads++;
        return { ...parseAnswerText(row.text), costUsd: row.costUsd };
      },
    };
    const wrapped = withReferenceConsensus(client, {
      samples: 1,
      ...(variant === 'adaptive'
        ? {
            route: 'auto' as const,
            check: async (question: string) => {
              if (question !== item.question) throw new Error('Check received data other than the question');
              routeReads++;
              const row = store.require(routePrompt(question));
              return { answer: routeAnswer(row.text), costUsd: row.costUsd };
            },
          }
        : {}),
      solve: async (question) => {
        if (question !== item.question) throw new Error('Solve received data other than the question');
        if (solveCached) return { answer: solveCached.answer };
        const row = store.require(solvePrompt(question));
        solveReads++;
        solveCached = { answer: row.text, costUsd: row.costUsd };
        return solveCached;
      },
    });
    const games: Choice[] = [];
    for (const [order, request] of requests.entries()) {
      sample = 0;
      const result = await judgeRepeated(wrapped, request, 3);
      const choice = reduceVotes(result.outcomes);
      games.push(order === 0 ? choice : flip(choice));
    }
    decisions.push({ item, games });
  }
  // Expected decisions and labels never enter the route, solve, client or reducer.
  if (expected) {
    const byId = new Map(expected.map((row) => [row.item.id, row]));
    if (byId.size !== expected.length || byId.size !== pairs.length)
      throw new Error('Expected population mismatch');
    for (const decision of decisions) {
      if (JSON.stringify(decision.games) !== JSON.stringify(byId.get(decision.item.id)?.games))
        throw new Error(
          `Verdict mismatch: ${decision.item.id}: got ${decision.games}, expected ${byId.get(decision.item.id)?.games}`,
        );
    }
  }
  return {
    variant,
    pairs: decisions.length,
    correct: decisions.filter((row) => officialCorrect(row.games, row.item.label)).length,
    comparedOrders: expected ? decisions.length * 2 : 0,
    rawReplayedOrders: (decisions.length - unavailablePairs) * 2,
    routeReads,
    solveReads,
    judgementReads,
    unavailablePairs,
    liveCalls: 0,
    decisions,
  };
}
