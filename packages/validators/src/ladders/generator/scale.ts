import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type HiddenSpec, hiddenSpec } from './hidden';

/**
 * The scale items (docs/validators.md section 12.2, item 4): the hidden specification of a seed with its
 * behaviours multiplied by 10 and by 100, generated under a CPU-time and memory budget in a child process
 * that is killed at a wall-clock cap. Correct and slow is a failing item. The child is `scale-child.ts`.
 * The time charged is the CPU time of the product's own work, a map load and a generation; the harness's work
 * is not charged. A separate growth measurement (`scale-growth-child.ts`) times both sizes back to back in one
 * process and judges how the cost grows with the behaviours, so a product that is linear on a quiet machine
 * and quadratic on a busy one is told apart from a busy machine.
 */

/**
 * CPU-time budget of one scale run, in milliseconds, per factor; the two generations get half (30 s at 10
 * times the behaviours, 60 s at 100 times). CPU time of the product's own work, not wall clock, so the verdict
 * does not depend on how busy the machine is.
 */
export const SCALE_BUDGET_MS: Record<number, number> = { 10: 60_000, 100: 120_000 };

/** The child is killed at this many times its budget of wall clock: a hang, never a slow but busy machine. */
export const SCALE_WALL_CAP = 10;

/** The heap the child may use, in megabytes. */
export const SCALE_HEAP_MB = 2048;

export type ScaleReport = {
  factor: number;
  budgetMs: number;
  /** Set when the run did not finish: over budget, out of memory, or a throw. */
  error?: string;
  ms: number;
  invalid: number;
  lint: number;
  bytesSame: boolean;
  graphOk: boolean;
  graphDetail: string;
  twiseShare: number;
  boundaryOk: boolean;
  boundaryMissing: number;
  deviationOk: boolean;
  deviationMissing: number;
  unwalked: number;
  completeShare: number;
  followerPass: number;
  followerTotal: number;
};

/** Behaviours of the high size per behaviour of the low size in the growth measurement: 100 over 10. */
export const SCALE_GROWTH_FACTORS: readonly [number, number] = [10, 100];

/** Back-to-back pairs of generations the growth measurement times; the best pair judges. */
export const SCALE_GROWTH_ROUNDS = 3;

/**
 * The most the cost per behaviour may grow, as a multiple, between the two sizes: the ratio of the CPU times
 * over the ratio of the behaviours. 1 is linear. A product whose cost grows as the behaviours to the power p
 * scores 10 to the power (p - 1) over the 10 times more behaviours of the high size, so 2.5 refuses everything
 * above the power 1.4 (a quadratic product scores 10) and allows the constant and the logarithmic factors of a
 * linear one.
 */
export const SCALE_GROWTH_BOUND = 2.5;

/** What the growth measurement reports. */
export type ScaleGrowth = {
  seed: number;
  /** The two factors, low then high. */
  low: number;
  high: number;
  rounds: number;
  bound: number;
  /** Set when the run did not finish. */
  error?: string;
  /** The CPU time of the product's own work for one generation at each size, per round, in milliseconds. */
  lowMs: number[];
  highMs: number[];
  /** Per round, the growth of the cost per behaviour between the sizes: (highMs / lowMs) / (high / low). */
  ratios: number[];
  /** The best round: the smallest of the ratios. */
  ratio: number;
};

/** The hidden specification with `factor` times its behaviours, each with a phrase, spread over the flows. */
export function scaledSpec(seed: number, factor: number): HiddenSpec {
  const spec = hiddenSpec(seed);
  const extra = spec.behaviours.length * (factor - 1);
  for (let index = 0; index < extra; index += 1) {
    const id = `B-${String(1000 + index)}`;
    spec.behaviours.push({ id, title: `Keep generic rule number ${index + 1} of the scaled agent` });
    spec.phrases.push({
      dimension: 'behaviour',
      value: id,
      text: `Please keep generic rule number ${index + 1}.`,
      lang: spec.lang,
      intent: { kind: 'behaviour', behaviour: id },
    });
    spec.flows[index % spec.flows.length]?.behaviours.push(id);
  }
  return spec;
}

function failed(factor: number, budgetMs: number, error: string): ScaleReport {
  return {
    factor,
    budgetMs,
    error,
    ms: budgetMs,
    invalid: -1,
    lint: -1,
    bytesSame: false,
    graphOk: false,
    graphDetail: error,
    twiseShare: 0,
    boundaryOk: false,
    boundaryMissing: -1,
    deviationOk: false,
    deviationMissing: -1,
    unwalked: -1,
    completeShare: 0,
    followerPass: 0,
    followerTotal: 0,
  };
}

/**
 * Runs the child for one factor and seed, kills it at the budget, and returns what it reported. A test may
 * lower the heap and name a module overriding the package's `generateSuiteToDisk` or `loadApprovedMap`.
 */
export function scaleReport(
  factor: number,
  seed: number,
  budgetMs = SCALE_BUDGET_MS[factor] ?? 60_000,
  options: { heapMb?: number; generator?: string } = {},
): Promise<ScaleReport> {
  const child = fileURLToPath(new URL('./scale-child.ts', import.meta.url));
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        `--max-old-space-size=${options.heapMb ?? SCALE_HEAP_MB}`,
        '--import',
        'tsx',
        child,
        String(factor),
        String(seed),
        String(budgetMs),
        ...(options.generator ? [options.generator] : []),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(
        failed(
          factor,
          budgetMs,
          `still running after ${SCALE_WALL_CAP * budgetMs} ms of wall clock at ${factor} times the behaviours: killed`,
        ),
      );
    }, SCALE_WALL_CAP * budgetMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        resolve(JSON.parse(line) as ScaleReport);
      } catch {
        resolve(
          failed(
            factor,
            budgetMs,
            `the scale run exited ${code} without a report: ${err.trim().split('\n').slice(-3).join(' ')}`,
          ),
        );
      }
    });
  });
}

/**
 * Runs the growth child for one seed: both sizes back to back in one process, `rounds` times. A test may
 * change the factors and the rounds, lower the heap, and name a module overriding `generateSuiteToDisk` or
 * `loadApprovedMap`. The child is killed at a wall-clock cap, a hang and never a slow but busy machine.
 */
export function scaleGrowth(
  seed: number,
  options: { factors?: readonly [number, number]; rounds?: number; heapMb?: number; generator?: string } = {},
): Promise<ScaleGrowth> {
  const [low, high] = options.factors ?? SCALE_GROWTH_FACTORS;
  const rounds = options.rounds ?? SCALE_GROWTH_ROUNDS;
  const child = fileURLToPath(new URL('./scale-growth-child.ts', import.meta.url));
  const failedGrowth = (error: string): ScaleGrowth => ({
    seed,
    low,
    high,
    rounds,
    bound: SCALE_GROWTH_BOUND,
    error,
    lowMs: [],
    highMs: [],
    ratios: [],
    ratio: Number.POSITIVE_INFINITY,
  });
  const cap =
    SCALE_WALL_CAP * (rounds + 1) * ((SCALE_BUDGET_MS[low] ?? 60_000) + (SCALE_BUDGET_MS[high] ?? 120_000));
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        `--max-old-space-size=${options.heapMb ?? SCALE_HEAP_MB}`,
        '--import',
        'tsx',
        child,
        String(seed),
        String(low),
        String(high),
        String(rounds),
        ...(options.generator ? [options.generator] : []),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(
        failedGrowth(`still running after ${cap} ms of wall clock at ${high} times the behaviours: killed`),
      );
    }, cap);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        const report = JSON.parse(line) as ScaleGrowth;
        // JSON writes an infinite ratio (a low size that took no measurable CPU) as null.
        resolve({ ...report, ratio: report.ratio ?? Number.POSITIVE_INFINITY });
      } catch {
        resolve(
          failedGrowth(
            `the growth run exited ${code} without a report: ${err.trim().split('\n').slice(-3).join(' ')}`,
          ),
        );
      }
    });
  });
}
