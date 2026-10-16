import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  type AgentLog,
  between,
  type Capabilities,
  code,
  list,
  observed,
  outcomeOf,
  pick,
  type RawSpec,
  type RunRecord,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
  statusOf,
} from '../harness';
import { startHttpAgent } from '../http-agent';
import { type BlocksProduct, need } from '../product';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 1: Given, When, Then and the four verdicts (docs/concepts/given-when-then.md, docs/concepts/block.md).
 * A spec of three to six blocks is planted from the seed: each block passes or fails by construction (its
 * reply says the code its `must` asks for, or not), and some blocks carry a Given layer (a written prefix, a
 * forced tool result) that the adapter may declare it cannot apply. The oracle is the documented rule: a
 * layer the adapter cannot apply is `not_run` from the block that sets it on (the `capability` check, kind
 * `unsupported`), the agent never sees that block, and the run is `fail` on any failing block, else `not_run`
 * on any block not run, else `pass`. The command line exits 0, 1 or 3 on the same rule.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const CAPABILITY = 'packages/core/src/runner/capability.ts';
const VERDICTS = 'packages/core/src/runner/verdicts.ts';
const GATE_EXIT = 'packages/cli/src/commands/gate-exit.ts';
const CAMPAIGN = 'packages/cli/src/commands/campaign.ts';
const HEADLINE = 'packages/report/src/headline.ts';

export type Plan = { fail: boolean; stub: boolean; prefix: boolean };

/** A named shape of a plan over n blocks: which blocks fail, which force a tool result, which write a prefix. */
type Pattern = { id: string; tier: Tier; plan(n: number, middle: number): Plan[] };

export const at = (n: number, positions: readonly number[], key: keyof Plan): Plan[] =>
  Array.from({ length: n }, (_, index) => ({
    fail: false,
    stub: false,
    prefix: false,
    ...(positions.includes(index) ? { [key]: true } : {}),
  }));

export const merge = (a: Plan[], b: Plan[]): Plan[] =>
  a.map((plan, index) => ({
    fail: plan.fail || (b[index]?.fail ?? false),
    stub: plan.stub || (b[index]?.stub ?? false),
    prefix: plan.prefix || (b[index]?.prefix ?? false),
  }));

const PATTERNS: Pattern[] = [
  { id: 'all-pass', tier: 1, plan: (n) => at(n, [], 'fail') },
  { id: 'fail-first', tier: 1, plan: (n) => at(n, [0], 'fail') },
  { id: 'fail-last', tier: 1, plan: (n) => at(n, [n - 1], 'fail') },
  { id: 'fail-middle', tier: 1, plan: (n, m) => at(n, [m], 'fail') },
  { id: 'all-fail', tier: 2, plan: (n) => at(n, [...Array(n).keys()], 'fail') },
  {
    id: 'alternating',
    tier: 2,
    plan: (n) =>
      at(
        n,
        [...Array(n).keys()].filter((index) => index % 2 === 1),
        'fail',
      ),
  },
  { id: 'stub-first', tier: 2, plan: (n) => at(n, [0], 'stub') },
  { id: 'stub-last', tier: 2, plan: (n) => at(n, [n - 1], 'stub') },
  { id: 'stub-middle', tier: 2, plan: (n, m) => at(n, [m], 'stub') },
  { id: 'prefix-first', tier: 3, plan: (n) => at(n, [0], 'prefix') },
  { id: 'prefix-last', tier: 3, plan: (n) => at(n, [n - 1], 'prefix') },
  { id: 'fail-then-stub', tier: 3, plan: (n, m) => merge(at(n, [m - 1], 'fail'), at(n, [m], 'stub')) },
  { id: 'stub-then-fail', tier: 3, plan: (n, m) => merge(at(n, [m], 'stub'), at(n, [n - 1], 'fail')) },
  { id: 'prefix-and-stub', tier: 4, plan: (n, m) => merge(at(n, [m], 'prefix'), at(n, [m], 'stub')) },
];

type CapabilitySet = { id: string; caps: Capabilities; tier: number };

const CAPABILITY_SETS: CapabilitySet[] = [
  { id: 'full', caps: {}, tier: 0 },
  { id: 'no-stubs', caps: { toolStubs: false }, tier: 1 },
  { id: 'no-prefix', caps: { seedPrefix: false }, tier: 1 },
];

/** What the documented rule gives each block: its verdict and, for a block not run, the layer refused. */
export function expectedStatuses(
  plans: readonly Plan[],
  mode: 'F' | 'T',
  caps: Capabilities,
): { status: string; layer?: string }[] {
  return plans.map((plan, index) => {
    const prefixWritten = plans.slice(0, index + 1).some((each) => each.prefix);
    const historyLayer = prefixWritten || (mode === 'T' && index > 0);
    const stubbed = plans.slice(0, index + 1).some((each) => each.stub);
    if (historyLayer && caps.seedPrefix === false) return { status: 'not_run', layer: '1 history' };
    if (stubbed && caps.toolStubs === false) return { status: 'not_run', layer: '5 world' };
    return { status: plan.fail ? 'fail' : 'pass' };
  });
}

/** The run's verdict by the documented rule: fail on any fail, else not_run, else blocked, else pass. */
export function expectedOutcome(statuses: readonly string[]): string {
  if (statuses.includes('fail') || statuses.length === 0) return 'fail';
  if (statuses.includes('not_run')) return 'not_run';
  if (statuses.includes('blocked')) return 'blocked';
  return 'pass';
}

/** The planted spec: block i asks for its own code and one lookup; the agent says the code unless it fails. */
export function plantedSpec(
  seed: number,
  tag: string,
  plans: readonly Plan[],
): { raw: RawSpec; texts: string[]; codes: string[] } {
  const rng = rngFor(seed, tag);
  const customer = pick(rng, SHOP.customers);
  const texts: string[] = [];
  const codes: string[] = [];
  const blocks = plans.map((plan, index) => {
    const bike = pick(rng, SHOP.bikes);
    const text = `[${tag}:${index}] ${customer} asks whether the ${bike} is free on day ${between(rng, 1, 28)}.`;
    texts.push(text);
    codes.push(code(seed, tag, index));
    return {
      id: `b${index}`,
      user: text,
      ...(plan.stub || plan.prefix
        ? {
            given: {
              ...(plan.prefix
                ? {
                    prefix: [
                      { role: 'user', content: `Hello, this is ${customer}.` },
                      { role: 'assistant', content: 'Hello, Larkspur Cycles here. How can I help?' },
                    ],
                  }
                : {}),
              ...(plan.stub
                ? { world: { tools: { 'bikes.lookup': { result: { free: true, bike } } } } }
                : {}),
            },
          }
        : {}),
      expect: {
        must: [codes[index]],
        tools: [{ label: 'bikes.lookup', count: 1 }],
      },
    };
  });
  const raw: RawSpec = {
    id: `blocks-${tag}-${seed}`.replace(/[^A-Za-z0-9._-]/g, '-'),
    title: `Larkspur Cycles rental, planted ${tag}`,
    channel: 'chat',
    lang: 'EN',
    blocks,
  };
  return { raw, texts, codes };
}

/** The scripted reply: one lookup, and the block's code unless the plan says the block fails. */
export function replyFor(plans: readonly Plan[], texts: readonly string[], codes: readonly string[]) {
  return (turn: { user: string }) => {
    const index = texts.findIndex((text) => turn.user.includes(text));
    if (index < 0) throw new Error(`no planted block for "${turn.user.slice(0, 60)}"`);
    const said = plans[index]?.fail
      ? 'Let me check that for you.'
      : `Yes, it is free. Your hold code is ${codes[index]}.`;
    return observed(said, [{ label: 'bikes.lookup', input: { day: index + 1 }, output: { free: true } }]);
  };
}

/** Compares a run with the oracle: every block's verdict, the not_run fields, what the agent saw, the run's verdict. */
export function judgeRun(
  product: BlocksProduct,
  record: RunRecord,
  want: readonly { status: string; layer?: string }[],
  texts: readonly string[],
  log: AgentLog,
): ItemResult {
  const skipReason = need<(block: unknown) => string | undefined>(product.core, 'core', 'skipReason');
  if (record.blocks.length !== want.length)
    return fail(`the run holds ${record.blocks.length} blocks, the spec ${want.length}`);
  const got = record.blocks.map((block) => statusOf(product, block));
  const expected = want.map((each) => each.status);
  if (got.join(',') !== expected.join(','))
    return fail(`block verdicts ${list(got)}, expected ${list(expected)}`);
  for (const [index, block] of record.blocks.entries()) {
    const wanted = want[index] as { status: string; layer?: string };
    if (block.pass !== (wanted.status === 'pass'))
      return fail(`block ${index} is ${wanted.status} with pass ${block.pass}`);
    if (wanted.status === 'not_run') {
      const notRun = block.notRun;
      if (!notRun) return fail(`block ${index} is not_run without notRun`);
      if (notRun.check !== 'capability' || notRun.kind !== 'unsupported' || notRun.layer !== wanted.layer)
        return fail(
          `block ${index} notRun is ${notRun.kind}/${notRun.check}/${notRun.layer}, expected unsupported/capability/${wanted.layer}`,
        );
      if (block.verdicts.length > 0)
        return fail(`block ${index} is not_run and still carries ${block.verdicts.length} verdicts`);
      const reason = skipReason(block) ?? '';
      if (!reason.startsWith('not run (unsupported, check capability)'))
        return fail(`block ${index} skip reason "${reason}"`);
      const text = texts[index] as string;
      if (log.turns.some((turn) => turn.user.includes(text)))
        return fail(`block ${index} is not_run, yet the agent received its user turn`);
    } else {
      const text = texts[index] as string;
      if (!log.turns.some((turn) => turn.user.includes(text)))
        return fail(`block ${index} is ${wanted.status}, yet the agent never received its user turn`);
      if (block.notRun) return fail(`block ${index} is ${wanted.status} and carries notRun`);
    }
  }
  const outcome = outcomeOf(product, record);
  const wantOutcome = expectedOutcome(expected);
  if (outcome !== wantOutcome) return fail(`the run reads ${outcome}, expected ${wantOutcome}`);
  return PASS;
}

function patternItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const capability of CAPABILITY_SETS) {
    for (const mode of ['F', 'T'] as const) {
      for (const pattern of PATTERNS) {
        const id = `verdicts/${capability.id}/${mode}/${pattern.id}`;
        const tier = Math.min(5, pattern.tier + capability.tier + (mode === 'T' ? 1 : 0)) as Tier;
        items.push({
          id,
          family: `verdicts-${capability.id}`,
          tier,
          level: 1,
          component: capability.id === 'full' ? RUNNER : CAPABILITY,
          title: `a ${pattern.id} spec in mode ${mode} on an adapter with ${capability.id} capabilities reads pass, fail and not_run block by block, and the run by the documented rule`,
          cause:
            capability.id === 'full'
              ? `The runner records each block pass or fail from its gating verdicts, in mode ${mode}.`
              : `The capability check refuses a ${capability.id === 'no-stubs' ? 'forced tool result' : 'history'} the adapter cannot apply as not_run from the block that sets it on, in mode ${mode}, and never sends that block.`,
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const n = between(rng, 3, 6);
            const middle = between(rng, 1, n - 2);
            const plans = pattern.plan(n, middle);
            const { raw, texts, codes } = plantedSpec(seed, id, plans);
            const log: AgentLog = { turns: [] };
            const adapter = scriptedAdapter(product, replyFor(plans, texts, codes), {
              capabilities: capability.caps,
              log,
            });
            const record = await run(product, raw, adapter, { mode });
            return judgeRun(product, record, expectedStatuses(plans, mode, capability.caps), texts, log);
          },
        });
      }
    }
  }
  return items;
}

/** Tallies: a pass rate leaves not_run and blocked out and prints their count beside it. */
function tallyItems(): BankItem[] {
  const sizes = [3, 5, 8, 12, 20];
  const mixes = [
    { id: 'pass-and-fail', caps: [CAPABILITY_SETS[0]] },
    { id: 'with-not-run', caps: CAPABILITY_SETS },
    { id: 'mostly-not-run', caps: [CAPABILITY_SETS[1], CAPABILITY_SETS[2]] },
    { id: 'no-failure', caps: CAPABILITY_SETS },
  ];
  const items: BankItem[] = [];
  for (const mix of mixes) {
    for (const size of sizes) {
      const id = `verdicts/tally/${mix.id}/${size}`;
      items.push({
        id,
        family: 'verdicts-tally',
        tier: (size >= 12 ? 3 : 2) as Tier,
        level: 1,
        component: mix.id === 'pass-and-fail' ? VERDICTS : HEADLINE,
        title: `over ${size} runs (${mix.id}), countRuns tallies each verdict, unscoredText prints the runs not run, and the suite headline counts only pass and fail runs`,
        cause:
          mix.id === 'pass-and-fail'
            ? 'countRuns tallies every run by runOutcome.'
            : 'Every reader of a rate counts not_run and blocked runs apart, never as passes or failures.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const records: RunRecord[] = [];
          const outcomes: string[] = [];
          for (let index = 0; index < size; index += 1) {
            const capability = pick(rng, mix.caps) as CapabilitySet;
            const pattern =
              mix.id === 'no-failure'
                ? pick(
                    rng,
                    PATTERNS.filter((each) => !each.id.includes('fail')),
                  )
                : pick(rng, PATTERNS);
            const n = between(rng, 3, 4);
            const plans = pattern.plan(n, 1);
            const tag = `${id}/${index}`;
            const { raw, texts, codes } = plantedSpec(seed, tag, plans);
            const record = await run(
              product,
              raw,
              scriptedAdapter(product, replyFor(plans, texts, codes), { capabilities: capability.caps }),
            );
            records.push(record);
            outcomes.push(
              expectedOutcome(expectedStatuses(plans, 'F', capability.caps).map((s) => s.status)),
            );
          }
          const countRuns = need<(runs: unknown[]) => Record<string, number>>(
            product.core,
            'core',
            'countRuns',
          );
          const unscoredText = need<(counts: Record<string, number>) => string>(
            product.core,
            'core',
            'unscoredText',
          );
          const suiteHeadline = need<
            (runs: unknown[], treeOf: (run: RunRecord) => string) => Record<string, unknown> | undefined
          >(product.report, 'report', 'suiteHeadline');
          const want = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
          for (const outcome of outcomes) want[outcome as keyof typeof want] += 1;
          const got = countRuns(records);
          const text = unscoredText(got);
          const wantText = [
            ...(want.not_run > 0 ? [`${want.not_run} not run`] : []),
            ...(want.blocked > 0 ? [`${want.blocked} blocked`] : []),
          ].join(', ');
          const headline = suiteHeadline(records, (record) => record.specId);
          const scored = want.pass + want.fail;
          const headlineRuns = headline?.runs;
          const shares = headline?.shares as { notRun?: number } | undefined;
          return expectAll([
            [
              got.pass === want.pass &&
                got.fail === want.fail &&
                got.not_run === want.not_run &&
                got.blocked === want.blocked,
              `countRuns ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
            ],
            [text === wantText, `unscoredText "${text}", expected "${wantText}"`],
            [
              scored === 0 ? headline === undefined : headlineRuns === scored,
              `the headline counts ${String(headlineRuns)} scored runs, expected ${scored}`,
            ],
            [
              scored === 0 || Math.abs((shares?.notRun ?? -1) - want.not_run / size) < 1e-12,
              `the headline's not-run share is ${shares?.notRun}, expected ${want.not_run / size}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

type ExitCase = { id: string; tier: Tier; specs: Plan[][]; exit: number; summary: RegExp };

const EXIT_CASES: ExitCase[] = [
  { id: 'one-pass', tier: 1, specs: [at(3, [], 'fail')], exit: 0, summary: /1 pass, 0 fail/ },
  { id: 'one-fail', tier: 1, specs: [at(3, [1], 'fail')], exit: 1, summary: /0 pass, 1 fail/ },
  { id: 'one-not-run', tier: 2, specs: [at(3, [1], 'stub')], exit: 3, summary: /1 not run/ },
  {
    id: 'fail-and-not-run-cell',
    tier: 2,
    specs: [merge(at(3, [0], 'fail'), at(3, [2], 'stub'))],
    exit: 1,
    summary: /1 fail/,
  },
  {
    id: 'pass-and-not-run',
    tier: 2,
    specs: [at(3, [], 'fail'), at(4, [3], 'stub')],
    exit: 3,
    summary: /1 pass, 0 fail, 1 not run/,
  },
  {
    id: 'fail-and-not-run',
    tier: 3,
    specs: [at(3, [2], 'fail'), at(4, [0], 'stub')],
    exit: 1,
    summary: /0 pass, 1 fail, 1 not run/,
  },
  {
    id: 'two-pass',
    tier: 1,
    specs: [at(3, [], 'fail'), at(2, [], 'fail')],
    exit: 0,
    summary: /2 pass, 0 fail/,
  },
  {
    id: 'prefix-on-http',
    tier: 3,
    specs: [at(3, [1], 'prefix')],
    exit: 0,
    summary: /1 pass, 0 fail/,
  },
  {
    id: 'three-mixed',
    tier: 4,
    specs: [at(3, [], 'fail'), at(3, [0], 'stub'), at(3, [], 'fail')],
    exit: 3,
    summary: /2 pass, 0 fail, 1 not run/,
  },
  {
    id: 'not-run-first-block',
    tier: 3,
    specs: [at(4, [0], 'stub')],
    exit: 3,
    summary: /0 pass, 0 fail, 1 not run/,
  },
];

/** The command line on an http agent that declares no tool stubs: exit 0, 1 or 3 by the gate rule. */
function exitItems(): BankItem[] {
  return (['F', 'T'] as const).flatMap((mode) =>
    EXIT_CASES.map((exitCase) => {
      const id = `verdicts/exit/${mode}/${exitCase.id}`;
      return {
        id,
        family: 'verdicts-exit',
        tier: Math.min(5, exitCase.tier + (mode === 'T' ? 1 : 0)) as Tier,
        level: 1,
        component: exitCase.exit === 3 ? GATE_EXIT : CAMPAIGN,
        title: `campaign run in mode ${mode} on specs that ${exitCase.id.replace(/-/g, ' ')} exits ${exitCase.exit} and prints the cells by verdict`,
        cause:
          exitCase.exit === 3
            ? 'campaign run exits 3 when no cell fails and a cell is not run.'
            : `campaign run exits ${exitCase.exit} by the gate rule on its cells' verdicts.`,
        check: async ({ seed, scratch, product }) => {
          const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
          mkdirSync(dir, { recursive: true });
          const texts: string[] = [];
          const codes: string[] = [];
          const plans: Plan[] = [];
          const paths: string[] = [];
          const specs = exitCase.specs.map((specPlans, index) => {
            const planted = plantedSpec(seed, `${id}/${index}`, specPlans);
            texts.push(...planted.texts);
            codes.push(...planted.codes);
            plans.push(...specPlans);
            return planted.raw;
          });
          const agent = await startHttpAgent(replyFor(plans, texts, codes));
          try {
            specs.forEach((raw, index) => {
              const path = join(dir, `spec-${index}.yaml`);
              writeFileSync(
                path,
                stringify({
                  ...raw,
                  target: {
                    adapter: 'http',
                    agent: 'larkspur',
                    options: { url: agent.url, tool_stubs: false, deterministic: true },
                  },
                }),
              );
              paths.push(path);
            });
            const result = await product.cli(
              ['campaign', 'run', ...paths, '--mode', mode, '--store', join(dir, 'store.db')],
              dir,
            );
            const text = `${result.out}\n${result.err}`;
            return expectAll([
              [
                result.code === exitCase.exit,
                `exit ${result.code}, expected ${exitCase.exit}: ${text.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`,
              ],
              [
                exitCase.summary.test(text),
                `the summary does not match ${exitCase.summary}: ${text.slice(-240)}`,
              ],
            ]);
          } finally {
            await agent.close();
          }
        },
      };
    }),
  );
}

/** Level 1 of the blocks bank. */
export function verdictItems(): BankItem[] {
  return [...patternItems(), ...tallyItems(), ...exitItems()];
}
