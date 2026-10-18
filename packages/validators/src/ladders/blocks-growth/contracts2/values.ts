import { type BlockRecord, type RawSpec, run } from '../../blocks/harness';
import { type FileAction, plantedAgent, token } from '../../blocks/kinds';
import { type BlocksProduct, need } from '../../blocks/product';
import { type BlockDef, play, scenario, verdictOf } from '../../blocks-breaker/kit';
import type { C2Cause } from './causes';
import { type BankItem, c2, type ItemContext, show, type Tier, tok, unless } from './kit';

/**
 * Value ladder and value checks for code (docs/reference/block-contracts.md, "Value ladder", "Value checks for
 * code"): the pass evidence of a declared exact compare and that it is never the default, the words of the exact
 * fallback, the { exact: <value> } form, the order of the policy items, named modes that settle nothing, the draws
 * and the digits of the recompute rung, and the sets, globs and paths of the state-diff rung. Spec items run the
 * tools check through the product's runner, as the command line does (no replayer, no judge); rung items call the
 * ladder of the checks package.
 */

const FAMILY = 'c2-values';
const LEVEL = 4;
const LADDER = 'packages/checks/src/value-check/ladder.ts';
const RECOMPUTE = 'packages/checks/src/value-check/recompute.ts';
const STATE_DIFF = 'packages/checks/src/value-check/state-diff.ts';
const TOOL = 'tool.write';
const F = 'ff';

type Entry = { call?: number; path?: string; rung?: string; outcome?: string };
type Verdict = { outcome?: string; gating?: boolean; evidence?: string; valueCheck?: Entry[] };

type Setup = {
  users: string[];
  actual: Record<string, unknown>;
  expected: Record<string, unknown>;
  compare?: unknown;
  schema?: Record<string, unknown>;
  uses?: unknown;
};

/** One spec whose last block calls the tool once; the tools check decides each field of the input. */
async function ladderRun(ctx: ItemContext, tag: string, setup: Setup) {
  const last = setup.users.length - 1;
  const defs: BlockDef[] = setup.users.map((text, index) => ({
    say: (marker) => `${marker} ${text}`,
    plan: { text: 'Done.', calls: index === last ? [{ label: TOOL, input: setup.actual }] : [] },
    expect:
      index === last
        ? {
            tools: [
              {
                label: TOOL,
                count: 1,
                input: setup.expected,
                ...(setup.compare !== undefined ? { compare: setup.compare } : {}),
              },
            ],
          }
        : {},
  }));
  const spec: Record<string, unknown> = {
    ...(setup.schema
      ? { metadata: { tool_schemas: { [TOOL]: { type: 'object', properties: setup.schema } } } }
      : {}),
    ...(setup.uses !== undefined ? { uses: setup.uses } : {}),
  };
  const { rec } = await play(ctx, scenario(ctx.seed, `c2:${tag}`, defs, spec), { mode: 'F' });
  const block = rec.blocks[last] as BlockRecord | undefined;
  const verdict = verdictOf(block, `tools.${TOOL}.input.${F}`) as Verdict | undefined;
  return {
    verdict,
    rung: verdict?.valueCheck?.[0]?.rung,
    evidence: String(verdict?.evidence ?? ''),
    lint: verdictOf(block, `tools.${TOOL}.input.${F}.no_decider`) as Verdict | undefined,
  };
}

type Out = Awaited<ReturnType<typeof ladderRun>>;
const describe = (out: Out) =>
  show({
    outcome: out.verdict?.outcome,
    valueCheck: out.verdict?.valueCheck,
    evidence: out.evidence.slice(0, 120),
  });
const decided = (out: Out, rung: string, outcome = 'fail') =>
  out.verdict?.outcome === outcome && out.rung === rung;

const upper = (ctx: ItemContext, tag: string, slot: string) => tok(ctx, tag, slot, 6).toUpperCase();
const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type SpecCase = {
  id: string;
  tier: Tier;
  cause: C2Cause;
  component: string;
  title: string;
  run(ctx: ItemContext, tag: string): Promise<ReadonlyArray<string | undefined>>;
};

const SPEC_CASES: SpecCase[] = [
  {
    id: 'exact-pass-evidence',
    tier: 3,
    cause: 'exact-pass-evidence',
    component: LADDER,
    title:
      'under compare exact the exact value passes with the evidence exactly <expected> (<reason>), and another writing fails',
    run: async (ctx, tag) => {
      const v = upper(ctx, tag, 'v');
      const reason = `${tok(ctx, tag, 'r1', 6)} ${tok(ctx, tag, 'r2', 7)}`;
      const equal = await ladderRun(ctx, `${tag}:eq`, {
        users: ['go'],
        actual: { [F]: v },
        expected: { [F]: v },
        compare: { exact: reason },
      });
      const differs = await ladderRun(ctx, `${tag}:df`, {
        users: ['go'],
        actual: { [F]: v.toLowerCase() },
        expected: { [F]: v },
        compare: { exact: reason },
      });
      return [
        unless(equal.verdict?.outcome === 'pass', `the exact value should pass: ${describe(equal)}`),
        unless(
          new RegExp(`exactly "?${escapeText(v)}"? \\(${escapeText(reason)}\\)`).test(equal.evidence),
          `the pass evidence should read exactly ${v} (${reason}); it reads: ${equal.evidence.slice(0, 200)}`,
        ),
        unless(differs.verdict?.outcome === 'fail', `another writing should fail: ${describe(differs)}`),
      ];
    },
  },
  {
    id: 'exact-never-default',
    tier: 3,
    cause: 'exact-never-default',
    component: LADDER,
    title:
      'a differing writing is never decided by rung4_exact under compare auto or with no compare, and is under compare exact',
    run: async (ctx, tag) => {
      const v = upper(ctx, tag, 'v');
      const base = { users: ['go'], actual: { [F]: `${v}X` }, expected: { [F]: v } };
      const auto = await ladderRun(ctx, `${tag}:auto`, { ...base, compare: 'auto' });
      const none = await ladderRun(ctx, `${tag}:none`, base);
      const exact = await ladderRun(ctx, `${tag}:exact`, {
        ...base,
        compare: { exact: tok(ctx, tag, 'why', 8) },
      });
      return [
        unless(
          decided(exact, 'rung4_exact'),
          `compare exact should decide by rung4_exact: ${describe(exact)}`,
        ),
        unless(
          decided(auto, 'exact_fallback'),
          `compare auto should leave the value to the exact fallback, never rung4_exact: ${describe(auto)}`,
        ),
        unless(
          decided(none, 'exact_fallback'),
          `no compare should leave the value to the exact fallback, never rung4_exact: ${describe(none)}`,
        ),
      ];
    },
  },
  {
    id: 'fallback-evidence-words',
    tier: 3,
    cause: 'fallback-evidence',
    component: LADDER,
    title:
      'a value no item settles fails with the evidence exact_fallback: no decider configured for <tool>.<field>; compared exactly: <value> is not <expected>',
    run: async (ctx, tag) => {
      const v = upper(ctx, tag, 'v');
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: v.toLowerCase() },
        expected: { [F]: v },
      });
      const want = new RegExp(
        `exact_fallback: no decider configured for ${escapeText(`${TOOL}.${F}`)}; compared exactly: "?${escapeText(v.toLowerCase())}"? is not "?${escapeText(v)}"?`,
      );
      return [
        unless(
          decided(out, 'exact_fallback'),
          `the value should fail at the exact fallback: ${describe(out)}`,
        ),
        unless(
          want.test(out.evidence),
          `the evidence should read ${want.source}; it reads: ${out.evidence.slice(0, 220)}`,
        ),
      ];
    },
  },
  {
    id: 'fallback-lists-as-given',
    tier: 4,
    cause: 'fallback-evidence',
    component: LADDER,
    title:
      'when the as-given item ran and settled nothing (the agent copied what the user wrote), the fallback evidence gives its reason, and no contract reason with no schema',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${a}`],
        actual: { [F]: a },
        expected: { [F]: e },
      });
      return [
        unless(
          decided(out, 'exact_fallback'),
          `the copied value should fail at the exact fallback: ${describe(out)}`,
        ),
        unless(
          /rung2b_as_given/.test(out.evidence),
          `the evidence should give the reason of rung2b_as_given, which ran: ${out.evidence.slice(0, 220)}`,
        ),
        unless(
          !/rung2_contract/.test(out.evidence),
          `no schema states a format, so rung2_contract never ran and has no reason: ${out.evidence.slice(0, 220)}`,
        ),
      ];
    },
  },
  {
    id: 'fallback-lists-contract',
    tier: 4,
    cause: 'fallback-evidence',
    component: LADDER,
    title:
      'when the contract item ran and passed nothing (both writings fit the pattern), the fallback evidence gives its reason, and no as-given reason with no source',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: a },
        expected: { [F]: e },
        schema: { [F]: { type: 'string', pattern: '^[A-Z]+$' } },
      });
      return [
        unless(
          decided(out, 'exact_fallback'),
          `a value inside the pattern should fail at the exact fallback: ${describe(out)}`,
        ),
        unless(
          /rung2_contract/.test(out.evidence),
          `the evidence should give the reason of rung2_contract, which ran: ${out.evidence.slice(0, 220)}`,
        ),
        unless(
          !/rung2b_as_given/.test(out.evidence),
          `no message or file holds a value, so rung2b_as_given never ran: ${out.evidence.slice(0, 220)}`,
        ),
      ];
    },
  },
  {
    id: 'exact-form-goes-through-the-ladder',
    tier: 3,
    cause: 'exact-form-ladder',
    component: LADDER,
    title:
      'an { exact: <value> } assertion whose value the user gave and the agent changed is decided by rung2b_as_given, as a bare value is, and passes on the same value',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const wrapped = await ladderRun(ctx, `${tag}:w`, {
        users: [`It is ${e}`],
        actual: { [F]: a },
        expected: { [F]: { exact: e } },
      });
      const same = await ladderRun(ctx, `${tag}:s`, {
        users: [`It is ${e}`],
        actual: { [F]: e },
        expected: { [F]: { exact: e } },
      });
      return [
        unless(
          decided(wrapped, 'rung2b_as_given'),
          `the changed value under { exact } should be decided by rung2b_as_given: ${describe(wrapped)}`,
        ),
        unless(
          same.verdict?.outcome === 'pass',
          `the same value under { exact } should pass: ${describe(same)}`,
        ),
      ];
    },
  },
  {
    id: 'policy-order-decides',
    tier: 4,
    cause: 'policy-order',
    component: LADDER,
    title:
      'a value outside the enum that the user gave otherwise is decided by rung2_contract in the shipped order, and by rung2b_as_given when a uses object moves it first',
    run: async (ctx, tag) => {
      const [e, a, o] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a'), upper(ctx, tag, 'o')];
      const base = {
        users: [`It is ${e}`],
        actual: { [F]: a },
        expected: { [F]: e },
        schema: { [F]: { type: 'string', enum: [e, o] } },
      };
      const shipped = await ladderRun(ctx, `${tag}:shipped`, base);
      const moved = await ladderRun(ctx, `${tag}:moved`, {
        ...base,
        uses: {
          value_check: { extends: 'default', items: [{ id: 'rung2b_as_given', before: 'rung2_contract' }] },
        },
      });
      return [
        unless(
          decided(shipped, 'rung2_contract'),
          `in the shipped order rung2_contract comes first and decides: ${describe(shipped)}`,
        ),
        unless(
          decided(moved, 'rung2b_as_given'),
          `with rung2b_as_given moved before rung2_contract, it decides: ${describe(moved)}`,
        ),
      ];
    },
  },
  {
    id: 'same-referent-without-judge',
    tier: 4,
    cause: 'mode-cannot-apply',
    component: LADDER,
    title:
      'compare same_referent with no calibrated judge leaves the value to the exact fallback, though the user gave the value and the enum excludes it',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${e}`],
        actual: { [F]: a },
        expected: { [F]: e },
        compare: 'same_referent',
        schema: { [F]: { type: 'string', enum: [e] } },
      });
      return [
        unless(
          decided(out, 'exact_fallback'),
          `same_referent with no judge should reach the exact fallback, no other item: ${describe(out)}`,
        ),
      ];
    },
  },
  {
    id: 'as-given-mode-on-a-copy',
    tier: 4,
    cause: 'mode-runs-alone',
    component: LADDER,
    title:
      'compare as_given on a value the agent copied leaves it to the exact fallback, though the enum excludes it, while compare auto lets rung2_contract fail it',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const base = {
        users: [`It is ${a}`],
        actual: { [F]: a },
        expected: { [F]: e },
        schema: { [F]: { type: 'string', enum: [e] } },
      };
      const named = await ladderRun(ctx, `${tag}:named`, { ...base, compare: 'as_given' });
      const auto = await ladderRun(ctx, `${tag}:auto`, base);
      return [
        unless(
          decided(named, 'exact_fallback'),
          `compare as_given runs only rung2b_as_given, which settles nothing on a copy: ${describe(named)}`,
        ),
        unless(
          decided(auto, 'rung2_contract'),
          `compare auto lets rung2_contract fail the value outside the enum: ${describe(auto)}`,
        ),
      ];
    },
  },
  {
    id: 'contract-mode-inside-the-format',
    tier: 4,
    cause: 'mode-runs-alone',
    component: LADDER,
    title:
      'compare contract on a value inside the pattern that the user gave otherwise leaves it to the exact fallback, while compare as_given fails it',
    run: async (ctx, tag) => {
      const [e, a] = [upper(ctx, tag, 'e'), upper(ctx, tag, 'a')];
      const base = {
        users: [`It is ${e}`],
        actual: { [F]: a },
        expected: { [F]: e },
        schema: { [F]: { type: 'string', pattern: '^[A-Z]+$' } },
      };
      const named = await ladderRun(ctx, `${tag}:named`, { ...base, compare: 'contract' });
      const given = await ladderRun(ctx, `${tag}:given`, { ...base, compare: 'as_given' });
      return [
        unless(
          decided(named, 'exact_fallback'),
          `compare contract runs only rung2_contract, which passes nothing: ${describe(named)}`,
        ),
        unless(
          decided(given, 'rung2b_as_given'),
          `compare as_given fails the changed value: ${describe(given)}`,
        ),
      ];
    },
  },
];

function specItems(): BankItem[] {
  return SPEC_CASES.map((specCase) =>
    c2(
      FAMILY,
      `c2.values.ladder.${specCase.id}`,
      specCase.tier,
      LEVEL,
      specCase.component,
      specCase.cause,
      specCase.title,
      (ctx) => specCase.run(ctx, `values.${specCase.id}`),
    ),
  );
}

type Result = Record<string, unknown> & { outcome?: string; rung?: string };
type RunLadder = (
  value: Record<string, unknown>,
  policy?: unknown,
  services?: Record<string, unknown>,
) => Promise<Result>;
const ladder = (product: BlocksProduct): RunLadder => need<RunLadder>(product.checks, 'checks', 'runLadder');

/** Whether `key` is true anywhere in the value, at any depth. */
function holdsTrue(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) return value.some((each) => holdsTrue(each, keys));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, each]) => (keys.includes(key) && each === true) || holdsTrue(each, keys),
  );
}

const CHANGED = ['changed_inputs_fail', 'changedInputsFail'];

async function recompute(
  ctx: ItemContext,
  produced: string,
  expected: string,
  inputs: Record<string, number>,
) {
  return ladder(ctx.product)(
    {
      field: 'Total',
      gold: `=${expected}`,
      value: `=${produced}`,
      recompute: { produced: { formula: produced }, expected: { formula: expected }, inputs },
    },
    undefined,
    {},
  );
}

const verdictOfResult = (result: Result) => show({ outcome: result.outcome, rung: result.rung });
const decidedBy = (result: Result, outcome: string, rung: string) =>
  result.outcome === outcome && result.rung === rung;

type RecomputeCase = {
  id: string;
  tier: Tier;
  cause: C2Cause;
  title: string;
  run(ctx: ItemContext, c: number): Promise<ReadonlyArray<string | undefined>>;
};

/** A seeded integer input of the item, 20 to 89. */
const seedInput = (ctx: ItemContext, tag: string) =>
  20 + (token(ctx.seed, `c2:${tag}`, 2).charCodeAt(0) % 70);

const RECOMPUTE_CASES: RecomputeCase[] = [
  {
    id: 'integer-input-stays-integer',
    tier: 4,
    cause: 'recompute',
    title:
      'a formula equal to the gold on every whole number of B2 passes when B2 is an integer: its changed draws stay integers',
    run: async (ctx, c) => {
      const b = 3 + (c % 7);
      const result = await recompute(ctx, 'C2*12+ROUND(B2*2,0)/2-B2', 'C2*12', { B2: b, C2: c });
      return [
        unless(
          decidedBy(result, 'pass', 'rung1_recompute'),
          `with B2 = ${b}, every integer draw agrees, so the rung passes; it decided ${verdictOfResult(result)}`,
        ),
      ];
    },
  },
  {
    id: 'changed-inputs-fail-emitted',
    tier: 4,
    cause: 'changed-inputs-fail',
    title:
      'a formula equal to the gold on the given inputs and not on changed ones fails with changed_inputs_fail: true',
    run: async (ctx, c) => {
      const b = 3 + (c % 7) + 0.5;
      const result = await recompute(ctx, 'C2*12+ROUND(B2*2,0)/2-B2', 'C2*12', { B2: b, C2: c });
      return [
        unless(
          decidedBy(result, 'fail', 'rung1_recompute'),
          `with B2 = ${b} the given inputs agree and a changed one does not, so the rung fails; it decided ${verdictOfResult(result)}`,
        ),
        unless(
          holdsTrue(result, CHANGED),
          `the rung should emit changed_inputs_fail: true; the result is ${show(result)}`,
        ),
      ];
    },
  },
  {
    id: 'no-changed-inputs-fail-on-given',
    tier: 3,
    cause: 'changed-inputs-fail',
    title: 'a formula that differs on the given inputs fails on them, with no changed_inputs_fail: true',
    run: async (ctx, c) => {
      const result = await recompute(ctx, 'C2*12+1', 'C2*12', { B2: 4, C2: c });
      return [
        unless(
          decidedBy(result, 'fail', 'rung1_recompute'),
          `the rung should fail on the given inputs; it decided ${verdictOfResult(result)}`,
        ),
        unless(
          !holdsTrue(result, CHANGED),
          `the given inputs differ, so changed_inputs_fail is not true; the result is ${show(result)}`,
        ),
      ];
    },
  },
  {
    id: 'draw-equal-to-seed-moved',
    tier: 5,
    cause: 'recompute',
    title:
      'with an integer input of 1, whose only integer draw in 0.5 to 1.5 times is 1 itself, the moved draw catches a formula exact only at 1',
    run: async (ctx, c) => {
      const caught = await recompute(ctx, 'C2*12+(B2-1)*5', 'C2*12', { B2: 1, C2: c });
      const same = await recompute(ctx, 'C2*12', 'C2*12', { B2: 1, C2: c });
      return [
        unless(
          decidedBy(caught, 'fail', 'rung1_recompute'),
          `a draw equal to the seed value is moved, so B2 changes and the rung fails; it decided ${verdictOfResult(caught)}`,
        ),
        unless(
          decidedBy(same, 'pass', 'rung1_recompute'),
          `the same formula passes; it decided ${verdictOfResult(same)}`,
        ),
      ];
    },
  },
  {
    id: 'twelve-significant-digits',
    tier: 4,
    cause: 'significant-digits',
    title:
      'a result off in the 16th significant digit passes and one off in the 10th fails, at the default 12 digits',
    run: async (ctx, c) => {
      const close = await recompute(ctx, 'C2*12+C2/100000000000000', 'C2*12', { B2: 4, C2: c });
      const far = await recompute(ctx, 'C2*12+C2/100000000', 'C2*12', { B2: 4, C2: c });
      return [
        unless(
          decidedBy(close, 'pass', 'rung1_recompute'),
          `a difference past the 12th digit should pass; it decided ${verdictOfResult(close)}`,
        ),
        unless(
          decidedBy(far, 'fail', 'rung1_recompute'),
          `a difference inside the 12th digit should fail; it decided ${verdictOfResult(far)}`,
        ),
      ];
    },
  },
];

function recomputeItems(): BankItem[] {
  return RECOMPUTE_CASES.map((recomputeCase) =>
    c2(
      FAMILY,
      `c2.values.recompute.${recomputeCase.id}`,
      recomputeCase.tier,
      LEVEL,
      RECOMPUTE,
      recomputeCase.cause,
      recomputeCase.title,
      (ctx) => recomputeCase.run(ctx, seedInput(ctx, recomputeCase.id)),
    ),
  );
}

type Diff = { created: string[]; changed: string[]; deleted: string[] };
const diff = (part: Partial<Diff>): Diff => ({ created: [], changed: [], deleted: [], ...part });

async function stateDiff(ctx: ItemContext, observed: Diff, expected: Partial<Diff>, allowed?: string[]) {
  return ladder(ctx.product)(
    {
      field: 'workspace',
      gold: expected,
      value: observed,
      stateDiff: { diff: observed, expected, ...(allowed ? { allowed } : {}) },
    },
    undefined,
    {},
  );
}

type DiffCase = {
  id: string;
  tier: Tier;
  cause: C2Cause;
  title: string;
  run(ctx: ItemContext, base: string): Promise<ReadonlyArray<string | undefined>>;
};

const DIFF_CASES: DiffCase[] = [
  {
    id: 'star-stays-in-one-folder',
    tier: 3,
    cause: 'state-diff',
    title: 'an allowed glob <folder>/* does not allow a file one folder deeper, and <folder>/** does',
    run: async (ctx, base) => {
      const observed = diff({ created: [`${base}/a.csv`, `${base}/logs/deep/run.txt`] });
      const expected = { created: [`${base}/a.csv`] };
      const star = await stateDiff(ctx, observed, expected, [`${base}/logs/*`]);
      const stars = await stateDiff(ctx, observed, expected, [`${base}/logs/**`]);
      return [
        unless(
          decidedBy(star, 'fail', 'rung1_state_diff'),
          `* stays within one folder, so the deeper file is extra; the rung decided ${verdictOfResult(star)}`,
        ),
        unless(
          decidedBy(stars, 'pass', 'rung1_state_diff'),
          `** crosses folders and allows it; the rung decided ${verdictOfResult(stars)}`,
        ),
      ];
    },
  },
  {
    id: 'deleted-is-its-own-set',
    tier: 3,
    cause: 'state-diff',
    title: 'a path expected as deleted passes when the diff deletes it and fails when the diff changes it',
    run: async (ctx, base) => {
      const path = `${base}/old.csv`;
      const gone = await stateDiff(ctx, diff({ deleted: [path] }), { deleted: [path] });
      const kept = await stateDiff(ctx, diff({ changed: [path] }), { deleted: [path] });
      return [
        unless(
          decidedBy(gone, 'pass', 'rung1_state_diff'),
          `the deleted path is in the same set; the rung decided ${verdictOfResult(gone)}`,
        ),
        unless(
          decidedBy(kept, 'fail', 'rung1_state_diff'),
          `a path expected deleted and observed changed is missing and extra; the rung decided ${verdictOfResult(kept)}`,
        ),
      ];
    },
  },
  {
    id: 'observed-dot-slash',
    tier: 3,
    cause: 'state-diff',
    title:
      'an observed diff whose paths start with ./ matches the same paths expected without it, and an extra observed file still fails',
    run: async (ctx, base) => {
      const paths = [`${base}/a.csv`, `${base}/b.json`];
      const dotted = await stateDiff(ctx, diff({ created: paths.map((path) => `./${path}`) }), {
        created: paths,
      });
      const extra = await stateDiff(
        ctx,
        diff({ created: [...paths, `${base}/c.txt`].map((path) => `./${path}`) }),
        { created: paths },
      );
      return [
        unless(
          decidedBy(dotted, 'pass', 'rung1_state_diff'),
          `paths compare with no leading ./; the rung decided ${verdictOfResult(dotted)}`,
        ),
        unless(
          decidedBy(extra, 'fail', 'rung1_state_diff'),
          `an extra file fails; the rung decided ${verdictOfResult(extra)}`,
        ),
      ];
    },
  },
  {
    id: 'equal-diff-skips-identity',
    tier: 3,
    cause: 'diff-skips-identity',
    title:
      'a workspace diff equal to the expected one is decided by rung1_state_diff, never by identity, and a differing one fails there',
    run: async (ctx, base) => {
      const same = diff({ created: [`${base}/a.csv`] });
      const equal = await ladder(ctx.product)(
        {
          field: 'workspace',
          gold: same,
          value: structuredClone(same),
          stateDiff: { diff: structuredClone(same), expected: same },
        },
        undefined,
        {},
      );
      const other = await stateDiff(ctx, diff({ created: [`${base}/b.csv`] }), same);
      return [
        unless(
          decidedBy(equal, 'pass', 'rung1_state_diff'),
          `only the state-diff rung decides a workspace diff; the ladder decided ${verdictOfResult(equal)}`,
        ),
        unless(
          decidedBy(other, 'fail', 'rung1_state_diff'),
          `a differing diff fails at the state-diff rung; the ladder decided ${verdictOfResult(other)}`,
        ),
      ];
    },
  },
];

function diffItems(): BankItem[] {
  return DIFF_CASES.map((diffCase) =>
    c2(
      FAMILY,
      `c2.values.state-diff.${diffCase.id}`,
      diffCase.tier,
      LEVEL,
      STATE_DIFF,
      diffCase.cause,
      diffCase.title,
      (ctx) => diffCase.run(ctx, `out/${tok(ctx, diffCase.id, 'folder', 6)}`),
    ),
  );
}

/** A one-block task spec whose code agent writes `files`, then deletes `deletes`; the run's workspace diff. */
async function codeDiff(ctx: ItemContext, tag: string, files: FileAction[], deletes: string[]) {
  const marker = tok(ctx, tag, 'marker', 8);
  const raw: RawSpec = {
    id: `spec-${tok(ctx, tag, 'spec', 8)}`,
    kind: 'task',
    workspace_seed: { files: { 'data/rentals.csv': 'bike,days\nFern 3,4\n' } },
    blocks: [
      {
        id: tok(ctx, tag, 'id', 6),
        user: `${marker} Build the files.`,
        expect: { execution: { exit_code: 0 } },
      },
    ],
  };
  const agent = plantedAgent(
    ctx.product,
    'code',
    new Map([
      [marker, { reply: 'Done.', files, deletes, commands: [{ command: 'python make.py', exitCode: 0 }] }],
    ]),
    { scratch: ctx.scratch },
  );
  const record = await run(ctx.product, raw, agent.adapter);
  return (record.blocks[0]?.observed as { workspaceDiff?: Diff } | undefined)?.workspaceDiff;
}

function netDiffItem(): BankItem {
  return c2(
    FAMILY,
    'c2.values.state-diff.created-then-deleted-is-no-change',
    4,
    LEVEL,
    STATE_DIFF,
    'state-diff',
    'a file a code agent creates and deletes in the same block is no change: the expected diff passes, and the same file left behind fails as extra',
    async (ctx) => {
      const base = `out/${tok(ctx, 'net', 'folder', 6)}`;
      const files: FileAction[] = [
        { path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] },
        { path: `${base}/tmp.txt`, format: 'txt', data: 'scratch' },
      ];
      const expected = { created: [`${base}/a.csv`] };
      const net = await codeDiff(ctx, 'net-a', files, [`${base}/tmp.txt`]);
      const left = await codeDiff(ctx, 'net-b', files, []);
      if (!net || !left) return ['the code run recorded no workspace diff'];
      const passed = await stateDiff(ctx, net, expected);
      const failed = await stateDiff(ctx, left, expected);
      return [
        unless(
          decidedBy(passed, 'pass', 'rung1_state_diff'),
          `created then deleted is no change, so the diff ${show(net)} matches; the rung decided ${verdictOfResult(passed)}`,
        ),
        unless(
          decidedBy(failed, 'fail', 'rung1_state_diff'),
          `the file left behind is extra; the rung decided ${verdictOfResult(failed)} on ${show(left)}`,
        ),
      ];
    },
  );
}

function valueStampItem(): BankItem {
  return c2(
    FAMILY,
    'c2.values.stamp.value-policy-names-its-rung',
    4,
    LEVEL,
    'packages/checks/src/checks/tools.ts',
    'value-stamp',
    'a tool input the as-given rung fails names policy/value-check:default, the item rung2b_as_given and the layer shipped, and under a spec value_check object that object and the layer spec',
    async (ctx) => {
      const [e, a] = [upper(ctx, 'stamp', 'e'), upper(ctx, 'stamp', 'a')];
      const base = { users: [`It is ${e}`], actual: { [F]: a }, expected: { [F]: e } };
      const shipped = await ladderRun(ctx, 'stamp:shipped', base);
      const tailored = await ladderRun(ctx, 'stamp:spec', {
        ...base,
        uses: { value_check: { extends: 'default', items: [{ id: 'rung2_contract', enabled: false }] } },
      });
      type By = { object?: string; item?: string; layer?: string };
      const byOf = (out: Out) => (out.verdict as unknown as { by?: By } | undefined)?.by;
      const one = byOf(shipped);
      const two = byOf(tailored);
      return [
        unless(
          decided(shipped, 'rung2b_as_given'),
          `the changed value should be failed by rung2b_as_given: ${describe(shipped)}`,
        ),
        unless(
          /^policy\/value-check:default@[0-9a-f]{8}$/.test(one?.object ?? '') &&
            one?.item === 'rung2b_as_given' &&
            one?.layer === 'shipped',
          `the verdict should name policy/value-check:default@<hash8>, item rung2b_as_given, layer shipped; it names ${show(one)}`,
        ),
        unless(
          /^policy\/value-check:[^@]+@[0-9a-f]{8}$/.test(two?.object ?? '') &&
            !(two?.object ?? '').startsWith('policy/value-check:default@') &&
            two?.item === 'rung2b_as_given' &&
            two?.layer === 'spec',
          `under the spec value_check object the verdict should name that object, item rung2b_as_given, layer spec; it names ${show(two)}`,
        ),
      ];
    },
  );
}

/** The items of the Value ladder and Value checks for code sections. */
export function valuesItems(): BankItem[] {
  return [...specItems(), valueStampItem(), ...recomputeItems(), ...diffItems(), netDiffItem()];
}
