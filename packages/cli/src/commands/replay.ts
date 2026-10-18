import { basename, dirname, resolve } from 'node:path';
import {
  orderedCheck,
  type ReplaySession,
  readSession,
  replayAdapter,
} from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import {
  CheckRegistry,
  type DefaultChecksOptions,
  defaultChecks,
  defaultRegistry,
  ESTATE_CHECKS,
} from '@agent-nexus/driftbench-checks';
import {
  blocksOutcome,
  type Campaign,
  type Check,
  type CheckSet,
  contentHash,
  type Embedder,
  type LoadedSpec,
  type RunResult,
  runSpec,
  type Store,
  type TargetRef,
  type ToolRule,
} from '@agent-nexus/driftbench-core';
import { noJudgeCheck } from '@agent-nexus/driftbench-judges';
import { openMemoryStore, openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  addJudgeOptions,
  addRunCheckOptions,
  type RunCheckFlags,
  type RunJudgeOptions,
  runCheckSettingsFrom,
  runJudgeFrom,
} from '../judge-options';
import { loadValidSpecs } from './campaign';

/**
 * `driftbench replay`: re-runs the checks of a suite of specs on recorded sessions, with no agent call; the judged criteria call a judge model only with --judge.
 *
 * Each session is read by the Claude Code adapter into blocks of Observed. Each spec is aligned with one
 * session and a first block:
 * - explicitly, by `metadata.replay: { session, from_block }`, where `session` is the transcript's file
 *   name without `.jsonl` (or its path) and `from_block` the session block the spec's first block reads
 *   (default 0);
 * - otherwise by order: the k-th spec without that key, in file order, reads the k-th session given, from
 *   block 0.
 * A spec that names a session not given is skipped with a note. The run is the runner's own: mode F, the
 * scripted driver, `defaultChecks()` plus the ordered-pair check under `rules.custom.ordered`, no cache. Each
 * run is stored (in the store given with `--store`, in memory otherwise) under one replay campaign. Judged
 * criteria are judged by `--judge` when it is given, and are inconclusive without it. A decision log or step feed belongs to the session whose file name starts its own
 * file name (`clean-build.decisions.jsonl` for `clean-build.jsonl`); with one session it belongs to it.
 *
 * Exit 0 when every aligned spec passes, 1 when one fails, 2 on bad input.
 */

export type ReplayDeps = {
  openStore(path: string | undefined): Promise<Store>;
  now(): Date;
};

export const defaultReplayDeps: ReplayDeps = {
  openStore: async (path) => (path === undefined ? openMemoryStore() : openStore(path)),
  now: () => new Date(),
};

export type ReplayOptions = {
  suite: string;
  decisions: string[];
  steps: string[];
  store?: string;
  json?: boolean;
  /** The owner's own values (an email, a phone, an IBAN) the pii check leaves out. */
  owner?: string[];
  /** A file of owner values, one per line; blank lines and lines starting with # are skipped. */
  ownerFile?: string;
} & RunJudgeOptions &
  RunCheckFlags;

/** Registers `driftbench replay`. */
export function registerReplayCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ReplayDeps = defaultReplayDeps,
): void {
  const replay = program
    .command('replay')
    .description(
      'Re-run the checks of a spec suite on recorded sessions: no agent call; a judge model only with --judge.',
    )
    .argument('<sessions...>', 'session transcripts (JSONL)')
    .requiredOption('--suite <dir>', 'the spec files or folder to run')
    .option(
      '--decisions <logs...>',
      'guard decision logs (JSONL), one per session, matched by file name',
      collectAll,
      [],
    )
    .option('--steps <feeds...>', 'step feeds (JSONL), one per session, matched by file name', collectAll, [])
    .option('--store <db>', 'keep the runs in this store; in memory without it')
    .option(
      '--owner <values...>',
      "the owner's own email, phone, IBAN or national number: the pii check leaves exactly these out",
      collectAll,
      [],
    )
    .option('--owner-file <file>', 'owner values, one per line, for the pii check; # starts a comment line')
    .option('--json', 'print one JSON document');
  addRunCheckOptions(addJudgeOptions(replay), { owner: false }).action(
    async (sessions: string[], options: ReplayOptions) => {
      setExit(await replayCommand(sessions, options, io, deps));
    },
  );
}

type SessionEntry = {
  name: string;
  path: string;
  session: ReplaySession;
  decisions?: string;
  steps?: string;
};

// Estate statistics use the same session alignment and reference/tree reads as replay.
export type { SessionEntry };
export { align as alignReplaySpecs, sessionFor as replaySessionFor };

/** The before and after trees of a spec's session: the seed folder, and the folder the session left. */
type Trees = { before: string; after: string };
type Alignment = {
  spec: LoadedSpec;
  entry: SessionEntry;
  fromBlock: number;
  how: 'metadata' | 'order';
  trees?: Trees;
};
type ReplayLine = {
  spec: string;
  session: string;
  fromBlock: number;
  aligned: 'metadata' | 'order';
  runId: string;
  status: RunResult['status'];
  pass: boolean;
  /** Set when no block failed but a block was not run or blocked: the spec is neither a pass nor a fail. */
  outcome?: 'not_run' | 'blocked';
  failing: string[];
  error?: string;
};

export async function replayCommand(
  sessionPaths: string[],
  options: ReplayOptions,
  io: Io,
  deps: ReplayDeps = defaultReplayDeps,
): Promise<number> {
  const misplaced = sessionPaths.filter((path) => /\.(decisions|steps)\.jsonl$/.test(path));
  if (misplaced.length > 0) {
    io.err(
      `${misplaced.join(', ')} ${misplaced.length === 1 ? 'is a log' : 'are logs'}, not ${misplaced.length === 1 ? 'a session' : 'sessions'}. Pass decision logs after --decisions and step feeds after --steps.\n`,
    );
    return 2;
  }
  const paths = sessionPaths.map((path) => resolve(io.cwd, path));
  const names = paths.map(sessionName);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    io.err(`Two sessions share the name ${duplicate}; give each transcript its own file name.\n`);
    return 2;
  }
  const settings = await runCheckSettingsFrom(options, io);
  const judge = await runJudgeFrom(options, io);
  if (!judge) return 2;
  if (!settings) return 2;
  const owner = settings.piiOwner;
  const decisions = assign(options.decisions, names, '--decisions', io);
  const steps = assign(options.steps, names, '--steps', io);
  if (!decisions || !steps) return 2;

  const entries: SessionEntry[] = [];
  for (const [index, path] of paths.entries()) {
    const name = names[index] as string;
    try {
      const decisionLog = decisions.get(name);
      const stepFeed = steps.get(name);
      const files = {
        transcript: path,
        ...(decisionLog === undefined ? {} : { decisions: resolve(io.cwd, decisionLog) }),
        ...(stepFeed === undefined ? {} : { steps: resolve(io.cwd, stepFeed) }),
      };
      const session = await readSession(files);
      entries.push({ name, path, session, ...files });
    } catch (cause) {
      io.err(`Cannot read the session ${name}: ${describe(cause)}\n`);
      return 2;
    }
  }

  const loaded = await loadValidSpecs([options.suite], io);
  if (!loaded) return 2;
  const aligned = align(loaded, entries, io, judge.label !== 'none');
  if (!aligned) return 2;
  if (aligned.alignments.length === 0) {
    io.err('No spec is aligned with the sessions given: nothing ran.\n');
    return 2;
  }

  let store: Store;
  const storePath = options.store === undefined ? undefined : resolve(io.cwd, options.store);
  try {
    store = await deps.openStore(storePath);
  } catch (cause) {
    io.err(`Cannot open the store at ${storePath}: ${describe(cause)}\n`);
    return 2;
  }
  const lines: ReplayLine[] = [];
  let campaignId: string;
  try {
    const createdAt = deps.now().toISOString();
    const specs = uniqueBy(
      aligned.alignments.map(({ spec, entry }) => ({
        id: spec.spec.id,
        hash: spec.hash,
        target: targetOf(entry),
      })),
      (spec) => `${spec.id} ${spec.hash}`,
    );
    const targets = uniqueBy(
      aligned.alignments.map(({ entry }) => targetOf(entry)),
      (target) => target.agent ?? '',
    );
    campaignId = `replay-${contentHash({ specs, targets, sessions: entries.map(fingerprint), createdAt })}`;
    for (const spec of uniqueBy(
      aligned.alignments.map((entry) => entry.spec),
      (spec) => spec.hash,
    )) {
      await store.putSpec(spec);
    }
    const campaign: Campaign = {
      campaignId,
      specs,
      targets,
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: judge.mode, judges: judge.judges },
      createdAt,
    };
    await store.putCampaign(campaign);
    const checks = replayChecks({
      piiOwner: owner,
      judge: judge.check,
      piiJudge: judge.piiJudge,
      ...(settings.toolPolicy ? { toolPolicy: settings.toolPolicy } : {}),
      ...(settings.embedder ? { embedder: settings.embedder } : {}),
    });
    const artifacts = defaultReaders();
    for (const alignment of aligned.alignments) {
      const session = await sessionFor(alignment);
      const run = await runSpec(alignment.spec.spec, {
        adapter: replayAdapter({
          session,
          fromBlock: alignment.fromBlock,
          ...(alignment.trees ? { files: alignment.trees.after } : {}),
        }),
        artifacts,
        driver: createScriptedDriver(),
        checks,
        ...(settings.toolPolicy ? { toolPolicy: settings.toolPolicy } : {}),
        mode: 'F',
        repeat: 0,
        target: targetOf(alignment.entry),
        store,
        campaignId,
        now: deps.now,
      });
      lines.push(lineOf(alignment, run));
    }
  } catch (cause) {
    io.err(`Replay stopped: ${describe(cause)}\n`);
    await closeStore(store, io);
    return 2;
  }
  const closed = await closeStore(store, io);
  if (!closed) return 2;
  await judge.save();

  const passed = lines.filter((line) => line.pass).length;
  // A spec not run or blocked is neither a pass nor a fail: it is counted apart.
  const unscored = lines.filter((line) => line.outcome !== undefined).length;
  const failed = lines.length - passed - unscored;
  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          campaignId,
          store: storePath ?? null,
          notes: aligned.notes,
          judge: judge.label,
          judgeCostUsd: judge.spend.usd,
          runs: lines,
          passed,
          failed,
          ...(unscored > 0 ? { notRun: unscored } : {}),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const note of aligned.notes) io.out(`note: ${note}\n`);
    for (const line of lines) {
      const mark = line.status !== 'completed' ? '!' : line.pass ? '✓' : line.outcome ? '-' : '✗';
      io.out(
        `${mark} ${line.spec}  session ${line.session} from block ${line.fromBlock} (${line.aligned})\n`,
      );
      if (line.error) io.out(`    error: ${line.error}\n`);
      if (line.failing.length > 0) io.out(`    failing: ${line.failing.join(', ')}\n`);
    }
    io.out(
      `${lines.length} spec${lines.length === 1 ? '' : 's'} replayed: ${passed} pass, ${failed} fail${unscored > 0 ? `, ${unscored} not run or blocked` : ''}. Judge ${judge.label}, ${judge.spend.usd.toFixed(4)} USD. Campaign ${campaignId}${storePath === undefined ? ' (in memory)' : ''}.\n`,
    );
  }
  return passed === lines.length ? 0 : 1;
}

/**
 * The session a spec reads. It is read again for the spec when the spec names files it must read (they map
 * to references beside the skill folders) or names its trees (the last block's workspace diff is then the
 * diff of the trees, and its artifacts are read from the after folder).
 */
async function sessionFor(alignment: Alignment): Promise<ReplaySession> {
  const named = referencesOf(alignment.spec);
  const { entry, trees } = alignment;
  if (named.length === 0 && !trees) return entry.session;
  return readSession({
    transcript: entry.path,
    ...(entry.decisions === undefined ? {} : { decisions: entry.decisions }),
    ...(entry.steps === undefined ? {} : { steps: entry.steps }),
    ...(trees ? { before: trees.before, after: trees.after } : {}),
    ...(named.length === 0 ? {} : { references: named }),
  });
}

/** Every path or glob a spec expects the agent to read, in its blocks and its perturbations. */
function referencesOf(spec: LoadedSpec): string[] {
  const expects = [
    ...spec.spec.blocks.map((block) => block.expect),
    ...(spec.spec.perturbations ?? []).map((perturbation) => perturbation.expect),
  ];
  return [
    ...new Set(expects.flatMap((expect) => (expect?.references ?? []).map((reference) => reference.path))),
  ];
}

/**
 * The custom checks of an estate run: every check of the default registry, the ordered-pair check, and
 * the estate checks (`some_call`, `hazard_recovery`, `permission`). The estate generator writes only names
 * this registry holds (`REPLAY_CUSTOM_CHECKS`).
 */
export function replayRegistry(): CheckRegistry {
  const registry = new CheckRegistry();
  for (const name of defaultRegistry.names()) {
    const check = defaultRegistry.get(name);
    if (check) registry.register(name, check);
  }
  if (!registry.get('ordered')) registry.register('ordered', orderedCheck);
  for (const [name, check] of Object.entries(ESTATE_CHECKS)) {
    if (!registry.get(name)) registry.register(name, check);
  }
  return registry;
}

/**
 * The checks of a replay: every default check, with the replay registry's custom checks. `piiOwner` lists
 * the owner's own values the pii check leaves out; empty by default. `judge` judges the criteria blocks
 * name; without one, each is inconclusive (`noJudgeCheck`), never a pass.
 */
export function replayChecks(
  options: {
    piiOwner?: readonly string[];
    judge?: Check;
    piiJudge?: DefaultChecksOptions['piiJudge'];
    toolPolicy?: readonly ToolRule[];
    embedder?: Embedder;
  } = {},
): CheckSet {
  const registry = replayRegistry();
  const judge = options.judge ?? noJudgeCheck();
  return defaultChecks({
    registry,
    judges: { check: () => judge },
    piiJudge: options.piiJudge,
    ...(options.piiOwner?.length ? { piiOwner: options.piiOwner } : {}),
    ...(options.toolPolicy?.length ? { toolPolicy: options.toolPolicy } : {}),
    ...(options.embedder ? { embedder: options.embedder } : {}),
  });
}

/** A session's name: its file name without `.jsonl`. */
function sessionName(path: string): string {
  return basename(path).replace(/\.jsonl$/i, '');
}

function targetOf(entry: SessionEntry): TargetRef {
  return { adapter: 'claude-code', agent: entry.name };
}

function fingerprint(entry: SessionEntry): string {
  return contentHash({ name: entry.name, blocks: entry.session.blocks });
}

/** Gives each log to the session its file name starts with; with one session, to that session. */
function assign(
  logs: readonly string[],
  names: readonly string[],
  flag: string,
  io: Io,
): Map<string, string> | undefined {
  const out = new Map<string, string>();
  for (const log of logs) {
    const file = basename(log);
    const owners =
      names.length === 1 ? [...names] : names.filter((name) => file === name || file.startsWith(`${name}.`));
    const owner = owners.sort((a, b) => b.length - a.length)[0];
    if (owner === undefined) {
      io.err(
        `${flag} ${log}: its file name starts with no session name (${names.join(', ')}); name it <session>.<anything>.jsonl\n`,
      );
      return undefined;
    }
    if (out.has(owner)) {
      io.err(`${flag}: two files for the session ${owner}: ${out.get(owner)} and ${log}\n`);
      return undefined;
    }
    out.set(owner, log);
  }
  return out;
}

function align(
  loaded: readonly LoadedSpec[],
  entries: readonly SessionEntry[],
  io: Io,
  judged = false,
): { alignments: Alignment[]; notes: string[] } | undefined {
  const alignments: Alignment[] = [];
  const notes: string[] = [];
  let next = 0;
  let bad = false;
  for (const spec of loaded) {
    const key = spec.spec.metadata?.replay;
    if (key === undefined) {
      const entry = entries[next];
      next += 1;
      if (!entry) {
        notes.push(`${spec.spec.id} has no replay key and no session is left to align by order; skipped`);
        continue;
      }
      alignments.push({ spec, entry, fromBlock: 0, how: 'order' });
      continue;
    }
    const parsed = replayKey(key);
    if (typeof parsed === 'string') {
      io.err(`${spec.spec.id}: metadata.replay ${parsed}\n`);
      bad = true;
      continue;
    }
    const entry = entries.find(
      (candidate) =>
        candidate.name === parsed.session ||
        candidate.name === sessionName(parsed.session) ||
        candidate.path === resolve(io.cwd, parsed.session),
    );
    if (!entry) {
      notes.push(`${spec.spec.id} names the session ${parsed.session}, which was not given; skipped`);
      continue;
    }
    // The trees belong to the session: they resolve from the transcript's folder, so a corpus can move.
    const folder = dirname(entry.path);
    const trees =
      parsed.trees === undefined
        ? undefined
        : { before: resolve(folder, parsed.trees.before), after: resolve(folder, parsed.trees.after) };
    alignments.push({
      spec,
      entry,
      fromBlock: parsed.fromBlock,
      how: 'metadata',
      ...(trees ? { trees } : {}),
    });
  }
  if (bad) return undefined;
  for (const { spec, entry } of alignments) {
    if (!judged && spec.spec.criteria?.length)
      notes.push(`${spec.spec.id}: judged criteria are inconclusive: no --judge was given`);
    const wantsGuards = spec.spec.blocks.some((block) => (block.expect?.guards?.length ?? 0) > 0);
    if (wantsGuards && !entry.session.meta.decisions) {
      notes.push(
        `${spec.spec.id} expects guards, but no decision log was given for ${entry.name}: no guard was seen`,
      );
    }
    const wantsStages = spec.spec.blocks.some((block) => block.expect?.stage !== undefined);
    if (wantsStages && !entry.session.meta.steps) {
      notes.push(`${spec.spec.id} expects stages, but no step feed was given for ${entry.name}`);
    }
  }
  return { alignments, notes };
}

const REPLAY_KEYS = ['session', 'from_block', 'before', 'after'];

function replayKey(value: unknown): { session: string; fromBlock: number; trees?: Trees } | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'is a mapping: { session, from_block, before, after }';
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !REPLAY_KEYS.includes(key));
  if (unknown.length > 0) {
    return `has unknown keys: ${unknown.join(', ')}; it takes session, from_block, before and after`;
  }
  const folder = (key: string) => typeof record[key] === 'string' && record[key] !== '';
  if ((record.before !== undefined || record.after !== undefined) && !(folder('before') && folder('after'))) {
    return 'before and after go together: the folders the workspace held before and after the session';
  }
  if (typeof record.session !== 'string' || record.session === '') return 'needs session, a session name';
  const from = record.from_block ?? 0;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
    return 'from_block is a whole number of at least 0';
  }
  return {
    session: record.session,
    fromBlock: from,
    ...(folder('after') ? { trees: { before: String(record.before), after: String(record.after) } } : {}),
  };
}

function lineOf(alignment: Alignment, run: RunResult): ReplayLine {
  const failing = run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map(
        (verdict) =>
          `block ${block.index}: ${verdict.id}${verdict.outcome === 'inconclusive' ? ' (inconclusive)' : ''}`,
      ),
  );
  const outcome = blocksOutcome(run);
  const pass = outcome === 'pass';
  const skipped = run.blocks.flatMap((block) =>
    block.notRun
      ? [`block ${block.index}: not run (${block.notRun.check}: ${block.notRun.got})`]
      : block.blocked
        ? [`block ${block.index}: blocked by ${block.blocked.by}`]
        : [],
  );
  return {
    spec: run.specId,
    session: alignment.entry.name,
    fromBlock: alignment.fromBlock,
    aligned: alignment.how,
    runId: run.runId,
    status: run.status,
    pass,
    ...(outcome === 'not_run' || outcome === 'blocked' ? { outcome } : {}),
    failing: [...failing, ...skipped],
    ...(run.error === undefined ? {} : { error: run.error }),
  };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function closeStore(store: Store, io: Io): Promise<boolean> {
  try {
    await store.close();
    return true;
  } catch (cause) {
    io.err(`Closing the store failed: ${describe(cause)}\n`);
    return false;
  }
}

/** A repeated variadic option accumulates: `--decisions a b --decisions c` gives `[a, b, c]`. */
function collectAll(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The owner values from --owner and --owner-file. Undefined, with the reason printed, when the file cannot be read. */
