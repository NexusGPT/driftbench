import {
  exact,
  LABELS,
  must,
  otherThan,
  type PlanUnit,
  plant,
  runStack,
  topOf,
  unitOf,
  type Vec,
  vector,
} from '../../kit/stack-world';
import { Prose } from '../../kit/words';
import type { StackAnswer, StackLabeller, StackResult } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const pick = (p: Prose, n = 1): string[] => {
  const pool = [...LABELS];
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(pool.splice(Math.floor(p.random() * pool.length), 1)[0] as string);
  return out;
};
const rnd = (p: Prose, lo: number, hi: number) => lo + (hi - lo) * p.random();
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A unit at a chosen margin with a random top and second label; system 2 will say the top label three times. */
function unitAt(p: Prose, margin: number, votes?: Array<string | null>): PlanUnit {
  const [top, second] = pick(p, 2) as [string, string];
  return { vec: vector(top, second, margin), ...(votes ? { votes } : {}) };
}

const sentIds = (res: StackResult) =>
  res.units
    .filter((u) => u.sentToSystem2)
    .map((u) => `${u.window}#${u.n}`)
    .sort();

export const stackRuns: Record<string, Run> = {
  'margin-is-top-minus-second': async (ctx) => {
    const p = prose(ctx);
    const margins = Array.from({ length: 12 }, () => rnd(p, 0.05, 0.95));
    const units = margins.map((m) => unitAt(p, m));
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 0 }));
    for (const [i, m] of margins.entries()) {
      const u = unitOf(res, 0, i + 1);
      if (!near(u.margin, m)) return fail(`unit ${i + 1}: margin ${u.margin}, planted ${m}`);
      if (u.top !== topOf((units[i] as PlanUnit).vec)) return fail(`unit ${i + 1}: top label ${u.top}`);
    }
    return pass('12 margins equal the planted top minus second');
  },
  'margin-in-unit-interval': async (ctx) => {
    const p = prose(ctx);
    const units: PlanUnit[] = [];
    for (let i = 0; i < 30; i += 1) {
      const raw = LABELS.map(() => p.random() ** 3);
      const sum = raw.reduce((a, b) => a + b, 0);
      units.push({ vec: Object.fromEntries(LABELS.map((l, k) => [l, (raw[k] as number) / sum])) });
    }
    units.push({ vec: exact('rule', 'gate', 1, 0) });
    units.push({ vec: Object.fromEntries(LABELS.map((l) => [l, 1 / 6])) });
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 0 }));
    for (const u of res.units)
      if (u.margin === null || u.margin < 0 || u.margin > 1) return fail(`margin ${u.margin} outside [0, 1]`);
    if (!near(unitOf(res, 0, 31).margin, 1)) return fail('the one-hot vector does not give margin 1');
    if (!near(unitOf(res, 0, 32).margin, 0)) return fail('the uniform vector does not give margin 0');
    return pass('32 margins in range, one-hot 1, uniform 0');
  },
  'margin-tie-is-zero': async (ctx) => {
    const p = prose(ctx);
    const [a, b] = pick(p, 2) as [string, string];
    const w = plant(p, { windows: [[{ vec: exact(a, b, 0.4, 0.4) }]] });
    const v = (w.windows[0] as { id: string }).id;
    void v;
    // exact() leaves 0.2 unassigned: add it to a third label so the sum is 1
    const third = LABELS.find((l) => l !== a && l !== b) as string;
    const w2 = plant(p, { windows: [[{ vec: { ...exact(a, b, 0.4, 0.4), [third]: 0.2 } }]] });
    const res = must(await runStack(ctx.sut, w2));
    const u = unitOf(res, 0, 1);
    if (!near(u.margin, 0)) return fail(`margin ${u.margin}, expected 0`);
    return u.sentToSystem2
      ? pass('margin 0, sent to system 2')
      : fail('a unit with margin 0 stayed at system 1');
  },
  'vector-sum-error': async (ctx) => {
    const p = prose(ctx);
    for (const sum of [0.9, 1.2]) {
      const [a, b] = pick(p, 2) as [string, string];
      const vec: Vec = { ...Object.fromEntries(LABELS.map((l) => [l, 0])), [a]: sum - 0.3, [b]: 0.3 };
      const w = plant(p, { windows: [[{ vec }]] });
      const res = await runStack(ctx.sut, w);
      if (res.ok) return fail(`a vector summing to ${sum} was accepted`);
      if (!/sum|1\b/i.test(res.error ?? '')) return fail(`the error does not name the sum: ${res.error}`);
      if (res.units.some((u) => u.label !== null && u.route === 'system1'))
        return fail('a unit was accepted from the bad vector');
    }
    return pass('both bad sums refused with a message');
  },
  'vector-sum-tolerance': async (ctx) => {
    const p = prose(ctx);
    for (const sum of [1.009, 0.992]) {
      const [a, b] = pick(p, 2) as [string, string];
      const vec: Vec = { ...Object.fromEntries(LABELS.map((l) => [l, 0])), [a]: sum - 0.25, [b]: 0.25 };
      const w = plant(p, { windows: [[{ vec }]] });
      const res = await runStack(ctx.sut, w, { marginCut: 0 });
      if (!res.ok) return fail(`a vector summing to ${sum} was refused: ${res.error}`);
      if (!near(unitOf(res, 0, 1).margin, sum - 0.5)) return fail(`margin ${unitOf(res, 0, 1).margin}`);
    }
    return pass('1.009 and 0.992 accepted');
  },
  'accept-above-cut': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 20 }, () => {
      const u = unitAt(p, rnd(p, 0.7, 0.99));
      return {
        ...u,
        votes: [otherThan(p, topOf(u.vec)), otherThan(p, topOf(u.vec)), otherThan(p, topOf(u.vec))],
      };
    });
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 0.65 }));
    for (const [i, u] of units.entries()) {
      const r = unitOf(res, 0, i + 1);
      if (r.route !== 'system1' || r.label !== topOf(u.vec))
        return fail(`unit ${i + 1}: route ${r.route}, label ${r.label}`);
    }
    return w.log.s2.length === 0
      ? pass('20 units kept at system 1, system 2 never called')
      : fail(`${w.log.s2.length} system 2 calls`);
  },
  'margin-equal-to-cut-accepted': async (ctx) => {
    const p = prose(ctx);
    const [a, b] = pick(p, 2) as [string, string];
    const units: PlanUnit[] = [
      { vec: exact(a, b, 0.75, 0.25) },
      { vec: exact(a, b, 0.5 + 0.25 - 2 ** -11, 0.25 + 2 ** -11) },
    ];
    // second: margin 0.5 - 2^-10
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 0.5 }));
    if (unitOf(res, 0, 1).route !== 'system1') return fail('a margin equal to the cut was sent to system 2');
    return unitOf(res, 0, 2).sentToSystem2
      ? pass('0.5 accepted, just below sent')
      : fail('a margin just below the cut stayed at system 1');
  },
  'default-cut-is-065': async (ctx) => {
    const p = prose(ctx);
    const margins = [0.6, 0.64, 0.66, 0.7];
    const w = plant(p, { windows: [margins.map((m) => unitAt(p, m))] });
    const res = must(await runStack(ctx.sut, w));
    const sent = margins.map((_, i) => unitOf(res, 0, i + 1).sentToSystem2);
    return same(sent, [true, true, false, false])
      ? pass('0.60 and 0.64 sent, 0.66 and 0.70 kept')
      : fail(`sent flags ${JSON.stringify(sent)}`);
  },
  'unanimous-system2-accepted': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 10 }, () => {
      const [top, second, other] = pick(p, 3) as [string, string, string];
      return { vec: vector(top, second, rnd(p, 0.05, 0.5)), votes: [other, other, other], other };
    });
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w));
    for (const [i, u] of units.entries()) {
      const r = unitOf(res, 0, i + 1);
      if (r.label !== u.other || r.route !== 'system2')
        return fail(`unit ${i + 1}: label ${r.label}, route ${r.route}, expected ${u.other} at system2`);
    }
    return pass('10 unanimous labels accepted against system 1');
  },
  'any-difference-goes-to-person': async (ctx) => {
    const p = prose(ctx);
    const [a, b, c] = pick(p, 3) as [string, string, string];
    const votes = [
      [a, a, b],
      [a, b, a],
      [b, a, a],
      [a, b, c],
    ];
    const w = plant(p, { windows: [votes.map((v) => unitAt(p, rnd(p, 0.05, 0.5), v))] });
    const res = must(await runStack(ctx.sut, w));
    for (const [i, v] of votes.entries()) {
      const r = unitOf(res, 0, i + 1);
      if (r.route !== 'person' || r.label !== null)
        return fail(`votes ${v.join(',')}: route ${r.route}, label ${r.label}`);
      if (!same(r.votes, v))
        return fail(`the votes ${JSON.stringify(r.votes)} are not listed as ${JSON.stringify(v)}`);
    }
    return pass('four splits go to a person with their votes');
  },
  'unanimity-fuzz': async (ctx) => {
    const p = prose(ctx);
    const units: PlanUnit[] = [];
    const unanimous: boolean[] = [];
    for (let i = 0; i < 60; i += 1) {
      const l = pick(p, 3) as [string, string, string];
      const same3 = i % 2 === 0;
      const odd = Math.floor(p.random() * 3);
      const votes = same3 ? [l[0], l[0], l[0]] : [l[0], l[0], l[0]].map((v, k) => (k === odd ? l[1] : v));
      unanimous.push(same3);
      units.push(unitAt(p, rnd(p, 0.02, 0.6), votes));
    }
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w));
    for (const [i, u] of unanimous.entries()) {
      const r = unitOf(res, 0, i + 1);
      if (u !== (r.route === 'system2' && r.label !== null))
        return fail(`unit ${i + 1} (${u ? 'unanimous' : 'split'}): route ${r.route}`);
    }
    return pass('60 units: accepted exactly when the votes are equal');
  },
  'cut-zero-is-system1': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 40 }, () => unitAt(p, rnd(p, 0, 1)));
    const w = plant(p, { windows: [units.slice(0, 20), units.slice(20)] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 0 }));
    for (const [i, u] of units.entries()) {
      const r = unitOf(res, i < 20 ? 0 : 1, (i % 20) + 1);
      if (r.label !== topOf(u.vec) || r.route !== 'system1') return fail(`unit ${i}: ${r.route} ${r.label}`);
    }
    return w.log.s2.length === 0
      ? pass('40 labels equal system 1, no unsure, no system 2 call')
      : fail(`${w.log.s2.length} system 2 calls`);
  },
  'cut-one-sends-nearly-all': async (ctx) => {
    const p = prose(ctx);
    const units = [
      ...Array.from({ length: 30 }, () => unitAt(p, rnd(p, 0, 0.99))),
      { vec: exact('rule', 'gate', 1, 0) },
    ];
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { marginCut: 1 }));
    const sent = res.units.filter((u) => u.sentToSystem2).length;
    if (unitOf(res, 0, 31).sentToSystem2) return fail('the one-hot unit (margin 1) was sent');
    return sent === 30 ? pass('30 sent, the one-hot unit kept') : fail(`${sent} units sent, expected 30`);
  },
  'cut-monotone': async (ctx) => {
    const p = prose(ctx);
    const margins = Array.from({ length: 50 }, (_, i) => (i + 0.5) / 50 + (p.random() - 0.5) * 0.004);
    const w = plant(p, {
      windows: [margins.slice(0, 25).map((m) => unitAt(p, m)), margins.slice(25).map((m) => unitAt(p, m))],
    });
    let before: string[] = [];
    for (let c = 0; c <= 10; c += 1) {
      const cut = c / 10;
      const res = must(await runStack(ctx.sut, w, { marginCut: cut }));
      const sent = sentIds(res);
      const want = res.units
        .filter((u) => (u.margin as number) < cut)
        .map((u) => `${u.window}#${u.n}`)
        .sort();
      if (!same(sent, want)) return fail(`cut ${cut}: ${sent.length} sent, ${want.length} below the cut`);
      if (!before.every((id) => sent.includes(id)))
        return fail(`cut ${cut} sends fewer units than the cut before`);
      before = sent;
    }
    return pass('11 cuts, nested sets equal to the units below each cut');
  },
  'share-sends-lowest-margins': async (ctx) => {
    const p = prose(ctx);
    const margins = Array.from({ length: 40 }, (_, i) => 0.02 + (i * 0.95) / 40);
    const order = [...margins.keys()].sort(() => p.random() - 0.5);
    const w = plant(p, {
      windows: [
        order.slice(0, 20).map((i) => unitAt(p, margins[i] as number)),
        order.slice(20).map((i) => unitAt(p, margins[i] as number)),
      ],
    });
    const res = must(await runStack(ctx.sut, w, { shareToSystem2: 0.25 }));
    const sent = res.units.filter((u) => u.sentToSystem2);
    if (sent.length !== 10) return fail(`${sent.length} units sent, expected 10`);
    const worst = Math.max(...sent.map((u) => u.margin as number));
    const best = Math.min(...res.units.filter((u) => !u.sentToSystem2).map((u) => u.margin as number));
    return worst < best
      ? pass('the ten lowest margins were sent')
      : fail(`a sent margin ${worst} is above a kept margin ${best}`);
  },
  'share-equals-cut': async (ctx) => {
    const p = prose(ctx);
    const margins = Array.from({ length: 40 }, (_, i) => 0.02 + (i * 0.95) / 40);
    const order = [...margins.keys()].sort(() => p.random() - 0.5);
    const w = plant(p, { windows: [order.map((i) => unitAt(p, margins[i] as number))] });
    const cut = ((margins[11] as number) + (margins[12] as number)) / 2;
    const a = must(await runStack(ctx.sut, w, { marginCut: cut }));
    const b = must(await runStack(ctx.sut, w, { shareToSystem2: 0.3 }));
    return same(sentIds(a), sentIds(b)) && sentIds(a).length === 12
      ? pass('12 units sent by the cut and by the share')
      : fail(`${sentIds(a).length} sent by the cut, ${sentIds(b).length} by the share`);
  },
  'require-agreement-default-off': async (ctx) => {
    const p = prose(ctx);
    const [top, second, other] = pick(p, 3) as [string, string, string];
    const w = plant(p, { windows: [[{ vec: vector(top, second, 0.2), votes: [other, other, other] }]] });
    const r = unitOf(must(await runStack(ctx.sut, w)), 0, 1);
    return r.label === other && r.route === 'system2'
      ? pass('accepted with the system 2 label')
      : fail(`route ${r.route}, label ${r.label}`);
  },
  'require-agreement-on': async (ctx) => {
    const p = prose(ctx);
    const units: PlanUnit[] = [];
    const agree: boolean[] = [];
    for (let i = 0; i < 12; i += 1) {
      const [top, second, other] = pick(p, 3) as [string, string, string];
      const ok = i % 2 === 0;
      agree.push(ok);
      const v = ok ? top : other;
      units.push({ vec: vector(top, second, rnd(p, 0.05, 0.5)), votes: [v, v, v] });
    }
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w, { requireAgreement: true }));
    for (const [i, ok] of agree.entries()) {
      const r = unitOf(res, 0, i + 1);
      if (ok ? r.route !== 'system2' : r.route !== 'person')
        return fail(`unit ${i + 1} (${ok ? 'agrees' : 'differs'}): route ${r.route}`);
    }
    return pass('agreeing units accepted, differing units to a person');
  },
  'require-agreement-subset': async (ctx) => {
    const p = prose(ctx);
    const units: PlanUnit[] = [];
    for (let i = 0; i < 60; i += 1) {
      const [top, second, other] = pick(p, 3) as [string, string, string];
      const m = i % 3 === 0 ? rnd(p, 0.7, 0.99) : rnd(p, 0.02, 0.6);
      const v = p.random() < 0.5 ? top : other;
      const votes = p.random() < 0.8 ? [v, v, v] : [v, other, top];
      units.push({ vec: vector(top, second, m), votes });
    }
    const w = plant(p, { windows: [units.slice(0, 30), units.slice(30)] });
    const off = must(await runStack(ctx.sut, w, { requireAgreement: false }));
    const on = must(await runStack(ctx.sut, w, { requireAgreement: true }));
    let narrowed = 0;
    for (const u of on.units) {
      if (u.label === null) {
        if (off.units.find((o) => o.window === u.window && o.n === u.n)?.label !== null) narrowed += 1;
        continue;
      }
      const o = off.units.find((x) => x.window === u.window && x.n === u.n);
      if (!o || o.label !== u.label)
        return fail(`unit ${u.window}#${u.n} is accepted with the setting on and differs without`);
    }
    return narrowed > 0
      ? pass(`${narrowed} units narrowed, none added`)
      : fail('the setting changed nothing on a plan with disagreeing units');
  },
  'moving-a-unit-changes-only-it': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 20 }, () => unitAt(p, rnd(p, 0.02, 0.99)));
    const k = 7;
    const above = units.map((u) => u);
    above[k] = {
      ...(units[k] as PlanUnit),
      vec: vector(topOf((units[k] as PlanUnit).vec), otherThan(p, topOf((units[k] as PlanUnit).vec)), 0.9),
    };
    const below = units.map((u) => u);
    below[k] = {
      ...(units[k] as PlanUnit),
      vec: vector(topOf((units[k] as PlanUnit).vec), otherThan(p, topOf((units[k] as PlanUnit).vec)), 0.1),
    };
    const wa = plant(new Prose(ctx.seed, ctx.id), { windows: [above] });
    const wb = plant(new Prose(ctx.seed, ctx.id), { windows: [below] });
    const a = must(await runStack(ctx.sut, wa));
    const b = must(await runStack(ctx.sut, wb));
    if (unitOf(a, 0, k + 1).sentToSystem2 || !unitOf(b, 0, k + 1).sentToSystem2)
      return fail('the moved unit did not change its route');
    for (let i = 1; i <= 20; i += 1) {
      if (i === k + 1) continue;
      const x = unitOf(a, 0, i);
      const y = unitOf(b, 0, i);
      if (!same({ ...x, margin: 0 }, { ...y, margin: 0 }))
        return fail(`unit ${i} differs between the two runs`);
    }
    return pass('19 other units identical');
  },
  'whole-window-context': async (ctx) => {
    const p = prose(ctx);
    const units: PlanUnit[] = Array.from({ length: 12 }, (_, i) => {
      const [top, second, wrong] = pick(p, 3) as [string, string, string];
      return i < 6
        ? { vec: vector(top, second, rnd(p, 0.02, 0.5)), votes: [top, top, top] }
        : { vec: vector(top, second, rnd(p, 0.8, 0.99)), votes: [wrong, wrong, wrong] };
    });
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w));
    for (const call of w.log.s2)
      if (call.units.length !== 12) return fail(`a system 2 call carried ${call.units.length} units of 12`);
    if (w.log.s2.length === 0) return fail('system 2 was not called');
    for (let i = 7; i <= 12; i += 1) {
      const r = unitOf(res, 0, i);
      if (r.route !== 'system1' || r.label !== topOf((units[i - 1] as PlanUnit).vec))
        return fail(`unit ${i} above the cut: ${r.route} ${r.label}`);
    }
    return pass('whole file sent, system 2 labels above the cut ignored');
  },
  'three-runs-same-windows': async (ctx) => {
    const p = prose(ctx);
    const w = plant(p, {
      windows: [
        Array.from({ length: 8 }, () => unitAt(p, rnd(p, 0.02, 0.5))),
        Array.from({ length: 6 }, () => unitAt(p, rnd(p, 0.02, 0.5))),
      ],
    });
    must(await runStack(ctx.sut, w));
    for (const id of ['f0.md', 'f1.md']) {
      const calls = w.log.s2.filter((c) => c.window === id);
      if (calls.length !== 3) return fail(`${calls.length} system 2 calls for ${id}, expected 3`);
      if (!same(calls.map((c) => c.run).sort(), [0, 1, 2]))
        return fail(`the runs of ${id} are ${calls.map((c) => c.run).join(',')}`);
      if (new Set(calls.map((c) => c.units.join(','))).size !== 1)
        return fail(`the three runs of ${id} carried different units`);
    }
    return pass('3 runs per file over the same units');
  },
  'one-call-per-file-per-run': async (ctx) => {
    const p = prose(ctx);
    const mixed = (below: number, n: number) =>
      Array.from({ length: n }, (_, i) => unitAt(p, i < below ? rnd(p, 0.02, 0.5) : rnd(p, 0.8, 0.99)));
    const w = plant(p, { windows: [mixed(1, 20), mixed(20, 20), mixed(0, 20)] });
    must(await runStack(ctx.sut, w));
    const per = (id: string) => w.log.s2.filter((c) => c.window === id).length;
    return per('f0.md') === 3 && per('f1.md') === 3 && per('f2.md') === 0
      ? pass('3, 3 and 0 calls')
      : fail(`calls per file: ${per('f0.md')}, ${per('f1.md')}, ${per('f2.md')}; expected 3, 3, 0`);
  },
  'system1-retry-once': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 6 }, () => unitAt(p, rnd(p, 0.7, 0.99)));
    const w = plant(p, { windows: [units] }, { s1Throws: (call) => call === 0 });
    const res = must(await runStack(ctx.sut, w));
    if (w.log.s1.length !== 2) return fail(`${w.log.s1.length} system 1 calls, expected 2`);
    return res.units.every((u) => u.route === 'system1')
      ? pass('accepted after one retry')
      : fail('the units were not accepted at system 1 after the retry');
  },
  'system1-fails-twice': async (ctx) => {
    const p = prose(ctx);
    const high = () => Array.from({ length: 6 }, () => unitAt(p, rnd(p, 0.8, 0.99)));
    const w = plant(p, { windows: [high(), high()] }, { s1Throws: (_c, win) => win === 'f0.md' });
    const res = must(await runStack(ctx.sut, w));
    for (let n = 1; n <= 6; n += 1) {
      if (!unitOf(res, 0, n).sentToSystem2)
        return fail(`unit ${n} of the failed window was not sent to system 2`);
      if (unitOf(res, 1, n).sentToSystem2) return fail(`unit ${n} of the good window was sent to system 2`);
    }
    return w.log.s1.filter((x) => x === 'f0.md').length === 2
      ? pass('failed window all sent, the other by margin')
      : fail('system 1 was not called exactly twice for the failed window');
  },
  'system2-run-missing': async (ctx) => {
    const p = prose(ctx);
    const [a, b] = pick(p, 2) as [string, string];
    const units: PlanUnit[] = [
      { vec: unitAt(p, 0.1).vec, votes: [a, a, a] },
      { vec: unitAt(p, 0.1).vec, votes: [a, a, null] },
      { vec: unitAt(p, 0.1).vec, votes: [a, a, 'not-a-label'] },
    ];
    const w = plant(p, { windows: [units] });
    const res = must(await runStack(ctx.sut, w));
    void b;
    for (let n = 2; n <= 3; n += 1) {
      const r = unitOf(res, 0, n);
      if (r.route !== 'person' || r.label !== null)
        return fail(`unit ${n}: route ${r.route}, label ${r.label}`);
    }
    const thrown = plant(
      prose(ctx),
      { windows: [[unitAt(prose(ctx), 0.1)]] },
      { s2Throws: (_w, run) => run === 1 },
    );
    const res2 = must(await runStack(ctx.sut, thrown));
    const r = unitOf(res2, 0, 1);
    return r.route === 'person'
      ? pass('missing, malformed and thrown runs all vote against')
      : fail(`a run that threw still gave route ${r.route}`);
  },
  'no-unlabelled-accept': async (ctx) => {
    const p = prose(ctx);
    const [a] = pick(p) as [string];
    const base: PlanUnit[] = Array.from({ length: 5 }, () => unitAt(p, rnd(p, 0.8, 0.99)));
    const w = plant(p, { windows: [base] });
    const withHole: StackLabeller = async (window, c) => {
      const answers = (await w.system1(window, c)) as StackAnswer[];
      return answers.filter((x) => x.n !== 3);
    };
    const gate: PlanUnit['votes'] = [a, a, a];
    const sys2: StackLabeller = async (window, c) => {
      const answers = (await w.system2(window, c)) as StackAnswer[];
      return answers.map((x) => (x.n === 3 ? { n: 3, label: a } : x));
    };
    const res = must(await runStack(ctx.sut, w, { system1: withHole, system2: sys2 }));
    const u = unitOf(res, 0, 3);
    if (u.route !== 'system2' || u.label !== a)
      return fail(`unit with no vector: route ${u.route}, label ${u.label}`);
    const mute: StackLabeller = async (window, c) =>
      ((await w.system2(window, c)) as StackAnswer[]).filter((x) => x.n !== 3);
    const res2 = must(await runStack(ctx.sut, w, { system1: withHole, system2: mute }));
    void gate;
    const v = unitOf(res2, 0, 3);
    return v.route === 'person' && v.label === null
      ? pass('accepted at system 2 or sent to a person, never unlabelled')
      : fail(`no answer anywhere: route ${v.route}, label ${v.label}`);
  },
  'persons-list-exact': async (ctx) => {
    const p = prose(ctx);
    const [a, b] = pick(p, 2) as [string, string];
    const units: PlanUnit[] = [
      ...Array.from({ length: 20 }, () => unitAt(p, rnd(p, 0.02, 0.5), [a, b, a])),
      ...Array.from({ length: 20 }, () => unitAt(p, rnd(p, 0.02, 0.5), [a, a, a])),
      ...Array.from({ length: 40 }, () => unitAt(p, rnd(p, 0.7, 0.99))),
    ];
    const w = plant(p, { windows: [units.slice(0, 40), units.slice(40)] });
    const res = must(await runStack(ctx.sut, w));
    const persons = res.units.filter((u) => u.route === 'person');
    if (persons.length !== 20) return fail(`${persons.length} units to a person, expected 20`);
    const bad = persons.find((u) => u.votes.join(',') !== [a, b, a].join(','));
    return bad
      ? fail(`a unit sent to a person has votes ${bad.votes.join(',')}`)
      : pass('exactly the 20 split units');
  },
  'user-labeller-as-system2': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 8 }, () => unitAt(p, rnd(p, 0.02, 0.5)));
    const w = plant(p, { windows: [units] });
    const fixed: StackLabeller = (window) =>
      window.units.map((u) => ({ n: u.n, label: LABELS[u.n % LABELS.length] as string }));
    const res = must(await runStack(ctx.sut, w, { system2: fixed }));
    for (let n = 1; n <= 8; n += 1) {
      const r = unitOf(res, 0, n);
      if (r.label !== LABELS[n % LABELS.length] || r.route !== 'system2')
        return fail(`unit ${n}: ${r.route} ${r.label}`);
    }
    return pass('a plain function accepted as system 2');
  },
  'user-labeller-not-system1': async (ctx) => {
    const p = prose(ctx);
    const w = plant(p, { windows: [Array.from({ length: 4 }, () => unitAt(p, 0.5))] });
    const labelsOnly: StackLabeller = (window) => window.units.map((u) => ({ n: u.n, label: 'rule' }));
    const res = await runStack(ctx.sut, w, { system1: labelsOnly });
    if (res.ok) return fail('a system 1 with no probabilities was accepted');
    return /probabilit/i.test(res.error ?? '')
      ? pass('refused, probabilities named')
      : fail(`the message does not name the probabilities: ${res.error}`);
  },
  'user-labeller-voting': async (ctx) => {
    const p = prose(ctx);
    const units = Array.from({ length: 10 }, () => unitAt(p, rnd(p, 0.02, 0.5)));
    const w = plant(p, { windows: [units] });
    const flip: StackLabeller = (window, c) =>
      window.units.map((u) => ({
        n: u.n,
        label: u.n % 2 === 0 ? (LABELS[(c.run + u.n) % LABELS.length] as string) : 'gate',
      }));
    const res = must(await runStack(ctx.sut, w, { system2: flip }));
    for (let n = 1; n <= 10; n += 1) {
      const r = unitOf(res, 0, n);
      if (n % 2 === 0 ? r.route !== 'person' : r.label !== 'gate')
        return fail(`unit ${n}: ${r.route} ${r.label}`);
    }
    return pass('flipping units to a person, stable units accepted');
  },
  'user-labeller-as-system1': async (ctx) => {
    const p = prose(ctx);
    const w = plant(p, { windows: [Array.from({ length: 10 }, () => unitAt(p, 0.5))] });
    const margins = [0.1, 0.3, 0.64, 0.65, 0.9];
    const mine: StackLabeller = (window) =>
      window.units.map((u) => {
        const m = margins[(u.n - 1) % margins.length] as number;
        return { n: u.n, label: 'rule', probabilities: vector('rule', 'gate', m) };
      });
    const res = must(await runStack(ctx.sut, w, { system1: mine }));
    for (let n = 1; n <= 10; n += 1) {
      const m = margins[(n - 1) % margins.length] as number;
      const r = unitOf(res, 0, n);
      if (r.sentToSystem2 !== m < 0.65 || !near(r.margin, m))
        return fail(`unit ${n}: margin ${r.margin}, sent ${r.sentToSystem2}`);
    }
    return pass('routed by the hand-written margins');
  },
  'empty-input': async (ctx) => {
    const p = prose(ctx);
    const w = plant(p, { windows: [] });
    const res = await runStack(ctx.sut, w);
    if (!res.ok || res.units.length !== 0) return fail(`empty list: ok ${res.ok}, ${res.units.length} units`);
    const w2 = plant(p, { windows: [[]] });
    const res2 = await runStack(ctx.sut, w2);
    if (!res2.ok || res2.units.length !== 0)
      return fail(`empty window: ok ${res2.ok}, ${res2.units.length} units`);
    return w.log.s2.length + w2.log.s2.length === 0
      ? pass('empty results, no system 2 call')
      : fail('system 2 was called with nothing to label');
  },
  deterministic: async (ctx) => {
    const p = prose(ctx);
    const [a, b] = pick(p, 2) as [string, string];
    const units = Array.from({ length: 30 }, (_, i) =>
      unitAt(p, rnd(p, 0.02, 0.99), i % 3 === 0 ? [a, b, a] : undefined),
    );
    const w = plant(p, { windows: [units.slice(0, 15), units.slice(15)] });
    const x = await runStack(ctx.sut, w);
    const y = await runStack(
      ctx.sut,
      plant(new Prose(ctx.seed, ctx.id), { windows: [units.slice(0, 15), units.slice(15)] }),
    );
    void y;
    const z = await runStack(ctx.sut, w);
    return same(x.units, z.units)
      ? pass('two runs, one result')
      : fail('two runs on the same answers differ');
  },
  'estate-reference-outcome': async (ctx) => {
    const p = prose(ctx);
    const sizes = [51, 51, 51, 51, 51, 51, 51, 54, 54];
    const total = sizes.reduce((a, b) => a + b, 0);
    // Which units are confident (279), unanimous and right (149) or split (37), spread over every file.
    const kinds: Array<'confident' | 'unanimous' | 'split'> = [
      ...Array(279).fill('confident'),
      ...Array(149).fill('unanimous'),
      ...Array(37).fill('split'),
    ];
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(p.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j] as 'confident', kinds[i] as 'confident'];
    }
    let at = 0;
    const truth: string[] = [];
    const windows = sizes.map((size) =>
      Array.from({ length: size }, () => {
        const kind = kinds[at] as 'confident' | 'unanimous' | 'split';
        at += 1;
        const [t, other, third] = pick(p, 3) as [string, string, string];
        truth.push(t);
        if (kind === 'confident') return { vec: vector(t, other, rnd(p, 0.7, 0.99)) };
        // below the cut, system 1 is often wrong: its top is another label
        const sysTop = p.random() < 0.4 ? other : t;
        const vec = vector(sysTop, sysTop === t ? other : t, rnd(p, 0.02, 0.6));
        return kind === 'unanimous' ? { vec, votes: [t, t, t] } : { vec, votes: [t, third, t] };
      }),
    );
    const w = plant(p, { windows });
    const res = must(await runStack(ctx.sut, w));
    const count = (route: string) => res.units.filter((u) => u.route === route).length;
    if (res.units.length !== total) return fail(`${res.units.length} units, expected ${total}`);
    if (count('system1') !== 279 || count('system2') !== 149 || count('person') !== 37)
      return fail(
        `routes: system1 ${count('system1')}, system2 ${count('system2')}, person ${count('person')}; expected 279, 149, 37`,
      );
    let wrong = 0;
    let k = 0;
    for (const [wi, size] of sizes.entries()) {
      for (let n = 1; n <= size; n += 1) {
        const u = unitOf(res, wi, n);
        if (u.label !== null && u.label !== truth[k]) wrong += 1;
        k += 1;
      }
    }
    if (wrong > 0) return fail(`${wrong} accepted units carry a wrong label`);
    if (res.system1Calls !== 9 || w.log.s2.length !== 27)
      return fail(`calls: system 1 ${res.system1Calls}, system 2 ${w.log.s2.length}; expected 9 and 27`);
    return pass('279 + 149 + 37 units, all accepted labels right, 9 + 27 calls');
  },
};
