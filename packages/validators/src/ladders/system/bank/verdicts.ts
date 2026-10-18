import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentAdapter,
  blockStatus,
  countRuns,
  type RunMode,
  type RunResult,
  runOutcome,
  unscoredText,
} from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { parse, stringify } from 'yaml';
import { LOOKUP } from '../family';
import type { Flow, RawSpec } from '../plant';
import { between, rngFor } from '../random';
import { hideArgv } from './links-world';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import { adapterFor, behavioursFor, failingList, plantedFlow, runScenario } from './world';

/**
 * Level 13, the two verdicts that are not measurements: `not_run` and `blocked` (docs/running.md, "Outcomes";
 * docs/concepts/given-when-then.md, "Parent blocks"). A block not run carries no verdict and no pass; a block
 * blocked by a failed or unrun ancestor names both. The gating commands exit 3 when nothing failed but a block
 * was not run or blocked (docs/reference/cli.md, "Exit codes"). The plant chooses which block cannot run and
 * why, so every status, every record and every exit code is known before the chain runs.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const CAPABILITY = 'packages/core/src/runner/capability.ts';
const GIVEN = 'packages/core/src/spec/verify-given.ts';
const PARENTS = 'packages/core/src/runner/parents.ts';
const CAMPAIGN_CMD = 'packages/cli/src/commands/campaign.ts';
const CI_CMD = 'packages/cli/src/commands/ci.ts';
const COMPARE_CMD = 'packages/cli/src/commands/compare.ts';
const REPORT_CMD = 'packages/cli/src/commands/report.ts';

function draft(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
  source: BankItem['source'] = 'contract',
): Draft {
  return {
    id: `verdicts/${id}`,
    family,
    tier,
    level: 13,
    component,
    title,
    cause,
    check: (ctx) => hideArgv(() => check(ctx)),
    source,
  };
}

const POSITIONS = ['first', 'middle', 'last'] as const;
type Position = (typeof POSITIONS)[number];

function positionIn(position: Position, blocks: number, seed: number, tag: string): number {
  if (position === 'first') return 0;
  if (position === 'last') return blocks - 1;
  return between(rngFor(seed, `${tag}-middle`), 1, blocks - 2);
}

/** The planted agent behind the function adapter, with one capability declared off. */
function without(capability: 'seedPrefix' | 'toolStubs', flow: Flow): AgentAdapter {
  const base = adapterFor('function', behavioursFor(flow));
  return {
    id: base.id,
    version: base.version,
    capabilities: () => ({ ...base.capabilities(), [capability]: false }),
    open: (given) => base.open(given),
    send: (session, turn) => base.send(session, turn),
    close: (session) => base.close(session),
    ...(base.endState
      ? {
          endState: (session, source) =>
            (base.endState as NonNullable<AgentAdapter['endState']>)(session, source),
        }
      : {}),
  };
}

type Block = Record<string, unknown> & { given?: Record<string, unknown> };
const blocksOf = (raw: RawSpec) => raw.blocks as Block[];

/**
 * The statuses a run must show when block k cannot run (docs/running.md, "Outcomes"): in F and P every later
 * block is not run too. In T a block is checked alone, so the blocks before k pass and k is not run; a block
 * after k starts from a canonical history built from the blocks before it, block k included, so the doc makes
 * no claim on it and the oracle reads it as `any`. Without seedPrefix, in T every block after the first needs
 * the canonical history the target cannot seed, so every one of them is not run.
 */
function expectedStatuses(blocks: number, k: number, mode: RunMode, noSeedPrefix = false): string[] {
  return Array.from({ length: blocks }, (_, index) => {
    if (index === k) return 'not_run';
    if (index < k) return mode === 'T' && noSeedPrefix && index > 0 ? 'not_run' : 'pass';
    if (mode !== 'T' || noSeedPrefix) return 'not_run';
    return 'any';
  });
}

/** Checks the not-run record of a run against the plant: statuses, no verdicts, no pass, the outcome. */
function notRunOracle(
  run: RunResult,
  k: number,
  mode: RunMode,
  kind: string,
  check: string,
  noSeedPrefix = false,
): ReturnType<typeof expectAll> {
  const want = expectedStatuses(run.blocks.length, k, mode, noSeedPrefix);
  const statuses = run.blocks.map((block, index) => (want[index] === 'any' ? 'any' : blockStatus(block)));
  const first = run.blocks.find((block) => block.index === k);
  return expectAll([
    [run.status === 'completed', `the run ${run.status}: ${run.error ?? ''}`],
    [statuses.join(',') === want.join(','), `statuses ${statuses.join(',')}, expected ${want.join(',')}`],
    [first?.notRun?.kind === kind, `block ${k} notRun.kind ${first?.notRun?.kind}, expected ${kind}`],
    [first?.notRun?.check === check, `block ${k} notRun.check ${first?.notRun?.check}, expected ${check}`],
    [
      run.blocks.every(
        (block) => blockStatus(block) !== 'not_run' || (block.pass === false && block.verdicts.length === 0),
      ),
      'a block not run carries a verdict or a pass',
    ],
    [
      runOutcome(run) === 'not_run' || (mode === 'T' && want.includes('any')),
      `the run's outcome is ${runOutcome(run)}, expected not_run`,
    ],
    [mode === 'T' || run.endState === undefined, 'the end state was compared on a run with a block not run'],
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// verdict-capability: a layer the target cannot apply.

function capabilityItems(): Draft[] {
  const out: Draft[] = [];
  for (const layer of ['tools', 'prefix'] as const)
    for (const mode of ['F', 'T'] as const)
      for (const position of POSITIONS) {
        const id = `capability/${layer}/${mode}/${position}`;
        out.push(
          draft(
            id,
            'verdict-not-run',
            mode === 'T' ? 3 : 2,
            CAPABILITY,
            `a ${layer === 'tools' ? 'forced tool result' : 'prefix'} on the ${position} block of a ${mode} run, on a target without ${layer === 'tools' ? 'toolStubs' : 'seedPrefix'}: that block is not run (unsupported, check capability)${mode === 'T' ? ' and the others run alone' : ' and every later block is not run'}`,
            mode === 'T'
              ? 'runSpec in mode T checks each block alone against the capabilities'
              : 'runSpec in modes F and P marks every block after one not run as not run',
            async ({ seed }) => {
              const flow = plantedFlow(seed, id, 5);
              const k = positionIn(position, 5, seed, id);
              const block = blocksOf(flow.spec)[k] as Block;
              if (layer === 'tools')
                block.given = {
                  world: { tools: { [LOOKUP]: { result: { status: 'found', step: k + 1 } } } },
                };
              else
                block.given = {
                  prefix: [
                    { role: 'user', content: flow.texts[Math.max(0, k - 1)] as string },
                    { role: 'assistant', content: `Noted under reference R-${4000 + k}.` },
                  ],
                };
              const run = await runScenario(flow.spec, behavioursFor(flow), {
                mode,
                adapter: without(layer === 'tools' ? 'toolStubs' : 'seedPrefix', flow),
              });
              return notRunOracle(run, k, mode, 'unsupported', 'capability', layer === 'prefix');
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// verdict-given: a Given error the static verifier finds.

function givenItems(): Draft[] {
  const out: Draft[] = [];
  const errors = {
    unpaired: (k: number) => [{ id: `c-${k}`, label: LOOKUP, input: {} }],
    'repeated-id': (k: number) => [
      { id: `c-${k}`, label: LOOKUP, input: {}, output: { status: 'found' } },
      { id: `c-${k}`, label: LOOKUP, input: {}, output: { status: 'found' } },
    ],
  } as const;
  for (const [error, calls] of Object.entries(errors))
    for (const mode of ['F', 'T'] as const)
      for (const position of POSITIONS) {
        const id = `given/${error}/${mode}/${position}`;
        out.push(
          draft(
            id,
            'verdict-not-run',
            mode === 'T' ? 3 : 2,
            GIVEN,
            `a prefix with ${error === 'unpaired' ? 'a tool call that has no result' : 'one call id twice in one message'} on the ${position} block of a ${mode} run: the block is not run (given_unmet, tool_history_paired), never sent`,
            mode === 'T'
              ? 'runSpec in mode T checks each block alone against the Given verifier'
              : 'runSpec in modes F and P marks every block after one not run as not run',
            async ({ seed }) => {
              const flow = plantedFlow(seed, id, 5);
              const k = positionIn(position, 5, seed, id);
              const block = blocksOf(flow.spec)[k] as Block;
              block.given = {
                prefix: [
                  { role: 'user', content: 'Hello.' },
                  { role: 'assistant', content: 'Looking it up.', tool_calls: calls(k) },
                ],
              };
              const run = await runScenario(flow.spec, behavioursFor(flow), { mode });
              return notRunOracle(run, k, mode, 'given_unmet', 'tool_history_paired');
            },
          ),
        );
      }
  return out;
}

/** The three other Given checks that make a block not run: an unknown tool, a fact not stated, a history that disagrees. */
function givenKinds(): Draft[] {
  type Kind = {
    id: string;
    check: string;
    title: string;
    build(raw: RawSpec, block: Block, k: number): void;
  };
  const kinds: Kind[] = [
    {
      id: 'tool-known',
      check: 'tool_known',
      title: "a prefix that calls a tool the spec's tool_schemas do not hold",
      build: (raw, block, k) => {
        raw.metadata = {
          ...((raw.metadata as Record<string, unknown>) ?? {}),
          tool_schemas: { [LOOKUP]: {} },
        };
        block.given = {
          prefix: [
            { role: 'user', content: 'Hello.' },
            {
              role: 'assistant',
              content: 'Checking.',
              tool_calls: [{ id: `c-${k}`, label: 'archive.search', input: {}, output: { found: false } }],
            },
          ],
        };
      },
    },
    {
      id: 'value-in-message',
      check: 'value_in_message',
      title: 'a shared fact said to be stated by the user in a prefix message that does not hold it',
      build: (_raw, block) => {
        block.given = {
          prefix: [
            { role: 'user', content: 'Hello, I would like to continue.' },
            { role: 'assistant', content: 'Of course.' },
          ],
          shared: [{ fact: 'email', by: 'user', in: 0 }],
        };
      },
    },
    {
      id: 'history-matches-world',
      check: 'history_matches_world',
      title: 'a prefix that records a result of a tool the world forces to another result',
      build: (_raw, block, k) => {
        block.given = {
          world: { tools: { [LOOKUP]: { result: { status: 'found', step: k + 1 } } } },
          prefix: [
            { role: 'user', content: 'Hello.' },
            {
              role: 'assistant',
              content: 'Checking.',
              tool_calls: [
                { id: `c-${k}`, label: LOOKUP, input: {}, output: { status: 'missing', step: 0 } },
              ],
            },
          ],
        };
      },
    },
  ];
  const out: Draft[] = [];
  for (const kind of kinds)
    for (const mode of ['F', 'T'] as const)
      for (const position of ['first', 'middle'] as const) {
        const id = `given/${kind.id}/${mode}/${position}`;
        out.push(
          draft(
            id,
            'verdict-not-run',
            mode === 'T' ? 4 : 3,
            GIVEN,
            `${kind.title}, on the ${position} block of a ${mode} run: the block is not run (given_unmet, ${kind.check}), never sent`,
            `the runner makes a block with a ${kind.check} Given error not run, before it is sent`,
            async ({ seed }) => {
              const flow = plantedFlow(seed, id, 5);
              const k = positionIn(position, 5, seed, id);
              kind.build(flow.spec, blocksOf(flow.spec)[k] as Block, k);
              const run = await runScenario(flow.spec, behavioursFor(flow), { mode });
              return notRunOracle(run, k, mode, 'given_unmet', kind.check);
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// verdict-records: the outcome of a run over its four verdicts, the counts beside a rate, and the store
// refusing a block whose pass and status disagree (docs/running.md, "Outcomes").

function block(status: 'pass' | 'fail' | 'not_run' | 'blocked', index: number) {
  return {
    index,
    pass: status === 'pass',
    status,
    verdicts: [],
    drift: [],
  } as unknown as RunResult['blocks'][number];
}

function recordItems(): Draft[] {
  type Case = {
    id: string;
    statuses: Array<'pass' | 'fail' | 'not_run' | 'blocked'>;
    status?: RunResult['status'];
    endMatch?: boolean;
    want: string;
  };
  const cases: Case[] = [
    { id: 'all-pass', statuses: ['pass', 'pass', 'pass'], want: 'pass' },
    { id: 'fail-and-not-run', statuses: ['pass', 'fail', 'not_run'], want: 'fail' },
    { id: 'fail-and-blocked', statuses: ['fail', 'blocked', 'pass'], want: 'fail' },
    { id: 'not-run-and-blocked', statuses: ['not_run', 'blocked', 'pass'], want: 'not_run' },
    { id: 'blocked-only', statuses: ['pass', 'blocked', 'blocked'], want: 'blocked' },
    { id: 'not-run-on-a-stopped-run', statuses: ['pass', 'not_run'], status: 'stopped', want: 'fail' },
    { id: 'not-run-with-end-state-missed', statuses: ['pass', 'not_run'], endMatch: false, want: 'fail' },
    { id: 'no-block', statuses: [], want: 'fail' },
  ];
  const out: Draft[] = cases.map((c) =>
    draft(
      `records/outcome/${c.id}`,
      'verdict-records',
      c.status || c.endMatch === false ? 3 : 2,
      'packages/core/src/runner/verdicts.ts',
      `a run whose blocks are ${c.statuses.join(', ') || 'none'}${c.status ? ` and whose status is ${c.status}` : ''}${c.endMatch === false ? ' with its end state missed' : ''} has the outcome ${c.want}`,
      'runOutcome lets a measured failure win, then not run, then blocked',
      async ({ seed }) => {
        const flow = plantedFlow(seed, `records-${c.id}`, 3);
        const real = await runScenario(flow.spec, behavioursFor(flow));
        const run: RunResult = {
          ...real,
          status: c.status ?? 'completed',
          blocks: c.statuses.map((status, index) => block(status, index)),
          ...(c.endMatch === false ? { endState: { match: false } as RunResult['endState'] } : {}),
        };
        const got = runOutcome(run);
        return got === c.want ? PASS : fail(`runOutcome gave ${got}, expected ${c.want}`);
      },
    ),
  );
  // The counts beside a rate: countRuns over a seeded mix, and the text a rate prints beside it.
  for (const size of [1, 2, 4, 9, 25, 60, 100, 400]) {
    out.push(
      draft(
        `records/counts/${size}`,
        'verdict-records',
        size > 20 ? 3 : 2,
        'packages/core/src/runner/verdicts.ts',
        `countRuns and unscoredText over ${size} runs with a seeded mix of the four outcomes count each outcome once and print the two unscored counts`,
        'countRuns counts each run under its runOutcome',
        async ({ seed }) => {
          const flow = plantedFlow(seed, `records-counts-${size}`, 2);
          const real = await runScenario(flow.spec, behavioursFor(flow));
          const rng = rngFor(seed, `records-counts-${size}`);
          const kinds = ['pass', 'fail', 'not_run', 'blocked'] as const;
          const want = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
          const runs: RunResult[] = Array.from({ length: size }, () => {
            const kind = kinds[between(rng, 0, 3)] as (typeof kinds)[number];
            want[kind] += 1;
            const statuses =
              kind === 'pass'
                ? ['pass', 'pass']
                : kind === 'fail'
                  ? ['pass', 'fail']
                  : kind === 'not_run'
                    ? ['pass', 'not_run']
                    : ['pass', 'blocked'];
            return { ...real, blocks: statuses.map((status, index) => block(status as 'pass', index)) };
          });
          const got = countRuns(runs);
          const text = unscoredText(got);
          const wantText = [
            ...(want.not_run > 0 ? [`${want.not_run} not run`] : []),
            ...(want.blocked > 0 ? [`${want.blocked} blocked`] : []),
          ].join(', ');
          return expectAll([
            [
              JSON.stringify(got) === JSON.stringify(want),
              `countRuns gave ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
            ],
            [text === wantText, `unscoredText gave "${text}", expected "${wantText}"`],
          ]);
        },
      ),
    );
  }
  // The store refuses a block record whose pass and status disagree, when it is written.
  const disagreements: Array<[string, boolean]> = [
    ['pass', false],
    ['fail', true],
    ['not_run', true],
    ['blocked', true],
  ];
  for (const [status, pass] of disagreements) {
    out.push(
      draft(
        `records/store-refuses/${status}-pass-${pass}`,
        'verdict-records',
        3,
        'packages/store/src/store.ts',
        `the store refuses to write a block record with status ${status} and pass ${pass}`,
        "the store validates that a block record's pass and status agree before it writes",
        async ({ seed, scratch }) => {
          const flow = plantedFlow(seed, `records-store-${status}`, 2);
          const real = await runScenario(flow.spec, behavioursFor(flow));
          const run: RunResult = {
            ...real,
            blocks: real.blocks.map((each, index) =>
              index === 1 ? { ...each, status, pass } : each,
            ) as RunResult['blocks'],
          };
          const store = openStore(join(scratch, `refuse-${status}-${pass}-${seed}.db`));
          try {
            await store.putCampaign({
              campaignId: 'c-refuse',
              specs: [{ id: run.specId, hash: run.specHash }],
              targets: [run.target],
              modes: ['F'],
              repeats: { T: 0, F: 1, P: 0 },
              budgetUsd: 0,
              judge: { mode: 'system1', judges: [] },
              createdAt: '2026-10-11T00:00:00.000Z',
            });
            let refused = false;
            try {
              await store.putRun('c-refuse', run);
            } catch {
              refused = true;
            }
            const back = await store.listRuns({ campaignId: 'c-refuse' });
            return expectAll([
              [refused, `putRun accepted a block with status ${status} and pass ${pass}`],
              [back.length === 0, `the store holds ${back.length} runs after the refusal`],
            ]);
          } finally {
            await store.close();
          }
        },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// verdict-blocked: a failed or unrun parent blocks its descendants, and an independent root goes on.

type Shape = {
  id: string;
  order: number[];
  parents: Array<[number, number]>;
  root: number;
  independent: number[];
};
const SHAPES: Shape[] = [
  {
    id: 'chain',
    order: [0, 1, 2, 3],
    parents: [
      [1, 0],
      [2, 1],
    ],
    root: 0,
    independent: [3],
  },
  {
    id: 'fan',
    order: [0, 1, 2, 3],
    parents: [
      [1, 0],
      [2, 0],
    ],
    root: 0,
    independent: [3],
  },
  {
    id: 'child-first',
    order: [1, 2, 0, 3],
    parents: [
      [1, 0],
      [2, 1],
    ],
    root: 0,
    independent: [3],
  },
];

function blockedItems(): Draft[] {
  const out: Draft[] = [];
  const causes = ['X1_local', 'X5_tool', 'D9_out_of_scope', 'given-unmet'] as const;
  for (const cause of causes)
    for (const shape of SHAPES)
      for (const mode of ['F', 'T'] as const) {
        const id = `blocked/${shape.id}/${cause.toLowerCase().replace(/_/g, '-')}/${mode}`;
        out.push(
          draft(
            id,
            'verdict-blocked',
            ((shape.id === 'child-first' ? 4 : cause === 'given-unmet' ? 3 : 2) +
              (mode === 'T' ? 1 : 0)) as Tier,
            PARENTS,
            `a ${cause === 'given-unmet' ? 'root not run' : `root failing ${cause}`} in a ${shape.id} forest, mode ${mode}: every descendant is blocked, blocked.by names its parent and blocked.root the root, and the independent root still passes`,
            shape.id === 'child-first'
              ? 'the parent scheduler blocks descendants authored before their failed parent'
              : 'the runner blocks every descendant of a failed or unrun parent and names the root cause',
            async ({ seed }) => {
              const flow = plantedFlow(seed, id, 4);
              const raw = flow.spec as RawSpec & { stages?: unknown };
              delete raw.stages;
              const source = blocksOf(raw).map((block) => {
                const copy: Block = { ...block, expect: { ...(block.expect as Record<string, unknown>) } };
                delete (copy.expect as Record<string, unknown>).stage;
                return copy;
              });
              const parentOf = new Map(shape.parents);
              raw.blocks = shape.order.map((truth) => {
                const block = { ...(source[truth] as Block) };
                const parent = parentOf.get(truth);
                if (parent !== undefined) block.parent = `b${parent}`;
                if (truth === shape.root && cause === 'given-unmet')
                  block.given = {
                    prefix: [
                      { role: 'user', content: 'Hello.' },
                      {
                        role: 'assistant',
                        content: 'Looking.',
                        tool_calls: [{ id: 'c', label: LOOKUP, input: {} }],
                      },
                    ],
                  };
                return block;
              });
              const faults = cause === 'given-unmet' ? new Map() : new Map([[shape.root, [cause]]]);
              const run = await runScenario(raw, behavioursFor(flow, faults), { mode });
              const byId = new Map(run.blocks.map((block) => [block.blockId, block]));
              const problems: Array<readonly [boolean, string]> = [
                [run.status === 'completed', `the run ${run.status}`],
              ];
              const rootBlock = byId.get(`b${shape.root}`);
              problems.push([
                blockStatus(rootBlock ?? { pass: true }) === (cause === 'given-unmet' ? 'not_run' : 'fail'),
                `the root b${shape.root} is ${rootBlock ? blockStatus(rootBlock) : 'absent'}: ${failingList(run)}`,
              ]);
              for (const [child, parent] of shape.parents) {
                const block = byId.get(`b${child}`);
                problems.push([
                  block !== undefined && blockStatus(block) === 'blocked',
                  `b${child} is ${block ? blockStatus(block) : 'absent'}, expected blocked`,
                ]);
                problems.push([
                  block?.blocked?.by === `b${parent}` && block?.blocked?.root === `b${shape.root}`,
                  `b${child} blocked by ${block?.blocked?.by} root ${block?.blocked?.root}, expected by b${parent} root b${shape.root}`,
                ]);
                problems.push([
                  block?.verdicts.length === 0 && block.pass === false,
                  `b${child} carries verdicts or a pass`,
                ]);
              }
              for (const free of shape.independent) {
                const block = byId.get(`b${free}`);
                problems.push([
                  block !== undefined && blockStatus(block) === 'pass',
                  `the independent root b${free} is ${block ? blockStatus(block) : 'absent'}`,
                ]);
              }
              const outcome = runOutcome(run);
              problems.push([
                outcome === (cause === 'given-unmet' ? 'not_run' : 'fail'),
                `the run's outcome is ${outcome}`,
              ]);
              return expectAll(problems);
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// verdict-exits: the gating commands on the Acme agent, with a block that cannot run.

type Cli = { code: number; out: string; err: string };

async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  });
  return { code, out, err };
}

const SOURCE = 'examples/acme/specs/conversations/plan-upgrade.yaml';
const TARGET = 'function:acme';

type Files = { dir: string; clean: string; notRun: string; failing: string; k: number; blocks: number };

/** The Acme spec as it is, with a Given error at block k, and with an expectation no reply meets. */
function files(root: string, scratch: string, seed: number, tag: string): Files {
  const dir = join(scratch, tag.replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(join(dir, 'clean'), { recursive: true });
  mkdirSync(join(dir, 'not-run'), { recursive: true });
  mkdirSync(join(dir, 'failing'), { recursive: true });
  const text = readFileSync(join(root, SOURCE), 'utf8');
  const doc = parse(text) as { id: string; blocks: Block[] };
  const blocks = doc.blocks.length;
  const k = between(rngFor(seed, `${tag}-k`), 0, blocks - 1);
  const clean = join(dir, 'clean', 'spec.yaml');
  writeFileSync(clean, text);
  const notRunDoc = structuredClone(doc);
  notRunDoc.id = `${doc.id}-given`;
  const block = notRunDoc.blocks[k] as Block;
  block.given = {
    ...(block.given ?? {}),
    prefix: [
      { role: 'user', content: 'Hello.' },
      {
        role: 'assistant',
        content: 'Looking it up.',
        tool_calls: [{ id: 'c-1', label: 'catalog.search', input: {} }],
      },
    ],
  };
  const notRun = join(dir, 'not-run', 'spec.yaml');
  writeFileSync(notRun, stringify(notRunDoc));
  const failingDoc = structuredClone(doc);
  failingDoc.id = `${doc.id}-never`;
  const last = failingDoc.blocks[blocks - 1] as Block & { expect?: { must?: string[] } };
  last.expect = { ...(last.expect ?? {}), must: [...(last.expect?.must ?? []), `NEVER-SAID-${seed}`] };
  const failing = join(dir, 'failing', 'spec.yaml');
  writeFileSync(failing, stringify(failingDoc));
  return { dir, clean, notRun, failing, k, blocks };
}

type ExitCase = {
  id: string;
  tier: Tier;
  component: string;
  title: string;
  cause: string;
  run(f: Files, mode: RunMode): Promise<ReturnType<typeof expectAll>>;
};

const code = (got: Cli, want: number, what: string) =>
  got.code === want
    ? PASS
    : fail(`${what} exited ${got.code}, expected ${want}: ${(got.err || got.out).slice(0, 240)}`);

const EXIT_CASES: ExitCase[] = [
  {
    id: 'run/not-run',
    tier: 1,
    component: CAMPAIGN_CMD,
    title: 'campaign run exits 3 when no cell failed but a block was not run',
    cause: 'campaign run exits through gateExit over the run outcomes',
    run: async (f, mode) =>
      code(
        await cli(['campaign', 'run', f.notRun, '--target', TARGET, '--mode', mode, '--no-cache'], f.dir),
        3,
        'campaign run',
      ),
  },
  {
    id: 'run/clean',
    tier: 1,
    component: CAMPAIGN_CMD,
    title: 'campaign run exits 0 when every cell passes',
    cause: 'campaign run exits through gateExit over the run outcomes',
    run: async (f, mode) =>
      code(
        await cli(['campaign', 'run', f.clean, '--target', TARGET, '--mode', mode, '--no-cache'], f.dir),
        0,
        'campaign run',
      ),
  },
  {
    id: 'run/not-run-and-fail',
    tier: 2,
    component: CAMPAIGN_CMD,
    title: 'campaign run exits 1 when one cell failed and another was not run: a failure wins',
    cause: 'campaign run exits through gateExit over the run outcomes',
    run: async (f, mode) =>
      code(
        await cli(
          ['campaign', 'run', f.notRun, f.failing, '--target', TARGET, '--mode', mode, '--no-cache'],
          f.dir,
        ),
        1,
        'campaign run',
      ),
  },
  {
    id: 'run/json-counts',
    tier: 3,
    component: CAMPAIGN_CMD,
    title: 'campaign run prints the cell not run apart in its count line, and never counts it as a failure',
    cause: 'campaign run prints the unscored count beside its pass line',
    run: async (f, mode) => {
      const got = await cli(
        ['campaign', 'run', f.notRun, '--target', TARGET, '--mode', mode, '--no-cache'],
        f.dir,
      );
      return expectAll([
        [got.code === 3, `exit ${got.code}`],
        [/\b1 not run\b/.test(got.out), `the cell line does not say "1 not run": ${got.out.slice(-300)}`],
        [/\b0 fail\b/.test(got.out), `the cell line does not say "0 fail": ${got.out.slice(-300)}`],
      ]);
    },
  },
  {
    id: 'status/not-run',
    tier: 2,
    component: CAMPAIGN_CMD,
    title:
      'campaign status exits 1 on a campaign with a cell not run: status counts every cell that does not pass',
    cause: 'campaign status exits 1 on any cell that does not pass, not run and blocked included',
    run: async (f, mode) => {
      const store = join(f.dir, 'status.db');
      const ran = await cli(
        [
          'campaign',
          'run',
          f.notRun,
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-status',
        ],
        f.dir,
      );
      if (ran.code !== 3)
        return fail(`campaign run exited ${ran.code}, expected 3: ${ran.err.slice(0, 200)}`);
      return code(
        await cli(['campaign', 'status', 'c-status', '--store', store], f.dir),
        1,
        'campaign status',
      );
    },
  },
  {
    id: 'resume/not-run',
    tier: 2,
    component: CAMPAIGN_CMD,
    title: 'campaign resume of a complete campaign with a cell not run exits 3, as run does',
    cause: 'campaign resume exits through gateExit over the run outcomes',
    run: async (f, mode) => {
      const store = join(f.dir, 'resume.db');
      const ran = await cli(
        [
          'campaign',
          'run',
          f.notRun,
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-resume',
        ],
        f.dir,
      );
      if (ran.code !== 3)
        return fail(`campaign run exited ${ran.code}, expected 3: ${ran.err.slice(0, 200)}`);
      return code(
        await cli(['campaign', 'resume', 'c-resume', '--store', store], f.dir),
        3,
        'campaign resume',
      );
    },
  },
  {
    id: 'ci/not-run',
    tier: 3,
    component: CI_CMD,
    title: 'ci exits 3 when the candidate has a spec with a block not run and no regression (max not run 0)',
    cause:
      'ci gives the verdict not-run, exit 3, when a spec has more blocks not run than --max-not-run allows',
    run: async (f, mode) => {
      const store = join(f.dir, 'ci.db');
      const base = await cli(
        [
          'campaign',
          'run',
          join(f.dir, 'clean'),
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-base',
        ],
        f.dir,
      );
      if (base.code !== 0) return fail(`the baseline exited ${base.code}: ${base.err.slice(0, 200)}`);
      const writeSpecs = join(f.dir, 'ci-specs');
      mkdirSync(writeSpecs, { recursive: true });
      writeFileSync(join(writeSpecs, 'spec.yaml'), readFileSync(f.notRun, 'utf8'));
      return code(
        await cli(
          [
            'ci',
            '--specs',
            writeSpecs,
            '--target',
            TARGET,
            '--baseline',
            'c-base',
            '--store',
            store,
            '--mode',
            mode,
            '--out',
            join(f.dir, 'ci.json'),
          ],
          f.dir,
        ),
        3,
        'ci',
      );
    },
  },
  {
    id: 'ci/not-run-allowed',
    tier: 4,
    component: CI_CMD,
    title:
      'ci with --max-not-run 1 lets every block of a spec be not run: no not-run verdict, exit 0 on parity',
    cause:
      'ci gives the verdict not-run, exit 3, when a spec has more blocks not run than --max-not-run allows',
    run: async (f, mode) => {
      const store = join(f.dir, 'ci2.db');
      const base = await cli(
        [
          'campaign',
          'run',
          join(f.dir, 'clean'),
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-base',
        ],
        f.dir,
      );
      if (base.code !== 0) return fail(`the baseline exited ${base.code}: ${base.err.slice(0, 200)}`);
      const specs = join(f.dir, 'ci2-specs');
      mkdirSync(specs, { recursive: true });
      writeFileSync(join(specs, 'spec.yaml'), readFileSync(f.notRun, 'utf8'));
      const got = await cli(
        [
          'ci',
          '--specs',
          specs,
          '--target',
          TARGET,
          '--baseline',
          'c-base',
          '--store',
          store,
          '--mode',
          mode,
          '--max-not-run',
          '1',
          '--out',
          join(f.dir, 'ci2.json'),
        ],
        f.dir,
      );
      return got.code === 3 ? fail(`ci exited 3 with --max-not-run 1: ${got.out.slice(-240)}`) : PASS;
    },
  },
  {
    id: 'compare/not-run',
    tier: 3,
    component: COMPARE_CMD,
    title:
      'compare leaves a golden with a block not run out of its rates, says how many it left out, and exits 0 on parity',
    cause: 'compare prints the not-run count beside its pass rates and never gates on it',
    run: async (f, mode) => {
      const store = join(f.dir, 'compare.db');
      const base = await cli(
        [
          'campaign',
          'run',
          f.clean,
          f.notRun,
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-base',
        ],
        f.dir,
      );
      const cand = await cli(
        [
          'campaign',
          'run',
          f.clean,
          f.notRun,
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-cand',
        ],
        f.dir,
      );
      if (base.code !== 3 || cand.code !== 3)
        return fail(`the campaigns exited ${base.code} and ${cand.code}, expected 3 and 3`);
      const got = await cli(
        ['compare', '--store', store, '--baseline', 'c-base', '--candidate', 'c-cand'],
        f.dir,
      );
      return expectAll([
        [got.code === 0, `compare exited ${got.code}, expected 0: ${(got.err || got.out).slice(0, 200)}`],
        [
          /\bnot run\b/.test(got.out),
          `compare does not say what it left out as not run: ${got.out.slice(0, 400)}`,
        ],
      ]);
    },
  },
  {
    id: 'report/junit-skipped',
    tier: 3,
    component: REPORT_CMD,
    title: 'report writes a block not run as a skipped test case in the JUnit file, never a failure',
    cause: 'the JUnit writer marks a run with a block not run as skipped',
    run: async (f, mode) => {
      const store = join(f.dir, 'report.db');
      const ran = await cli(
        [
          'campaign',
          'run',
          f.notRun,
          '--target',
          TARGET,
          '--mode',
          mode,
          '--store',
          store,
          '--campaign',
          'c-report',
        ],
        f.dir,
      );
      if (ran.code !== 3) return fail(`campaign run exited ${ran.code}, expected 3`);
      const html = join(f.dir, 'report.html');
      const junit = join(f.dir, 'report.xml');
      const got = await cli(['report', 'c-report', '--store', store, '--out', html, '--junit', junit], f.dir);
      if (got.code !== 0) return fail(`report exited ${got.code}: ${got.err.slice(0, 200)}`);
      let xml = '';
      try {
        xml = readFileSync(junit, 'utf8');
      } catch {
        return fail(`report wrote no JUnit file at ${junit}`);
      }
      return expectAll([
        [/<skipped\b/.test(xml), 'the JUnit file holds no <skipped> element'],
        [!/<failure\b/.test(xml), 'the JUnit file holds a <failure> for a run with no failed block'],
      ]);
    },
  },
];

function exitItems(): Draft[] {
  const out: Draft[] = [];
  for (const c of EXIT_CASES)
    for (const mode of ['F', 'T'] as const) {
      const id = `exits/${c.id}/${mode}`;
      out.push(
        draft(
          id,
          'verdict-exits',
          c.tier,
          c.component,
          `${c.title}, mode ${mode}`,
          c.cause,
          async ({ seed, root, scratch }) => c.run(files(root, scratch, seed, id), mode),
        ),
      );
    }
  return out;
}

/** Every item of the not-run and blocked level. */
export function verdictItems(): BankItem[] {
  return withCauses([
    ...capabilityItems(),
    ...givenItems(),
    ...givenKinds(),
    ...recordItems(),
    ...blockedItems(),
    ...exitItems(),
  ]);
}

export { RUNNER };
