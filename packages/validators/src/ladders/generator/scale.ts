import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type HiddenSpec, hiddenSpec } from './hidden';
import { CALIBRATION_REFERENCE_MS } from './scale-calibration';

/**
 * The scale items (docs/validators.md section 12.2, item 4): the hidden specification of a seed with its
 * behaviours multiplied by 10 and by 100, generated under a CPU-time and memory budget in a child process
 * that is killed at a wall-clock cap. Correct and slow is a failing item. The child is `scale-child.ts`.
 */

/**
 * CPU-time budget of one scale run, in milliseconds, per factor; the two generations get half. CPU time, not
 * wall clock, so the verdict does not depend on how busy the machine is.
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
  /** The raw CPU time of the product's run, in milliseconds. */
  ms: number;
  /** The CPU time of the fixed calibration workload on this machine, run in the same process before the window. */
  calibrationMs: number;
  /** The calibration on the reference machine (scale-calibration.ts). */
  referenceMs: number;
  /** `ms` scaled to the reference machine: ms x referenceMs / calibrationMs. The item judges this. */
  normalisedMs: number;
  /** True when the credit a slow calibration earns was capped (scale-calibration.ts, CALIBRATION_MAX_CREDIT). */
  creditCapped: boolean;
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
    calibrationMs: 0,
    referenceMs: CALIBRATION_REFERENCE_MS,
    normalisedMs: budgetMs,
    creditCapped: false,
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
