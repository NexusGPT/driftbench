import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pointer as shipped } from '@agent-nexus/driftbench-estate';
import type { Tier } from '../../../ladder';
import {
  DEFECTS,
  type Defect,
  type FileRule,
  rngOf,
  seededAnswer,
  seededChoice,
  seededGold,
  seededLabelFile,
  seededLabellingHash,
  seededRecording,
  seededSetHash,
  seededSingle,
  seededStack,
  seededUnits,
  seededYesNo,
} from './pointer-seeded';

/**
 * The pointer labellers of packages/estate/src/pointer, judged like judges (docs/validators.md section 12):
 * the answer checks, the label-set hash, the yes or no and choice readers, the stack that decides between a
 * system 1 and a system 2 labeller, the cassette key and a gold set through the whole stack. No live model:
 * every labeller here is a table. The expected values come from `fixtures/judges/pointer.json`, made by
 * `make_pointer.py` from the documented rules with the standard library only.
 *
 * `DRIFTBENCH_POINTER_IMPL` names another build of the module (its `index.ts`), for a pilot on a degraded copy.
 */

export type PointerImpl = typeof shipped;
export const POINTER_FIXTURES = 'packages/validators/fixtures/judges/pointer.json';
export const POINTER_FAMILIES = [
  'units',
  'set-hash',
  'answer',
  'label-file',
  'yes-no',
  'choice',
  'stack',
  'recording',
  'gold-set',
  'source',
] as const;
export type PointerFamily = (typeof POINTER_FAMILIES)[number];

export type PointerItem = {
  id: string;
  family: PointerFamily;
  tier: Tier;
  cause: string;
  component: string;
  /** Returns the misses; an empty list passes. */
  run(impl: PointerImpl, fixtures: Fixtures, seed: number, root: string): Promise<string[]> | string[];
};

type Json = any;
type Fixtures = Record<string, any[]> & { provenance?: unknown };

let cached: { path: string; value: Fixtures } | undefined;
export function pointerFixtures(root: string): Fixtures {
  const path = join(root, POINTER_FIXTURES);
  if (cached?.path !== path) cached = { path, value: JSON.parse(readFileSync(path, 'utf8')) as Fixtures };
  return cached.value;
}

export async function loadPointerImpl(): Promise<PointerImpl> {
  const path = process.env.DRIFTBENCH_POINTER_IMPL;
  if (!path) return shipped;
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>;
  return (loaded.pointer ?? loaded) as PointerImpl;
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v,
  );
const same = (a: unknown, b: unknown): boolean => show(a) === show(b);
const near = (a: number, b: number, tol = 1e-12): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const guard = <T>(label: string, fn: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: fn() };
  } catch (cause) {
    return {
      ok: false,
      error: `${label} threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
    };
  }
};

const FILE = {
  labels: 'packages/estate/src/pointer/labels.ts',
  yesno: 'packages/estate/src/pointer/yesno.ts',
  stack: 'packages/estate/src/pointer/stack.ts',
  cassette: 'packages/estate/src/pointer/cassette.ts',
  scan: 'packages/estate/src/pointer/scan.ts',
};

// ---------------------------------------------------------------------------------------------- checkers
const labelOf = (name: string) => ({ name, description: `The ${name} label.` });

type Check = (impl: PointerImpl, cases: Json[]) => string[] | Promise<string[]>;

const expandCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard(`expandUnits(${show(c.text)})`, () => impl.expandUnits(c.text));
    if (!got.ok) misses.push(got.error);
    else if (!same(got.value ?? null, c.expect))
      misses.push(`expandUnits(${show(c.text)}) gave ${show(got.value ?? null)}, expected ${show(c.expect)}`);
  }
  return misses;
};

const hashValueCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard('setHash', () => impl.setHash(c.set));
    if (!got.ok) misses.push(got.error);
    else if (got.value !== c.expect)
      misses.push(
        `setHash of the set ${c.set.set} gave ${got.value}, expected ${c.expect} (sha256 of the sorted-key compact JSON, first 16 hex characters)`,
      );
  }
  return misses;
};

const hashPairsCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const a = guard('setHash a', () => impl.setHash(c.a));
    const b = guard('setHash b', () => impl.setHash(c.b));
    if (!a.ok) misses.push(a.error);
    else if (!b.ok) misses.push(b.error);
    else if ((a.value === b.value) !== c.same)
      misses.push(`${c.why}: the hashes ${c.same ? 'differ' : 'are equal'} (${a.value}, ${b.value})`);
  }
  return misses;
};

const hashIsolatedCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard('setHash', () => c.sets.map((s: Json) => impl.setHash(s)));
    if (!got.ok) misses.push(got.error);
    else {
      const before = got.value as string[];
      const edited = structuredClone(c.sets) as Json[];
      edited[c.edit.set].labels[c.edit.label].description = c.edit.description;
      const after = edited.map((s) => impl.setHash(s));
      for (const i of c.unchanged)
        if (before[i] !== after[i]) misses.push(`editing set ${c.edit.set} changed the hash of set ${i}`);
      for (const i of c.changed)
        if (before[i] === after[i]) misses.push(`editing a label of set ${i} did not change its hash`);
      if (!same(after, c.expect))
        misses.push(`the hashes after the edit are ${show(after)}, expected ${show(c.expect)}`);
    }
  }
  return misses;
};

function answerCheck(keep: (c: Json) => boolean): Check {
  return (impl, cases) => {
    const misses: string[] = [];
    for (const c of cases) {
      if (!keep(c)) continue;
      const got = guard(`checkAnswer ${c.name}`, () =>
        impl.checkAnswer(c.set, c.window, structuredClone(c.answer)),
      );
      if (!got.ok) {
        misses.push(got.error);
        continue;
      }
      const r = got.value;
      const accepted = Object.fromEntries(
        [...r.accepted.entries()].sort((x, y) => x[0] - y[0]).map(([n, v]) => [String(n), v]),
      );
      const covered = [...r.covered].sort((x, y) => x - y);
      if (r.refusals.length !== c.expect.refusals.length) {
        misses.push(
          `${c.name}: ${r.refusals.length} refusals ${show(r.refusals)}, expected ${c.expect.refusals.length}, one per refused entry`,
        );
      } else {
        r.refusals.forEach((message: string, i: number) => {
          const must = c.expect.mentions[i] as string[];
          if (!must.some((part) => message.includes(part)))
            misses.push(
              `${c.name}: the refusal "${message}" must name the part of the answer it refuses: ${must.map((part) => show(part)).join(' or ')}`,
            );
        });
      }
      if (!same(accepted, c.expect.accepted))
        misses.push(`${c.name}: accepted ${show(accepted)}, expected ${show(c.expect.accepted)}`);
      if (!same(covered, c.expect.covered))
        misses.push(`${c.name}: covered ${show(covered)}, expected ${show(c.expect.covered)}`);
    }
    return misses;
  };
}

const parseValidCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard(`parseLabelSets ${c.name}`, () => impl.parseLabelSets(c.text));
    if (!got.ok) misses.push(got.error);
    else if (!got.value.ok)
      misses.push(`${c.name}: refused with "${got.value.message}", expected ${c.sets} set(s)`);
    else if (
      got.value.sets.length !== c.sets ||
      !same(
        got.value.sets.map((s) => s.labels.length),
        c.labels,
      )
    )
      misses.push(
        `${c.name}: read ${got.value.sets.length} set(s) with ${show(got.value.sets.map((s) => s.labels.length))} labels, expected ${c.sets} with ${show(c.labels)}`,
      );
  }
  return misses;
};

function parseInvalidCheck(names: readonly string[]): Check {
  return (impl, cases) => {
    const misses: string[] = [];
    for (const c of cases) {
      if (!names.includes(c.name)) continue;
      const got = guard(`parseLabelSets ${c.name}`, () => impl.parseLabelSets(c.text));
      if (!got.ok) misses.push(got.error);
      else if (got.value.ok) misses.push(`${c.name}: accepted a file that must be refused`);
      else if (!got.value.message.toLowerCase().includes(String(c.mentions).toLowerCase()))
        misses.push(`${c.name}: refused with "${got.value.message}", which does not mention "${c.mentions}"`);
    }
    return misses;
  };
}

const askedCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard(`askedLabels ${c.name}`, () => impl.askedLabels(c.set, c.skip).map((l) => l.name));
    if (c.expect === 'error') {
      if (got.ok) misses.push(`${c.name}: asked ${show(got.value)}, expected a refusal`);
      else if (!/LabelerConfigError/.test(got.error))
        misses.push(`${c.name}: ${got.error}, expected a LabelerConfigError`);
    } else if (!got.ok) misses.push(got.error);
    else if (!same(got.value, c.expect))
      misses.push(`${c.name}: asked ${show(got.value)}, expected ${show(c.expect)}`);
  }
  return misses;
};

const answerOf = (probabilities: Record<string, unknown>) => ({
  probabilities,
  returnedModel: 'planted',
  stopReason: 'answered',
  usage: { input: 1, output: 1 },
});

function yesNoCheck(names: readonly string[]): Check {
  return (impl, cases) => {
    const misses: string[] = [];
    for (const c of cases) {
      if (!names.includes(c.name)) continue;
      const got = guard(`yesNoOpinions ${c.name}`, () =>
        impl.yesNoOpinions(
          answerOf(c.probabilities) as never,
          c.window,
          c.asked.map(labelOf) as never,
          c.threshold,
        ),
      );
      if (!got.ok) {
        misses.push(got.error);
        continue;
      }
      const byUnit = Object.fromEntries(
        [...got.value.byUnit.entries()].map(([index, o]) => [String(index), o.label]),
      );
      if (!same(byUnit, c.expect))
        misses.push(`${c.name}: opinions ${show(byUnit)}, expected ${show(c.expect)}`);
    }
    return misses;
  };
}

function choiceCheck(names: readonly string[]): Check {
  return (impl, cases) => {
    const misses: string[] = [];
    for (const c of cases) {
      if (!names.includes(c.name)) continue;
      const got = guard(`choiceOpinions ${c.name}`, () =>
        impl.choiceOpinions(answerOf(c.probabilities) as never, c.window, c.asked.map(labelOf) as never),
      );
      if (!got.ok) {
        misses.push(got.error);
        continue;
      }
      const byUnit = Object.fromEntries(
        [...got.value.byUnit.entries()].map(([index, o]) => [
          String(index),
          { label: o.label, probabilities: o.probabilities },
        ]),
      );
      if (!same(Object.keys(byUnit), Object.keys(c.expect.byUnit)))
        misses.push(
          `${c.name}: opinions for units ${show(Object.keys(byUnit))}, expected ${show(Object.keys(c.expect.byUnit))}`,
        );
      for (const [index, want] of Object.entries(c.expect.byUnit) as Array<[string, Json]>) {
        if (byUnit[index]?.label !== want.label)
          misses.push(`${c.name}: unit ${index} took ${show(byUnit[index]?.label)}, expected ${want.label}`);
      }
      if (got.value.refusals.length !== c.expect.refusals)
        misses.push(`${c.name}: ${got.value.refusals.length} refusals, expected ${c.expect.refusals}`);
    }
    return misses;
  };
}

const marginCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard(`margin ${show(c.probabilities)}`, () => impl.margin(c.probabilities));
    if (!got.ok) misses.push(got.error);
    else if (c.expect === null) {
      if (got.value !== undefined)
        misses.push(
          `margin(${show(c.probabilities)}) gave ${show(got.value)}, expected none (no vector or no none option)`,
        );
    } else if (!got.value || got.value.label !== c.expect.label || !near(got.value.margin, c.expect.margin))
      misses.push(`margin(${show(c.probabilities)}) gave ${show(got.value)}, expected ${show(c.expect)}`);
  }
  return misses;
};

// ----------------------------------------------------------------------------------------- the stack
function labeler(impl: PointerImpl, cls: 'system1' | 'system2', over: Json = {}) {
  return {
    id: over.id ?? (cls === 'system1' ? 'planted-p' : 'planted'),
    cls,
    family: 'planted',
    model: over.model ?? (cls === 'system1' ? 'planted-p1' : 'planted-1'),
    settings: over.settings ?? (cls === 'system1' ? { threshold: 0.4 } : {}),
    ...(over.runs && over.runs !== 1 ? { runs: over.runs } : {}),
    maxUnits: (_set: unknown, wanted: number) => wanted,
    render: () => ({ labeler: 'planted', body: {} }),
    opinions: () => ({ byUnit: new Map(), refusals: [] }),
  } as never;
}

function labellingOf(impl: PointerImpl, rule: Json, over1: Json = {}, over2: Json = {}) {
  const a = labeler(impl, 'system1', over1);
  const b = labeler(impl, 'system2', over2);
  return rule.rule === 'margin'
    ? impl.stackedLabelling(a, b, { passAt: 0.9, failAt: 0.1, marginCut: rule.marginCut })
    : impl.stackedLabelling(a, b, { passAt: rule.passAt, failAt: rule.failAt });
}

function stackCheck(names: readonly string[]): Check {
  return (impl, cases) => {
    const misses: string[] = [];
    for (const c of cases) {
      if (!names.includes(c.name)) continue;
      const labelling = labellingOf(impl, c.rule);
      const got = guard(`decide ${c.name}`, () =>
        labelling.decide([c.first ?? undefined, c.second ?? undefined], c.set),
      );
      if (!got.ok) {
        misses.push(got.error);
        continue;
      }
      const d = got.value;
      if (c.expect === null) {
        if (d !== undefined)
          misses.push(
            `${c.name}: decided ${show({ label: d.label, by: d.by })}, expected no decision (the unit stays unlabeled)`,
          );
        continue;
      }
      if (!d) {
        misses.push(`${c.name}: no decision, expected ${show(c.expect)}`);
        continue;
      }
      const got3 = {
        label: d.label,
        by: d.by,
        ...(d.target !== undefined ? { target: d.target } : {}),
        ...(d.fallback ? { fallback: true } : {}),
      };
      if (!same(got3, c.expect)) misses.push(`${c.name}: decided ${show(got3)}, expected ${show(c.expect)}`);
    }
    return misses;
  };
}

const singleCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const labelling = impl.singleLabelling(labeler(impl, c.cls));
    const got = guard(`single ${c.name}`, () =>
      labelling.decide([c.opinion ?? undefined], { set: 's', description: 'd', labels: [] } as never),
    );
    if (!got.ok) misses.push(got.error);
    else if (c.expect === null) {
      if (got.value !== undefined) misses.push(`${c.name}: decided ${show(got.value)}, expected none`);
    } else if (
      !got.value ||
      got.value.label !== c.expect.label ||
      got.value.by !== c.expect.by ||
      got.value.target !== c.expect.target
    )
      misses.push(`${c.name}: decided ${show(got.value)}, expected ${show(c.expect)}`);
  }
  return misses;
};

const labellingHashCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const got = guard(`labelling hash ${c.name}`, () => {
      const members = c.members.map((m: Json) =>
        labeler(impl, m.cls, { id: m.id, model: m.model, settings: m.settings, runs: m.runs }),
      );
      if (c.kind === 'single') return impl.singleLabelling(members[0]).hash;
      const rule = c.rule;
      return (
        rule.rule === 'margin'
          ? impl.stackedLabelling(members[0], members[1], {
              passAt: 0.9,
              failAt: 0.1,
              marginCut: rule.marginCut,
            })
          : impl.stackedLabelling(members[0], members[1], { passAt: rule.passAt, failAt: rule.failAt })
      ).hash;
    });
    if (!got.ok) misses.push(got.error);
    else if (got.value !== c.expect)
      misses.push(
        `${c.name}: hash ${got.value}, expected ${c.expect} (sha256 of the canonical members and rule, first 16 hex characters)`,
      );
  }
  return misses;
};

const labellingPairsCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  const variantOf = (name: string): { members: Json[]; rule: Json } => {
    const base1 = {
      id: 'planted-p',
      cls: 'system1',
      model: 'planted-p1',
      settings: { threshold: 0.4 },
      runs: 1,
    };
    const base2 = { id: 'planted', cls: 'system2', model: 'planted-1', settings: {}, runs: 1 };
    const cas = { rule: 'cascade', passAt: 0.9, failAt: 0.1 };
    switch (name) {
      case 'threshold':
        return { members: [{ ...base1, settings: { threshold: 0.5 } }, base2], rule: cas };
      case 'model':
        return { members: [base1, { ...base2, model: 'planted-2' }], rule: cas };
      case 'id':
        return { members: [{ ...base1, id: 'planted-q' }, base2], rule: cas };
      case 'runs':
        return { members: [base1, { ...base2, runs: 3 }], rule: cas };
      case 'pass-at':
        return { members: [base1, base2], rule: { ...cas, passAt: 0.8 } };
      case 'fail-at':
        return { members: [base1, base2], rule: { ...cas, failAt: 0.2 } };
      case 'rule':
        return { members: [base1, base2], rule: { rule: 'margin', marginCut: 0.65 } };
      case 'swapped-members':
        return { members: [base2, base1], rule: cas };
      default:
        return { members: [base1, base2], rule: cas };
    }
  };
  const hashOf = (v: { members: Json[]; rule: Json }): string => {
    const [m1, m2] = v.members.map((m) =>
      labeler(impl, m.cls, { id: m.id, model: m.model, settings: m.settings, runs: m.runs }),
    ) as [ReturnType<typeof labeler>, ReturnType<typeof labeler>];
    const l =
      v.rule.rule === 'margin'
        ? impl.stackedLabelling(m1, m2, { passAt: 0.9, failAt: 0.1, marginCut: v.rule.marginCut })
        : impl.stackedLabelling(m1, m2, { passAt: v.rule.passAt, failAt: v.rule.failAt });
    return l.hash;
  };
  const base = guard('labelling hash', () => hashOf(variantOf('same')));
  if (!base.ok) return [base.error];
  for (const c of cases) {
    const got = guard(`labelling hash ${c.name}`, () => hashOf(variantOf(c.variant)));
    if (!got.ok) misses.push(got.error);
    else if ((got.value === base.value) !== c.expectSame)
      misses.push(
        `${c.name}: the hash ${c.expectSame ? 'changed' : 'did not change'} (${got.value} against ${base.value})`,
      );
    else if (got.value !== c.expect) misses.push(`${c.name}: hash ${got.value}, expected ${c.expect}`);
  }
  return misses;
};

const keyCheck =
  (fields: readonly string[] | 'all'): Check =>
  (impl, cases) => {
    const misses: string[] = [];
    const base = cases.find((c) => c.name === 'base');
    for (const c of cases) {
      if (fields !== 'all' && !fields.includes(c.name)) continue;
      const readable = guard(`readableOf ${c.name}`, () => impl.readableOf(c.wire, c.meta));
      if (!readable.ok) {
        misses.push(readable.error);
        continue;
      }
      if (!same(readable.value, c.expectReadable))
        misses.push(`${c.name}: readable ${show(readable.value)}, expected ${show(c.expectReadable)}`);
      const key = guard(`requestKey ${c.name}`, () => impl.requestKey(c.wire, readable.value));
      if (!key.ok) misses.push(key.error);
      else if (key.value !== c.expectKey) misses.push(`${c.name}: key ${key.value}, expected ${c.expectKey}`);
      else if (base && c.name !== 'base' && c.name !== 'body-key-order' && key.value === base.expectKey)
        misses.push(`${c.name}: the key equals the key of the base request`);
    }
    return misses;
  };

const goldCheck: Check = (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const labelling = impl.stackedLabelling(labeler(impl, 'system1'), labeler(impl, 'system2'), {
      passAt: c.passAt,
      failAt: c.failAt,
    });
    const labels: string[] = [];
    const by: string[] = [];
    let agree = 0;
    const gold = new Map<string, number>();
    const given = new Map<string, number>();
    c.units.forEach((u: Json) => {
      const d = labelling.decide(
        [
          {
            label: Object.entries(u.system1 as Record<string, number>).reduce((best, e) =>
              e[1] > best[1] ? e : best,
            )[0],
            probabilities: u.system1,
          },
          { label: u.system2 },
        ],
        c.set,
      );
      labels.push(d?.label ?? 'abstain');
      by.push(d?.by ?? 'none');
      if (d?.label === u.gold) agree++;
      gold.set(u.gold, (gold.get(u.gold) ?? 0) + 1);
      if (d) given.set(d.label, (given.get(d.label) ?? 0) + 1);
    });
    const n = c.units.length;
    const po = agree / n;
    let pe = 0;
    for (const [name, count] of gold) pe += (count * (given.get(name) ?? 0)) / (n * n);
    const kappa = (po - pe) / (1 - pe);
    if (!same(labels, c.expect.labels))
      misses.push(`labels ${show(labels)}, expected ${show(c.expect.labels)}`);
    if (!same(by, c.expect.by)) misses.push(`deciders ${show(by)}, expected ${show(c.expect.by)}`);
    if (!near(kappa, c.expect.kappa))
      misses.push(`kappa ${kappa} against the gold labels, expected ${c.expect.kappa}`);
  }
  return misses;
};

/** The gold set through the whole scan: cut, window, both labellers by table, cassette, ledger. */
const goldScanCheck: Check = async (impl, cases) => {
  const misses: string[] = [];
  for (const c of cases) {
    const byText = new Map<string, Json>(c.units.map((u: Json) => [u.text, u]));
    const names = c.set.labels.map((l: Json) => l.name as string);
    const system1 = {
      ...(labeler(impl, 'system1') as object),
      opinions: (answer: never, set: never, window: never) =>
        impl.choiceOpinions(answer, window, impl.askedLabels(set, true)),
      call: async (_wire: unknown, _set: unknown, window: { units: Array<{ n: number; text: string }> }) => {
        const probabilities: Record<string, number> = {};
        for (const unit of window.units) {
          const row = byText.get(unit.text)?.system1 ?? { none: 1 };
          for (const name of [...names, 'none']) probabilities[impl.choiceKey(unit.n, name)] = row[name] ?? 0;
        }
        return {
          probabilities,
          returnedModel: 'planted-p1',
          stopReason: 'answered',
          usage: { input: 1, output: 0 },
        };
      },
      render: (_set: unknown, window: { id: string }) => ({
        labeler: 'planted-p',
        body: { window: window.id },
      }),
    };
    const system2 = {
      ...(labeler(impl, 'system2') as object),
      opinions: impl.denseOpinions,
      call: async (_wire: unknown, _set: unknown, window: { units: Array<{ n: number; text: string }> }) => ({
        labels: window.units.map((unit) => ({
          units: String(unit.n),
          label: byText.get(unit.text)?.system2 ?? 'none',
        })),
        returnedModel: 'planted-1',
        stopReason: 'end_turn',
        usage: { input: 1, output: 1 },
      }),
      render: (_set: unknown, window: { id: string }) => ({
        labeler: 'planted',
        body: { window: window.id },
      }),
    };
    const got = await (async () => {
      try {
        const labelling = impl.stackedLabelling(system1 as never, system2 as never, {
          passAt: c.passAt,
          failAt: c.failAt,
        });
        const text = `# Orchard\n\n${c.units.map((u: Json) => u.text).join('\n\n')}\n`;
        return {
          ok: true as const,
          value: await impl.pointerScan({
            files: [{ path: 'orchard.md', text }],
            sets: [c.set],
            labelling,
            cassette: new impl.Cassette(),
            mode: 'record',
            estateKey: 'gold',
          }),
        };
      } catch (cause) {
        return {
          ok: false as const,
          error: `pointerScan threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
        };
      }
    })();
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    const result = got.value;
    const labelledByText = new Map(result.labelled.map((l) => [l.unit.text, { label: l.label, by: l.by }]));
    const decided: string[] = [];
    const deciders: string[] = [];
    let agree = 0;
    const goldCount = new Map<string, number>();
    const givenCount = new Map<string, number>();
    c.units.forEach((u: Json) => {
      const l = labelledByText.get(u.text);
      const label = l?.label ?? 'none';
      decided.push(label);
      deciders.push(l?.by ?? 'none');
      if (label === u.gold) agree++;
      goldCount.set(u.gold, (goldCount.get(u.gold) ?? 0) + 1);
      givenCount.set(label, (givenCount.get(label) ?? 0) + 1);
    });
    const n = c.units.length;
    const po = agree / n;
    let pe = 0;
    for (const [name, count] of goldCount) pe += (count * (givenCount.get(name) ?? 0)) / (n * n);
    const kappa = (po - pe) / (1 - pe);
    if (!same(decided, c.expect.labels))
      misses.push(`the scan labelled ${show(decided)}, expected ${show(c.expect.labels)}`);
    const expectedBy = c.expect.by as string[];
    c.units.forEach((u: Json, i: number) => {
      const l = labelledByText.get(u.text);
      if (l && l.by !== expectedBy[i])
        misses.push(`unit ${i} was decided by ${l.by}, expected ${expectedBy[i]}`);
    });
    if (result.unlabeled !== 0) misses.push(`${result.unlabeled} units stayed unlabeled, expected none`);
    if (result.failed.length > 0 || result.refusals.length > 0)
      misses.push(`the scan failed windows ${show(result.failed)} or refused ${show(result.refusals)}`);
    if (!near(kappa, c.expect.kappa))
      misses.push(`kappa ${kappa} against the gold labels, expected ${c.expect.kappa}`);
  }
  return misses;
};

// ------------------------------------------------------------------------------------------- the bank
function item(
  id: string,
  family: PointerFamily,
  tier: Tier,
  component: string,
  cause: string,
  group: string,
  check: Check,
): PointerItem {
  return {
    id: `pointer/${family}/${id}`,
    family,
    tier,
    component,
    cause,
    run: async (impl, fixtures) => {
      const cases = fixtures[group];
      if (!cases) return [`the fixture group ${group} is missing from ${POINTER_FIXTURES}`];
      if (GROUP_SIZES[group] !== undefined && cases.length !== GROUP_SIZES[group])
        return [
          `the fixture group ${group} holds ${cases.length} cases, the items were written for ${GROUP_SIZES[group]}`,
        ];
      return check(impl, cases);
    },
  };
}

const REFUSALS = [
  'unknown-label',
  'bad-units',
  'outside-window',
  'named-twice',
  'bad-target',
  'none-target',
  'missing-target',
  'extra-target',
] as const;
const REFUSAL_CAUSE: Record<(typeof REFUSALS)[number], string> = {
  'unknown-label': 'checkAnswer refuses a label that is not in the set, with the set named',
  'bad-units': 'checkAnswer refuses units that are no number or range',
  'outside-window': 'checkAnswer refuses a unit outside the window',
  'named-twice': 'checkAnswer refuses a unit named twice and keeps the first answer',
  'bad-target': 'checkAnswer refuses a target that is no whole unit number',
  'none-target': 'checkAnswer refuses a target on the label none',
  'missing-target':
    'checkAnswer refuses a label that needs a target when none or one outside the window is given',
  'extra-target': 'checkAnswer refuses a target on a label that takes none',
};

export function pointerBank(): PointerItem[] {
  const out: PointerItem[] = [];
  const L = FILE.labels;
  const Y = FILE.yesno;
  const S = FILE.stack;
  const C = FILE.cassette;
  out.push(
    item(
      'expand-valid',
      'units',
      1,
      L,
      'expandUnits reads a unit number or range as the numbers it names',
      'expandUnits.valid',
      expandCheck,
    ),
  );
  out.push(
    item(
      'expand-invalid',
      'units',
      1,
      L,
      'expandUnits refuses a backwards range, a range over 10000 units and anything that is not ASCII digits',
      'expandUnits.invalid',
      expandCheck,
    ),
  );
  out.push(
    item(
      'value',
      'set-hash',
      2,
      L,
      'setHash is the first 16 hex characters of the sha256 of the sorted-key compact JSON of the set',
      'setHash.value',
      hashValueCheck,
    ),
  );
  out.push(
    item(
      'pairs',
      'set-hash',
      3,
      L,
      'setHash changes with any edit of the set, a label or the label order, and not with key order',
      'setHash.pairs',
      hashPairsCheck,
    ),
  );
  out.push(
    item(
      'isolated',
      'set-hash',
      3,
      L,
      'setHash of one set does not depend on another set',
      'setHash.isolated',
      hashIsolatedCheck,
    ),
  );
  out.push(
    item(
      'accepted',
      'answer',
      1,
      L,
      'checkAnswer accepts the labelled units of an answer and covers the units it names, none included',
      'checkAnswer.accepted',
      answerCheck(() => true),
    ),
  );
  for (const code of REFUSALS) {
    const tier: Tier = code === 'unknown-label' || code === 'outside-window' ? 2 : 3;
    out.push(
      item(
        `refuses-${code}`,
        'answer',
        tier,
        L,
        REFUSAL_CAUSE[code],
        'checkAnswer.refusals',
        answerCheck((c) => c.expect.refusals.includes(code)),
      ),
    );
  }
  out.push(
    item(
      'refusal-keeps-rest',
      'answer',
      4,
      L,
      'a refused entry leaves the accepted entries of the same answer standing and covers none of its units',
      'checkAnswer.refusals',
      answerCheck((c) => Object.keys(c.expect.accepted).length > 0),
    ),
  );
  out.push(
    item(
      'read-valid',
      'label-file',
      1,
      L,
      'parseLabelSets reads a labels list of sets with unique names',
      'parseLabelSets.valid',
      parseValidCheck,
    ),
  );
  out.push(
    item(
      'refuse-names',
      'label-file',
      2,
      L,
      'parseLabelSets refuses a set or label name outside lower case letters, digits and hyphens, and the reserved name none',
      'parseLabelSets.invalid',
      parseInvalidCheck([
        'reserved-none',
        'upper-case-name',
        'space-in-name',
        'digit-first-name',
        'underscore-name',
        'bad-set-name',
      ]),
    ),
  );
  out.push(
    item(
      'refuse-duplicates',
      'label-file',
      2,
      L,
      'parseLabelSets refuses a set or a label declared twice and names it',
      'parseLabelSets.invalid',
      parseInvalidCheck(['duplicate-set', 'duplicate-label']),
    ),
  );
  out.push(
    item(
      'refuse-conditions',
      'label-file',
      3,
      L,
      'parseLabelSets refuses a condition label without target: required or with an atom of its own',
      'parseLabelSets.invalid',
      parseInvalidCheck(['condition-without-target', 'condition-with-atom']),
    ),
  );
  out.push(
    item(
      'refuse-shape',
      'label-file',
      3,
      L,
      'parseLabelSets refuses an empty description, an empty list, more than three examples, an unknown key and a bad target or polarity',
      'parseLabelSets.invalid',
      parseInvalidCheck([
        'empty-description',
        'no-labels',
        'four-examples',
        'unknown-key',
        'bad-target-value',
        'bad-polarity',
        'empty-list',
        'no-labels-key',
      ]),
    ),
  );
  out.push(
    item(
      'refuse-yaml',
      'label-file',
      2,
      L,
      'parseLabelSets refuses text that is not YAML, a duplicate key and an empty file',
      'parseLabelSets.invalid',
      parseInvalidCheck(['duplicate-yaml-key', 'not-yaml', 'empty-text']),
    ),
  );
  out.push(
    item(
      'asked-labels',
      'yes-no',
      2,
      Y,
      'askedLabels leaves the labels that ask for a target to system 2 and refuses a set a yes or no model cannot be asked about',
      'askedLabels.cases',
      askedCheck,
    ),
  );
  out.push(
    item(
      'threshold',
      'yes-no',
      2,
      Y,
      'a yes or no unit takes the label with the highest probability at or above the threshold, else none',
      'yesNoOpinions.threshold',
      yesNoCheck([
        'above',
        'at-threshold',
        'just-below',
        'tie-first-wins',
        'high-threshold',
        'zero-threshold',
        'one-label',
      ]),
    ),
  );
  out.push(
    item(
      'unanswered',
      'yes-no',
      3,
      Y,
      'a unit with an unanswered question has no opinion and is never guessed from the answers that came back',
      'yesNoOpinions.unanswered',
      yesNoCheck([
        'one-missing',
        'unit-absent',
        'non-number',
        'null-value',
        'nothing',
        'unrelated-keys',
        'key-case',
      ]),
    ),
  );
  out.push(
    item(
      'vector-tolerance',
      'choice',
      3,
      Y,
      'a choice answer is a vector when each probability is in 0 to 1 and the sum is within 0.01 of 1',
      'choiceOpinions.vector',
      choiceCheck(['clean', 'tolerance-upper', 'tolerance-over', 'tolerance-under']),
    ),
  );
  out.push(
    item(
      'vector-refused',
      'choice',
      3,
      Y,
      'a choice answer that is no vector is refused with a reason and never normalised',
      'choiceOpinions.vector',
      choiceCheck(['sum-too-high', 'negative', 'above-one']),
    ),
  );
  out.push(
    item(
      'choice-ties-missing',
      'choice',
      4,
      Y,
      'a choice unit takes the first of equal options and has no opinion when an option or a number is missing',
      'choiceOpinions.vector',
      choiceCheck(['tie-first', 'missing-option', 'missing-none', 'non-number']),
    ),
  );
  out.push(
    item(
      'margin',
      'stack',
      2,
      S,
      'margin is the likeliest option minus the second, and none for probabilities without none or without a vector',
      'margin.cases',
      marginCheck,
    ),
  );
  const cascade = (names: string[]) => stackCheck(names);
  out.push(
    item(
      'cascade-sure',
      'stack',
      3,
      S,
      'system 1 decides alone at pass-at or above and under fail-at',
      'stack.cascade',
      cascade([
        'sure-yes',
        'sure-yes-boundary',
        'sure-none-option',
        'sure-none-option-boundary',
        'just-under-pass',
        'sure-none',
        'fail-boundary',
      ]),
    ),
  );
  out.push(
    item(
      'cascade-unsure',
      'stack',
      3,
      S,
      "between the bounds system 2 decides; with no system 2 opinion the unit stays unlabeled, never system 1's unsure label",
      'stack.cascade',
      cascade(['unsure-second', 'unsure-no-second', 'second-says-none-unsure', 'custom-bounds-between']),
    ),
  );
  out.push(
    item(
      'cascade-fallback',
      'stack',
      4,
      S,
      'the labeler that gave an opinion decides alone when the other gave none, and the decision says so',
      'stack.cascade',
      cascade(['sure-no-second', 'sure-none-no-second', 'first-missing', 'both-missing']),
    ),
  );
  out.push(
    item(
      'cascade-targets',
      'stack',
      4,
      S,
      'a label that asks for a target is decided by system 2 alone',
      'stack.cascade',
      cascade([
        'second-needs-target',
        'second-target-label-over-sure-none',
        'target-label-sure-first',
        'second-target-with-none-first',
        'second-label-outside-asked-no-target',
      ]),
    ),
  );
  out.push(
    item(
      'cascade-bounds',
      'stack',
      4,
      S,
      'the bounds of the stack are the ones it was built with',
      'stack.cascade',
      cascade(['custom-bounds', 'custom-bounds-none', 'custom-bounds-between']),
    ),
  );
  out.push(
    item(
      'margin-rule',
      'stack',
      4,
      S,
      'with a margin cut system 1 decides when the likeliest option leads by the cut or more',
      'stack.margin',
      stackCheck(['clear-lead', 'lead-at-cut', 'lead-under-cut', 'none-leads', 'tie', 'cut-zero']),
    ),
  );
  out.push(
    item(
      'margin-no-vector',
      'stack',
      4,
      S,
      'a system 1 answer that is no vector, or has no none option, is left to system 2',
      'stack.margin',
      stackCheck([
        'no-vector',
        'no-none-option',
        'no-second',
        'unsure-no-second',
        'first-missing',
        'second-target',
      ]),
    ),
  );
  out.push(
    item(
      'single',
      'stack',
      2,
      S,
      "a lone labeler's opinion is the decision and no opinion is no decision",
      'stack.single',
      singleCheck,
    ),
  );
  out.push(
    item(
      'labelling-hash',
      'recording',
      3,
      S,
      'the hash of a labelling is the first 16 hex characters of the sha256 of its canonical members and rule',
      'labelling.hash',
      labellingHashCheck,
    ),
  );
  out.push(
    item(
      'labelling-hash-changes',
      'recording',
      4,
      S,
      'the hash of a labelling changes with a member id, model, threshold or runs, a bound, the rule and the order of the members',
      'labelling.hash-pairs',
      labellingPairsCheck,
    ),
  );
  out.push(
    item(
      'key-value',
      'recording',
      3,
      C,
      'readableOf hashes each part of the body, and requestKey is the sha256 of the canonical wire and readable',
      'cassette.requestKey',
      keyCheck(['base', 'unicode-body']),
    ),
  );
  out.push(
    item(
      'key-set-and-model',
      'recording',
      4,
      C,
      'a changed label set, model, run, cut or prompt version gives another cassette key',
      'cassette.requestKey',
      keyCheck(['set-hash', 'model', 'run', 'cut', 'prompt-version']),
    ),
  );
  out.push(
    item(
      'key-body-and-labeler',
      'recording',
      4,
      C,
      'a changed unit text or labeler gives another cassette key, and the order of the keys of the body does not',
      'cassette.requestKey',
      keyCheck(['body-unit', 'labeler', 'body-key-order']),
    ),
  );
  out.push(
    item(
      'gold-scan',
      'gold-set',
      5,
      FILE.scan,
      'a gold set through the whole scan is labelled by the cascade rule: cut, windows, both labellers, cassette and ledger agree with the table',
      'stack.goldset',
      goldScanCheck,
    ),
  );
  out.push(
    item(
      'gold-set',
      'gold-set',
      5,
      S,
      'a gold set through system 1 then system 2 is labelled as the cascade rule says and its kappa against the gold labels is the exact one',
      'stack.goldset',
      goldCheck,
    ),
  );
  return finishBank(out);
}

/** The text of a source without comments, so a doc comment may name `process` or a file. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      // keep string literals whole: a string that names a fixture file is evidence
      const quote = c;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------- what makes the bank hard to cheat
/**
 * The size of each fixture group when the items were written. An empty or missing group would pass every item
 * that reads it, so an item fails when its group has another size (docs/validators.md section 12.7).
 */
export const GROUP_SIZES: Record<string, number> = {
  'expandUnits.valid': 13,
  'expandUnits.invalid': 15,
  'setHash.value': 3,
  'setHash.pairs': 10,
  'setHash.isolated': 1,
  'checkAnswer.accepted': 7,
  'checkAnswer.refusals': 17,
  'parseLabelSets.valid': 6,
  'parseLabelSets.invalid': 21,
  'askedLabels.cases': 5,
  'yesNoOpinions.threshold': 7,
  'yesNoOpinions.unanswered': 7,
  'choiceOpinions.vector': 11,
  'margin.cases': 13,
  'stack.cascade': 22,
  'stack.margin': 12,
  'stack.single': 4,
  'labelling.hash': 4,
  'labelling.hash-pairs': 9,
  'cassette.requestKey': 10,
  'stack.goldset': 1,
};

type Seeded = (impl: PointerImpl, rng: ReturnType<typeof rngOf>) => string[];
const defect =
  (...d: Defect[]): Seeded =>
  (impl, r) =>
    seededAnswer(impl, r, d);
const file =
  (rule: FileRule): Seeded =>
  (impl, r) =>
    seededLabelFile(impl, r, rule);
const SEEDED: Record<string, Seeded> = {
  'units/expand-valid': seededUnits,
  'units/expand-invalid': seededUnits,
  'set-hash/value': seededSetHash,
  'set-hash/pairs': seededSetHash,
  'set-hash/isolated': seededSetHash,
  'answer/accepted': defect('none'),
  'answer/refuses-unknown-label': defect('unknown-label'),
  'answer/refuses-bad-units': defect('bad-units'),
  'answer/refuses-outside-window': defect('outside-window'),
  'answer/refuses-named-twice': defect('named-twice'),
  'answer/refuses-bad-target': defect('bad-target'),
  'answer/refuses-none-target': defect('none-target'),
  'answer/refuses-missing-target': defect('missing-target'),
  'answer/refuses-extra-target': defect('extra-target'),
  'answer/refusal-keeps-rest': defect(...DEFECTS),
  'label-file/read-valid': file('valid'),
  'label-file/refuse-names': file('names'),
  'label-file/refuse-duplicates': file('duplicates'),
  'label-file/refuse-conditions': file('conditions'),
  'label-file/refuse-shape': file('shape'),
  'label-file/refuse-yaml': file('yaml'),
  'yes-no/asked-labels': (impl, r) => seededYesNo(impl, r, 'asked'),
  'yes-no/threshold': (impl, r) => seededYesNo(impl, r, 'threshold'),
  'yes-no/unanswered': (impl, r) => seededYesNo(impl, r, 'unanswered'),
  'choice/vector-tolerance': seededChoice,
  'choice/vector-refused': seededChoice,
  'choice/choice-ties-missing': seededChoice,
  'stack/margin': seededChoice,
  'stack/cascade-sure': (impl, r) => seededStack(impl, r, 'cascade-sure'),
  'stack/cascade-unsure': (impl, r) => seededStack(impl, r, 'cascade-unsure'),
  'stack/cascade-fallback': (impl, r) => seededStack(impl, r, 'cascade-fallback'),
  'stack/cascade-targets': (impl, r) => seededStack(impl, r, 'targets'),
  'stack/cascade-bounds': (impl, r) => seededStack(impl, r, 'cascade-sure'),
  'stack/margin-rule': (impl, r) => seededStack(impl, r, 'margin'),
  'stack/margin-no-vector': (impl, r) => seededStack(impl, r, 'margin-no-vector'),
  'stack/single': seededSingle,
  'recording/labelling-hash': seededLabellingHash,
  'recording/labelling-hash-changes': seededLabellingHash,
  'recording/key-value': seededRecording,
  'recording/key-set-and-model': seededRecording,
  'recording/key-body-and-labeler': seededRecording,
  'gold-set/gold-set': seededGold,
  'gold-set/gold-scan': seededGold,
};

/** Items that read only refusals also run a valid case, so an implementation that refuses everything fails them. */
const CONTROLS: Record<string, Check> = {
  ...Object.fromEntries(
    [...REFUSALS.map((c) => `answer/refuses-${c}`), 'answer/refusal-keeps-rest'].map((id) => [
      id,
      (impl: PointerImpl, cases: Json[]) => answerCheck(() => true)(impl, cases),
    ]),
  ),
  ...Object.fromEntries(
    ['refuse-names', 'refuse-duplicates', 'refuse-conditions', 'refuse-shape', 'refuse-yaml'].map((n) => [
      `label-file/${n}`,
      (impl: PointerImpl, cases: Json[]) => parseValidCheck(impl, cases),
    ]),
  ),
};
const CONTROL_GROUP = (id: string): string =>
  id.startsWith('answer/') ? 'checkAnswer.accepted' : 'parseLabelSets.valid';

/** One cause per change that would make items pass: items that one change fixes name one cause (cause review). */
const CAUSE_SHARED: Record<string, string> = {
  'set-hash/value':
    'setHash is the first 16 hex characters of the sha256 of the sorted-key compact JSON of the set, and any edit of the set changes it',
  'set-hash/pairs':
    'setHash is the first 16 hex characters of the sha256 of the sorted-key compact JSON of the set, and any edit of the set changes it',
  'set-hash/isolated':
    'setHash is the first 16 hex characters of the sha256 of the sorted-key compact JSON of the set, and any edit of the set changes it',
  'answer/refuses-missing-target':
    'checkAnswer checks the target of an entry against the label: required, none, extra or outside the window',
  'answer/refuses-extra-target':
    'checkAnswer checks the target of an entry against the label: required, none, extra or outside the window',
  'answer/refuses-none-target':
    'checkAnswer checks the target of an entry against the label: required, none, extra or outside the window',
  'label-file/refuse-names':
    'parseLabelSets validates the shape of the file: names, conditions, examples, descriptions',
  'label-file/refuse-conditions':
    'parseLabelSets validates the shape of the file: names, conditions, examples, descriptions',
  'label-file/refuse-shape':
    'parseLabelSets validates the shape of the file: names, conditions, examples, descriptions',
  'choice/vector-tolerance':
    'isVector accepts a probability vector within 0.01 of a sum of 1 and refuses anything else',
  'choice/vector-refused':
    'isVector accepts a probability vector within 0.01 of a sum of 1 and refuses anything else',
  'stack/cascade-sure':
    'the stack decides a unit by the cascade rule: system 1 at its bounds, system 2 between them',
  'stack/cascade-unsure':
    'the stack decides a unit by the cascade rule: system 1 at its bounds, system 2 between them',
  'stack/cascade-bounds':
    'the stack decides a unit by the cascade rule: system 1 at its bounds, system 2 between them',
  'gold-set/gold-set':
    'the stack decides a unit by the cascade rule: system 1 at its bounds, system 2 between them',
  'gold-set/gold-scan':
    'the stack decides a unit by the cascade rule: system 1 at its bounds, system 2 between them',
  'stack/margin-rule':
    'the margin rule lets system 1 decide only when its likeliest option leads by the cut, from a vector that holds none',
  'stack/margin-no-vector':
    'the margin rule lets system 1 decide only when its likeliest option leads by the cut, from a vector that holds none',
  'recording/labelling-hash':
    'a labelling hash is the first 16 hex characters of the sha256 of its canonical members and rule',
  'recording/labelling-hash-changes':
    'a labelling hash is the first 16 hex characters of the sha256 of its canonical members and rule',
  'recording/key-value':
    'readableOf and requestKey hash the parts of the body, the readable fields and the wire',
  'recording/key-set-and-model':
    'readableOf and requestKey hash the parts of the body, the readable fields and the wire',
  'recording/key-body-and-labeler':
    'readableOf and requestKey hash the parts of the body, the readable fields and the wire',
  'units/expand-valid': 'expandUnits reads a unit number or range and refuses anything else',
  'units/expand-invalid': 'expandUnits reads a unit number or range and refuses anything else',
};

function finishBank(items: PointerItem[]): PointerItem[] {
  const out = items.map((base) => {
    const key = base.id.replace(/^pointer\//, '');
    const seeded = SEEDED[key];
    const control = CONTROLS[key];
    const group = base.id.startsWith('pointer/answer/') ? 'checkAnswer.accepted' : 'parseLabelSets.valid';
    return {
      ...base,
      cause: CAUSE_SHARED[key] ?? base.cause,
      run: async (impl: PointerImpl, fixtures: Fixtures, seed: number, root: string) => {
        const misses = [...(await base.run(impl, fixtures, seed, root))];
        if (control) {
          const cases = fixtures[group];
          if (!cases || cases.length !== GROUP_SIZES[group])
            misses.push(
              `the control group ${group} is missing or has another size than ${GROUP_SIZES[group]}`,
            );
          else misses.push(...(await control(impl, cases)).map((m) => `control: ${m}`));
        }
        if (seeded) {
          const salt = Number.parseInt(createHash('sha256').update(base.id).digest('hex').slice(0, 6), 16);
          misses.push(...seeded(impl, rngOf((seed >>> 0) + salt)).map((m) => `seed ${seed}: ${m}`));
        }
        return misses;
      },
    };
  });
  return [...out, ...sourceGuardItems()];
}

function moduleDir(root: string): string {
  const impl = process.env.DRIFTBENCH_POINTER_IMPL;
  // The whole source tree of the module (the folder that holds pointer/), so a helper kept beside it is read too.
  if (impl) return dirname(dirname(resolve(impl.startsWith('file://') ? new URL(impl).pathname : impl)));
  return join(root, 'packages', 'estate', 'src');
}

/**
 * The files of a module's source tree that need a scan: every file that is not byte for byte a file of the
 * shipped module. A file the shipped module has and the copy keeps unchanged is the shipped code (it may use
 * the process or a dynamic import where it must); a changed file, or one the shipped module does not have, is
 * the code under audit.
 */
function sourcesOf(dir: string, shipped: string): Array<{ file: string; text: string }> {
  const found: Array<{ file: string; text: string }> = [];
  if (!existsSync(dir)) return found;
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (name === 'node_modules') continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(json|md|map)$/.test(name)) continue;
      const relative = path.slice(dir.length + 1);
      const text = readFileSync(path, 'utf8');
      const twin = join(shipped, relative);
      if (existsSync(twin) && readFileSync(twin, 'utf8') === text) continue;
      found.push({ file: relative, text });
    }
  };
  walk(dir);
  return found;
}

type Source = { id: string; cause: string; what: string; patterns: RegExp[] };
const SOURCE_GUARDS: Source[] = [
  {
    id: 'reads-files',
    what: 'a file, a process, a connection or a worker',
    cause: 'the pointer module reads files, runs processes or opens connections',
    patterns: [
      /\bfrom\s*['"`](?:node:)?(?:fs|fs\/promises|child_process|worker_threads|cluster|net|dgram|http|https|http2|tls|dns|vm|v8|readline)['"`]/,
      /\brequire\s*\(/,
      /\bcreateRequire\b/,
      /\breadFile|\breaddir|\bcreateReadStream|\bspawn\b|\bexecSync\b|\bexecFile/,
      /\bimport\.meta\b/,
      /\b__dirname\b|\b__filename\b/,
    ],
  },
  {
    id: 'reads-process-state',
    what: 'the arguments, the working folder or the main module of its process',
    cause: 'the pointer module reads the arguments, the working folder or the main module of its process',
    patterns: [
      /\bprocess\s*\.\s*(?:argv|execArgv|cwd|binding|mainModule|title|pid)\b/,
      /\bglobalThis\b/,
      /\bglobal\s*\./,
      /DRIFTBENCH/,
    ],
  },
  {
    id: 'reads-call-stack',
    what: 'the call stack',
    cause: 'the pointer module reads its call stack to see who is calling',
    patterns: [/\.stack\b/, /\bcaptureStackTrace\b|\bprepareStackTrace\b/, /\bcallee\b|\bcaller\b/],
  },
  {
    id: 'runs-generated-code',
    what: 'generated code',
    cause: 'the pointer module builds code from strings at run time',
    patterns: [/\beval\b/, /\bnew\s+Function\b|\bFunction\s*\(/, /\.constructor\s*[.(]/, /\bimport\s*\(/],
  },
  {
    id: 'patches-builtins',
    what: 'a built-in object',
    cause: 'the pointer module changes a built-in object or the prototype of one',
    patterns: [
      /\.prototype\b/,
      /\b(?:JSON|Math|Object|Array|String|Number|Map|Set|Reflect|Promise|Date|Error|Symbol)\s*\.\s*[A-Za-z_]+\s*=[^=]/,
      /\bdefineProperty\b|\bsetPrototypeOf\b|__proto__/,
      /\bProxy\b/,
    ],
  },
  {
    id: 'names-the-validator',
    what: 'the validator or its fixtures',
    cause: 'the pointer module names the validator, its fixtures or its cases',
    patterns: [
      /pointer\.json/,
      /make_pointer/,
      /fixtures\/judges/,
      /driftbench-validators|packages\/validators/,
      /\bGROUP_SIZES\b|\bpointerBank\b|\bpointerFixtures\b/,
    ],
  },
];

function sourceGuardItems(): PointerItem[] {
  return SOURCE_GUARDS.map((g) => ({
    id: `pointer/source/${g.id}`,
    family: 'source' as PointerFamily,
    tier: 3 as Tier,
    cause: g.cause,
    component: 'packages/estate/src/pointer',
    run: (_impl: PointerImpl, _fixtures: Fixtures, _seed: number, root: string) => {
      const dir = moduleDir(root);
      if (!existsSync(dir)) return [`no source of the pointer module under ${dir}`];
      const files = sourcesOf(dir, join(root, 'packages', 'estate', 'src'));
      const misses: string[] = [];
      for (const f of files) {
        const text = stripComments(f.text);
        for (const pattern of g.patterns) {
          const m = pattern.exec(text);
          if (m)
            misses.push(
              `${f.file} touches ${g.what}: ${show(m[0])}. A labeller is pure computation: numbers, strings and lists in, the same out.`,
            );
        }
      }
      return misses;
    },
  }));
}
