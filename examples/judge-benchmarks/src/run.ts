import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Caller, CallFailed, createCaller, promptKey, Recordings, SpendCapReached } from './call';
import {
  CONTESTANTS,
  type Contestant,
  contestantById,
  jsonObjects,
  type PairDecision,
  type PointDecision,
  type Prompt,
} from './contestants';
import {
  type BenchmarkId,
  type Item,
  loadBenchmark,
  type PairItem,
  type PointItem,
  splitOf,
  stratifiedSample,
} from './data';
import { extractPython, finalLine, majoritySolve, normalizeFinal, pythonOutput } from './extras';
import {
  type PairResult,
  type PointResult,
  pairGames,
  pointGame,
  type Summary,
  scorePairs,
  scorePoints,
} from './score';

/**
 * Runs contestants on a public judge benchmark through the claude command, with recordings, and prints the
 * paper's metric per contestant.
 *
 *   npx tsx examples/judge-benchmarks/src/run.ts --bench judgebench --model haiku [--sample 100]
 *     [--contestants driftbench,deepeval] [--cap-usd 1] [--concurrency 6] [--replay-only] [--out report.json]
 *
 * Recordings live in examples/judge-benchmarks/recordings/<bench>/<model>.jsonl. A rerun of the same
 * prompts reads them and costs nothing; --replay-only refuses to call the model at all.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const RECORDINGS = join(HERE, '..', 'recordings');

export type RunOptions = {
  readonly bench: BenchmarkId;
  readonly model: string;
  readonly contestants: readonly Contestant[];
  readonly sample?: number;
  readonly seed?: string;
  /** dev, test or all (default all). Our judge is tuned on dev; charts show test. */
  readonly split?: 'dev' | 'test' | 'all';
  readonly capUsd?: number;
  /** Absolute time after which no new model calls start. */
  readonly deadlineAt?: number;
  readonly concurrency?: number;
  /** Never call the model: true stops at a missing recording; lenient counts its answer as missing. */
  readonly replayOnly?: boolean | 'lenient';
  readonly recordingsDir?: string;
  readonly command?: string;
  /** Items to use instead of loading the benchmark, for tests. */
  readonly items?: readonly (PairItem | PointItem)[];
  readonly criterion?: string;
  /** Draw the stratified sample from all items, then keep the items of the split (the charts' order). */
  readonly sampleBeforeSplit?: boolean;
  /** Optional diagnostics, with no benchmark text copied into the report. */
  readonly includeDecisions?: boolean;
};

export type ContestantReport = {
  readonly contestant: string;
  readonly source: string;
  readonly mode: 'pairwise, both orders' | 'pointwise, single game' | 'pointwise';
  readonly summary: Summary;
  /** What the calls cost as the command reported it, recorded or new. */
  readonly costUsd: number;
  readonly calls: number;
  readonly decisions?: readonly {
    id: string;
    pass?: boolean;
    correct: boolean;
    responseChars: number;
    missing: number;
  }[];
};

export type RunReport = {
  readonly bench: BenchmarkId;
  readonly model: string;
  readonly items: number;
  readonly sample?: number;
  readonly contestants: readonly ContestantReport[];
  readonly newSpendUsd: number;
  readonly newCalls: number;
  readonly replayed: number;
  /** Calls that failed after their retries; their answers are missing. */
  readonly failedCalls: number;
  readonly stopped?: string;
};

async function pool<T>(tasks: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (next < tasks.length && failure === undefined) {
      const index = next;
      next += 1;
      try {
        out[index] = await (tasks[index] as () => Promise<T>)();
      } catch (cause) {
        failure = cause;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (failure !== undefined) throw failure;
  return out;
}

type Ask = (
  contestant: Contestant,
  prompt: Parameters<Caller['call']>[0],
  item: string,
  order: string,
) => Promise<{ text: string; costUsd: number } | undefined>;

export async function runBenchmark(options: RunOptions): Promise<RunReport> {
  const bench = options.items
    ? { id: options.bench, criterion: options.criterion ?? 'The response is correct.', items: options.items }
    : await loadBenchmark(options.bench);
  const inSplit = (xs: readonly Item[]) =>
    xs.filter(
      (item) => (options.split ?? 'all') === 'all' || splitOf(options.bench, item.id) === options.split,
    );
  const items =
    options.sample && options.sampleBeforeSplit
      ? inSplit(stratifiedSample(bench.items, options.sample, options.seed))
      : options.sample
        ? stratifiedSample(inSplit(bench.items), options.sample, options.seed)
        : inSplit(bench.items);
  const recordings = await new Recordings(
    join(options.recordingsDir ?? RECORDINGS, options.bench, `${options.model}.jsonl`),
  ).load();
  const programOutputs = await new Recordings(
    join(options.recordingsDir ?? RECORDINGS, options.bench, 'program-outputs.jsonl'),
  ).load();
  const caller = createCaller(
    recordings,
    { model: options.model, ...(options.command ? { command: options.command } : {}) },
    {
      ...(options.capUsd === undefined ? {} : { capUsd: options.capUsd }),
      ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt }),
      ...(options.replayOnly ? { replayOnly: options.replayOnly } : {}),
    },
  );
  let stopped: string | undefined;
  let failedCalls = 0;
  const costs = new Map<string, { usd: number; calls: number }>();
  // Limit actual calls, including nested votes, chunks and both pair orders.
  const waiting: (() => void)[] = [];
  let active = 0;
  const limit = Math.max(1, Math.floor(options.concurrency ?? 4));
  const ask: Ask = async (contestant, prompt, item, order) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      if (stopped) return undefined;
      try {
        const r = await caller.call(prompt, { bench: options.bench, contestant: contestant.id, item, order });
        const c = costs.get(contestant.id) ?? { usd: 0, calls: 0 };
        c.usd += r.costUsd;
        c.calls += 1;
        costs.set(contestant.id, c);
        return r;
      } catch (cause) {
        if (cause instanceof CallFailed) {
          failedCalls += 1;
          return undefined;
        }
        stopped =
          cause instanceof SpendCapReached
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : String(cause);
        return undefined;
      }
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };

  const reports: ContestantReport[] = [];
  for (const contestant of options.contestants) {
    const pairwiseBench = items.every((item) => item.kind === 'pair');
    const usePair = pairwiseBench && contestant.pair !== undefined;
    // A setup call (DeepEval's evaluation steps) is made once per criterion and reused.
    const setups = new Map<string, Promise<string | undefined>>();
    const setupFor = (criterion: string): Promise<string | undefined> => {
      const prompt = usePair ? contestant.setup?.pair?.(criterion) : contestant.setup?.point?.(criterion);
      if (!prompt) return Promise.resolve(undefined);
      let pending = setups.get(criterion);
      if (!pending) {
        pending = ask(contestant, prompt, 'setup', usePair ? 'pair' : 'point').then((r) => r?.text);
        setups.set(criterion, pending);
      }
      return pending;
    };
    // The criterion of an item: its own (such as human rubrics), or one the contestant writes itself.
    // A contestant with samples above 1 judges each prompt that many times, independently, and the majority
    // decides; each sample after the first carries its number, so it is its own recorded call.
    const sampled = async (prompt: Prompt, id: string, order: string): Promise<string[]> => {
      const k = contestant.samples ?? 1;
      const asked = await Promise.all(
        Array.from({ length: k }, (_, i) =>
          ask(
            contestant,
            i === 0
              ? prompt
              : { ...prompt, user: `${prompt.user}\n\n(Independent judgement ${i + 1} of ${k}.)` },
            id,
            k === 1 ? order : `${order}#${i + 1}`,
          ),
        ),
      );
      return asked.filter((r): r is NonNullable<typeof r> => r !== undefined).map((r) => r.text);
    };
    const routes = new Map<string, Promise<boolean>>();
    const checkable = (item: Item): Promise<boolean> => {
      if (!contestant.route) return Promise.resolve(true);
      let pending = routes.get(item.id);
      if (!pending) {
        pending = ask(contestant, contestant.route(item.question), item.id, 'route').then(
          (r) => r === undefined || /^\s*\**\s*YES/i.test(r.text),
        );
        routes.set(item.id, pending);
      }
      return pending;
    };
    const executeProgram = async (
      text: string,
      item: Item,
      restricted = true,
    ): Promise<string | undefined> => {
      const code = extractPython(text);
      if (code === undefined) return undefined;
      const model = restricted ? 'python3-macos-restricted-v1' : 'python3-isolated-v1';
      const key = promptKey(model, { system: 'five seconds, standard library', user: code });
      const hit = programOutputs.get(key);
      if (!hit && options.replayOnly) return undefined;
      const out = hit ? hit.text || undefined : await pythonOutput(code, 'python3', restricted);
      if (!hit)
        await programOutputs.add({
          key,
          model,
          text: out ?? '',
          costUsd: 0,
          bench: options.bench,
          contestant: contestant.id,
          item: item.id,
          order: 'program-output',
        });
      return out;
    };
    // The solve of the item: one solve, or the majority of several. Unchanged for one solve, so its recording holds.
    const solveFor = async (item: Item): Promise<string | undefined> => {
      if (contestant.referencePaths) {
        const texts: string[] = [];
        const completeAnswers: (string | undefined)[] = [];
        const completeFinal = (text: string): string | undefined => {
          const last = [...text.matchAll(/Final answer:/gi)].at(-1);
          return last?.index === undefined ? undefined : text.slice(last.index + last[0].length).trim();
        };
        const diagnostics: string[] = [];
        for (const path of contestant.referencePaths) {
          const r = await ask(contestant, path.prompt(item.question), item.id, `blind-${path.name}`);
          if (!r) continue;
          if (!path.program) {
            texts.push(r.text);
            completeAnswers.push(completeFinal(r.text));
            continue;
          }
          const out = await executeProgram(r.text, item);
          if (!out) continue;
          if (/^UNSUPPORTED\b/i.test(out)) {
            diagnostics.push(`${path.name} did not produce a supported final answer:\n${out}`);
            continue;
          }
          const answer = jsonObjects(out)
            .filter((o) => typeof o.final_answer === 'string')
            .at(-1)?.final_answer;
          if (typeof answer === 'string' && /^UNSUPPORTED\b/i.test(answer)) {
            diagnostics.push(`${path.name} did not produce a supported final answer:\n${out}`);
            continue;
          }
          texts.push(
            typeof answer === 'string' ? `Independent program output:\n${out}\nFinal answer: ${answer}` : out,
          );
          completeAnswers.push(typeof answer === 'string' ? answer : completeFinal(out));
        }
        const winner = majoritySolve(texts);
        const key = normalizeFinal(finalLine(winner));
        const completeCounts = new Map<string, number>();
        for (const answer of completeAnswers) {
          const normalized = normalizeFinal(answer);
          if (normalized !== undefined)
            completeCounts.set(normalized, (completeCounts.get(normalized) ?? 0) + 1);
        }
        const count = contestant.fullReferenceAnswers
          ? Math.max(0, ...completeCounts.values())
          : key === undefined
            ? 0
            : texts.filter((text) => normalizeFinal(finalLine(text)) === key).length;
        const total = contestant.referencePaths.length;
        const agreement = count / total;
        const threshold = contestant.referenceAgreementThreshold;
        if (threshold !== undefined && agreement < threshold)
          return `Blind-solve agreement is ${count}/${total}, below the preregistered confidence threshold ${threshold}. No majority answer is supplied as a trusted reference. Re-derive the result from the question and external checks.`;
        return `Blind-solve agreement: ${count}/${total}. Independent work is fallible; agreement does not prove correctness.\n\n${texts.map((text, i) => `Solve path ${i + 1}:\n${text}`).join('\n\n')}${diagnostics.length ? `\n\nAbstaining program diagnostics (not counted as answers):\n${diagnostics.join('\n\n')}` : ''}`;
      }
      if (!contestant.reference) return undefined;
      const k = contestant.referenceSamples ?? 1;
      const prompt = contestant.reference(item.question);
      const texts: string[] = [];
      for (let i = 0; i < k; i += 1) {
        const p =
          i === 0 ? prompt : { ...prompt, user: `${prompt.user}\n\n(Independent solve ${i + 1} of ${k}.)` };
        const r = await ask(contestant, p, item.id, k === 1 ? 'reference' : `reference#${i + 1}`);
        if (r) texts.push(r.text);
      }
      if (contestant.referenceAggregation === 'all')
        return texts.length
          ? texts.map((text, i) => `Independent derivation ${i + 1}:\n${text}`).join('\n\n')
          : undefined;
      return k === 1 ? texts[0] : majoritySolve(texts);
    };
    // The readings of a long reply, one call per part, as notes for the judge.
    const readingsFor = async (item: Item, response: string): Promise<string | undefined> => {
      const chunked = contestant.chunkedReading;
      if (!chunked || response.length <= chunked.threshold) return undefined;
      const criterion = item.criterion ?? bench.criterion;
      const parts: string[] = [];
      for (let at = 0; at < response.length; at += chunked.size)
        parts.push(response.slice(at, at + chunked.size));
      const notes = await Promise.all(
        parts.map((part, i) =>
          ask(
            contestant,
            chunked.read({ question: item.question, part, criterion, index: i + 1, total: parts.length }),
            item.id,
            `read#${i + 1}`,
          ),
        ),
      );
      const lines = notes.map((r, i) =>
        r ? `Part ${i + 1} of ${parts.length}: ${r.text.trim()}` : undefined,
      );
      return lines.some((l) => l !== undefined)
        ? `Notes from reading the reply in ${parts.length} parts, each part alone (they may be wrong):\n${lines
            .filter((l) => l !== undefined)
            .join('\n')}`
        : undefined;
    };
    // The program's printed output for the question, when the contestant asks for one.
    const programFor = async (item: Item, response?: string): Promise<string | undefined> => {
      if (!contestant.codeCheck) return undefined;
      const r = await ask(
        contestant,
        contestant.codeCheck.write(item.question, contestant.codeCheck.targeted ? response : undefined),
        item.id,
        'program',
      );
      const out = r
        ? await executeProgram(r.text, item, contestant.codeCheck.restricted ?? false)
        : undefined;
      return out === undefined
        ? undefined
        : `Output of a program that works the question out (it may be wrong): ${out}`;
    };
    // Everything the judge is given as reference for an item. With no extra step, exactly the solve, as before.
    const referenceFor = async (
      item: Item,
      response?: string,
      originalResponse?: string,
    ): Promise<string | undefined> => {
      const isChecked = await checkable(item);
      const solved = isChecked ? await solveFor(item) : undefined;
      const extras: (string | undefined)[] = [];
      if (contestant.toolEvidence) extras.push(await contestant.toolEvidence(item.question));
      if (
        contestant.finalStepCheck &&
        originalResponse &&
        response &&
        originalResponse.length > contestant.finalStepCheck.threshold
      ) {
        const checked = await ask(
          contestant,
          contestant.finalStepCheck.read(
            item.question,
            originalResponse.slice(-contestant.finalStepCheck.size),
            response,
          ),
          item.id,
          'final-step',
        );
        if (checked)
          extras.push(`Independent re-derivation of the final step (may itself be wrong):\n${checked.text}`);
      }
      if (response !== undefined) extras.push(await readingsFor(item, response));
      if (isChecked && contestant.codeCheck) extras.push(await programFor(item, response));
      const parts = [solved, ...extras].filter((p): p is string => p !== undefined);
      return parts.length === 0 ? undefined : parts.join('\n\n');
    };
    const criterionFor = async (item: Item): Promise<string> => {
      if (contestant.rubric) {
        const r = await ask(contestant, contestant.rubric(item.question), item.id, 'rubric');
        return `${bench.criterion}\n${r?.text ?? ''}`;
      }
      return item.criterion ?? bench.criterion;
    };
    const point = async (
      item: Item,
      response: string,
      order: string,
    ): Promise<{ d: PointDecision; missing: number }> => {
      const originalResponse = response;
      if (contestant.responseExtractor) {
        const extractor = contestant.responseExtractor;
        let answer = extractor.local(item.question, response);
        if (answer === undefined) {
          const r = await ask(
            contestant,
            extractor.prompt(item.question, response),
            item.id,
            'quoted-extract',
          );
          answer = r ? extractor.parse(r.text, response) : undefined;
        }
        if (answer === undefined || !answer.trim()) {
          if (!extractor.fallback) return { d: {}, missing: 1 };
          response = extractor.fallback(item.question, originalResponse);
        } else response = answer;
      } else if (contestant.extractResponse) {
        const extracted = await ask(
          contestant,
          contestant.extractResponse(item.question, response),
          item.id,
          'extract',
        );
        if (!extracted?.text.trim()) return { d: {}, missing: 1 };
        response = extracted.text;
      }
      const criterion = await criterionFor(item);
      const setup = await setupFor(criterion);
      const reference = await referenceFor(item, response, originalResponse);
      const pointInput = {
        question: item.question,
        response,
        criterion,
        ...(setup === undefined ? {} : { setup }),
        ...(reference === undefined ? {} : { reference }),
      };
      const prompt = contestant.point?.(pointInput);
      const id = item.id;
      if (!prompt || !contestant.parsePoint) return { d: {}, missing: 1 };
      const parse = contestant.parsePoint;
      const texts = await sampled(prompt, id, order);
      if (texts.length === 0) return { d: {}, missing: 1 };
      const decision = majorityPoint(texts.map(parse));
      if (contestant.postPoint?.when(decision, texts)) {
        const review = await ask(contestant, contestant.postPoint.prompt(pointInput), id, `${order}-review`);
        return review ? { d: parse(review.text), missing: 0 } : { d: {}, missing: 1 };
      }
      return { d: decision, missing: 0 };
    };
    let summary: Summary;
    let mode: ContestantReport['mode'];
    let decisions: ContestantReport['decisions'];
    if (pairwiseBench) {
      const pairs = items as PairItem[];
      const tasks = pairs.map((item) => async (): Promise<PairResult> => {
        if (contestant.checklist) {
          // Each reply is checked against every rubric alone; the reply with more satisfied rubrics wins.
          const checklist = contestant.checklist;
          const rubrics = (await criterionFor(item))
            .split('\n')
            .slice(1)
            .map((r) => r.trim())
            .filter(Boolean);
          const count = async (reply: string): Promise<number | undefined> => {
            const r = await ask(
              contestant,
              checklist.reply({ question: item.question, reply, rubrics }),
              item.id,
              'checklist',
            );
            const checks = r ? checklist.parse(r.text, rubrics.length) : undefined;
            return checks === undefined ? undefined : checks.filter(Boolean).length;
          };
          const [a, b] = await Promise.all([count(item.a), count(item.b)]);
          const decision: PairDecision =
            a === undefined || b === undefined || a === b ? 'tie' : a > b ? 'A' : 'B';
          // One decision for both games: no reply is seen in a position, so the two games cannot disagree.
          return {
            item,
            games: [decision, decision],
            missing: (a === undefined ? 1 : 0) + (b === undefined ? 1 : 0),
          };
        }
        if (usePair && contestant.pair && contestant.parsePair) {
          const parse = contestant.parsePair;
          const criterion = await criterionFor(item);
          const setup = await setupFor(criterion);
          const reference = await referenceFor(item);
          const one = async (a: string, b: string, order: string): Promise<PairDecision[] | undefined> => {
            const prompt = contestant.pair?.({
              question: item.question,
              a,
              b,
              criterion,
              ...(setup === undefined ? {} : { setup }),
              ...(reference === undefined ? {} : { reference }),
            });
            if (!prompt) return undefined;
            const texts = await sampled(prompt, item.id, order);
            return texts.length === 0 ? undefined : texts.map(parse);
          };
          const [ordered, swapped] = await Promise.all([
            one(item.a, item.b, 'AB'),
            one(item.b, item.a, 'BA'),
          ]);
          const missing = (ordered === undefined ? 1 : 0) + (swapped === undefined ? 1 : 0);
          if (contestant.pooled) {
            // One verdict from every judgement of both orders, the swapped ones read back as A and B.
            const verdict = majorityPair([...(ordered ?? []), ...(swapped ?? []).map(flipPair)]);
            return { item, games: pairGames(verdict, flipPair(verdict)), missing };
          }
          const vote = (ds: PairDecision[] | undefined) => (ds === undefined ? 'tie' : majorityPair(ds));
          return { item, games: pairGames(vote(ordered), vote(swapped)), missing };
        }
        const [a, b] = await Promise.all([point(item, item.a, 'A'), point(item, item.b, 'B')]);
        return { item, games: [pointGame(a.d, b.d)], missing: a.missing + b.missing };
      });
      const results = await pool(tasks, options.concurrency ?? 4);
      summary = scorePairs(options.bench, results);
      mode = usePair ? 'pairwise, both orders' : 'pointwise, single game';
    } else {
      const points = items as PointItem[];
      const tasks = points.map((item) => async (): Promise<PointResult> => {
        const r = await point(item, item.response, 'single');
        return { item, decision: r.d, missing: r.missing };
      });
      const results = await pool(tasks, options.concurrency ?? 4);
      summary = scorePoints(results);
      if (options.includeDecisions)
        decisions = results.map(({ item, decision, missing }) => ({
          id: item.id,
          ...decision,
          correct: item.correct,
          responseChars: item.response.length,
          missing,
        }));
      mode = 'pointwise';
    }
    const c = costs.get(contestant.id) ?? { usd: 0, calls: 0 };
    reports.push({
      contestant: contestant.id,
      source: contestant.source,
      mode,
      summary,
      costUsd: c.usd,
      calls: c.calls,
      ...(decisions === undefined ? {} : { decisions }),
    });
  }
  return {
    bench: options.bench,
    model: options.model,
    items: items.length,
    ...(options.sample ? { sample: options.sample } : {}),
    contestants: reports,
    newSpendUsd: caller.spent(),
    newCalls: caller.calls(),
    replayed: caller.replayed(),
    failedCalls,
    ...(stopped ? { stopped } : {}),
  };
}

const pct = (x: number) => (100 * x).toFixed(1);

export function renderReport(report: RunReport): string {
  const lines = [
    `${report.bench} on ${report.model}: ${report.items} items${report.sample ? ` (stratified sample of ${report.sample})` : ''}`,
    '',
    '| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of report.contestants) {
    const s = c.summary;
    const extra = s.balancedAccuracy === undefined ? '' : `, balanced ${pct(s.balancedAccuracy)}`;
    lines.push(
      `| ${c.contestant} | ${c.mode} | ${pct(s.value.estimate)} [${pct(s.value.lower)}, ${pct(s.value.upper)}]${extra} | ${s.positionConsistency === undefined ? 'n/a' : pct(s.positionConsistency)} | ${c.costUsd.toFixed(4)} | ${s.missing} |`,
    );
  }
  lines.push(
    '',
    `New calls ${report.newCalls}, new spend ${report.newSpendUsd.toFixed(4)} USD, replayed ${report.replayed}.`,
  );
  if (report.stopped) lines.push(`Stopped early: ${report.stopped}`);
  return lines.join('\n');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const bench = arg('bench') as BenchmarkId | undefined;
  if (!bench) throw new Error('--bench judgebench|mmeval|longjudge-wp|longjudge-verify is required');
  const ids = arg('contestants')?.split(',') ?? CONTESTANTS.map((c) => c.id);
  const sample = arg('sample');
  const cap = arg('cap-usd');
  const report = await runBenchmark({
    bench,
    model: arg('model') ?? 'haiku',
    contestants: ids.map(contestantById),
    ...(sample ? { sample: Number(sample) } : {}),
    ...(arg('seed') ? { seed: arg('seed') as string } : {}),
    ...(arg('split') ? { split: arg('split') as 'dev' | 'test' | 'all' } : {}),
    ...(cap ? { capUsd: Number(cap) } : {}),
    concurrency: Number(arg('concurrency') ?? 4),
    replayOnly: process.argv.includes('--replay-only'),
    includeDecisions: process.argv.includes('--include-decisions'),
  });
  process.stdout.write(`${renderReport(report)}\n`);
  const out = arg('out');
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.stopped) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exitCode = 2;
  });
}

/** The majority of several pairwise decisions: the side with more votes, a tie when they are level. */
const flipPair = (d: PairDecision): PairDecision => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');

export function majorityPair(decisions: readonly PairDecision[]): PairDecision {
  const a = decisions.filter((d) => d === 'A').length;
  const b = decisions.filter((d) => d === 'B').length;
  return a > b ? 'A' : b > a ? 'B' : 'tie';
}

/** The majority of several pointwise decisions: pass or fail by vote, the score their mean; no verdict votes nothing. */
export function majorityPoint(decisions: readonly PointDecision[]): PointDecision {
  const pass = decisions.filter((d) => d.pass === true).length;
  const fail = decisions.filter((d) => d.pass === false).length;
  const scores = decisions.map((d) => d.score).filter((x): x is number => x !== undefined);
  const score = scores.length === 0 ? undefined : scores.reduce((s, x) => s + x, 0) / scores.length;
  const verdict = pass > fail ? true : fail > pass ? false : undefined;
  return { ...(verdict === undefined ? {} : { pass: verdict }), ...(score === undefined ? {} : { score }) };
}
