import type {
  StackAnswer,
  StackApi,
  StackRequest,
  StackResult,
  StackUnitResult,
  StackWindow,
} from '../../../src/ladders/pointer/sut/port';

/** The reference two-class stack, written from the stack specification, sections 2 to 8. */

const DEFAULT_CUT = 0.65;
const SUM_TOLERANCE = 0.01;

type Vector = Record<string, number>;

const fail = (error: string, units: StackUnitResult[] = []): StackResult => ({
  ok: false,
  error,
  units,
  system1Calls: 0,
  system2Calls: [],
});

function marginOf(v: Vector): { top: string; margin: number } {
  const sorted = Object.entries(v).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { top: sorted[0]?.[0] as string, margin: (sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0) };
}

async function callSystem1(
  request: StackRequest,
  window: StackWindow,
  counter: { n: number },
): Promise<StackAnswer[] | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    counter.n += 1;
    try {
      return await request.system1(window, { role: 'system1', run: 0, labels: request.labels });
    } catch {
      // retried once, then the window counts as below the cut
    }
  }
  return undefined;
}

export const referenceStack: StackApi = {
  async run(request: StackRequest): Promise<StackResult> {
    const runs = request.runs ?? 3;
    const counter = { n: 0 };
    type Entry = { window: StackWindow; n: number; top: string | null; margin: number | null };
    const entries: Entry[] = [];
    for (const window of request.windows) {
      const answers = await callSystem1(request, window, counter);
      const byN = new Map<number, StackAnswer>();
      for (const a of answers ?? []) byN.set(a.n, a);
      for (const unit of window.units) {
        const a = byN.get(unit.n);
        if (!a) {
          entries.push({ window, n: unit.n, top: null, margin: null });
          continue;
        }
        if (!a.probabilities)
          return fail(
            'system 1 must return the probabilities of every label for a unit; a label only is not enough',
          );
        const values = Object.values(a.probabilities);
        const sum = values.reduce((x, y) => x + y, 0);
        if (Math.abs(sum - 1) > SUM_TOLERANCE)
          return fail(`the probabilities of unit ${unit.n} in ${window.id} sum to ${sum}, not 1`);
        if (Object.keys(a.probabilities).some((l) => !request.labels.includes(l)))
          return fail(`unit ${unit.n} has a probability for a label outside the set`);
        const { top, margin } = marginOf(a.probabilities);
        entries.push({ window, n: unit.n, top, margin });
      }
    }
    const sent = new Set<Entry>();
    if (request.shareToSystem2 !== undefined) {
      const count = Math.round(request.shareToSystem2 * entries.length);
      const order = [...entries].sort((a, b) => (a.margin ?? -1) - (b.margin ?? -1));
      for (const e of order.slice(0, count)) sent.add(e);
    } else {
      const cut = request.marginCut ?? DEFAULT_CUT;
      for (const e of entries) if (e.margin === null || e.margin < cut) sent.add(e);
    }
    const votes = new Map<Entry, Array<string | null>>();
    const calls: StackResult['system2Calls'] = [];
    for (const window of request.windows) {
      const mine = entries.filter((e) => e.window === window && sent.has(e));
      if (mine.length === 0) continue;
      for (let run = 0; run < runs; run += 1) {
        calls.push({ window: window.id, run, units: window.units.map((u) => u.n) });
        let answers: StackAnswer[] | undefined;
        try {
          answers = await request.system2(window, { role: 'system2', run, labels: request.labels });
        } catch {
          answers = undefined;
        }
        const byN = new Map<number, string>();
        for (const a of answers ?? []) if (request.labels.includes(a.label)) byN.set(a.n, a.label);
        for (const e of mine) {
          const list = votes.get(e) ?? [];
          list.push(byN.get(e.n) ?? null);
          votes.set(e, list);
        }
      }
    }
    const units: StackUnitResult[] = entries.map((e) => {
      const v = votes.get(e) ?? [];
      const base = {
        window: e.window.id,
        n: e.n,
        top: e.top,
        margin: e.margin,
        sentToSystem2: sent.has(e),
        votes: v,
      };
      if (!sent.has(e)) return { ...base, label: e.top, route: 'system1' as const };
      const first = v[0];
      const unanimous =
        v.length === runs && first !== null && first !== undefined && v.every((x) => x === first);
      if (!unanimous) return { ...base, label: null, route: 'person' as const };
      if (request.requireAgreement && first !== e.top)
        return { ...base, label: null, route: 'person' as const };
      return { ...base, label: first, route: 'system2' as const };
    });
    return { ok: true, units, system1Calls: counter.n, system2Calls: calls };
  },
};
