import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../../root';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * scale: each stage of the estate loop on estates of 250, 1000, 2500 and 5000 atoms, under a time budget
 * that grows with the size (a few milliseconds per atom), in a child process killed at the budget. The oracle
 * is the stage's own result as well as its time: the scan finds every planted atom, the lint gives no
 * defect finding on a clean estate, the plan and the suite are produced, and maintenance retires exactly
 * the one test whose atom left. Correct and slow is a failing item. Run the family on a quiet machine: its
 * times are wall-clock times.
 */

const COMPONENTS: Record<string, string> = {
  scan: 'packages/estate/src/scan/claude-code.ts',
  lint: 'packages/estate/src/lint/lint.ts',
  plan: 'packages/estate/src/plan/build.ts',
  generate: 'packages/generate/src/estate/generate.ts',
  impact: 'packages/estate/src/maintain/impact.ts',
};

/** Milliseconds allowed per planted atom, per stage. */
export const BUDGET_PER_ATOM: Readonly<Record<string, number>> = {
  scan: 3,
  lint: 1,
  plan: 6,
  generate: 6,
  impact: 1,
};
/** The floor of every budget, for the start-up of a small run. */
export const BUDGET_FLOOR_MS = 4000;
export const SIZES = [250, 1000, 2500, 5000] as const;
const STAGES = ['scan', 'lint', 'plan', 'generate', 'impact'] as const;

function tierOf(size: number, stage: string): Tier {
  const base = size <= 250 ? 1 : size <= 1000 ? 2 : size <= 2500 ? 3 : 4;
  return (stage === 'plan' || stage === 'generate' ? Math.min(5, base + 1) : base) as Tier;
}

export function budgetMs(stage: string, size: number): number {
  return Math.max(BUDGET_FLOOR_MS, (BUDGET_PER_ATOM[stage] ?? 1) * size);
}

/** Runs the worker; resolves its JSON line, or why it gave none. */
function runWorker(
  stage: string,
  size: number,
  seed: number,
  budget: number,
): Promise<{ ok: true; value: Record<string, unknown>; wallMs: number } | { ok: false; reason: string }> {
  const worker = fileURLToPath(new URL('./scale-worker.ts', import.meta.url));
  const root = findRoot(fileURLToPath(new URL('.', import.meta.url)));
  // The item judges the stage's own time, which the worker measures. The scan of the scale estate and the
  // process start are outside it, and a loaded machine slows them: the kill only stops a stage far over its
  // budget, never one the worker could still time.
  const limit = Math.max(3 * budget, budget + 60_000);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', worker, stage, String(size), String(seed)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), limit);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const wallMs = Date.now() - started;
      if (signal) {
        resolve({ ok: false, reason: `killed after ${wallMs} ms (the stage's budget is ${budget} ms)` });
        return;
      }
      const line = out.trim().split('\n').pop() ?? '';
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (typeof value.error === 'string')
          resolve({ ok: false, reason: `the stage threw: ${value.error}` });
        else resolve({ ok: true, value, wallMs });
      } catch {
        resolve({
          ok: false,
          reason: `exit ${code}, no result: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`,
        });
      }
    });
  });
}

function judge(stage: string, value: Record<string, unknown>, budget: number): string | undefined {
  const ms = Number(value.ms);
  const problems: string[] = [];
  if (!(ms <= budget)) problems.push(`took ${ms} ms, over the budget of ${budget} ms`);
  if (stage === 'scan' && value.atoms !== value.planted)
    problems.push(`found ${value.atoms} atoms of ${value.planted} planted`);
  if (stage === 'lint' && value.findings !== 0)
    problems.push(`gave ${value.findings} findings on a clean estate`);
  if (stage === 'plan' && !(Number(value.rows) > 0)) problems.push('wrote no row');
  if (stage === 'generate' && !(Number(value.specs) > 0)) problems.push('wrote no spec');
  if (stage === 'impact' && (value.removed !== 1 || value.retired !== 1))
    problems.push(`removed ${value.removed} and retired ${value.retired}, expected 1 and 1`);
  return problems.length === 0 ? undefined : problems.join('; ');
}

export function scaleFamily(): Family {
  const family = 'scale';
  const items = itemsOf(
    family,
    7,
    COMPONENTS.scan as string,
    SIZES.flatMap((size) =>
      STAGES.map((stage) => ({
        key: `${stage}-${size}`,
        tier: tierOf(size, stage),
        title: `${stage} on an estate of ${size} atoms within ${budgetMs(stage, size)} ms, its result right`,
        component: COMPONENTS[stage] as string,
      })),
    ),
  );
  return {
    id: family,
    level: 7,
    component: COMPONENTS.scan as string,
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const stage of STAGES) {
        // A stage that fails at one size is not run at a larger one: it fails there too, by its budget.
        let failed: string | undefined;
        for (const size of SIZES) {
          const id = `${family}.${stage}-${size}`;
          if (failed) {
            out.set(id, {
              pass: false,
              detail: `not run: the stage already failed at a smaller size (${failed})`,
            });
            continue;
          }
          const budget = budgetMs(stage, size);
          const result = await runWorker(stage, size, seed, budget);
          const reason = result.ok ? judge(stage, result.value, budget) : result.reason;
          out.set(id, {
            pass: reason === undefined,
            detail: reason ?? `holds (${String(result.ok ? result.value.ms : '')} ms)`,
          });
          if (reason) failed = `${size} atoms`;
        }
      }
      return out;
    },
  };
}
