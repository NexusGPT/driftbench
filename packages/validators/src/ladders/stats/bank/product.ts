import { join } from 'node:path';
import type { StatsImpl } from '../reference';
import { attempt, type BankItem, fail, near, ok, show, type Tier } from './item';

/**
 * The statistics the product prints or plans, measured where they are printed (validators/stats/NEEDS.md,
 * "Planned capabilities" and "Printouts"):
 * Family `product`, with the report's interval coverage of bank/rates.ts:
 * - level `roadmap`, tier 5: what a docs page names as planned, with its contract:
 *   `campaign plan` computing the minimum detectable effect with stats.mde and a measured rho
 *   (docs/concepts/statistics.md, "Before a campaign"), the session as the unit of an estate run with the design
 *   effect of a measured rho (docs/estate.md, section 7), and the early stop of a spec whose first two
 *   free-running repeats fail a gating machine check (docs/concepts/run-modes.md, "Around the modes");
 * - level `analytic`, tier 4: a number the report computes with its own code beside
 *   the library agrees with the library and with its documented formula.
 * The product packages are loaded from the repository root at run time, so the validator's dependencies do not
 * change; each item names the file the executor changes.
 */

const CAMPAIGN = 'packages/core/src/runner/campaign.ts';
const CLI_CAMPAIGN = 'packages/cli/src/commands/campaign.ts';
const ESTATE = 'packages/estate/src/index.ts';
const RELIABILITY = 'packages/report/src/reliability.ts';
const SPREAD = 'packages/report/src/spread.ts';

type Mod = Record<string, unknown>;
const loaded = new Map<string, Promise<Mod>>();
function load(root: string, path: string): Promise<Mod> {
  const key = join(root, path);
  let mod = loaded.get(key);
  if (!mod) {
    mod = import(key) as Promise<Mod>;
    loaded.set(key, mod);
  }
  return mod;
}

function item(
  id: string,
  level: 'roadmap' | 'analytic',
  tier: Tier,
  component: string,
  cause: string,
  check: BankItem['check'],
): BankItem {
  return {
    id,
    family: 'product',
    tier,
    level,
    component,
    cause,
    budgetMs: 300_000,
    check,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Synthetic specs and runs: fictional, deterministic.

const TARGET = { adapter: 'function', agent: 'demo' };
const FIXED = '2026-10-11T12:00:00.000Z';

function specs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    spec: { id: `spec-${i}`, kind: 'conversation', blocks: [{ when: { user: 'hello' } }] },
    hash: `h${i}`,
  }));
}

/** A completed run of one block that passes or fails. */
function runOf(specId: string, repeat: number, pass: boolean, mode = 'F') {
  return {
    runId: `${specId}-${mode}-${repeat}`,
    specId,
    specHash: 'h1',
    target: TARGET,
    mode,
    repeat,
    status: 'completed',
    blocks: [
      {
        index: 0,
        givenHash: 'g0',
        observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
        verdicts: [],
        ledgerCheck: { ok: true, contradictions: [] },
        drift: pass ? [] : ['X1_local'],
        pass,
      },
    ],
    succession: {
      ...(pass ? {} : { firstDriftBlock: 0 }),
      driftCount: pass ? 0 : 1,
      driftRate: pass ? 0 : 1,
      longestClean: pass ? 1 : 0,
      minOverBlocks: pass,
    },
    cost: 0,
    latencyMs: 0,
    startedAt: FIXED,
    finishedAt: FIXED,
    cacheHit: false,
  };
}

/** Campaign data as @agent-nexus/driftbench-report reads it, over synthetic runs. */
function dataOf(runs: ReturnType<typeof runOf>[]) {
  const ids = [...new Set(runs.map((run) => run.specId))];
  return {
    campaign: {
      campaignId: 'c-agreement',
      specs: ids.map((id) => ({ id, hash: 'h1' })),
      targets: [TARGET],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: FIXED,
    },
    specs: new Map(
      ids.map((id) => [
        `${id}@h1`,
        {
          ok: true,
          path: `${id}.yaml`,
          spec: { id, kind: 'conversation', blocks: [{ when: { user: 'hello' } }] },
          hash: 'h1',
          warnings: [],
        },
      ]),
    ),
    runs,
  };
}

/** Runs of specs with the given passing repeats out of `repeats`. */
function campaignRuns(passing: readonly number[], repeats: number) {
  return passing.flatMap((c, i) => Array.from({ length: repeats }, (_, r) => runOf(`spec-${i}`, r, r < c)));
}

// ---------------------------------------------------------------------------------------------------------
// Planned: campaign plan with stats.mde and a measured rho.

type PlanFn = (
  specs: unknown,
  targets: unknown,
  modes: unknown,
  repeats: number,
  options: Record<string, unknown>,
) => { mde: Array<Record<string, unknown>> };

const MDE_CAUSE = 'campaign plan prints a minimum detectable effect that differs from stats.mde';
const RHO_CAUSE = 'campaign plan has no input for a measured rho';
const STATISTICS_NEED =
  'docs/concepts/statistics.md, "Before a campaign": "campaign plan uses the runner\'s own formula today, with runs counted as independent; using mde with a measured rho there is planned"';

function planEffect(s: StatsImpl, input: { n: number; repeats: number; baselineRate: number; rho?: number }) {
  return s.mde(input).effect;
}

function planMde(n: number, repeats: number, baselineRate: number): BankItem['check'] {
  return async ({ s, root }) => {
    const plan = (await load(root, CAMPAIGN)).planCampaign as PlanFn;
    const got = attempt(() => plan(specs(n), [TARGET], ['F'], repeats, { baselineRate }));
    if (got.error) return fail(`planCampaign threw ${got.error.message}`);
    const line = got.value?.mde[0] ?? {};
    const effect = (line.effect as number | undefined) ?? null;
    const want = planEffect(s, { n, repeats, baselineRate });
    const same = want === null ? effect === null : typeof effect === 'number' && near(effect, want, 1e-9);
    return same
      ? ok()
      : fail(
          `planCampaign on ${n} specs x ${repeats} repeats at a baseline rate of ${baselineRate} gives a minimum detectable effect of ${show(effect)}; stats.mde({ n: ${n}, repeats: ${repeats}, baselineRate: ${baselineRate} }) gives ${show(want)}${want === null ? ' (no drop below the baseline is detectable)' : ''}. Compute the plan's effect with mde of @agent-nexus/driftbench-stats (a null effect when none is detectable). Need: ${STATISTICS_NEED}.`,
        );
  };
}

function planRho(n: number, repeats: number, baselineRate: number, rho: number): BankItem['check'] {
  return async ({ s, root }) => {
    const plan = (await load(root, CAMPAIGN)).planCampaign as PlanFn;
    const got = attempt(() => plan(specs(n), [TARGET], ['F'], repeats, { baselineRate, rho }));
    if (got.error) return fail(`planCampaign with options.rho ${rho} threw ${got.error.message}`);
    const line = got.value?.mde[0] ?? {};
    const want = s.mde({ n, repeats, baselineRate, rho });
    const effect = (line.effect as number | undefined) ?? null;
    const sameEffect =
      want.effect === null ? effect === null : typeof effect === 'number' && near(effect, want.effect, 1e-9);
    const sameRho =
      line.rho === rho &&
      typeof line.designEffect === 'number' &&
      near(line.designEffect, want.designEffect, 1e-12);
    return sameEffect && sameRho
      ? ok()
      : fail(
          `planCampaign(specs, targets, ['F'], ${repeats}, { baselineRate: ${baselineRate}, rho: ${rho} }) on ${n} specs gives the line ${show(line)}; want effect ${show(want.effect)}, rho ${rho} and designEffect ${want.designEffect}, as stats.mde({ n: ${n}, repeats: ${repeats}, baselineRate: ${baselineRate}, rho: ${rho} }) gives. Add PlanOptions.rho (the rho icc measures), pass it to mde with the specs as n, and print rho and the design effect on each line. Need: ${STATISTICS_NEED}.`,
        );
  };
}

const planRhoRange: BankItem['check'] = async ({ root }) => {
  const plan = (await load(root, CAMPAIGN)).planCampaign as PlanFn;
  const got = attempt(() => plan(specs(6), [TARGET], ['F'], 5, { baselineRate: 0.9, rho: 1.5 }));
  return got.error instanceof RangeError
    ? ok()
    : fail(
        `planCampaign with options.rho 1.5 ${got.error ? `threw ${got.error.name}` : `returned ${show(got.value?.mde)}`}; a correlation outside [0, 1] must throw a RangeError naming rho. Need: ${STATISTICS_NEED}.`,
      );
};

type Main = (
  argv: string[],
  io: { out(t: string): void; err(t: string): void; cwd: string },
) => Promise<number>;

/** `driftbench campaign plan` on the Acme specs (6 specs), the printed effect of mode F in points. */
async function cliPlan(
  root: string,
  extra: string[],
): Promise<{ code: number; points?: number; out: string }> {
  const main = (await load(root, 'packages/cli/src/main.ts')).main as Main;
  let out = '';
  const io = {
    out: (t: string) => {
      out += t;
    },
    err: (t: string) => {
      out += t;
    },
    cwd: root,
  };
  const code = await main(
    [
      'campaign',
      'plan',
      'examples/acme/specs/conversations',
      '--repeats',
      '5',
      '--baseline-rate',
      '0.9',
      ...extra,
    ],
    io,
  );
  const match = /Minimum detectable effect, mode F: ([0-9.]+) points/.exec(out);
  return { code, out, ...(match ? { points: Number(match[1]) } : {}) };
}

function cliCheck(extra: string[], rho: number | undefined, fix: string): BankItem['check'] {
  return async ({ s, root }) => {
    const run = await cliPlan(root, extra);
    const want = s.mde({ n: 6, repeats: 5, baselineRate: 0.9, ...(rho === undefined ? {} : { rho }) }).effect;
    const wantText = want === null ? 'none' : (want * 100).toFixed(1);
    const line =
      run.out.split('\n').find((l) => l.startsWith('Minimum detectable effect, mode F')) ??
      run.out.slice(0, 300);
    return run.code === 0 && run.points !== undefined && wantText === run.points.toFixed(1)
      ? ok()
      : fail(
          `driftbench campaign plan examples/acme/specs/conversations --repeats 5 --baseline-rate 0.9 ${extra.join(' ')} exited ${run.code} and printed "${line.trim()}"; the six Acme specs with 5 repeats want ${wantText} points, as stats.mde({ n: 6, repeats: 5, baselineRate: 0.9${rho === undefined ? '' : `, rho: ${rho}`} }) gives. ${fix} Need: ${STATISTICS_NEED}.`,
        );
  };
}

// ---------------------------------------------------------------------------------------------------------
// Planned: the session as the unit of an estate run.

type SessionRate = (
  runs: ReadonlyArray<{ session: string; pass: boolean }>,
  options: { rho: number },
) => Record<string, number>;

const SESSION_CAUSE = '@agent-nexus/driftbench-estate has no sessionRate (the session as the unit)';
const SESSION_NEED =
  'docs/estate.md, section 7, "Not built yet": "The session as the unit (one cluster), with the design effect from the measured correlation of the variance pilot"';
const SESSION_CONTRACT =
  'Export sessionRate(runs, { rho }) from @agent-nexus/driftbench-estate: runs are { session, pass }; m = runs / sessions; designEffect = 1 + (m - 1) rho; effectiveRuns = runs / designEffect; the interval is Wilson on round(effectiveRuns) runs with round(rate x round(effectiveRuns)) passes, as the pilot prints its pass rate (docs/generating.md); return { estimate, lower, upper, sessions, runs, designEffect, effectiveRuns }.';

function sessionWant(s: StatsImpl, sizes: readonly number[], passes: readonly number[], rho: number) {
  const runs = sizes.reduce((a, b) => a + b, 0);
  const k = passes.reduce((a, b) => a + b, 0);
  const m = runs / sizes.length;
  const designEffect = 1 + (m - 1) * rho;
  const effectiveRuns = runs / designEffect;
  const n = Math.max(1, Math.round(effectiveRuns));
  const w = s.wilson(Math.min(n, Math.round((k / runs) * n)), n);
  return {
    estimate: k / runs,
    lower: w.lower,
    upper: w.upper,
    sessions: sizes.length,
    runs,
    designEffect,
    effectiveRuns,
  };
}

function sessionCheck(sizes: readonly number[], passes: readonly number[], rho: number): BankItem['check'] {
  return async ({ s, root }) => {
    const f = (await load(root, ESTATE)).sessionRate as SessionRate | undefined;
    if (typeof f !== 'function')
      return fail(
        `@agent-nexus/driftbench-estate exports no function sessionRate. ${SESSION_CONTRACT} Need: ${SESSION_NEED}.`,
      );
    const runs = sizes.flatMap((size, i) =>
      Array.from({ length: size }, (_, r) => ({ session: `session-${i}`, pass: r < (passes[i] as number) })),
    );
    const got = attempt(() => f(runs, { rho }));
    if (got.error)
      return fail(
        `sessionRate on ${sizes.length} sessions, rho ${rho}, threw ${got.error.message}. ${SESSION_CONTRACT}`,
      );
    const want = sessionWant(s, sizes, passes, rho);
    for (const [key, value] of Object.entries(want)) {
      const v = (got.value as Record<string, unknown>)[key];
      if (typeof v !== 'number' || !near(v, value, 1e-9))
        return fail(
          `sessionRate on sessions of sizes ${show(sizes)} with ${show(passes)} passes, rho ${rho}: ${key} ${show(v)}, want ${value}. ${SESSION_CONTRACT} Need: ${SESSION_NEED}.`,
        );
    }
    return ok();
  };
}

const sessionRange: BankItem['check'] = async ({ root }) => {
  const f = (await load(root, ESTATE)).sessionRate as SessionRate | undefined;
  if (typeof f !== 'function')
    return fail(`@agent-nexus/driftbench-estate exports no function sessionRate. ${SESSION_CONTRACT}`);
  const got = attempt(() =>
    f(
      [
        { session: 'a', pass: true },
        { session: 'a', pass: false },
      ],
      { rho: -0.2 },
    ),
  );
  return got.error instanceof RangeError
    ? ok()
    : fail(
        `sessionRate with rho -0.2 ${got.error ? `threw ${got.error.name}` : `returned ${show(got.value)}`}; the measured correlation of the pilot lies in [0, 1] (the pilot clamps it there): throw a RangeError naming rho. Need: ${SESSION_NEED}.`,
      );
};

// ---------------------------------------------------------------------------------------------------------
// Planned: the early stop.

const EARLY_CAUSE =
  'the runner runs every repeat of a spec whose first two free-running repeats failed (no early stop)';
const EARLY_NEED =
  'docs/concepts/run-modes.md, "Around the modes": "Stopping a spec early when its first two free-running repeats both fail a gating machine check is planned"';
const EARLY_CONTRACT =
  'Add CampaignRunOptions.earlyStop: when true, once repeats 0 and 1 of a spec in mode F (same target) both fail a gating machine check, the later F repeats of that spec are not run and come back with state "stopped" and earlyStop { after: 2 }; a spec that passes repeat 0 or 1 runs every repeat.';

type CellOutcome = {
  cell: { specId: string; repeat: number; mode: string };
  state: string;
  earlyStop?: unknown;
};

const earlyRuns = new Map<
  string,
  Promise<{ outcomes: CellOutcome[]; stored: Map<string, number> } | string>
>();

/** The Acme specs on the x1-invents-price fault, F mode, 4 repeats, with earlyStop: true (one run per process). */
function earlyCampaign(root: string) {
  let run = earlyRuns.get(root);
  if (!run) {
    run = (async () => {
      const core = await load(root, 'packages/core/src/index.ts');
      const { defaultChecks } = await load(root, 'packages/checks/src/index.ts');
      const { faultAdapter } = await load(root, 'packages/generate/src/index.ts');
      const { localProvider } = await load(root, 'packages/sandbox/src/index.ts');
      const { createScriptedDriver } = await load(root, 'packages/users/src/index.ts');
      const { openMemoryStore } = await load(root, 'packages/store/src/index.ts');
      const { faults } = await load(root, 'examples/acme/faults/index.ts');
      const loadSpecs = core.loadSpecs as (
        paths: string[],
      ) => Promise<Array<{ ok: boolean; spec: { id: string }; hash: string }>>;
      const entries = (await loadSpecs([join(root, 'examples/acme/specs/conversations')])).filter(
        (e) => e.ok,
      );
      const fault = (faults as Array<{ id: string }>).find((f) => f.id === 'x1-invents-price');
      if (!fault) return 'examples/acme/faults has no fault x1-invents-price';
      const store = await (
        openMemoryStore as () => Promise<Record<string, (...a: unknown[]) => Promise<unknown>>>
      )();
      const target = { adapter: 'function', agent: 'acme-sales', variant: 'fault-x1-invents-price' };
      for (const e of entries) await store.putSpec?.(e);
      await store.putCampaign?.({
        campaignId: 'c-early',
        specs: entries.map((e) => ({ id: e.spec.id, hash: e.hash, target })),
        targets: [target],
        modes: ['F'],
        repeats: { T: 0, F: 4, P: 0 },
        budgetUsd: 0,
        judge: { mode: 'system1', judges: [] },
        createdAt: FIXED,
      });
      const bySpec = new Map(entries.map((e) => [`${e.spec.id}@${e.hash}`, e.spec]));
      const plan = (
        core.planCampaign as (...a: unknown[]) => { cells: Array<{ specId: string; specHash: string }> }
      )(entries, [target], ['F'], 4);
      const outcomes = (await (core.runCampaign as (o: unknown) => Promise<CellOutcome[]>)({
        campaignId: 'c-early',
        cells: plan.cells,
        specFor: (cell: { specId: string; specHash: string }) =>
          bySpec.get(`${cell.specId}@${cell.specHash}`),
        adapterFor: () =>
          (faultAdapter as (f: unknown, p: unknown) => unknown)(fault, () =>
            (localProvider as () => unknown)(),
          ),
        driver: () => (createScriptedDriver as () => unknown)(),
        checks: (defaultChecks as () => unknown)(),
        store,
        now: () => new Date(FIXED),
        concurrency: 1,
        earlyStop: true,
      })) as CellOutcome[];
      const runs = (await store.listRuns?.({ campaignId: 'c-early' })) as Array<{ specId: string }>;
      const stored = new Map<string, number>();
      for (const r of runs) stored.set(r.specId, (stored.get(r.specId) ?? 0) + 1);
      await store.close?.();
      return { outcomes, stored };
    })();
    earlyRuns.set(root, run);
  }
  return run;
}

function earlyCheck(which: 'failing' | 'passing'): BankItem['check'] {
  return async ({ root }) => {
    const result = await earlyCampaign(root);
    if (typeof result === 'string') return fail(result);
    const bySpec = new Map<string, CellOutcome[]>();
    for (const o of result.outcomes) bySpec.set(o.cell.specId, [...(bySpec.get(o.cell.specId) ?? []), o]);
    for (const [spec, cells] of bySpec) {
      cells.sort((a, b) => a.cell.repeat - b.cell.repeat);
      const firstTwoFail = cells.slice(0, 2).every((c) => c.state === 'fail');
      const states = cells.map((c) => c.state);
      if (which === 'failing' && firstTwoFail) {
        const later = cells.slice(2);
        const stopped = later.every((c) => c.state === 'stopped' && c.earlyStop !== undefined);
        if (!stopped || (result.stored.get(spec) ?? 0) !== 2)
          return fail(
            `with earlyStop: true, ${spec} failed a gating machine check in F repeats 0 and 1 (fault x1-invents-price of the Acme example), and its repeats came back ${show(states)} with ${result.stored.get(spec) ?? 0} runs stored; want repeats 2 and 3 stopped with an earlyStop marker and 2 runs stored. ${EARLY_CONTRACT} Need: ${EARLY_NEED}.`,
          );
      }
      if (which === 'passing' && !firstTwoFail && states.some((st) => st === 'stopped'))
        return fail(
          `with earlyStop: true, ${spec} passed an early repeat yet came back ${show(states)}; a spec is stopped only when its first two free-running repeats both fail. ${EARLY_CONTRACT} Need: ${EARLY_NEED}.`,
        );
      if (which === 'passing' && !firstTwoFail && (result.stored.get(spec) ?? 0) !== cells.length)
        return fail(
          `with earlyStop: true, ${spec} has ${result.stored.get(spec) ?? 0} runs stored of ${cells.length}. ${EARLY_CONTRACT}`,
        );
    }
    const any = [...bySpec.values()].some((cells) =>
      which === 'failing'
        ? cells.slice(0, 2).every((c) => c.state === 'fail')
        : !cells.slice(0, 2).every((c) => c.state === 'fail'),
    );
    return any
      ? ok()
      : fail(`the early stop campaign has no ${which} spec to judge; the Acme fault changed.`);
  };
}

// ---------------------------------------------------------------------------------------------------------
// Printouts that the report computes beside the library.

type Line = {
  runs: number;
  passRate: { k: number; lower: number; upper: number };
  passK: Array<{ k: number; value: number; lower: number; upper: number }>;
  passAtK: Array<{ k: number; value: number; lower: number; upper: number }>;
};

const passKBounds: BankItem['check'] = async ({ s, root }) => {
  const reliability = (await load(root, RELIABILITY)).reliability as (data: unknown) => Line[];
  const lines = reliability(dataOf(campaignRuns([0, 1, 3, 5], 5)));
  for (const line of lines) {
    const c = line.passRate.k;
    const w = s.wilson(c, line.runs);
    for (let k = 1; k <= line.runs; k += 1) {
      const rowK = line.passK[k - 1];
      const rowAtK = line.passAtK[k - 1];
      // The raised Wilson bounds, widened to contain the exact value (the exact pass^k sits below p^k).
      const pk = s.passK(c, line.runs, k);
      const pak = s.passAtK(c, line.runs, k);
      const want = {
        passK: [pk, Math.min(w.lower ** k, pk), Math.max(w.upper ** k, pk)],
        passAtK: [pak, Math.min(1 - (1 - w.lower) ** k, pak), Math.max(1 - (1 - w.upper) ** k, pak)],
      };
      for (const [name, got] of [
        ['passK', rowK],
        ['passAtK', rowAtK],
      ] as const) {
        const triple = [got?.value, got?.lower, got?.upper];
        if (!triple.every((v, i) => typeof v === 'number' && near(v, want[name][i] as number, 1e-12)))
          return fail(
            `report reliability, a line of ${c} passes in ${line.runs} repeats, ${name} at k ${k}: ${show(got)}; want value ${want[name][0]} (stats.${name}) and bounds ${want[name][1]} to ${want[name][2]} (the Wilson bounds of the per-run rate raised the same way, widened to contain the value). Need: driftbench report prints pass^k and pass@k with their interval (docs/concepts/statistics.md).`,
          );
      }
    }
  }
  return ok();
};

const allPassClusters: BankItem['check'] = async ({ s, root }) => {
  const rel = await load(root, RELIABILITY);
  const data = dataOf(campaignRuns([4, 4, 4, 4, 4, 4, 4], 4));
  const lines = (rel.reliability as (d: unknown) => unknown[])(data);
  const modes = (
    rel.modeReliability as (d: unknown, l: unknown[]) => Array<{ runPass?: Record<string, number | string> }>
  )(data, lines);
  const got = modes[0]?.runPass;
  const w = s.wilson(7, 7);
  return got &&
    got.method === 'wilson, clusters' &&
    near(got.lower as number, w.lower, 1e-12) &&
    near(got.upper as number, w.upper, 1e-12) &&
    got.estimate === 1
    ? ok()
    : fail(
        `report modeReliability on 7 specs of 4 repeats that all pass: run pass ${show(got)}; want estimate 1 with the Wilson interval over the 7 specs, each spec counted once (${w.lower} to 1, method "wilson, clusters"): a bootstrap of values that all agree has no width. Need: driftbench report prints the run pass rate of each mode with its interval (docs/concepts/statistics.md, one conversation or task being one cluster).`,
      );
};

const noiseFloor: BankItem['check'] = async ({ s, root }) => {
  const spreadOf = (await load(root, SPREAD)).spread as (
    data: unknown,
    o: unknown,
  ) => { noise?: Record<string, number> };
  const passing = [1, 2, 3, 4, 2, 3];
  const repeats = 5;
  const got = attempt(() => spreadOf(dataOf(campaignRuns(passing, repeats)), { margin: 0.02 }));
  if (got.error) return fail(`report spread threw ${got.error.message}`);
  const noise = got.value?.noise;
  // The pooled within-spec variance of the pass flags, (n - 1) in each spec's denominator.
  let ss = 0;
  for (const c of passing) ss += c * (1 - c / repeats) ** 2 + (repeats - c) * (c / repeats) ** 2;
  const variance = ss / (passing.length * (repeats - 1));
  const z = 1.959963984540054;
  const perGolden = z * Math.sqrt((2 * variance) / repeats);
  let r = 1;
  while (z * Math.sqrt((2 * variance) / r) > 0.05) r += 1;
  const floor = s.repeatsForFloor({ variance, floor: 0.05 });
  const fine =
    noise &&
    near(noise.variance as number, variance, 1e-12) &&
    near(noise.perGolden as number, perGolden, 1e-12) &&
    noise.repeatsFor5Points === r &&
    floor.repeats === r;
  return fine
    ? ok()
    : fail(
        `report spread on 6 specs of 5 repeats with ${show(passing)} passes: noise ${show(noise)}, stats.repeatsForFloor gives ${show(floor)}; want variance ${variance}, perGolden ${perGolden} (z sqrt(2 variance / repeats)) and repeatsFor5Points ${r}, the smallest r with z sqrt(2 variance / r) <= 0.05 (docs/concepts/statistics.md, repeatsForFloor). Need: the scorecard's spread view prints the noise floor and the repeats for 5 points (docs/generating.md).`,
      );
};

export function productItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const [n, repeats, p] of [
    [6, 5, 0.9],
    [40, 1, 0.5],
    [200, 3, 0.95],
    [1, 1, 0.5],
  ] as const) {
    out.push(
      item(
        `planned.plan-mde.n${n}-r${repeats}-p${p}`,
        'roadmap',
        5,
        CAMPAIGN,
        MDE_CAUSE,
        planMde(n, repeats, p),
      ),
    );
  }
  for (const [n, repeats, p, rho] of [
    [6, 5, 0.9, 0.3],
    [40, 3, 0.8, 1],
  ] as const) {
    out.push(
      item(
        `planned.plan-rho.n${n}-r${repeats}-rho${rho}`,
        'roadmap',
        5,
        CAMPAIGN,
        RHO_CAUSE,
        planRho(n, repeats, p, rho),
      ),
    );
  }
  out.push(item('planned.plan-rho.out-of-range', 'roadmap', 5, CAMPAIGN, RHO_CAUSE, planRhoRange));
  out.push(
    item(
      'planned.plan-cli.mde',
      'roadmap',
      5,
      CLI_CAMPAIGN,
      MDE_CAUSE,
      cliCheck(
        [],
        undefined,
        'Print the effect of stats.mde, with the specs as n and the repeats as repeats.',
      ),
    ),
    item(
      'planned.plan-cli.rho',
      'roadmap',
      5,
      CLI_CAMPAIGN,
      'campaign plan has no --rho flag',
      cliCheck(
        ['--rho', '0.3'],
        0.3,
        'Add --rho <rho> to campaign plan (the rho icc measures, default 0) and pass it to the plan.',
      ),
    ),
  );
  for (const [key, sizes, passes, rho] of [
    ['one-run-each', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 1, 1, 0, 1, 1, 1], 0.4],
    ['equal-sessions', [4, 4, 4, 4, 4, 4, 4, 4, 4, 4], [4, 3, 4, 0, 2, 4, 4, 1, 4, 3], 0.25],
    ['unequal-sessions', [2, 7, 3, 1, 5], [2, 4, 3, 0, 5], 0.5],
  ] as const) {
    out.push(
      item(
        `planned.estate-session.${key}`,
        'roadmap',
        5,
        ESTATE,
        SESSION_CAUSE,
        sessionCheck(sizes, passes, rho),
      ),
    );
  }
  out.push(item('planned.estate-session.rho-range', 'roadmap', 5, ESTATE, SESSION_CAUSE, sessionRange));
  out.push(
    item('planned.early-stop.stops', 'roadmap', 5, CAMPAIGN, EARLY_CAUSE, earlyCheck('failing')),
    item('planned.early-stop.keeps', 'roadmap', 5, CAMPAIGN, EARLY_CAUSE, earlyCheck('passing')),
  );
  out.push(
    item(
      'agree.report.pass-k-bounds',
      'analytic',
      4,
      RELIABILITY,
      "the report's pass^k or pass@k differs from the library",
      passKBounds,
    ),
    item(
      'agree.report.all-pass-clusters',
      'analytic',
      4,
      'packages/report/src/estimate.ts',
      "the report's interval on an all-pass rate does not count each spec once",
      allPassClusters,
    ),
    item(
      'agree.report.noise-floor',
      'analytic',
      4,
      SPREAD,
      "the report's noise floor differs from repeatsForFloor",
      noiseFloor,
    ),
  );
  return out;
}
