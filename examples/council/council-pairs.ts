import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import {
  type CouncilResult,
  createCouncil,
  createJevJudge,
  type JudgeClient,
  type JudgeRequest,
} from '../../packages/judges/src/index';

/**
 * driftbench's own council on a pairwise benchmark. A pair becomes one binary criterion, "response A is
 * better than response B": pass means A wins. System 2 seats are recorded chat-model verdicts (each the
 * net of both orders); System 1 seats are Jev, the real `createJevJudge` client, asked three ways: A shown
 * first, B shown first (answer inverted), and A first with a second wording. Hybrid mode: the System 2
 * majority decides; a split goes to System 1; a second split is inconclusive, scored as a tie.
 */

export type Side = 'A' | 'B' | 'tie' | 'missing';
export type PairInput = { id: string; question: string; a: string; b: string; criterion: string };

export function pairRequest(
  pair: PairInput,
  swapped = false,
  wording: 'better' | 'prefer' = 'better',
): JudgeRequest {
  const first = swapped ? pair.b : pair.a;
  const second = swapped ? pair.a : pair.b;
  const rubric =
    wording === 'better'
      ? `Response A is better than response B for the request, judged by this criterion: ${pair.criterion}`
      : `An expert who checks every claim against the request would choose response A over response B. Criterion: ${pair.criterion}`;
  return {
    criterion: {
      name: 'a_beats_b',
      rubric,
      pass: 'Response A meets the criterion better than response B.',
      fail: 'Response B meets the criterion at least as well as response A, or response A has an error B avoids.',
    },
    transcript: [
      { role: 'user', text: pair.question },
      { role: 'context', text: `Response A:\n${first}` },
      { role: 'context', text: `Response B:\n${second}` },
    ],
  };
}

/** The pair id a council request carries in its Given ledger. */
export function itemOf(request: JudgeRequest): string {
  return String(request.given?.ledger?.item ?? '');
}

/** A recorded verdict as a council seat: A is a pass, B a fail, a tie or a missing answer inconclusive. */
export function recordedSeat(id: string, family: string, verdicts: ReadonlyMap<string, Side>): JudgeClient {
  return {
    id,
    family,
    cls: 'system2',
    cost: 10,
    async judge(request) {
      const side = verdicts.get(itemOf(request)) ?? 'missing';
      const outcome = side === 'A' ? 'pass' : side === 'B' ? 'fail' : 'inconclusive';
      return { answer: { outcome, reasoning: `${id} recorded verdict ${side}` } };
    },
  };
}

/** A fetch that answers from a JSONL recording keyed by the request body, and records what it calls. */
export function recordingFetch(file: string, live: boolean) {
  const cache = new Map<string, { status: number; body: string }>();
  let loaded = false;
  const stats = { calls: 0, replayed: 0, inputTokens: 0, outputTokens: 0, ms: 0 };
  const fetchLike = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (!loaded) {
      loaded = true;
      try {
        for (const line of (await readFile(file, 'utf8')).split('\n'))
          if (line.trim()) {
            const row = JSON.parse(line) as { key: string; status: number; body: string };
            cache.set(row.key, row);
          }
      } catch {
        // no recording yet
      }
    }
    const key = createHash('sha256')
      .update(String(init?.body ?? ''))
      .digest('hex')
      .slice(0, 24);
    const hit = cache.get(key);
    if (hit) {
      stats.replayed += 1;
      return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json' } });
    }
    if (!live) throw new Error('jev recording miss in replay mode');
    const started = Date.now();
    const response = await fetch(url, init);
    const body = await response.text();
    const ms = Date.now() - started;
    stats.calls += 1;
    stats.ms += ms;
    try {
      const usage = (JSON.parse(body) as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      stats.inputTokens += usage?.input_tokens ?? 0;
      stats.outputTokens += usage?.output_tokens ?? 0;
    } catch {
      // body is not JSON; kept as is
    }
    if (response.ok) {
      cache.set(key, { status: response.status, body });
      await appendFile(file, `${JSON.stringify({ key, status: response.status, body, ms })}\n`, 'utf8');
    }
    return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchLike as typeof fetch, stats };
}

/** The three System 1 seats: Jev asked A-first, B-first (inverted), and A-first with the second wording. */
export function jevSeats(pairs: ReadonlyMap<string, PairInput>, jev: JudgeClient): JudgeClient[] {
  const seat = (id: string, swapped: boolean, wording: 'better' | 'prefer'): JudgeClient => ({
    id,
    family: 'jev',
    cls: 'system1',
    cost: 1,
    async judge(request) {
      const pair = pairs.get(itemOf(request));
      if (!pair) throw new Error('unknown pair');
      const result = await jev.judge(pairRequest(pair, swapped, wording));
      if (!swapped) return result;
      const outcome =
        result.answer.outcome === 'pass'
          ? 'fail'
          : result.answer.outcome === 'fail'
            ? 'pass'
            : 'inconclusive';
      const score = result.answer.score === undefined ? undefined : 1 - result.answer.score;
      return { ...result, answer: { ...result.answer, outcome, ...(score === undefined ? {} : { score }) } };
    },
  });
  return [
    seat('jev-ab', false, 'better'),
    seat('jev-ba', true, 'better'),
    seat('jev-ab-prefer', false, 'prefer'),
  ];
}

export function makeJev(fetchLike: typeof fetch, env: Record<string, string | undefined>): JudgeClient {
  return createJevJudge({ env, fetch: fetchLike, maxRetries: 2 } as never);
}

/** The hybrid council over three recorded System 2 seats and three Jev seats. */
export function pairCouncil(system2: JudgeClient[], system1: JudgeClient[]) {
  return createCouncil({
    mode: 'hybrid',
    judges: [...system2, ...system1],
    agentFamily: 'none',
    assignment: [
      {
        criterion: 'a_beats_b',
        cls: 'system2',
        judges: system2.map((j) => j.id),
        rejudge: system1.map((j) => j.id),
        source: 'spec',
      },
    ],
  });
}

export function sideOf(result: CouncilResult): Side {
  return result.outcome === 'pass' ? 'A' : result.outcome === 'fail' ? 'B' : 'tie';
}
