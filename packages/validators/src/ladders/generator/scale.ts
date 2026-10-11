import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type HiddenSpec, hiddenSpec } from './hidden';

/**
 * The scale items (docs/validators.md section 12.2, item 4): the hidden specification of a seed with its
 * behaviours multiplied by 10 and by 100, generated under a time and memory budget in a child process that
 * is killed at the budget. Correct and slow is a failing item. The child is `scale-child.ts`.
 */

/** Wall-clock budget of one scale run, in milliseconds, per factor. The generation itself gets half. */
export const SCALE_BUDGET_MS: Record<number, number> = { 10: 60_000, 100: 120_000 };

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

/** Runs the child for one factor and seed, kills it at the budget, and returns what it reported. */
export function scaleReport(
  factor: number,
  seed: number,
  budgetMs = SCALE_BUDGET_MS[factor] ?? 60_000,
): Promise<ScaleReport> {
  const child = fileURLToPath(new URL('./scale-child.ts', import.meta.url));
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        `--max-old-space-size=${SCALE_HEAP_MB}`,
        '--import',
        'tsx',
        child,
        String(factor),
        String(seed),
        String(budgetMs),
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
          `over the budget of ${budgetMs} ms at ${factor} times the behaviours: killed`,
        ),
      );
    }, budgetMs);
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
