import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { type AgentAdapter, outcomeOf, type PlannedCell, runSpec } from '@agent-nexus/driftbench-core';
import {
  BUDGET_FILE,
  Budget,
  formatJson,
  inHoldout,
  openBundle,
  passRate,
  SEALED_FILE,
  SEALED_NOTE,
  SealedBundle,
  spendQuery,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import {
  type CampaignDeps,
  type CampaignScope,
  defaultDeps,
  parseTarget,
  resolveAdapter,
  showTarget,
} from './campaign';
import { display, exists, portable, readPool, table, whole } from './select';

export type HoldoutDeps = Pick<CampaignDeps, 'adapterFor' | 'checks' | 'artifacts' | 'driver' | 'now'>;

export const defaultHoldoutDeps: HoldoutDeps = {
  adapterFor: (target, scope) => defaultDeps.adapterFor(target, scope),
  checks: defaultDeps.checks,
  ...(defaultDeps.artifacts ? { artifacts: defaultDeps.artifacts } : {}),
  driver: (cell) => defaultDeps.driver(cell),
  now: () => new Date(),
};

type SealOptions = { specs: string; out: string; share?: string; seed?: string; force?: boolean };
type ScoreOptions = { sealed: string; target: string; budget?: string; json?: boolean };

/** Registers `driftbench holdout seal|score`. */
export function registerHoldoutCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: HoldoutDeps = defaultHoldoutDeps,
): void {
  const holdout = program
    .command('holdout')
    .description('The sealed holdout: seal a share of the gated specs, then score it once per query.');

  holdout
    .command('seal')
    .description("Seal a share of the gated specs; the gate's own sealed split is taken as it is.")
    .requiredOption(
      '--specs <dir>',
      'the gated specs: a folder written by driftbench gate, or a folder of specs',
    )
    .requiredOption('--out <dir>', 'the folder to write the sealed bundle into')
    .option('--share <share>', 'the share of specs to seal when the gate sealed none (default 0.2)')
    .option('--seed <n>', 'the seed of the draw when the gate sealed none (default 1)')
    .option('--force', 'replace a seal that has never been scored')
    .action(async (options: SealOptions) => {
      setExit(await holdoutSealCommand(options, io, deps));
    });

  holdout
    .command('score')
    .description('Run the sealed specs once through the runner and print the pass rate; spends one query.')
    .requiredOption('--sealed <dir>', 'the folder holdout seal wrote')
    .requiredOption('--target <adapter:agent>', 'the agent to score, such as function:acme-sales')
    .option('--budget <queries>', 'the query budget, fixed by the first score; later scores may restate it')
    .option('--json', 'print one JSON document')
    .action(async (options: ScoreOptions) => {
      setExit(await holdoutScoreCommand(options, io, deps));
    });
}

/**
 * `driftbench holdout seal --specs <dir> --out <dir> [--share s] [--seed n]`. When the folder holds gate
 * seals, the specs they list are sealed as they are and nothing is drawn again; otherwise each spec is
 * drawn with the gate's rule. Exit 0 when the bundle is written, 2 on a usage or input error.
 */
export async function holdoutSealCommand(options: SealOptions, io: Io, deps: HoldoutDeps): Promise<number> {
  const share = shareOf(options.share);
  const seed = whole(options.seed, 'seed', 0, 1);
  if (typeof share === 'string' || typeof seed === 'string') {
    io.err(`${typeof share === 'string' ? share : seed}\n`);
    return 2;
  }
  const root = resolve(io.cwd, options.specs);
  const pool = await readPool(root, io);
  if (typeof pool === 'number') return pool;

  const outPath = resolve(io.cwd, options.out);
  const bundlePath = join(outPath, SEALED_FILE);
  const budgetPath = join(outPath, BUDGET_FILE);
  if (await exists(bundlePath)) {
    if (!options.force) {
      io.err(
        `${display(bundlePath, io)} already exists. Pass --force to replace a seal that was never scored.\n`,
      );
      return 2;
    }
    if (await exists(budgetPath)) {
      io.err(
        `${display(budgetPath, io)} shows this seal has been scored: a scored holdout is never sealed again.\n`,
      );
      return 2;
    }
  }

  let entries: Array<{ id: string; path: string; hash: string; spec: unknown }>;
  let split: 'gate' | 'draw';
  let usedSeed = seed;
  let usedShare = share;
  if (pool.seals.length > 0) {
    split = 'gate';
    const missing = pool.sealed.filter((entry) => entry.spec === undefined);
    if (missing.length > 0) {
      // `<gate output>/specs` reads the seal of its parent, so select leaves the sealed specs out; the
      // sealed files themselves are beside that folder, not under it.
      const outside = pool.seals.find((entry) => relative(root, entry.file).startsWith('..'));
      if (outside !== undefined) {
        const holdoutDir = dirname(outside.file);
        const show = (path: string) => portable(display(path, io));
        io.err(
          `--specs ${show(root)} is the specs folder inside a gate output. The specs the gate sealed are beside it, in ${show(holdoutDir)}. Pass the gate's output folder: --specs ${show(dirname(holdoutDir))}\n`,
        );
        return 2;
      }
      io.err(
        `The gate seal lists specs that are not under --specs: ${missing.map((entry) => entry.id).join(', ')}. Point --specs at the gate's output folder.\n`,
      );
      return 2;
    }
    const seeds = new Set(pool.seals.map((entry) => entry.seal.seed));
    const shares = new Set(pool.seals.map((entry) => entry.seal.share));
    usedSeed = pool.seals[0]?.seal.seed ?? seed;
    usedShare = pool.seals[0]?.seal.share ?? share;
    if (seeds.size > 1 || shares.size > 1) {
      io.err(
        'The gate seals under --specs use different seeds or shares: seal each gate output on its own.\n',
      );
      return 2;
    }
    if (
      (options.share !== undefined && share !== usedShare) ||
      (options.seed !== undefined && seed !== usedSeed)
    ) {
      io.out(
        `Note: the gate sealed its split at seed ${usedSeed}, share ${usedShare}; that split is kept and nothing is drawn again.\n`,
      );
    }
    entries = pool.sealed.flatMap((entry) =>
      entry.spec
        ? [
            {
              id: entry.id,
              path: portable(relative(pool.base, entry.file)),
              hash: entry.hash,
              spec: entry.spec.spec,
            },
          ]
        : [],
    );
  } else {
    split = 'draw';
    entries = pool.specs
      .filter((spec) => inHoldout(spec.spec.id, share, seed))
      .map((spec) => ({
        id: spec.spec.id,
        path: portable(relative(pool.base, spec.path)),
        hash: spec.hash,
        spec: spec.spec,
      }));
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (entries.length === 0) {
    io.err('The draw sealed no spec: raise --share or add specs.\n');
    return 2;
  }
  const total = split === 'gate' ? pool.specs.length + entries.length : pool.specs.length;
  const bundle: SealedBundle = {
    sealed: true,
    note: SEALED_NOTE,
    source: portable(display(root, io)),
    split,
    seed: usedSeed,
    share: usedShare,
    gate_seals: pool.seals.map((entry) => portable(relative(pool.base, entry.file))),
    date: deps.now().toISOString().slice(0, 10),
    specs: entries,
  };
  await mkdir(outPath, { recursive: true });
  await writeFile(bundlePath, formatJson(bundle));

  const lines = [
    split === 'gate'
      ? `Sealed ${entries.length} of ${total} gated specs: the gate's split (seed ${usedSeed}, share ${usedShare}) from ${bundle.gate_seals.join(', ')}.`
      : `Sealed ${entries.length} of ${total} specs: drawn at seed ${usedSeed}, share ${usedShare}.`,
    '',
    ...table([
      ['#', 'spec', 'hash', 'read from'],
      ...entries.map((entry, index) => [String(index + 1), entry.id, entry.hash, entry.path]),
    ]),
    '',
    `Wrote ${display(bundlePath, io)}. The sealed specs run only through driftbench holdout score; select leaves them out.`,
  ];
  io.out(`${lines.join('\n')}\n`);
  return 0;
}

/**
 * `driftbench holdout score --sealed <dir> --target <adapter:agent> [--budget n]`. Spends one query of the
 * budget, runs every sealed spec once through the runner in free-running mode and prints the pass rate
 * with its 95 percent Wilson interval, never which spec passed. Exit 0 when scored, 1 when the budget is
 * spent (nothing runs), 2 on a usage or input error (nothing runs, nothing is spent).
 */
export async function holdoutScoreCommand(options: ScoreOptions, io: Io, deps: HoldoutDeps): Promise<number> {
  const target = parseTarget(options.target);
  if (target.agent === undefined || target.adapter === '' || target.agent === '') {
    io.err(`--target takes adapter:agent, such as function:acme-sales, not "${options.target}".\n`);
    return 2;
  }
  const shown = showTarget(target);
  const requested = options.budget === undefined ? undefined : whole(options.budget, 'budget', 1, 1);
  if (typeof requested === 'string') {
    io.err(`${requested}\n`);
    return 2;
  }
  const sealedPath = resolve(io.cwd, options.sealed);
  const bundlePath = join(sealedPath, SEALED_FILE);
  const budgetPath = join(sealedPath, BUDGET_FILE);
  const bundleRead = SealedBundle.safeParse(await readJson(bundlePath));
  if (!bundleRead.success) {
    io.err(
      `${display(bundlePath, io)} is missing or is not a sealed bundle: run driftbench holdout seal first.\n`,
    );
    return 2;
  }
  const opened = openBundle(bundleRead.data);
  if (opened.problems.length > 0) {
    for (const problem of opened.problems) io.err(`${problem}.\n`);
    io.err('The sealed bundle was changed: it is not scored.\n');
    return 2;
  }
  let found: Budget | undefined;
  if (await exists(budgetPath)) {
    const budgetRead = Budget.safeParse(await readJson(budgetPath));
    if (!budgetRead.success) {
      io.err(`${display(budgetPath, io)} is not a budget file: it is not scored.\n`);
      return 2;
    }
    found = budgetRead.data;
  }
  const date = deps.now().toISOString().slice(0, 10);
  const decision = spendQuery(found, requested, shown, date);
  if (!decision.ok) {
    io.err(`${decision.message}\n`);
    return decision.code;
  }

  const scope = openScope();
  let adapter: AgentAdapter | undefined;
  try {
    adapter = await resolveAdapter(target, () => deps.adapterFor(target, scope), io, [], { unspent: true });
    if (!adapter) {
      return 2;
    }
    // The query is spent before the first run: results seen once count, even when the run breaks off.
    await writeFile(budgetPath, formatJson(decision.budget));

    const notRun: string[] = [];
    let passed = 0;
    let conversations = 0;
    for (const { spec } of opened.specs) {
      if (spec.target && showTarget(spec.target) !== shown) {
        notRun.push(`${spec.id} (names ${showTarget(spec.target)})`);
        continue;
      }
      const run = await runSpec(spec, {
        adapter,
        driver: deps.driver(),
        checks: deps.checks,
        mode: 'F',
        repeat: 0,
        ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
      });
      const cell: PlannedCell = {
        cellId: `holdout:${spec.id}`,
        specId: spec.id,
        specHash: run.specHash,
        target,
        mode: 'F',
        repeat: 0,
        blocks: spec.blocks.length,
      };
      // A conversation with a block not run or blocked, and no failure, is no measurement: it is listed with
      // the ones not run and stays out of the rate.
      const state = outcomeOf(cell, run).state;
      if (state === 'not_run' || state === 'blocked') {
        notRun.push(`${spec.id} (${state === 'not_run' ? 'a block not run' : 'a block blocked'})`);
        continue;
      }
      conversations += 1;
      if (state === 'pass') passed += 1;
    }
    const rate = passRate(passed, conversations);
    const scored = {
      ...decision.budget,
      scores: decision.budget.scores.map((entry) =>
        entry.query === decision.query
          ? {
              ...entry,
              state: 'scored' as const,
              conversations,
              passed,
              not_run: notRun,
              ...(rate
                ? {
                    rate: { estimate: round(rate.estimate), low: round(rate.lower), high: round(rate.upper) },
                  }
                : {}),
            }
          : entry,
      ),
    };
    await writeFile(budgetPath, formatJson(scored));

    const left = scored.total - scored.used;
    if (options.json) {
      io.out(
        `${JSON.stringify({ sealed: portable(display(sealedPath, io)), target: shown, query: decision.query, budget: { total: scored.total, used: scored.used, left }, conversations, passed, not_run: notRun, ...(rate ? { rate } : {}) }, null, 2)}\n`,
      );
      return 0;
    }
    const lines = [
      `Holdout score, query ${decision.query} of ${scored.total}, on ${shown}: ${opened.specs.length} sealed conversations, each run once.`,
      '',
      ...table([
        ['conversations', 'passed', 'pass rate', '95% Wilson interval'],
        [
          String(conversations),
          String(passed),
          rate ? percent(rate.estimate) : '-',
          rate ? `${percent(rate.lower)} to ${percent(rate.upper)}` : '-',
        ],
      ]),
      '',
      ...(notRun.length > 0 ? [`Not run, not counted: ${notRun.join(', ')}.`] : []),
      `Budget: ${scored.used} of ${scored.total} queries used, ${left} left. Which conversation passed is not shown: the holdout stays sealed.`,
    ];
    io.out(`${lines.join('\n')}\n`);
    return 0;
  } finally {
    await scope.close(io);
  }
}

function shareOf(text: string | undefined): number | string {
  if (text === undefined) return 0.2;
  const value = optionNumber(text);
  if (text.trim() === '' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    return `--share must be a number above 0 and below 1, got "${text}".`;
  }
  return value;
}

/** A temporary folder for the sandboxes of a process target, removed at the end. */
function openScope(): CampaignScope & { close(io: Io): Promise<void> } {
  let made: Promise<string> | undefined;
  return {
    tempDir() {
      made ??= mkdtemp(join(tmpdir(), 'driftbench-holdout-'));
      return made;
    },
    async close(io) {
      if (made === undefined) return;
      const folder = await made;
      try {
        await rm(folder, { recursive: true, force: true });
      } catch (cause) {
        io.err(
          `The sandbox folder ${folder} could not be removed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        );
      }
    },
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
