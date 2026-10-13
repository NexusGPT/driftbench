/**
 * Runs the council experiment on dev items with the benchmark harness of the codex-mm worktree, read only:
 * its contestants' prompts and its scorer, unchanged. Non-Anthropic models answer through llm-shim.mjs.
 *
 *   run    --bench judgebench|mmeval --model <id> --contestants a,b,c   paid run, both orders, recorded here
 *   items  --bench ... --model ... --contestant c                       per-item net verdicts, replay only
 *   jev    --bench ...                                                  system 1 votes, both orders
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks/src';
const { runBenchmark } = await import(`${HARNESS}/run.ts`);
const { contestantById } = await import(`${HARNESS}/contestants.ts`);
const { loadBenchmark, CRITERIA } = await import(`${HARNESS}/data.ts`);

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const RECORDINGS = join(HERE, 'recordings');
const SHIM = join(HERE, 'llm-shim.mjs');
const TWIN = process.argv.includes('--twin') ? '-twin' : '';
const GEMINI = arg('gemini') ?? 'gemini-3.8-flash';
const STOP_AT = Date.parse('2026-10-13T06:30:00+02:00');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Pair = {
  kind: 'pair';
  id: string;
  question: string;
  a: string;
  b: string;
  label: 'A' | 'B';
  group: string;
};

const SCRATCH =
  '/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/opus';

export function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^(\s*)[-*+]\s+/, '$1')
        .replace(/\*\*|__/g, '')
        .replace(/`/g, ''),
    )
    .join('\n');
}

/** RubricBench dev rows, read from the scratchpad at run time and never committed (the dataset names no licence). */
async function rubricItems(): Promise<Pair[]> {
  const rows = JSON.parse(await readFile(join(SCRATCH, 'rb-dev.json'), 'utf8')) as Record<string, unknown>[];
  return rows.map((r) => ({
    kind: 'pair',
    id: String(r.case_id),
    question: String(r.instruction),
    a: String(r.response_a),
    b: String(r.response_b),
    label: Number(r.label) === 0 ? 'A' : 'B',
    group: String(r.domain),
    criterion: `${CRITERIA.rubricbench}\n${String(r.rubrics)}`,
  })) as Pair[];
}

/** RubricBench fixtures, fixed before any tie is scored: six clear dev pairs (binary margin 3 or more, base right). */
export async function rubricFixtures(): Promise<Pair[]> {
  const margins = JSON.parse(await readFile(join(SCRATCH, 'rb-margins.json'), 'utf8')) as [
    string,
    number,
    number,
    boolean,
    string,
  ][];
  const clear = new Set(margins.filter((m) => Math.abs(m[1]) >= 3 && m[3]).map((m) => m[0]));
  const items = (await rubricItems()).filter((i) => clear.has(i.id));
  const key = (id: string) => createHash('sha256').update(`fixture:rubricbench:${id}`).digest('hex');
  return items.sort((x, y) => key(x.id).localeCompare(key(y.id))).slice(0, 6);
}

export async function devItems(bench: string): Promise<Pair[]> {
  if (bench === 'rubricbench') {
    const ties = new Set(JSON.parse(await readFile(join(SCRATCH, 'rb-m0.json'), 'utf8')) as string[]);
    const tied = (await rubricItems()).filter((i) => ties.has(i.id));
    if (!process.argv.includes('--twin')) return tied;
    // The markdown-stripped twin: same words, no headings, emphasis, bullets or code fences.
    return tied.map((i) => ({ ...i, id: `${i.id}#plain`, a: stripMarkdown(i.a), b: stripMarkdown(i.b) }));
  }
  if (bench === 'rbfixtures') return rubricFixtures();
  const all = (await loadBenchmark(bench)).items as Pair[];
  const byId = new Map(all.map((item) => [item.id, item]));
  let ids: string[];
  if (bench === 'judgebench') {
    ids = JSON.parse(await readFile(join(HERE, 'inputs', 'jb-dev-haiku-reference3.json'), 'utf8')).map(
      (row: { id: string }) => row.id,
    );
  } else {
    ids = JSON.parse(await readFile(join(HERE, 'inputs', 'mm-dev400-ids.json'), 'utf8'));
  }
  const items = ids.map((id) => byId.get(id)).filter((item): item is Pair => item !== undefined);
  if (items.length !== ids.length)
    throw new Error(`${bench}: ${ids.length - items.length} dev ids not found`);
  const limit = Number(arg('limit') ?? 0);
  return limit > 0 ? items.slice(0, limit) : items;
}

async function ledger(line: string) {
  const file = process.env.SPEND_LEDGER;
  if (file) await appendFile(file, `${line}\n`, 'utf8');
}

const mode = process.argv[2];
const bench = arg('bench') ?? 'judgebench';
await mkdir(RESULTS, { recursive: true });

if (mode === 'run') {
  const model = arg('model')!;
  const items = await devItems(bench);
  const contestants = arg('contestants')!
    .split(',')
    .map((id) => contestantById(id));
  const started = Date.now();
  const report = await runBenchmark({
    bench,
    model,
    contestants,
    items,
    criterion: CRITERIA[bench],
    command: SHIM,
    recordingsDir: arg('recordings-dir') ?? RECORDINGS,
    ...(process.argv.includes('--replay-only') ? { replayOnly: 'lenient' as const } : {}),
    concurrency: Number(arg('concurrency') ?? 3),
    capUsd: Number(arg('cap-usd') ?? 2),
    deadlineMs: STOP_AT,
  });
  const out = join(
    RESULTS,
    `${bench}${TWIN}-${model}${process.argv.includes('--replay-only') ? '-replay' : ''}-${contestants.map((c: { id: string }) => c.id).join('+')}.json`,
  );
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  const provider = model.startsWith('gpt-') ? 'OpenAI' : model.startsWith('gemini-') ? 'Google' : 'Anthropic';
  if (report.newCalls > 0)
    await ledger(
      `| ${new Date().toISOString()} | opus-council | ${provider} | ${model} | ${bench} dev ${items.length} pairs, ${arg('contestants')} | ${report.newCalls} calls | ${report.newSpendUsd.toFixed(4)} USD |`,
    );
  console.log(
    JSON.stringify({
      out,
      minutes: ((Date.now() - started) / 60000).toFixed(1),
      newSpendUsd: report.newSpendUsd,
      newCalls: report.newCalls,
      failedCalls: report.failedCalls,
      stopped: report.stopped,
      scores: report.contestants.map(
        (c: { contestant: string; summary: { value: { estimate: number }; missing: number } }) => ({
          contestant: c.contestant,
          estimate: c.summary.value.estimate,
          missing: c.summary.missing,
        }),
      ),
    }),
  );
} else if (mode === 'items') {
  const model = arg('model')!;
  const contestant = contestantById(arg('contestant')!);
  const items = await devItems(bench);
  const rows: { id: string; group: string; label: string; score: number | null; vote: string }[] = [];
  for (const item of items) {
    const report = await runBenchmark({
      bench,
      model,
      contestants: [contestant],
      items: [item],
      criterion: CRITERIA[bench],
      command: SHIM,
      recordingsDir: arg('recordings-dir') ?? RECORDINGS,
      replayOnly: 'lenient',
      concurrency: 1,
    });
    const summary = report.contestants[0].summary;
    const score = summary.missing > 0 ? null : summary.value.estimate;
    const other = item.label === 'A' ? 'B' : 'A';
    const vote = score === null ? 'missing' : score > 0.5 ? item.label : score < 0.5 ? other : 'tie';
    rows.push({ id: item.id, group: item.group, label: item.label, score, vote });
  }
  const out = join(RESULTS, `items-${bench}${TWIN}-${model}-${contestant.id}.json`);
  await writeFile(out, `${JSON.stringify(rows)}\n`);
  console.log(
    JSON.stringify({ out, n: rows.length, missing: rows.filter((r) => r.vote === 'missing').length }),
  );
}

// ---- System 1 (Jev) and the council ----
const { scorePairs } = await import(`${HARNESS}/score.ts`);
const pairs = await import('./council-pairs.ts');
type Side = 'A' | 'B' | 'tie' | 'missing';

function netSide(games: readonly string[]): Side {
  const a = games.filter((g) => g === 'A').length;
  const b = games.filter((g) => g === 'B').length;
  return games.length === 0 ? 'missing' : a > b ? 'A' : b > a ? 'B' : 'tie';
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]!();
      }
    }),
  );
  return out;
}

function score(items: Pair[], sides: ReadonlyMap<string, Side>) {
  const results = items.map((item) => {
    const side = sides.get(item.id) ?? 'missing';
    return side === 'missing'
      ? { item, games: [], missing: 2, providerRefused: true }
      : { item, games: [side, side], missing: 0 };
  });
  return scorePairs(bench, results);
}

async function haikuSides(): Promise<Map<string, Side>> {
  const file = bench === 'judgebench' ? 'jb-dev-haiku-reference3.json' : 'mm-dev400-haiku-native.json';
  const rows = JSON.parse(await readFile(join(HERE, 'inputs', file), 'utf8')) as {
    id: string;
    games: string[];
  }[];
  return new Map(rows.map((r) => [r.id, netSide(r.games)]));
}

async function chatSides(model: string, contestant: string): Promise<Map<string, Side>> {
  const rows = JSON.parse(
    await readFile(join(RESULTS, `items-${bench}${TWIN}-${model}-${contestant}.json`), 'utf8'),
  ) as { id: string; vote: Side }[];
  return new Map(rows.map((r) => [r.id, r.vote]));
}

if (mode === 'jev' || mode === 'council') {
  const items = await devItems(bench);
  const live = mode === 'jev' && Date.now() < STOP_AT;
  const recorder = pairs.recordingFetch(join(RECORDINGS, `jev-${bench}.jsonl`), live);
  const env = {
    JEV_URL: 'https://api.typesafe.ai/v1/systemone',
    JEV_API_KEY: process.env.JEV_API_KEY ?? 'replay',
  };
  const jev = pairs.makeJev(recorder.fetch, env);
  const inputs = new Map(
    items.map((item) => [item.id, { ...item, criterion: item.criterion ?? (CRITERIA[bench] as string) }]),
  );
  const seats = pairs.jevSeats(inputs, jev);
  const ask = (seat: (typeof seats)[number], id: string) =>
    seat
      .judge({ ...pairs.pairRequest(inputs.get(id)!), given: { ledger: { item: id } } })
      .then((r) => r.answer.outcome)
      .catch(() => 'inconclusive' as const);
  if (mode === 'jev') {
    const started = Date.now();
    const tasks = items.flatMap((item) => seats.map((seat) => () => ask(seat, item.id)));
    const outcomes = await pool(tasks, 3);
    const sides = new Map<string, Side>();
    const perSeat = seats.map(() => new Map<string, Side>());
    items.forEach((item, i) => {
      const votes = outcomes.slice(i * 3, i * 3 + 3);
      votes.forEach((v, k) => {
        perSeat[k]!.set(item.id, v === 'pass' ? 'A' : v === 'fail' ? 'B' : 'tie');
      });
      const pass = votes.filter((v) => v === 'pass').length;
      const fail = votes.filter((v) => v === 'fail').length;
      sides.set(item.id, pass >= 2 ? 'A' : fail >= 2 ? 'B' : 'tie');
    });
    const report = {
      bench,
      items: items.length,
      jevMajority: score(items, sides),
      perSeat: seats.map((seat, k) => ({ seat: seat.id, summary: score(items, perSeat[k]!) })),
      stats: recorder.stats,
      minutes: (Date.now() - started) / 60000,
      sides: Object.fromEntries(sides),
      seatSides: seats.map((seat, k) => ({ seat: seat.id, sides: Object.fromEntries(perSeat[k]!) })),
    };
    await writeFile(join(RESULTS, `jev-${bench}${TWIN}.json`), `${JSON.stringify(report, null, 2)}\n`);
    await ledger(
      `| ${new Date().toISOString()} | opus-council | Jev (TypeSafe direct) | jev-latest | ${bench} dev ${items.length} pairs, 3 framings | ${recorder.stats.calls} calls | tokens in ${recorder.stats.inputTokens} out ${recorder.stats.outputTokens}, price not published |`,
    );
    console.log(
      JSON.stringify({
        bench,
        jev: report.jevMajority.value,
        perSeat: report.perSeat.map((s) => [s.seat, s.summary.value.estimate]),
        stats: recorder.stats,
      }),
    );
  } else {
    const haiku = await haikuSides();
    const gpt = await chatSides('gpt-5.4-mini', 'driftbench');
    const gemini = await chatSides(GEMINI, 'driftbench');
    const system2 = [
      pairs.recordedSeat('haiku-frozen', 'anthropic', haiku),
      pairs.recordedSeat('gpt-5.4-mini', 'openai', gpt),
      pairs.recordedSeat(GEMINI, 'google', gemini),
    ];
    const council = pairs.pairCouncil(system2, seats);
    const sides = new Map<string, Side>();
    let splits = 0;
    let decidedBySystem1 = 0;
    for (const item of items) {
      const result = await council.judge({
        ...pairs.pairRequest(inputs.get(item.id)!),
        given: { ledger: { item: item.id } },
      });
      if (result.split) splits += 1;
      if (result.split && result.cls === 'system1' && result.outcome !== 'inconclusive')
        decidedBySystem1 += 1;
      sides.set(item.id, pairs.sideOf(result));
    }
    // System 2 majority alone: a split is a tie, no System 1.
    const s2only = new Map<string, Side>();
    for (const item of items) {
      const votes = [haiku, gpt, gemini].map((m) => m.get(item.id) ?? 'missing');
      const a = votes.filter((v) => v === 'A').length;
      const b = votes.filter((v) => v === 'B').length;
      s2only.set(item.id, a >= 2 ? 'A' : b >= 2 ? 'B' : 'tie');
    }
    // Cascade on the strongest seat: keep Haiku when its two orders agree; otherwise ask the other two chat
    // seats and Jev's three-framing majority, and keep Haiku's own net answer when they split too.
    const haikuGames = new Map(
      (
        JSON.parse(
          await readFile(
            join(
              HERE,
              'inputs',
              bench === 'judgebench' ? 'jb-dev-haiku-reference3.json' : 'mm-dev400-haiku-native.json',
            ),
            'utf8',
          ),
        ) as { id: string; games: string[] }[]
      ).map((r) => [r.id, r.games]),
    );
    const jevSides = new Map(
      Object.entries(
        (
          JSON.parse(await readFile(join(RESULTS, `jev-${bench}.json`), 'utf8')) as {
            sides: Record<string, Side>;
          }
        ).sides,
      ),
    );
    const cascade = new Map<string, Side>();
    let escalated = 0;
    for (const item of items) {
      const games = haikuGames.get(item.id) ?? [];
      const sure = games.length === 2 && games[0] === games[1] && games[0] !== 'tie';
      if (sure) {
        cascade.set(item.id, games[0] as Side);
        continue;
      }
      escalated += 1;
      const votes = [gpt.get(item.id), gemini.get(item.id), jevSides.get(item.id)];
      const a = votes.filter((v) => v === 'A').length;
      const b = votes.filter((v) => v === 'B').length;
      cascade.set(item.id, a >= 2 ? 'A' : b >= 2 ? 'B' : (haiku.get(item.id) ?? 'missing'));
    }
    const report = {
      bench,
      items: items.length,
      council: score(items, sides),
      haikuFirstCascade: { summary: score(items, cascade), escalated },
      cascadeSides: Object.fromEntries(cascade),
      system2MajorityOnly: score(items, s2only),
      haikuFrozen: score(items, haiku),
      gpt: score(items, gpt),
      gemini: score(items, gemini),
      splits,
      decidedBySystem1,
      jevStats: recorder.stats,
      sides: Object.fromEntries(sides),
    };
    await writeFile(join(RESULTS, `council-${bench}-${GEMINI}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        bench,
        council: report.council.value.estimate,
        cascade: report.haikuFirstCascade.summary.value.estimate,
        escalated,
        s2only: report.system2MajorityOnly.value.estimate,
        haiku: report.haikuFrozen.value.estimate,
        gpt: report.gpt.value.estimate,
        gemini: report.gemini.value.estimate,
        splits,
        decidedBySystem1,
      }),
    );
  }
}

// ---- Judges earn their categories: assign on dev half 1, score on dev half 2 ----
if (mode === 'route') {
  const items = await devItems(bench);
  const half = (id: string) => (createHashSync(`half:${bench}:${id}`) < 128 ? 1 : 2);
  const first = items.filter((i) => half(i.id) === 1);
  const second = items.filter((i) => half(i.id) === 2);
  const read = async (f: string) => JSON.parse(await readFile(join(RESULTS, f), 'utf8'));
  const jevReport = await read(`jev-${bench}.json`);
  const councilReport = await read(`council-${bench}-${GEMINI}.json`);
  const runReport = async (model: string) => {
    const report = await read(`${bench}-${model}-driftbench+deepeval+promptfoo.json`).catch(() =>
      read(`${bench}-${model}-driftbench.json`),
    );
    return report.contestants.find((c: { contestant: string }) => c.contestant === 'driftbench');
  };
  const per100 = async (model: string) => {
    const c = await runReport(model);
    return (c.costUsd * 100) / items.length;
  };
  const haikuPer100 = bench === 'judgebench' ? 0.7719890495867774 : 0.27735696750000005;
  const gptPer100 = await per100('gpt-5.4-mini');
  const geminiPer100 = await per100(GEMINI);
  const judges: { name: string; sides: Map<string, Side>; per100: number }[] = [
    { name: 'jev', sides: new Map(Object.entries(jevReport.sides)) as Map<string, Side>, per100: 0 },
    { name: GEMINI, sides: await chatSides(GEMINI, 'driftbench'), per100: geminiPer100 },
    { name: 'gpt-5.4-mini', sides: await chatSides('gpt-5.4-mini', 'driftbench'), per100: gptPer100 },
    { name: 'haiku-frozen', sides: await haikuSides(), per100: haikuPer100 },
    {
      name: 'haiku-first-cascade',
      sides: new Map(Object.entries(councilReport.cascadeSides)) as Map<string, Side>,
      per100:
        haikuPer100 + (councilReport.haikuFirstCascade.escalated / items.length) * (gptPer100 + geminiPer100),
    },
    {
      name: 'council',
      sides: new Map(Object.entries(councilReport.sides)) as Map<string, Side>,
      per100: haikuPer100 + gptPer100 + geminiPer100,
    },
  ];
  // JudgeBench's paper categories: knowledge (MMLU-Pro), reasoning, math (LiveBench), coding (LiveCodeBench).
  const category = new Map<string, string>();
  if (bench === 'judgebench') {
    const raw = await readFile(join(process.env.DRIFTBENCH_BENCH_CACHE ?? '', '10153fe639a1e701'), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { pair_id: string; source: string };
      const c = row.source.startsWith('mmlu-pro')
        ? 'knowledge'
        : row.source === 'livebench-reasoning'
          ? 'reasoning'
          : row.source === 'livebench-math'
            ? 'math'
            : 'coding';
      category.set(row.pair_id, c);
    }
    for (const item of items) item.group = category.get(item.id) ?? item.group;
  }
  const groups = [...new Set(items.map((i) => i.group))].sort();
  const assignment: Record<
    string,
    { judge: string; firstHalf: Record<string, { n: number; value: number; lower: number; upper: number }> }
  > = {};
  for (const group of groups) {
    const inGroup = first.filter((i) => i.group === group);
    const measured = judges.map((j) => {
      const s = score(inGroup, j.sides);
      return { name: j.name, n: s.n, value: s.value.estimate, lower: s.value.lower, upper: s.value.upper };
    });
    // Highest first-half accuracy; an exact tie goes to the cheaper judge (the list is cheapest first).
    const best = measured.reduce((a, b) => (b.value > a.value ? b : a));
    assignment[group] = { judge: best.name, firstHalf: Object.fromEntries(measured.map((m) => [m.name, m])) };
  }
  const routed = new Map<string, Side>();
  let routedCost = 0;
  for (const item of second) {
    const judge = judges.find((j) => j.name === assignment[item.group]!.judge)!;
    routed.set(item.id, judge.sides.get(item.id) ?? 'missing');
    routedCost += judge.per100 / 100;
  }
  const secondHalf = {
    routed: { summary: score(second, routed), per100: (routedCost * 100) / second.length },
    ...Object.fromEntries(judges.map((j) => [j.name, { summary: score(second, j.sides), per100: j.per100 }])),
  };
  const report = {
    bench,
    firstHalf: first.length,
    secondHalf: second.length,
    assignment,
    secondHalfScores: secondHalf,
  };
  await writeFile(join(RESULTS, `route-${bench}-${GEMINI}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      bench,
      n: [first.length, second.length],
      assignment: Object.fromEntries(groups.map((g) => [g, assignment[g]!.judge])),
      second: Object.fromEntries(
        Object.entries(secondHalf).map(([k, v]) => [
          k,
          [Number(v.summary.value.estimate.toFixed(4)), Number(v.per100.toFixed(4))],
        ]),
      ),
    }),
  );
}

function createHashSync(text: string): number {
  return createHash('sha256').update(text).digest()[0]!;
}

// ---- JudgeBench design JB-1: reference3 base, the council only on escalated and contested pairs ----
// No OpenAI seat: the judged responses come from GPT-4o, and a judge never shares the agent's family.
if (mode === 'jbcouncil') {
  const items = await devItems('judgebench');
  const recorder = pairs.recordingFetch(join(RECORDINGS, 'jev-judgebench.jsonl'), false);
  const jev = pairs.makeJev(recorder.fetch, {
    JEV_URL: 'https://api.typesafe.ai/v1/systemone',
    JEV_API_KEY: 'replay',
  });
  const inputs = new Map(
    items.map((item) => [item.id, { ...item, criterion: CRITERIA.judgebench as string }]),
  );
  const finalLetters = (text: string): string | undefined => {
    const all = [...text.matchAll(/\b([A-J])\1{4}\b/g)];
    return all.length ? all[all.length - 1]![1] : undefined;
  };
  const haikuGames = new Map(
    (
      JSON.parse(await readFile(join(HERE, 'inputs', 'jb-dev-haiku-reference3.json'), 'utf8')) as {
        id: string;
        games: string[];
      }[]
    ).map((r) => [r.id, r.games]),
  );
  const ref3 = await haikuSides();
  const adaptive = await chatSides('haiku', 'driftbench-adaptive');
  const gemini = await chatSides(GEMINI, 'driftbench');
  const system2 = [
    pairs.recordedSeat('haiku-reference3', 'anthropic', ref3),
    pairs.recordedSeat('haiku-adaptive', 'anthropic', adaptive),
    pairs.recordedSeat(GEMINI, 'google', gemini),
  ];
  const council = pairs.pairCouncil(system2, pairs.jevSeats(inputs, jev));
  const inconsistent = new Set(
    items
      .filter((i) => {
        const g = haikuGames.get(i.id) ?? [];
        return !(g.length === 2 && g[0] === g[1] && g[0] !== 'tie');
      })
      .map((i) => i.id),
  );
  const contested = new Set(
    items
      .filter((i) => /\(([A-J])\)/.test(i.question))
      .filter((i) => {
        const a = finalLetters(i.a);
        const b = finalLetters(i.b);
        return a !== undefined && b !== undefined && a !== b;
      })
      .map((i) => i.id),
  );
  const variants: Record<string, Set<string>> = {
    inconsistentOnly: inconsistent,
    contestedOnly: contested,
    inconsistentOrContested: new Set([...inconsistent, ...contested]),
  };
  const out: Record<string, unknown> = { inconsistent: inconsistent.size, contested: contested.size };
  for (const [name, routed] of Object.entries(variants)) {
    const sides = new Map<string, Side>();
    const changes: { id: string; from: Side; to: Side; label: string }[] = [];
    let s1 = 0;
    for (const item of items) {
      const base = ref3.get(item.id) ?? 'missing';
      if (!routed.has(item.id)) {
        sides.set(item.id, base);
        continue;
      }
      const result = await council.judge({
        ...pairs.pairRequest(inputs.get(item.id)!),
        given: { ledger: { item: item.id } },
      });
      if (result.split && result.cls === 'system1') s1 += 1;
      // Inconclusive after both classes: reference3 stands (JudgeBench scores a tie as wrong).
      const side = result.outcome === 'inconclusive' ? base : pairs.sideOf(result);
      sides.set(item.id, side);
      if (side !== base) changes.push({ id: item.id, from: base, to: side, label: item.label });
    }
    const summary = score(items, sides);
    out[name] = {
      routed: routed.size,
      correct: Math.round(summary.value.estimate * items.length),
      summary: summary.value,
      decidedOrTriedBySystem1: s1,
      fixes: changes.filter((c) => c.to === c.label).length,
      breaks: changes.filter((c) => c.from === c.label).length,
      changes,
    };
  }
  await writeFile(join(RESULTS, `jbcouncil-${GEMINI}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(out).map(([k, v]) => [
          k,
          typeof v === 'object' && v ? { ...(v as object), changes: undefined, summary: undefined } : v,
        ]),
      ),
    ),
  );
}

// ---- Earn the criterion: each judge separates six clear RubricBench fixtures, 3 runs of 3 ----
if (mode === 'fixtures') {
  const { spawn } = await import('node:child_process');
  const fixtures = await rubricFixtures();
  const contestant = contestantById('driftbench');
  const callShim = (model: string, prompt: { system: string; user: string }) =>
    new Promise<{ text: string; cost: number }>((resolve) => {
      const child = spawn(SHIM, ['-p', '--model', model, '--system-prompt', prompt.system], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.once('close', () => {
        try {
          const j = JSON.parse(out) as { result: string; total_cost_usd: number };
          resolve({ text: j.result, cost: j.total_cost_usd });
        } catch {
          resolve({ text: '', cost: 0 });
        }
      });
      child.stdin.end(prompt.user);
    });
  const report: Record<string, unknown> = {
    fixtures: fixtures.map((f) => ({ id: f.id, label: f.label, group: f.group })),
  };
  let spent = 0;
  for (const model of ['gpt-5.4-mini', GEMINI]) {
    const rows: { id: string; runs: Side[] }[] = [];
    for (const fx of fixtures) {
      const runs = await Promise.all(
        [0, 1, 2].map(async () => {
          const ab = await callShim(
            model,
            contestant.pair({ question: fx.question, a: fx.a, b: fx.b, criterion: fx.criterion! }),
          );
          const ba = await callShim(
            model,
            contestant.pair({ question: fx.question, a: fx.b, b: fx.a, criterion: fx.criterion! }),
          );
          spent += ab.cost + ba.cost;
          const first = contestant.parsePair(ab.text) as string;
          const swapped = contestant.parsePair(ba.text) as string;
          const back = swapped === 'A' ? 'B' : swapped === 'B' ? 'A' : 'tie';
          return netSide([first, back]);
        }),
      );
      rows.push({ id: fx.id, runs });
    }
    const passed = rows.filter((r, k) => r.runs.every((side) => side === fixtures[k]!.label)).length;
    report[model] = { rows, separated3of3: passed, earns: passed === fixtures.length };
  }
  // Jev: three repeats of its three-framing majority, live (no recording), per fixture.
  const jev = pairs.makeJev(fetch, {
    JEV_URL: 'https://api.typesafe.ai/v1/systemone',
    JEV_API_KEY: process.env.JEV_API_KEY,
  });
  const inputs = new Map(fixtures.map((f) => [f.id, { ...f, criterion: f.criterion! }]));
  const seats = pairs.jevSeats(inputs, jev);
  const jevRows: { id: string; runs: Side[] }[] = [];
  for (const fx of fixtures) {
    const runs: Side[] = [];
    for (let r = 0; r < 3; r += 1) {
      const outcomes = await Promise.all(
        seats.map((seat) =>
          seat
            .judge({ ...pairs.pairRequest(inputs.get(fx.id)!), given: { ledger: { item: fx.id } } })
            .then((x) => x.answer.outcome)
            .catch(() => 'inconclusive'),
        ),
      );
      const pass = outcomes.filter((o) => o === 'pass').length;
      const fail = outcomes.filter((o) => o === 'fail').length;
      runs.push(pass >= 2 ? 'A' : fail >= 2 ? 'B' : 'tie');
    }
    jevRows.push({ id: fx.id, runs });
  }
  const jevPassed = jevRows.filter((r, k) => r.runs.every((side) => side === fixtures[k]!.label)).length;
  report.jev = { rows: jevRows, separated3of3: jevPassed, earns: jevPassed === fixtures.length };
  report.spentUsd = spent;
  await writeFile(
    join(RESULTS, `fixtures-rubricbench-${GEMINI}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await ledger(
    `| ${new Date().toISOString()} | opus-council | OpenAI + Google + Jev | gpt-5.4-mini, ${GEMINI}, jev-latest | rubricbench 6 fixtures x 3 runs x 2 orders | 72 chat calls + 54 Jev calls | ${spent.toFixed(4)} USD |`,
  );
  console.log(
    JSON.stringify({
      gpt: (report['gpt-5.4-mini'] as { separated3of3: number }).separated3of3,
      gemini: (report[GEMINI] as { separated3of3: number }).separated3of3,
      jev: jevPassed,
      spent,
    }),
  );
}

// ---- RubricBench: a rubric tie is a split; it goes to gpt, Gemini and Jev, two of three decide ----
if (mode === 'rbcouncil') {
  const ties = await devItems('rubricbench');
  const lite = arg('gemini') ?? 'gemini-3.5-flash-lite';
  const margins = JSON.parse(await readFile(join(SCRATCH, 'rb-margins.json'), 'utf8')) as [
    string,
    number,
    number,
    boolean,
    string,
  ][];
  const baseCorrect = new Map(margins.map((m) => [m[0], m[3]]));
  const base = new Map<string, Side>(
    ties.map((i) => [i.id, baseCorrect.get(i.id) ? i.label : i.label === 'A' ? 'B' : 'A']),
  );
  const load = async (file: string, plain = false) => {
    const rows = JSON.parse(await readFile(join(RESULTS, file), 'utf8')) as { id: string; vote: Side }[];
    return new Map(rows.map((r) => [plain ? r.id.replace('#plain', '') : r.id, r.vote]));
  };
  const jevOf = async (file: string) =>
    new Map(
      Object.entries(
        (JSON.parse(await readFile(join(RESULTS, file), 'utf8')) as { sides: Record<string, Side> }).sides,
      ).map(([k, v]) => [k.replace('#plain', ''), v]),
    );
  const judges = {
    gpt: {
      orig: await load('items-rubricbench-gpt-5.4-mini-driftbench.json'),
      twin: await load('items-rubricbench-twin-gpt-5.4-mini-driftbench.json', true).catch(
        () => new Map<string, Side>(),
      ),
    },
    gemini: {
      orig: await load(`items-rubricbench-${lite}-driftbench.json`),
      twin: await load(`items-rubricbench-twin-${lite}-driftbench.json`, true).catch(
        () => new Map<string, Side>(),
      ),
    },
    jev: {
      orig: await jevOf('jev-rubricbench.json'),
      twin: await jevOf('jev-rubricbench-twin.json').catch(() => new Map<string, Side>()),
    },
  };
  const decide = (votes: Side[], fallback: Side): Side => {
    const a = votes.filter((v) => v === 'A').length;
    const b = votes.filter((v) => v === 'B').length;
    return a >= 2 ? 'A' : b >= 2 ? 'B' : fallback;
  };
  const variants: Record<string, (id: string) => Side> = {
    base: (id) => base.get(id)!,
    majorityOriginal: (id) =>
      decide(
        Object.values(judges).map((j) => j.orig.get(id) ?? 'missing'),
        base.get(id)!,
      ),
    // A vote counts only when the judge gives the same side on the original and its markdown-stripped twin.
    majorityStableUnderTwin: (id) =>
      decide(
        Object.values(judges).map((j) => {
          const o = j.orig.get(id);
          return o !== undefined && o === j.twin.get(id) ? o : 'missing';
        }),
        base.get(id)!,
      ),
    gptAlone: (id) => judges.gpt.orig.get(id) ?? 'missing',
    geminiAlone: (id) => judges.gemini.orig.get(id) ?? 'missing',
    jevAlone: (id) => judges.jev.orig.get(id) ?? 'missing',
  };
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(variants)) {
    const right = ties.filter((i) => f(i.id) === i.label).length;
    out[name] = { right, of: ties.length, fullDev: (294 - 29 + right) / 357 };
  }
  await writeFile(join(RESULTS, `rbcouncil-${lite}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out));
}
