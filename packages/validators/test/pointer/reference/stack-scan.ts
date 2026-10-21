import { referenceBugsD } from './bugs-d';
import type { ParsedSet } from './labelset';
import { askModel, haiku, type ModelCtx, type ModelResult } from './ports';
import type { WindowPlan } from './window';

/** The margin cut of a stack when the caller sets none (design, "The default stack"). */
export const DEFAULT_MARGIN_CUT = 0.65;

/** The runs of the system 2 labeler of a stack: three, unanimous. */
const SYSTEM2_RUNS = 3;

type Vote = { label: string; target?: number };

export type StackOutcome =
  | { abort: string }
  | { labels: Map<number, Vote>; key?: string; fellBack: number; calls: number };

/** The margin of a choice vector: the top option and its lead over the second. `none` must be an option. */
function marginOf(vector: Record<string, number>): { label: string; margin: number } | undefined {
  if (!('none' in vector)) return undefined;
  const sorted = Object.entries(vector).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top) return undefined;
  return { label: top[0], margin: top[1] - (sorted[1]?.[1] ?? 0) };
}

/** One answer of a model port, asked once more when it is refused or fails. */
async function twice(ask: () => Promise<ModelResult>): Promise<ModelResult> {
  const first = await ask();
  return first.kind === 'answer' ? first : ask();
}

/**
 * A window labelled by the default stack (design, "The default stack"): system 1 (the choice arm of `ctx`)
 * gives a vector per unit, system 2 (the `haiku` arm) three runs. A unit whose margin is at or above the cut
 * takes its system 1 top label; under the cut it takes the label every system 2 run gave, or none. A label
 * that names a target is asked of system 2 alone. A member with no opinion for a unit leaves it to the other,
 * which then decides alone: that unit fell back.
 */
export async function stackWindow(
  plan: WindowPlan,
  set: ParsedSet,
  ctx: ModelCtx,
  marginCut: number,
): Promise<StackOutcome> {
  let calls = 0;
  const vectors = new Map<number, Record<string, number>>();
  ctx.onVector = (n, vector) => {
    if (vector) vectors.set(n, vector);
  };
  let first: ModelResult;
  try {
    first = await twice(() => {
      calls += 1;
      return askModel(plan, set, ctx);
    });
  } finally {
    ctx.onVector = undefined;
  }
  // A cassette miss in a replay stops the run, as it does for one labeler; a failed call leaves no opinion.
  if (first.kind === 'error' && /^cassette miss/.test(first.message)) return { abort: first.message };

  const runs: Array<Map<number, Vote> | undefined> = [];
  let key: string | undefined = first.kind === 'answer' ? first.key : undefined;
  for (let run = 1; run <= SYSTEM2_RUNS; run += 1) {
    const answer = await twice(() => {
      calls += 1;
      return haiku(plan, set, ctx, run);
    });
    if (answer.kind === 'error' && /^cassette miss/.test(answer.message)) return { abort: answer.message };
    if (answer.kind !== 'answer') {
      runs.push(undefined);
      continue;
    }
    key ??= answer.key;
    const checked = new Map<number, Vote>();
    const entries = 'labels' in answer.answer ? answer.answer.labels : [];
    for (const entry of entries) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(String(entry.units));
      if (!m) continue;
      const to = m[2] === undefined ? Number(m[1]) : Number(m[2]);
      const vote: Vote =
        entry.target === undefined ? { label: entry.label } : { label: entry.label, target: entry.target };
      for (let n = Number(m[1]); n <= to; n += 1) checked.set(n, vote);
    }
    runs.push(checked);
  }

  const asked = new Set(set.labels.filter((l) => l.target !== 'required').map((l) => l.name));
  const labels = new Map<number, Vote>();
  let fellBack = 0;
  for (const unit of plan.units) {
    if (unit.mode !== 'label') continue;
    const vector = vectors.get(unit.n);
    const votes = runs.map((r) => r?.get(unit.n));
    const head = votes[0];
    const second =
      head && votes.every((v) => v !== undefined && v.label === head.label && v.target === head.target)
        ? head
        : undefined;
    if (!vector && !second) continue;
    if (!vector && second) {
      // System 1 gave no opinion: it counts as below the cut, and system 2 decides alone.
      if (referenceBugsD.has('w-stack-system1-missing-undecided')) continue;
      labels.set(unit.n, second);
      fellBack += 1;
      continue;
    }
    if (second && (referenceBugsD.has('stack-system2-none-overrides') || second.label !== 'none')) {
      if (!asked.has(second.label)) {
        labels.set(unit.n, second);
        continue;
      }
    }
    const lead = vector ? marginOf(vector) : undefined;
    const sure =
      lead &&
      (referenceBugsD.has('stack-margin-equal-defers') ? lead.margin > marginCut : lead.margin >= marginCut)
        ? lead.label
        : undefined;
    if (sure !== undefined) {
      labels.set(unit.n, { label: sure });
      if (!second && !referenceBugsD.has('stack-fallback-flag-dropped')) fellBack += 1;
      continue;
    }
    if (second) labels.set(unit.n, second);
  }
  return { labels, ...(key ? { key } : {}), fellBack, calls };
}
