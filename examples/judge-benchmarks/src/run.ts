import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Caller, CallFailed, createCaller, Recordings, SpendCapReached } from './call';
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
import {
  agreementSolve,
  consensusSolve,
  extractPython,
  finalLine,
  majoritySolve,
  type PythonResult,
  pythonRun,
  unanimousSolve,
  validateDivergence,
} from './extras';
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
  readonly concurrency?: number;
  /** Never call the model: true stops at a missing recording; lenient counts its answer as missing. */
  readonly replayOnly?: boolean | 'lenient';
  readonly recordingsDir?: string;
  readonly command?: string;
  readonly maxCallUsd?: number;
  readonly deadlineMs?: number;
  /** Items to use instead of loading the benchmark, for tests. */
  readonly items?: readonly (PairItem | PointItem)[];
  readonly criterion?: string;
  /** Draw the stratified sample from all items, then keep the items of the split (the charts' order). */
  readonly sampleBeforeSplit?: boolean;
  /** Diagnostics only; never passed to contestant prompts. */
  readonly onPairResult?: (result: PairResult) => void;
  readonly onEvidence?: (signal: {
    item: string;
    kind: string;
    status: string;
    details?: unknown;
  }) => void | Promise<void>;
};

export type ContestantReport = {
  readonly contestant: string;
  readonly source: string;
  readonly mode: 'pairwise, both orders' | 'pointwise, single game' | 'pointwise';
  readonly summary: Summary;
  /** What the calls cost as the command reported it, recorded or new. */
  readonly costUsd: number;
  readonly calls: number;
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
  const caller = createCaller(
    recordings,
    {
      model: options.model,
      ...(options.command ? { command: options.command } : {}),
      ...(options.maxCallUsd === undefined ? {} : { maxCallUsd: options.maxCallUsd }),
      ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    },
    {
      ...(options.capUsd === undefined ? {} : { capUsd: options.capUsd }),
      ...(options.replayOnly ? { replayOnly: options.replayOnly } : {}),
    },
  );
  // Replay observed execution evidence, including failures, so speed or set ordering cannot change a prompt.
  const executionFile = join(
    options.recordingsDir ?? RECORDINGS,
    options.bench,
    `${options.model}.executions.jsonl`,
  );
  type Execution = PythonResult & { key: string; recordedAt: string };
  const executions = new Map<string, Execution>();
  try {
    for (const line of (await readFile(executionFile, 'utf8')).split('\n').filter(Boolean)) {
      const r = JSON.parse(line) as Execution;
      executions.set(r.key, r);
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
  const runnerSource = await readFile(join(HERE, 'extras.ts'), 'utf8');
  const runProgram = async (code: string, pure: boolean) => {
    const key = createHash('sha256')
      .update(JSON.stringify([runnerSource, process.platform, 'python3', pure, code]))
      .digest('hex');
    const hit = executions.get(key);
    if (hit) return { ...hit, cached: true };
    const r: Execution = {
      ...(await pythonRun(code, 'python3', pure)),
      key,
      recordedAt: new Date().toISOString(),
    };
    await mkdir(dirname(executionFile), { recursive: true });
    await appendFile(executionFile, `${JSON.stringify(r)}\n`);
    executions.set(key, r);
    return { ...r, cached: false };
  };
  let stopped: string | undefined;
  let failedCalls = 0;
  const costs = new Map<string, { usd: number; calls: number }>();
  // Item-level pooling alone does not limit the nested samples and both orders.
  // At concurrency 1, serialize calls as well so the stated limit is real.
  let callTail: Promise<unknown> = Promise.resolve();
  const ask: Ask = async (contestant, prompt, item, order) => {
    if (stopped) return undefined;
    try {
      const call = () => {
        if (stopped) throw new Error(stopped);
        return caller.call(prompt, { bench: options.bench, contestant: contestant.id, item, order });
      };
      const pending = options.concurrency === 1 ? callTail.then(call) : call();
      if (options.concurrency === 1) callTail = pending.catch(() => undefined);
      const r = await pending;
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
  };

  const reports: ContestantReport[] = [];
  const signal = async (item: string, kind: string, status: string, details?: unknown) => {
    await options.onEvidence?.({ item, kind, status, ...(details === undefined ? {} : { details }) });
  };
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
    const computationRoutes = new Map<string, Promise<boolean>>();
    const computational = (item: Item): Promise<boolean | undefined> => {
      if (!contestant.computationalRoute) return Promise.resolve(undefined);
      let pending = computationRoutes.get(item.id);
      if (!pending) {
        pending = ask(
          contestant,
          contestant.computationalRoute(item.question),
          item.id,
          'computation-route',
        ).then(async (r) => {
          const isCompute = /^\s*COMPUTE\b/i.test(r?.text ?? '');
          await signal(item.id, 'route', isCompute ? 'compute' : 'knowledge', r?.text);
          return isCompute;
        });
        computationRoutes.set(item.id, pending);
      }
      return pending;
    };
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
    // The solve of the item: one solve, or the majority of several. Unchanged for one solve, so its recording holds.
    const solveFor = async (item: Item): Promise<string | undefined> => {
      if (!contestant.reference) return undefined;
      const k = contestant.referenceSamples ?? 1;
      const prompt = contestant.reference(item.question);
      const texts: string[] = [];
      for (let i = 0; i < k; i += 1) {
        const base = contestant.referenceVariants?.[i]?.(item.question) ?? prompt;
        const p = i === 0 ? base : { ...base, user: `${base.user}\n\n(Independent solve ${i + 1} of ${k}.)` };
        const r = await ask(contestant, p, item.id, k === 1 ? 'reference' : `reference#${i + 1}`);
        if (r) texts.push(r.text);
      }
      const reference =
        k === 1
          ? texts[0]
          : contestant.referenceConsensus
            ? texts.length === k
              ? contestant.referenceMinimumAgreement !== undefined
                ? agreementSolve(texts, contestant.referenceMinimumAgreement)
                : contestant.referenceConsensus === 'unanimous'
                  ? unanimousSolve(texts)
                  : consensusSolve(texts)
              : undefined
            : majoritySolve(texts);
      await signal(item.id, 'reference', reference ? 'used' : 'omitted', {
        finals: texts.map(finalLine),
        selected: finalLine(reference),
        text: reference,
      });
      return reference;
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
    const execute = async (
      item: Item,
      prompt: Prompt,
      order: string,
      pure: boolean,
    ): Promise<string | undefined> => {
      let written = await ask(contestant, prompt, item.id, order);
      for (let attempt = 0; attempt < (contestant.repairPrograms ? 2 : 1); attempt++) {
        if (!written || /^\s*NO_CODE\b/.test(written.text)) {
          await signal(item.id, order, 'omitted');
          return undefined;
        }
        const code = extractPython(written.text);
        const ran: PythonResult = code ? await runProgram(code, pure) : { error: 'No program was provided.' };
        await signal(item.id, order, ran.output ? 'executed' : 'failed', ran);
        if (ran.output) return ran.output;
        if (attempt === 0 && contestant.repairPrograms)
          written = await ask(
            contestant,
            {
              ...prompt,
              user: `${prompt.user}\n\nThe previous program did not execute. Repair it using this actual diagnostic. Keep the original verification task, pure-operation restrictions and compact printed schema.\nDiagnostic: ${ran.error}\nPrevious program:\n${code}`,
            },
            item.id,
            `${order}-repair`,
          );
      }
      return undefined;
    };
    // The program's printed output, with failed execution retained as a diagnostic, never a verdict.
    const programFor = async (item: Item): Promise<string | undefined> => {
      if (!contestant.codeCheck) return undefined;
      const out = await execute(
        item,
        contestant.codeCheck.write(item.question),
        'program',
        contestant.codeCheck.pure ?? false,
      );
      return out === undefined
        ? undefined
        : `Output of a program that works the question out (it may be wrong): ${out}`;
    };
    // Everything the judge is given as reference for an item. With no extra step, exactly the solve, as before.
    const referenceFor = async (item: Item, response?: string): Promise<string | undefined> => {
      const isChecked = await checkable(item);
      const computation = await computational(item);
      const solved =
        isChecked && (computation !== true || contestant.referenceOnCompute)
          ? await solveFor(item)
          : undefined;
      const extras: (string | undefined)[] = [];
      if (response !== undefined) extras.push(await readingsFor(item, response));
      if (isChecked && contestant.codeCheck && computation !== false) extras.push(await programFor(item));
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
    const formatFor = async (
      item: PairItem,
    ): Promise<{ a: boolean | null; b: boolean | null } | undefined> => {
      if (!contestant.answerFormat) return undefined;
      const prompt = contestant.answerFormat(item.question);
      let generated = await ask(contestant, prompt, item.id, 'answer-format');
      for (let attempt = 0; attempt < 2; attempt++) {
        const spec = jsonObjects(generated?.text ?? '').at(-1);
        if (spec?.none === true) {
          await signal(item.id, 'answer-format', 'none');
          return undefined;
        }
        if (
          typeof spec?.instruction_quote !== 'string' ||
          !spec.instruction_quote.trim() ||
          !item.question.includes(spec.instruction_quote) ||
          typeof spec.python !== 'string'
        ) {
          await signal(item.id, 'answer-format', 'invalid-instruction');
          return undefined;
        }
        const code = `${spec.python}\nimport json\nprint(json.dumps({"first": check(json.loads(${JSON.stringify(JSON.stringify(item.a))})), "second": check(json.loads(${JSON.stringify(JSON.stringify(item.b))}))}))`;
        const ran = await runProgram(code, true);
        if (ran.output) {
          try {
            const checks = JSON.parse(ran.output) as Record<string, unknown>;
            const valid = (x: unknown): x is boolean | null => x === true || x === false || x === null;
            if (valid(checks.first) && valid(checks.second)) {
              await signal(item.id, 'answer-format', 'executed', {
                instruction: spec.instruction_quote,
                checks,
              });
              return { a: checks.first, b: checks.second };
            }
          } catch {
            /* Malformed output is no signal. */
          }
        }
        await signal(item.id, 'answer-format', 'failed', ran);
        if (attempt === 0)
          generated = await ask(
            contestant,
            {
              ...prompt,
              user: `${prompt.user}\n\nRepair the previous predicate using the actual diagnostic below. Keep the instruction_quote exact and the same question-only formatting task.\n${ran.error ?? 'The checker did not return booleans or null as JSON.'}\nPrevious predicate:\n${spec.python}`,
            },
            item.id,
            'answer-format-repair',
          );
      }
      return undefined;
    };
    const point = async (
      item: Item,
      response: string,
      order: string,
    ): Promise<{ d: PointDecision; missing: number }> => {
      const criterion = await criterionFor(item);
      const setup = await setupFor(criterion);
      const reference = await referenceFor(item, response);
      const prompt = contestant.point?.({
        question: item.question,
        response,
        criterion,
        ...(setup === undefined ? {} : { setup }),
        ...(reference === undefined ? {} : { reference }),
      });
      const id = item.id;
      if (!prompt || !contestant.parsePoint) return { d: {}, missing: 1 };
      const parse = contestant.parsePoint;
      const texts = await sampled(prompt, id, order);
      return texts.length === 0 ? { d: {}, missing: 1 } : { d: majorityPoint(texts.map(parse)), missing: 0 };
    };
    let summary: Summary;
    let mode: ContestantReport['mode'];
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
          const format = await formatFor(item);
          const solved = await referenceFor(item);
          const reviews: string[] = [];
          if (contestant.candidateReview) {
            for (const response of [item.a, item.b]) {
              const review = await ask(
                contestant,
                contestant.candidateReview(item.question, response),
                item.id,
                'candidate-review',
              );
              if (review)
                reviews.push(
                  `Fallible independent review of the response ending ${JSON.stringify(response.slice(-400))}:\n${review.text}`,
                );
            }
          }
          const parts = [solved, ...reviews].filter((p): p is string => p !== undefined);
          const reference = parts.length ? parts.join('\n\n') : undefined;
          let programEvidence: Record<string, unknown> | undefined;
          if (contestant.pairCodeCheck && (await computational(item)) !== false) {
            let disagreement: string | undefined;
            if (contestant.pairDivergence) {
              const located = await ask(
                contestant,
                contestant.pairDivergence({ question: item.question, a: item.a, b: item.b }),
                item.id,
                'divergence',
              );
              disagreement = validateDivergence(jsonObjects(located?.text ?? '').at(-1), item.a, item.b);
              await signal(item.id, 'divergence', disagreement ? 'validated' : 'omitted', disagreement);
            }
            const out = await execute(
              item,
              contestant.pairCodeCheck({
                question: item.question,
                a: item.a,
                b: item.b,
                ...(disagreement ? { disagreement } : {}),
              }),
              'pair-program',
              true,
            );
            try {
              const parsed = out ? (JSON.parse(out) as Record<string, unknown>) : undefined;
              if (parsed && 'first' in parsed && 'second' in parsed) programEvidence = parsed;
            } catch {
              /* Failed or malformed programs provide no evidence, rather than invented results. */
            }
            await signal(item.id, 'pair-evidence', programEvidence ? 'usable' : 'omitted');
          }
          const one = async (a: string, b: string, order: string): Promise<PairDecision[] | undefined> => {
            const evidence = programEvidence
              ? JSON.stringify({
                  reference_answer: programEvidence.reference_answer,
                  checks_for_reply_A: order === 'AB' ? programEvidence.first : programEvidence.second,
                  checks_for_reply_B: order === 'AB' ? programEvidence.second : programEvidence.first,
                })
              : undefined;
            const withEvidence = [
              reference,
              evidence
                ? `Executed program evidence (only the encoded tests, not a proof): ${evidence}`
                : undefined,
            ]
              .filter(Boolean)
              .join('\n\n');
            const prompt = contestant.pair?.({
              question: item.question,
              a,
              b,
              criterion,
              ...(setup === undefined ? {} : { setup }),
              ...(withEvidence ? { reference: withEvidence } : {}),
            });
            if (!prompt) return undefined;
            const texts = await sampled(prompt, item.id, order);
            await signal(item.id, 'judgements', 'observed', { order, texts });
            return texts.length === 0
              ? undefined
              : texts.map((text) =>
                  parse(text, {
                    question: item.question,
                    a,
                    b,
                    ...(format ? { format: order === 'AB' ? format : { a: format.b, b: format.a } } : {}),
                  }),
                );
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
      if (options.onPairResult) for (const result of results) options.onPairResult(result);
      summary = scorePairs(options.bench, results);
      mode = usePair ? 'pairwise, both orders' : 'pointwise, single game';
    } else {
      const points = items as PointItem[];
      const tasks = points.map((item) => async (): Promise<PointResult> => {
        const r = await point(item, item.response, 'single');
        return { item, decision: r.d, missing: r.missing };
      });
      summary = scorePoints(await pool(tasks, options.concurrency ?? 4));
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
