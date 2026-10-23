import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HIDDEN_SHAPE, type HiddenSpec, hiddenSpec } from './hidden';
import {
  CALIBRATION_COUNT,
  CALIBRATION_ENV,
  CALIBRATION_REFERENCE_MS,
  calibrationFactor,
  calibrationOf,
  normalisedMs,
} from './scale-calibration';

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

/**
 * The behaviours a factor of 1 stands for: the most a seed draws (HIDDEN_SHAPE.behaviours). Every seed scales to
 * `SCALE_BASE_BEHAVIOURS * factor` behaviours (600 at 100 times), so the workload of a scale run does not depend on
 * how many behaviours the seed happened to draw (4 to 6): the cost grows about as the square of that number, and a
 * seed with 4 passed a time budget that a seed with 6 failed with the same product.
 */
export const SCALE_BASE_BEHAVIOURS = HIDDEN_SHAPE.behaviours[1];

export type ScaleReport = {
  factor: number;
  budgetMs: number;
  /** Set when the run did not finish: over budget, out of memory, or a throw. */
  error?: string;
  /** The raw CPU time of the product's run, in milliseconds. */
  ms: number;
  /** The calibration of this machine: `calibrationOf` its `calibrationRunsMs` (scale-calibration.ts). */
  calibrationMs: number;
  /** Each calibration measured before the timed child started, in the order measured. */
  calibrationRunsMs?: number[];
  /** The behaviours of the scaled hidden specification the run generated. */
  behaviours?: number;
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

/**
 * The hidden specification grown to `SCALE_BASE_BEHAVIOURS * factor` behaviours, each with a phrase, spread over the
 * flows. The seed still decides the rest of its structure (stages, paths, data, phrases), which moves the time of a
 * run by up to about 40 percent between seeds (four seeds, ten runs each: means 89, 90, 106 and 127 s).
 */
export function scaledSpec(seed: number, factor: number): HiddenSpec {
  const spec = hiddenSpec(seed);
  const extra = Math.max(0, SCALE_BASE_BEHAVIOURS * factor - spec.behaviours.length);
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

/** The calibration takes about a second on a hosted runner; a run that takes this long is stuck. */
export const CALIBRATION_TIMEOUT_MS = 120_000;

/**
 * Measures the calibration (scale-calibration.ts) in a short-lived process of its own on this machine. Its
 * result goes to the timed child through the environment, so the timed child's heap is not touched by it.
 */
export function measureCalibration(timeoutMs = CALIBRATION_TIMEOUT_MS): Promise<number | string> {
  const child = fileURLToPath(new URL('./scale-calibrate.ts', import.meta.url));
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', child], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve(`the calibration did not finish in ${timeoutMs} ms and was stopped`);
        return;
      }
      const value = Number(out.trim().split('\n').at(-1));
      resolve(
        Number.isFinite(value) && value > 0
          ? value
          : `the calibration exited ${code} without a value: ${err.trim().split('\n').slice(-3).join(' ')}`,
      );
    });
  });
}

/** Measures `count` calibrations, one after the other, each in a process of its own; a message when one fails. */
async function calibrations(count: number): Promise<number[] | string> {
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = await measureCalibration();
    if (typeof value === 'string') return value;
    out.push(value);
  }
  return out;
}

/** Runs the timed child once with the calibration it is handed, kills it at the wall cap, and returns its report. */
function runChild(
  factor: number,
  seed: number,
  budgetMs: number,
  calibration: number,
  options: { heapMb?: number; generator?: string },
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
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, [CALIBRATION_ENV]: String(calibration) } },
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
 * Runs one scale measurement: `calibrations` calibrations (default CALIBRATION_COUNT), one after the other, each in a
 * process of its own on this machine, and only then the timed child. The calibration of the run is `calibrationOf`
 * the samples; the timed child gets it in its environment, so it measures with its whole heap and imports no
 * product code before it has it. No sample is taken after the product has run: the ruler is not moved by what it
 * measures. The report carries the samples, the calibration, the raw CPU time and the time normalised by it. A test
 * may lower the heap and name a module overriding the package's `generateSuiteToDisk` or `loadApprovedMap`.
 */
export async function scaleReport(
  factor: number,
  seed: number,
  budgetMs = SCALE_BUDGET_MS[factor] ?? 60_000,
  options: { heapMb?: number; generator?: string; calibrations?: number } = {},
): Promise<ScaleReport> {
  const samples = await calibrations(Math.max(1, options.calibrations ?? CALIBRATION_COUNT));
  if (typeof samples === 'string') return failed(factor, budgetMs, samples);
  const taken = samples.map((value) => Math.round(value * 10) / 10);
  const calibrationMs = calibrationOf(taken);
  const report = await runChild(factor, seed, budgetMs, calibrationMs, options);
  if (report.error) return report;
  return {
    ...report,
    calibrationMs,
    calibrationRunsMs: taken,
    normalisedMs: normalisedMs(report.ms, calibrationMs),
    creditCapped: calibrationFactor(calibrationMs).capped,
  };
}
