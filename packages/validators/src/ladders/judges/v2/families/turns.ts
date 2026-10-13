import {
  FakeJudge,
  type JudgeAnswer,
  type JudgeRequest,
  type TranscriptEntry,
} from '@agent-nexus/driftbench-judges';
import { loadPool } from '../../pool';
import { type BankItem, between, filler, fn, type JudgesApi, pick, type Tier } from '../bank';
import { ruleVerdict } from '../rules';

/**
 * Two capabilities for long conversations.
 *
 * `judgeTurns(judge, request)` judges a conversation turn by turn (MT-Bench-101's lowest turn decides; the drift
 * onset and recovery of AgentChangeBench). A turn starts at a customer message; consecutive customer messages
 * are one turn; entries before the first customer message belong to turn 1; context entries are not turns. Turn
 * t is judged on the prefix that ends where turn t+1 starts, one call per turn, with the request's criterion. It
 * returns `{ turns: [{ turn, outcome }], outcome, firstFailing?, recoveredAt? }`: the outcome is fail when a turn
 * fails, else inconclusive when a turn is inconclusive, else pass; `firstFailing` is the first failing turn and
 * `recoveredAt` the first later turn that passes. A judge that throws makes its turn inconclusive. A transcript
 * with no customer message is refused with a RangeError.
 *
 * `fitPrompt(request, maxChars)` fits a request to a prompt budget measured as the length of
 * `buildPrompt(request).user`. A request that fits is returned unchanged. Otherwise the fewest oldest entries are
 * dropped and replaced by one context entry, "[1 earlier entry omitted]" or "[k earlier entries omitted]"; the
 * last block (from the last customer message on), the artifact and the Given are never dropped; a tool result is
 * never kept without its call. When even that does not fit, or the budget is not a whole number above 0, a
 * RangeError.
 */

const TURNS = 'packages/judges/src/council.ts';
const BUDGET = 'packages/judges/src/prompt.ts';

type Turns = (
  judge: unknown,
  request: JudgeRequest,
) => Promise<{
  turns: { turn: number; outcome: string }[];
  outcome: string;
  firstFailing?: number;
  recoveredAt?: number;
}>;

/** A conversation of n turns: customer, then a tool call and result, then the agent. */
function conversation(n: number, random: () => number, burstAt = -1): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (let t = 1; t <= n; t += 1) {
    out.push({ role: 'user', text: `turn ${t}: ${filler(random, 4)}` });
    if (t === burstAt) out.push({ role: 'user', text: `and also ${filler(random, 3)}` });
    if (random() < 0.5) {
      out.push({ role: 'tool_call', tool: 'kb.search', text: `{"q":"t${t}"}` });
      out.push({ role: 'tool_result', tool: 'kb.search', text: `{"hits":${t}}` });
    }
    out.push({ role: 'agent', text: `reply ${t}: ${filler(random, 5)}` });
  }
  return out;
}

const count = (r: JudgeRequest) =>
  r.transcript.filter((e) => e.role === 'user' && /^turn \d+/.test(e.text)).length;

/** A judge answering per turn from a table: the table's entry for the number of turns it sees. */
function tableJudge(table: readonly ('pass' | 'fail' | 'inconclusive' | 'throw')[]) {
  const seen: number[] = [];
  const judge = new FakeJudge('turns', [
    (request: JudgeRequest): JudgeAnswer => {
      const n = count(request);
      seen.push(request.transcript.length);
      const out = table[n - 1] ?? 'pass';
      if (out === 'throw') throw new Error('down');
      return { outcome: out, reasoning: `turn ${n}` };
    },
  ]);
  return { judge, seen };
}

/** The spec's reading of a table of turn outcomes. */
function expected(table: readonly string[]) {
  const outcomes = table.map((o) => (o === 'throw' ? 'inconclusive' : o));
  const first = outcomes.indexOf('fail');
  const recovered = first < 0 ? -1 : outcomes.findIndex((o, i) => i > first && o === 'pass');
  return {
    outcome: outcomes.includes('fail') ? 'fail' : outcomes.includes('inconclusive') ? 'inconclusive' : 'pass',
    turns: outcomes.map((outcome, i) => ({ turn: i + 1, outcome })),
    ...(first < 0 ? {} : { firstFailing: first + 1 }),
    ...(recovered < 0 ? {} : { recoveredAt: recovered + 1 }),
  };
}

function check(
  family: string,
  id: string,
  tier: Tier,
  component: string,
  run: (
    api: JudgesApi,
    random: () => number,
    root: string,
  ) => Promise<string | undefined> | string | undefined,
): BankItem {
  return {
    id: `${family}/${id}`,
    family,
    tier,
    level: family,
    component,
    async run({ api, random, root }) {
      const problem = await run(api, random, root);
      return problem === undefined ? { pass: true, detail: '' } : { pass: false, detail: problem };
    },
  };
}

const CRITERION = { name: 'rule', rubric: 'Each reply answers its turn.' };

export function turnItems(): BankItem[] {
  const t = (
    id: string,
    tier: Tier,
    makeTable: (random: () => number) => ('pass' | 'fail' | 'inconclusive' | 'throw')[],
    extra?: (
      seen: number[],
      got: Awaited<ReturnType<Turns>>,
      transcript: TranscriptEntry[],
    ) => string | undefined,
    burst = false,
  ) =>
    check('turns', id, tier, TURNS, async (api, random) => {
      const table = makeTable(random);
      const burstAt = burst ? between(random, 1, table.length) : -1;
      const transcript = conversation(table.length, random, burstAt);
      const { judge, seen } = tableJudge(table);
      let got: Awaited<ReturnType<Turns>>;
      try {
        got = await fn<Turns>(api, 'judgeTurns')(judge, { criterion: CRITERION, transcript });
      } catch (cause) {
        return `threw: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
      const want = expected(table);
      const shape = {
        outcome: got.outcome,
        turns: got.turns,
        ...(got.firstFailing === undefined ? {} : { firstFailing: got.firstFailing }),
        ...(got.recoveredAt === undefined ? {} : { recoveredAt: got.recoveredAt }),
      };
      if (JSON.stringify(shape) !== JSON.stringify(want))
        return `expected ${JSON.stringify(want)}, got ${JSON.stringify(shape)}`;
      return extra?.(seen, got, transcript);
    });
  const fill = (n: number, v: 'pass' | 'fail' | 'inconclusive') =>
    new Array(n).fill(v) as ('pass' | 'fail' | 'inconclusive')[];
  const out: BankItem[] = [
    t('all-pass', 1, (r) => fill(between(r, 2, 6), 'pass')),
    t('one-fail', 2, (r) => {
      const n = between(r, 3, 7);
      const table = fill(n, 'pass');
      table[between(r, 0, n - 1)] = 'fail';
      return table;
    }),
    t('only-inconclusive', 2, (r) => {
      const n = between(r, 2, 5);
      const table = fill(n, 'pass');
      table[between(r, 0, n - 1)] = 'inconclusive';
      return table;
    }),
    t('fail-beats-inconclusive', 2, () => ['pass', 'inconclusive', 'fail', 'pass']),
    t('first-of-several-fails', 3, (r) => {
      const n = between(r, 5, 8);
      return Array.from({ length: n }, (_, i) => (i >= 2 && r() < 0.6 ? 'fail' : 'pass'));
    }),
    t('recovered-at', 3, (r) => {
      const n = between(r, 4, 8);
      const f = between(r, 0, n - 3);
      return Array.from({ length: n }, (_, i) => (i === f || i === f + 1 ? 'fail' : 'pass'));
    }),
    t('no-recovery', 3, (r) => {
      const n = between(r, 3, 6);
      return Array.from({ length: n }, (_, i) => (i === 0 ? 'pass' : 'fail'));
    }),
    t('recovery-after-inconclusive', 4, () => ['pass', 'fail', 'inconclusive', 'pass']),
    t('judge-throws-on-a-turn', 3, () => ['pass', 'throw', 'pass']),
    t(
      'cumulative-prefixes',
      3,
      (r) => fill(between(r, 3, 6), 'pass'),
      (seen, _got, transcript) => {
        const starts = transcript
          .map((e, i) => (e.role === 'user' && /^turn/.test(e.text) ? i : -1))
          .filter((i) => i >= 0);
        const want = starts.map((_, i) => starts[i + 1] ?? transcript.length);
        return JSON.stringify(seen) === JSON.stringify(want)
          ? undefined
          : `prefix lengths ${seen}, expected ${want}`;
      },
    ),
    t(
      'one-call-per-turn',
      2,
      (r) => fill(between(r, 2, 7), 'pass'),
      (seen, got) =>
        seen.length === got.turns.length ? undefined : `${seen.length} calls for ${got.turns.length} turns`,
    ),
    t('burst-is-one-turn', 4, (r) => fill(between(r, 2, 5), 'pass'), undefined, true),
    check('turns', 'context-is-not-a-turn', 3, TURNS, async (api, random) => {
      const transcript = [
        { role: 'context' as const, text: 'Pending question.' },
        ...conversation(3, random),
      ];
      const { judge } = tableJudge(['pass', 'pass', 'pass']);
      const got = await fn<Turns>(api, 'judgeTurns')(judge, { criterion: CRITERION, transcript });
      return got.turns.length === 3 ? undefined : `${got.turns.length} turns`;
    }),
    check('turns', 'no-customer-refused', 2, TURNS, async (api) => {
      try {
        await fn<Turns>(api, 'judgeTurns')(tableJudge(['pass']).judge, {
          criterion: CRITERION,
          transcript: [{ role: 'agent', text: 'hello' }],
        });
        return 'a transcript with no customer message was judged';
      } catch (cause) {
        return cause instanceof RangeError ? undefined : `threw ${String(cause)}`;
      }
    }),
    check('turns', 'criterion-carried', 2, TURNS, async (api, random) => {
      const names: string[] = [];
      const judge = new FakeJudge('turns', [
        (q: JudgeRequest): JudgeAnswer => {
          names.push(q.criterion.rubric);
          return { outcome: 'pass', reasoning: 'x' };
        },
      ]);
      await fn<Turns>(api, 'judgeTurns')(judge, {
        criterion: CRITERION,
        transcript: conversation(3, random),
      });
      return names.every((n) => n === CRITERION.rubric) && names.length === 3
        ? undefined
        : JSON.stringify(names);
    }),
    check('turns', 'leading-tools-in-turn-one', 3, TURNS, async (api, random) => {
      const transcript = [
        { role: 'tool_call' as const, tool: 'crm', text: '{}' },
        { role: 'tool_result' as const, tool: 'crm', text: '{}' },
        ...conversation(2, random),
      ];
      const { judge, seen } = tableJudge(['pass', 'pass']);
      const got = await fn<Turns>(api, 'judgeTurns')(judge, { criterion: CRITERION, transcript });
      return got.turns.length === 2 && seen[1] === transcript.length
        ? undefined
        : `turns ${got.turns.length}, prefixes ${seen}`;
    }),
  ];
  for (const criterion of [
    'explicit_confirmation',
    'no_invented_data',
    'coverage_before_offer',
    'care_redirect',
  ] as const) {
    out.push(
      check('turns', `drift-onset-${criterion}`, 4, TURNS, async (api, random, root) => {
        const pool = await loadPool(root);
        const conversations = pool.items.filter((i) => i.criterion === criterion && i.label === 'fail');
        const item = pick(random, conversations);
        const request = item.request;
        const judge = new FakeJudge('rules', [
          (q: JudgeRequest): JudgeAnswer => ({
            outcome: ruleVerdict(criterion, q.transcript),
            reasoning: 'rule',
          }),
        ]);
        const got = await fn<Turns>(api, 'judgeTurns')(judge, request);
        const starts: number[] = [];
        request.transcript.forEach((e, i) => {
          if (e.role === 'user' && (i === 0 || request.transcript[i - 1]?.role !== 'user')) starts.push(i);
        });
        const table = starts.map((_, i) =>
          ruleVerdict(criterion, request.transcript.slice(0, starts[i + 1] ?? request.transcript.length)),
        );
        const want = expected(table);
        return got.outcome === want.outcome && got.firstFailing === want.firstFailing
          ? undefined
          : `${item.id}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
      }),
    );
  }
  return out;
}

type Fit = (request: JudgeRequest, maxChars: number) => JudgeRequest;
type Build = (request: JudgeRequest) => { user: string };

/** The spec's fit, written out with the package's own prompt: the oracle of every budget item. */
export function referenceFit(build: Build, request: JudgeRequest, max: number): JudgeRequest | 'refused' {
  if (!Number.isInteger(max) || max <= 0) return 'refused';
  if (build(request).user.length <= max) return request;
  let lastUser = -1;
  request.transcript.forEach((e, i) => {
    if (e.role === 'user') lastUser = i;
  });
  const candidate = (k: number): JudgeRequest => {
    let start = k;
    while (request.transcript[start]?.role === 'tool_result' && start < lastUser) start += 1;
    const marker = `[${start} earlier ${start === 1 ? 'entry' : 'entries'} omitted]`;
    return {
      ...request,
      transcript: [{ role: 'context' as const, text: marker }, ...request.transcript.slice(start)],
    };
  };
  const fits = (k: number) => build(candidate(k)).user.length <= max;
  if (lastUser < 1 || !fits(lastUser)) return 'refused';
  // Dropping more never lengthens the prompt, so the fewest drops that fit are found by bisection.
  let low = 1;
  let high = lastUser;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }
  return candidate(low);
}

export function budgetItems(): BankItem[] {
  const b = (
    id: string,
    tier: Tier,
    make: (random: () => number, build: Build) => { request: JudgeRequest; max: number },
    extra?: (
      got: JudgeRequest | 'refused',
      request: JudgeRequest,
      max: number,
      build: Build,
    ) => string | undefined,
  ) =>
    check('budget', id, tier, BUDGET, (api, random) => {
      const build = fn<Build>(api, 'buildPrompt');
      const { request, max } = make(random, build);
      const want = referenceFit(build, request, max);
      let got: JudgeRequest | 'refused';
      try {
        got = fn<Fit>(api, 'fitPrompt')(request, max);
      } catch (cause) {
        if (!(cause instanceof RangeError)) throw cause;
        got = 'refused';
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        const show = (v: JudgeRequest | 'refused') =>
          v === 'refused'
            ? 'refused'
            : `${v.transcript.length} entries, first ${JSON.stringify(v.transcript[0]?.text.slice(0, 40))}`;
        return `budget ${max}: expected ${show(want)}, got ${show(got)}`;
      }
      return extra?.(got, request, max, build);
    });
  const req = (n: number, r: () => number, extra: Partial<JudgeRequest> = {}): JudgeRequest => ({
    criterion: CRITERION,
    transcript: conversation(n, r),
    ...extra,
  });
  const size = (build: Build, q: JudgeRequest) => build(q).user.length;
  const lastBlock = (q: JudgeRequest) => {
    let at = 0;
    q.transcript.forEach((e, i) => {
      if (e.role === 'user') at = i;
    });
    return { ...q, transcript: q.transcript.slice(at) };
  };
  return [
    b('fits-unchanged', 1, (r, build) => {
      const q = req(4, r);
      return { request: q, max: size(build, q) + between(r, 0, 50) };
    }),
    b('exactly-at-budget', 2, (r, build) => {
      const q = req(5, r);
      return { request: q, max: size(build, q) };
    }),
    b('drops-fewest-oldest', 3, (r, build) => {
      const q = req(8, r);
      return { request: q, max: size(build, q) - between(r, 20, 400) };
    }),
    b('singular-marker', 3, (r, build) => {
      const q = {
        criterion: CRITERION,
        transcript: [{ role: 'agent' as const, text: filler(r, 30) }, ...conversation(3, r)],
      };
      return { request: q, max: size(build, q) - 5 };
    }),
    b('keeps-last-block-whole', 3, (r, build) => {
      const q = req(6, r);
      return { request: q, max: size(build, lastBlock(q)) + 40 };
    }),
    b('refuses-when-last-block-too-big', 2, (r, build) => {
      const q = req(4, r);
      return { request: q, max: size(build, lastBlock(q)) - 10 };
    }),
    b('conversation-scope', 3, (r, build) => {
      const q = req(7, r, { criterion: { ...CRITERION, scope: 'conversation' } });
      return { request: q, max: size(build, q) - 200 };
    }),
    b('artifact-kept', 3, (r, build) => {
      const q = req(6, r, { artifact: `File a.txt (text)\n${filler(r, 40)}` });
      return { request: q, max: size(build, q) - 150 };
    }),
    b('given-kept', 3, (r, build) => {
      const q = req(6, r, { given: { stage: 'offer', ledger: { a: filler(r, 10) } } });
      return { request: q, max: size(build, q) - 150 };
    }),
    b('context-entries-dropped-like-others', 3, (r, build) => {
      const q = {
        criterion: CRITERION,
        transcript: [{ role: 'context' as const, text: filler(r, 20) }, ...conversation(5, r)],
      };
      return { request: q, max: size(build, q) - 60 };
    }),
    b('tool-result-not-orphaned', 4, (r, build) => {
      const q = {
        criterion: CRITERION,
        transcript: [
          { role: 'user' as const, text: 'hello' },
          { role: 'tool_call' as const, tool: 't', text: '{}' },
          { role: 'tool_result' as const, tool: 't', text: filler(r, 30) },
          { role: 'agent' as const, text: 'ok' },
          ...conversation(2, r),
        ],
      };
      return { request: q, max: size(build, q) - 12 };
    }),
    b('budget-zero-refused', 1, (r) => ({ request: req(2, r), max: 0 })),
    b('budget-fraction-refused', 2, (r) => ({ request: req(2, r), max: 1000.5 })),
    b('single-turn-too-big-refused', 2, (r, build) => {
      const q = req(1, r);
      return { request: q, max: size(build, q) - 1 };
    }),
    b('multibyte-text', 3, (r, build) => {
      const q = {
        criterion: CRITERION,
        transcript: [
          { role: 'user' as const, text: '你好 '.repeat(40) },
          { role: 'agent' as const, text: '\u{1F642} '.repeat(30) },
          ...conversation(3, r),
        ],
      };
      return { request: q, max: size(build, q) - 30 };
    }),
    b(
      'idempotent',
      3,
      (r, build) => {
        const q = req(8, r);
        return { request: q, max: size(build, q) - 300 };
      },
      (got, _q, max, build) => {
        if (got === 'refused') return undefined;
        return JSON.stringify(referenceFit(build, got, max)) === JSON.stringify(got)
          ? undefined
          : 'a second fit changes the result';
      },
    ),
    b(
      'result-fits',
      2,
      (r, build) => {
        const q = req(10, r);
        return { request: q, max: size(build, q) - between(r, 100, 900) };
      },
      (got, _q, max, build) =>
        got === 'refused' || build(got).user.length <= max ? undefined : 'the result is over the budget',
    ),
    b('order-kept', 2, (r, build) => {
      const q = req(9, r);
      return { request: q, max: size(build, q) - 500 };
    }),
    b('many-entries', 4, (r, build) => {
      const q = req(3000, r);
      return { request: q, max: Math.floor(size(build, q) / 3) };
    }),
    b('drops-to-the-last-block', 4, (r, build) => {
      const q = req(12, r);
      return { request: q, max: size(build, lastBlock(q)) + 30 };
    }),
  ];
}
