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

export async function devItems(bench: string): Promise<Pair[]> {
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
    `${bench}-${model}${process.argv.includes('--replay-only') ? '-replay' : ''}-${contestants.map((c: { id: string }) => c.id).join('+')}.json`,
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
      recordingsDir: RECORDINGS,
      replayOnly: 'lenient',
      concurrency: 1,
    });
    const summary = report.contestants[0].summary;
    const score = summary.missing > 0 ? null : summary.value.estimate;
    const other = item.label === 'A' ? 'B' : 'A';
    const vote = score === null ? 'missing' : score > 0.5 ? item.label : score < 0.5 ? other : 'tie';
    rows.push({ id: item.id, group: item.group, label: item.label, score, vote });
  }
  const out = join(RESULTS, `items-${bench}-${model}-${contestant.id}.json`);
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
    return side === 'missing' ? { item, games: [], missing: 2 } : { item, games: [side, side], missing: 0 };
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
    await readFile(join(RESULTS, `items-${bench}-${model}-${contestant}.json`), 'utf8'),
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
  const inputs = new Map(items.map((item) => [item.id, { ...item, criterion: CRITERIA[bench] as string }]));
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
    await writeFile(join(RESULTS, `jev-${bench}.json`), `${JSON.stringify(report, null, 2)}\n`);
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
    const report = {
      bench,
      items: items.length,
      council: score(items, sides),
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
      name: 'council',
      sides: new Map(Object.entries(councilReport.sides)) as Map<string, Side>,
      per100: haikuPer100 + gptPer100 + geminiPer100,
    },
  ];
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
