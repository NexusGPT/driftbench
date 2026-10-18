import { Problem } from '../bank/types';
import type {
  PointerSut,
  StackAnswer,
  StackLabeller,
  StackRequest,
  StackResult,
  StackUnitResult,
  StackWindow,
} from '../sut/port';
import type { Prose } from './words';

export const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];

export type Vec = Record<string, number>;

/** A 6-label vector with the given top label, second label and margin; the other labels share what is left. */
export function vector(top: string, second: string, margin: number): Vec {
  const rest = (1 - margin) * 0.2;
  const p1 = (1 - rest + margin) / 2;
  const p2 = (1 - rest - margin) / 2;
  const others = LABELS.filter((l) => l !== top && l !== second);
  const out: Vec = { [top]: p1, [second]: p2 };
  for (const l of others) out[l] = rest / others.length;
  return out;
}

/** A vector with exactly representable numbers: top p1, second p2, the rest zero. Their margin is exactly p1 - p2. */
export function exact(top: string, second: string, p1: number, p2: number): Vec {
  const out: Vec = {};
  for (const l of LABELS) out[l] = 0;
  out[top] = p1;
  out[second] = p2;
  return out;
}

export const topOf = (v: Vec): string =>
  Object.entries(v).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] as string;

export type PlanUnit = {
  vec: Vec;
  /** The system 2 label per run; a string repeated for unanimity, null for a missing run. Default: the top label x3. */
  votes?: Array<string | null>;
};

export type Plan = {
  /** Units per window, in order; window i is `f<i>.md`. */
  windows: PlanUnit[][];
};

export type Planted = {
  windows: StackWindow[];
  system1: StackLabeller;
  system2: StackLabeller;
  log: { s1: string[]; s2: Array<{ window: string; run: number; units: number[] }> };
};

export type PlantOptions = {
  /** Make system 1 throw on its k-th call (0-based) over all calls. */
  s1Throws?: (call: number, window: string) => boolean;
  /** Make a system 2 run throw. */
  s2Throws?: (window: string, run: number) => boolean;
  /** What system 2 answers for units without planted votes. */
  s2Default?: string;
};

export const keyOf = (window: string, n: number) => `${window}#${n}`;

/** Windows of `size` sentences each, and labellers that answer from the plan. */
export function plant(prose: Prose, plan: Plan, options: PlantOptions = {}): Planted {
  const windows: StackWindow[] = plan.windows.map((units, i) => ({
    id: `f${i}.md`,
    file: `f${i}.md`,
    units: units.map((_, k) => ({ n: k + 1, text: prose.next(), container: 'sentence' })),
  }));
  const planned = new Map<string, PlanUnit>();
  plan.windows.forEach((units, i) => {
    units.forEach((u, k) => {
      planned.set(keyOf(`f${i}.md`, k + 1), u);
    });
  });
  const log: Planted['log'] = { s1: [], s2: [] };
  let s1Calls = 0;
  const system1: StackLabeller = (window) => {
    const call = s1Calls;
    s1Calls += 1;
    log.s1.push(window.id);
    if (options.s1Throws?.(call, window.id)) throw new Error('system 1 is down');
    const answers: StackAnswer[] = [];
    for (const u of window.units) {
      const p = planned.get(keyOf(window.id, u.n));
      if (p) answers.push({ n: u.n, label: topOf(p.vec), probabilities: { ...p.vec } });
    }
    return answers;
  };
  const system2: StackLabeller = (window, context) => {
    log.s2.push({ window: window.id, run: context.run, units: window.units.map((u) => u.n) });
    if (options.s2Throws?.(window.id, context.run)) throw new Error('system 2 is down');
    const answers: StackAnswer[] = [];
    for (const u of window.units) {
      const p = planned.get(keyOf(window.id, u.n));
      const vote = p?.votes ? p.votes[context.run] : (options.s2Default ?? (p ? topOf(p.vec) : 'none'));
      if (vote === null || vote === undefined) continue;
      answers.push({ n: u.n, label: vote });
    }
    return answers;
  };
  return { windows, system1, system2, log };
}

export function stackOf(sut: PointerSut) {
  if (!sut.stack)
    throw new Problem('the binding of the reader offers no stack: the two-class stack is not reachable');
  return sut.stack;
}

export async function runStack(
  sut: PointerSut,
  planted: Planted,
  extra: Partial<StackRequest> = {},
): Promise<StackResult> {
  const windows = extra.windows ?? planted.windows;
  const res = await stackOf(sut).run({
    labels: LABELS,
    windows,
    system1: planted.system1,
    system2: planted.system2,
    ...extra,
  });
  // A run that succeeds answers for every unit it was given: a stack that returns nothing proves nothing.
  const given = windows.reduce((n, w) => n + w.units.length, 0);
  if (res.ok && res.units.length !== given) {
    throw new Problem(`the stack answered for ${res.units.length} of ${given} units`);
  }
  return res;
}

export function unitOf(res: StackResult, window: number, n: number): StackUnitResult {
  const hit = res.units.find((u) => u.window === `f${window}.md` && u.n === n);
  if (!hit) throw new Problem(`no result for unit ${n} of window f${window}.md`);
  return hit;
}

export const must = (res: StackResult): StackResult => {
  if (!res.ok) throw new Problem(`the stack failed: ${res.error ?? 'no message'}`);
  return res;
};

/** A different label from the given ones, drawn from the seeded stream. */
export function otherThan(prose: Prose, ...not: string[]): string {
  const pool = LABELS.filter((l) => !not.includes(l));
  return pool[Math.floor(prose.random() * pool.length)] as string;
}
