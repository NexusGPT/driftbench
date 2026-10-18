import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import {
  type Campaign,
  type CellOutcome,
  canonicalJson,
  type LoadedSpec,
  loadSpecFile,
  type Observed,
  type PlannedCell,
  planCampaign,
  RunResult,
  runCampaign,
  runSpec,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import {
  openStore,
  readCampaignBundle,
  restoreFiles,
  SCHEMA_VERSION,
  type SqliteStore,
  StoreError,
} from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { migrateFloors, raiseFloor, readFloors, writeFloors } from '../../../../floors';
import { type BankItem, expectAll, fail, type ItemContext, type ItemResult, PASS, type Tier } from '../types';
import { behavioursFor, plantedFlow, runScenario } from '../world';

// Loaded at call time from the running Node.js: a bundler would turn a static import of node:sqlite into a
// package named sqlite, which does not exist.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite;

/**
 * Executable claims on four subjects of robustness, all at level 1 (records).
 *
 * robust-concurrency: two real processes (`node --import tsx` children) on one store file: two campaigns at
 * once, two writers of one campaign, a reader during a write, the cache, the registry, units, imports, and
 * two `campaign run` commands that pick the same campaign id. Oracle: every committed write is readable,
 * whole and once; no lost update; no error other than a documented StoreError (packages/store/src/errors.ts).
 * Where a race needs exact timing, a raw SQLite child holds an open write transaction (what another store
 * process does between its check and its commit) while the store call runs.
 *
 * robust-resume: a campaign run killed (SIGKILL of a child started here, by its captured pid, or the child
 * killing itself at a planted point) before the first run, mid run, between runs, during the write of a run
 * record and during the final report; then the documented recovery path (docs/running.md "campaign resume"
 * and "The worker pool": runCampaign reuses every completed run of the store). Oracle: every cell ends with
 * exactly one completed run, a finished run is never run again, the budget counts each stored run once.
 *
 * robust-transfer: campaign bundles and dataset versions interrupted (a killed writer, a truncated or
 * missing member) and re-run (docs/datasets.md "Run a campaign again elsewhere", docs/running.md "The
 * store"). Oracle: an incomplete bundle is refused with BUNDLE_INVALID and nothing of it is visible; a re-run
 * completes.
 *
 * robust-version: old data read by today's code. The schema 1 SQL of the store and the bundle format of
 * schema 1 and 2 are copied from git history (commit named at each copy); old spec fields from the history
 * of packages/core/src/schema/spec.ts; the format version 1 floors file from validators/floors.json history.
 * Oracle: what the docs promise for older data: read, upgraded or migrated, or refused with a named error.
 */

const STORE = 'packages/store/src/store.ts';
const BUNDLE = 'packages/store/src/bundle.ts';
const REGISTRY = 'packages/store/src/registry.ts';
const SCHEMA = 'packages/store/src/schema.ts';
const CAMPAIGN = 'packages/core/src/runner/campaign.ts';
const CLI_CAMPAIGN = 'packages/cli/src/commands/campaign.ts';
const LOAD = 'packages/core/src/spec/load.ts';
const FLOORS = 'packages/validators/src/floors.ts';

const FAMILIES = {
  concurrency: 'robust-concurrency',
  resume: 'robust-resume',
  transfer: 'robust-transfer',
  version: 'robust-version',
} as const;

type FamilyShort = keyof typeof FAMILIES;

type Spec = {
  slug: string;
  tier: Tier;
  component: string;
  source: BankItem['source'];
  title: string;
  cause: string;
  check: BankItem['check'];
};

function item(family: FamilyShort, spec: Spec): BankItem {
  const { slug, ...rest } = spec;
  return { id: `robust/${family}/${slug}`, family: FAMILIES[family], level: 1, ...rest };
}

/* ------------------------------------------------------------------------------------------------ */
/* Shared helpers                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const CLOCK = '2026-10-11T00:00:00.000Z';
const TARGET: TargetRef = { adapter: 'function', agent: 'bank-agent' };

/** A fresh folder of one item and seed under the run's scratch folder. */
function folderFor(ctx: ItemContext, tag: string): string {
  const dir = join(ctx.scratch, 'claims-robust', `${tag}-${ctx.seed}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

const src = (ctx: ItemContext, pkg: string): string => join(ctx.root, 'packages', pkg, 'src', 'index.ts');

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

const show = (value: unknown, size = 300): string => {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  return text.length > size ? `${text.slice(0, size)}...` : text;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

async function caught(work: Promise<unknown> | (() => Promise<unknown>)): Promise<unknown> {
  try {
    await (typeof work === 'function' ? work() : work);
    return undefined;
  } catch (error) {
    return error ?? new Error('a falsy value was thrown');
  }
}

/** What an error is, as the store documents errors: a StoreError and its code, or anything else. */
function kindOf(error: unknown): string {
  if (error === undefined) return 'no error';
  if (error instanceof StoreError) return `StoreError ${error.code}`;
  const e = error as Error;
  return `${e?.name ?? typeof error}: ${String(e?.message ?? error).slice(0, 240)}`;
}

async function withStore<T>(path: string, use: (store: SqliteStore) => Promise<T>): Promise<T> {
  const store = openStore(path);
  try {
    return await use(store);
  } finally {
    await store.close();
  }
}

function campaignOf(campaignId: string, run: RunResult, extra: Partial<Campaign> = {}): Campaign {
  return {
    campaignId,
    specs: [{ id: run.specId, hash: run.specHash }],
    targets: [TARGET],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CLOCK,
    ...extra,
  };
}

/** One real run of a three-block planted flow, the record most store items start from. */
async function baseRun(seed: number, tag: string): Promise<RunResult> {
  const planted = plantedFlow(seed, `robust-${tag}`, 3);
  return runScenario(planted.spec, behavioursFor(planted, new Map([[1, ['X1_local']]])), { target: TARGET });
}

/** A copy of a run under another run id, as JSON (what the store gives back). */
function variant(run: RunResult, runId: string, extra: Partial<RunResult> = {}): RunResult {
  return JSON.parse(JSON.stringify({ ...run, runId, ...extra })) as RunResult;
}

/** A run whose cost names its block count, so a read that mixes two versions shows. */
function sized(run: RunResult, runId: string, blocks: number): RunResult {
  const source = run.blocks;
  const made = Array.from({ length: blocks }, (_, index) => ({
    ...(source[index % source.length] as RunResult['blocks'][number]),
    index,
  }));
  return variant(run, runId, { blocks: made, cost: blocks });
}

function observedText(text: string, usd = 0): Observed {
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: { usd }, latencyMs: 1 };
}

/** Polls a condition until it holds or the time runs out. */
async function waitFor(condition: () => boolean, ms: number, step = 10): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await sleep(step);
  }
  return condition();
}

type Ended = { code: number | null; signal: NodeJS.Signals | null; out: string; err: string };
type Launched = { pid: number; lines: string[]; ended: Promise<Ended>; isRunning(): boolean };

/** Starts node with arguments; its pid is captured at launch, the only pid an item ever kills. */
function launch(args: string[], cwd: string, onLine?: (line: string) => void): Launched {
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = child.pid;
  if (pid === undefined) throw new Error(`could not start node ${args.join(' ').slice(0, 200)}`);
  const lines: string[] = [];
  let out = '';
  let err = '';
  let pending = '';
  let running = true;
  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    out += text;
    pending += text;
    let at = pending.indexOf('\n');
    while (at >= 0) {
      const line = pending.slice(0, at);
      lines.push(line);
      onLine?.(line);
      pending = pending.slice(at + 1);
      at = pending.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8');
  });
  const ended = new Promise<Ended>((done, reject) => {
    child.once('error', (error) => {
      running = false;
      reject(error);
    });
    child.once('close', (code, signal) => {
      running = false;
      done({ code, signal, out, err });
    });
  });
  return { pid, lines, ended, isRunning: () => running };
}

/** A TypeScript child, run from the repository root so `tsx` resolves. */
function tsx(ctx: ItemContext, script: string, args: string[], onLine?: (line: string) => void): Launched {
  return launch(['--import', 'tsx', script, ...args], ctx.root, onLine);
}

/** SIGKILL to a pid captured at launch (or written by an agent this item started). A gone process is fine. */
function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/* ---------------------------------------- store worker ------------------------------------------ */

type OpResult = { ok: boolean; value?: unknown; code?: string | null; name?: string; message?: string };

const workerScript = (ctx: ItemContext) => `import { existsSync, readFileSync } from 'node:fs';
import { openStore } from ${JSON.stringify(src(ctx, 'store'))};
const [path, opsFile, goFile] = process.argv.slice(2);
const ops = JSON.parse(readFileSync(opsFile, 'utf8'));
const store = openStore(path);
console.log('ready');
while (goFile && !existsSync(goFile)) await new Promise((done) => setTimeout(done, 2));
const results = [];
for (const op of ops) {
  try {
    let value;
    if (op.op === 'putCampaign') await store.putCampaign(op.campaign);
    else if (op.op === 'putRun') await store.putRun(op.campaignId, op.run);
    else if (op.op === 'putSpec') await store.putSpec(op.spec);
    else if (op.op === 'putUnit') await store.putUnit(op.unit);
    else if (op.op === 'cachePut') await store.cachePut(op.key, op.observed);
    else if (op.op === 'import') value = (await store.importCampaign(op.folder)).campaign.campaignId;
    else if (op.op === 'push') {
      const files = op.files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.text) }));
      const pushed = await store.pushVersion(op.kind, op.name, files);
      value = { version: pushed.version.version, created: pushed.created, hash: pushed.version.hash };
    } else throw new Error('unknown op ' + op.op);
    results.push({ ok: true, value });
  } catch (error) {
    results.push({ ok: false, code: error?.code ?? null, name: error?.name, message: String(error?.message ?? error).slice(0, 300) });
  }
}
await store.close();
console.log('RESULT ' + JSON.stringify(results));
`;

/** Runs one store worker per op list, all released at the same moment, and returns their results. */
async function race(
  ctx: ItemContext,
  dir: string,
  path: string,
  opLists: unknown[][],
): Promise<{ results: OpResult[][]; problems: string[] }> {
  const script = join(dir, 'worker.mts');
  writeFileSync(script, workerScript(ctx));
  const go = join(dir, `go-${Date.now()}`);
  const workers = opLists.map((ops, index) => {
    const file = join(dir, `ops-${index}.json`);
    writeFileSync(file, JSON.stringify(ops));
    return tsx(ctx, script, [path, file, go]);
  });
  const ready = await waitFor(
    () => workers.every((w) => w.lines.includes('ready') || !w.isRunning()),
    60_000,
  );
  writeFileSync(go, 'go');
  const ends = await Promise.all(workers.map((w) => w.ended));
  const problems: string[] = [];
  if (!ready) problems.push('a worker did not start within 60 s');
  const results = ends.map((end, index) => {
    const line = end.out.split('\n').find((l) => l.startsWith('RESULT '));
    if (!line) {
      problems.push(
        `worker ${index} ended ${end.code ?? end.signal} without results: ${end.err.slice(0, 300)}`,
      );
      return [];
    }
    return JSON.parse(line.slice('RESULT '.length)) as OpResult[];
  });
  return { results, problems };
}

/** Every op that failed, as `worker:op code message`. */
function failedOps(results: OpResult[][], allowed: readonly string[] = []): string[] {
  return results.flatMap((list, w) =>
    list.flatMap((r, i) =>
      r.ok || (r.name === 'StoreError' && allowed.includes(String(r.code)))
        ? []
        : [`worker ${w} op ${i}: ${r.name ?? 'error'} ${r.code ?? ''} ${r.message ?? ''}`.trim()],
    ),
  );
}

/* ------------------------------------- open write holder ---------------------------------------- */

const HOLDER = `import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [path, stmtsFile, holdMs] = process.argv.slice(2);
const stmts = JSON.parse(readFileSync(stmtsFile, 'utf8'));
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('BEGIN IMMEDIATE');
for (const [sql, params] of stmts) {
  db.prepare(sql).run(...params.map((p) => (p && typeof p === 'object' && 'hex' in p ? Buffer.from(p.hex, 'hex') : p)));
}
console.log('ready');
setTimeout(() => { db.exec('COMMIT'); db.close(); console.log('done'); }, Number(holdMs));
`;

type Stmt = [string, (string | number | null | { hex: string })[]];

/**
 * Another process holds an open write transaction that ran `stmts` while `act` runs, then commits: what a
 * second store process does between its own check and its commit, made exact in time.
 */
async function whileHeld<T>(
  dir: string,
  path: string,
  stmts: Stmt[],
  holdMs: number,
  act: () => Promise<T>,
): Promise<{ acted: { value?: T; error?: unknown }; ended: Ended; started: boolean }> {
  const script = join(dir, 'holder.mjs');
  writeFileSync(script, HOLDER);
  const file = join(dir, `stmts-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(stmts));
  let acting: Promise<{ value?: T; error?: unknown }> | undefined;
  const child = launch([script, path, file, String(holdMs)], dir, (line) => {
    if (line === 'ready' && acting === undefined) {
      acting = act().then(
        (value) => ({ value }),
        (error: unknown) => ({ error: error ?? new Error('falsy') }),
      );
    }
  });
  const ended = await child.ended;
  const acted = acting ? await acting : { error: new Error('the holder never became ready') };
  return { acted, ended, started: acting !== undefined };
}

/* -------------------------------------------- CLI ----------------------------------------------- */

type CliResult = { code: number | undefined; out: string; err: string; thrown?: string };

async function cli(argv: string[], cwd: string): Promise<CliResult> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const io = {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  };
  try {
    const code = await main(argv, io);
    return { code, out, err };
  } catch (error) {
    return { code: undefined, out, err, thrown: kindOf(error) };
  }
}

const cliChild = (ctx: ItemContext) => `const [argvJson, cwd] = process.argv.slice(2);
const { main } = await import(${JSON.stringify(join(ctx.root, 'packages/cli/src/main.ts'))});
const code = await main(JSON.parse(argvJson), { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t), cwd });
process.exitCode = code;
`;

/* ------------------------------------------- specs ---------------------------------------------- */

type RawSpec = Record<string, unknown> & { id: string };

/** A spec of `blocks` blocks; each block asks for a reference code the planted agents give. */
function rawSpec(id: string, blocks: number, target: TargetRef): RawSpec {
  return {
    id,
    version: '1',
    title: `Robust claim ${id}`,
    channel: 'chat',
    lang: 'EN',
    target,
    blocks: Array.from({ length: blocks }, (_, b) => ({
      user: `${id} block ${b}: please confirm.`,
      expect: { must: ['R-\\d{4}'] },
    })),
  };
}

function loaded(raw: RawSpec): LoadedSpec {
  const result = validateSpec(raw, `${raw.id}.yaml`);
  if (!result.ok) throw new Error(`the item's own spec ${raw.id} is invalid: ${show(result.errors)}`);
  return result;
}

/** Lines of an agent log as counts per `spec block`. */
function logCounts(file: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!existsSync(file)) return counts;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function countsText(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/* ------------------------------------------------------------------------------------------------ */
/* robust-concurrency                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

function concurrencyItems(): BankItem[] {
  const out: BankItem[] = [];
  const c = (spec: Spec) => out.push(item('concurrency', spec));

  c({
    slug: 'two-campaigns-at-once',
    tier: 1,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The store": two processes each writing their own campaign and its runs into one store file at once leave both campaigns with every run whole',
    cause: 'the store writes each campaign and run of two processes into one file without losing either',
    async check(ctx) {
      const dir = folderFor(ctx, 'two-campaigns');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const base = await baseRun(ctx.seed, 'two-campaigns');
      const n = 5 + (ctx.seed % 4);
      const runsOf = (tag: string) =>
        Array.from({ length: n }, (_, i) => variant(base, `${tag}-${i}`, { cost: i }));
      const lists = ['a', 'b'].map((tag) => [
        { op: 'putCampaign', campaign: campaignOf(`c-${tag}`, base) },
        ...runsOf(tag).map((run) => ({ op: 'putRun', campaignId: `c-${tag}`, run })),
      ]);
      const { results, problems } = await race(ctx, dir, path, lists);
      return withStore(path, async (store) => {
        const ids = (await store.listCampaigns()).map((x) => x.campaignId).sort();
        const missing: string[] = [];
        for (const tag of ['a', 'b']) {
          for (const run of runsOf(tag)) {
            const back = await store.getRun(run.runId, `c-${tag}`);
            if (!same(back, run)) missing.push(`c-${tag}/${run.runId}`);
          }
        }
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [same(ids, ['c-a', 'c-b']), `expected campaigns c-a and c-b, got ${show(ids)}`],
          [
            missing.length === 0,
            `expected every run back whole, these were missing or changed: ${missing.slice(0, 5).join(', ')}`,
          ],
        ]);
      });
    },
  });

  c({
    slug: 'two-writers-one-campaign',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The worker pool": two processes filing runs of one campaign at once lose none: every run id each wrote is stored once',
    cause: 'the store files the runs of one campaign from two processes without losing any',
    async check(ctx) {
      const dir = folderFor(ctx, 'two-writers');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'two-writers');
      await withStore(path, (store) => store.putCampaign(campaignOf('c-one', base)));
      const n = 8 + (ctx.seed % 5);
      const lists = ['a', 'b'].map((tag) =>
        Array.from({ length: n }, (_, i) => ({
          op: 'putRun',
          campaignId: 'c-one',
          run: variant(base, `${tag}-${i}`),
        })),
      );
      const { results, problems } = await race(ctx, dir, path, lists);
      const ids = await withStore(path, async (store) =>
        (await store.listRuns({ campaignId: 'c-one' })).map((r) => r.runId),
      );
      const expected = ['a', 'b'].flatMap((tag) => Array.from({ length: n }, (_, i) => `${tag}-${i}`)).sort();
      return expectAll([
        [problems.length === 0, problems.join('; ')],
        [
          failedOps(results).length === 0,
          `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
        ],
        [
          same([...ids].sort(), expected),
          `expected the ${2 * n} run ids once each, got ${ids.length}: ${show([...ids].sort())}`,
        ],
      ]);
    },
  });

  c({
    slug: 'same-run-two-writers',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "campaign resume": two processes putting the same run id again and again leave one whole run, its blocks those of the version whose summary is stored',
    cause: 'the store replaces a run and its blocks in one transaction under concurrent writers',
    async check(ctx) {
      const dir = folderFor(ctx, 'same-run');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'same-run');
      await withStore(path, (store) => store.putCampaign(campaignOf('c-same', base)));
      const reps = 10 + (ctx.seed % 6);
      const lists = [3, 1].map((blocks) =>
        Array.from({ length: reps }, () => ({
          op: 'putRun',
          campaignId: 'c-same',
          run: sized(base, 'r-same', blocks),
        })),
      );
      const { results, problems } = await race(ctx, dir, path, lists);
      return withStore(path, async (store) => {
        const runs = await store.listRuns({ campaignId: 'c-same' });
        const run = runs[0];
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [runs.length === 1, `expected one run r-same, got ${runs.length}`],
          [
            run !== undefined && run.cost === run.blocks.length,
            `expected the stored summary and blocks of one version (cost equals block count), got cost ${run?.cost} with ${run?.blocks.length} blocks`,
          ],
        ]);
      });
    },
  });

  c({
    slug: 'equal-campaign-race',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "campaign import": a campaign must be new or equal to the one held: putCampaign of a campaign another process commits with the same content meanwhile succeeds and keeps one campaign',
    cause:
      'SqliteStore.putCampaign looks for an existing campaign outside its write transaction, so a campaign another process commits in between raises a raw constraint error',
    async check(ctx) {
      const dir = folderFor(ctx, 'equal-campaign');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'equal-campaign');
      const campaign = campaignOf(`c-eq-${ctx.seed % 50}`, base);
      const store = openStore(path);
      try {
        const { acted, ended, started } = await whileHeld(
          dir,
          path,
          [
            [
              'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
              [campaign.campaignId, JSON.stringify(campaign), CLOCK],
            ],
          ],
          400,
          () => store.putCampaign(campaign),
        );
        const ids = (await store.listCampaigns()).map((x) => x.campaignId);
        return expectAll([
          [
            started && ended.code === 0,
            `expected the other writer to commit, it ended ${ended.code}: ${ended.err.slice(0, 200)}`,
          ],
          [
            acted.error === undefined,
            `expected putCampaign of equal content to succeed, got ${kindOf(acted.error)}`,
          ],
          [
            same(ids, [campaign.campaignId]),
            `expected one campaign ${campaign.campaignId}, got ${show(ids)}`,
          ],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'reader-during-import',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "campaign import": all or nothing: a reader polling while another process imports a bundle never sees the campaign without all its runs',
    cause: 'importCampaign commits the campaign and its runs in one transaction',
    async check(ctx) {
      const dir = folderFor(ctx, 'reader-import');
      const bundle = await exportedBundle(ctx, dir, 'reader-import', 6 + (ctx.seed % 4));
      const path = join(dir, 'target.sqlite');
      await withStore(path, async () => undefined);
      const script = join(dir, 'worker.mts');
      writeFileSync(script, workerScript(ctx));
      const ops = join(dir, 'ops.json');
      writeFileSync(ops, JSON.stringify([{ op: 'import', folder: bundle.folder }]));
      const store = openStore(path);
      const seen: string[] = [];
      const errors: string[] = [];
      let reads = 0;
      try {
        const worker = tsx(ctx, script, [path, ops, '']);
        while (worker.isRunning()) {
          try {
            const held = (await store.listCampaigns()).some((x) => x.campaignId === bundle.campaignId);
            if (held) {
              const n = (await store.listRuns({ campaignId: bundle.campaignId })).length;
              if (n !== bundle.runs) seen.push(`campaign with ${n} runs`);
            }
            reads += 1;
          } catch (error) {
            errors.push(kindOf(error));
          }
          await sleep(1);
        }
        const ended = await worker.ended;
        const final = (await store.listRuns({ campaignId: bundle.campaignId })).length;
        return expectAll([
          [
            ended.out.includes('"ok":true'),
            `expected the import to succeed, got ${ended.out.slice(-300)} ${ended.err.slice(0, 200)}`,
          ],
          [reads > 0, 'expected reads during the import'],
          [
            seen.length === 0,
            `expected the campaign visible only with its ${bundle.runs} runs, saw ${seen.slice(0, 3).join('; ')}`,
          ],
          [errors.length === 0, `expected no read error, got ${[...new Set(errors)].join('; ')}`],
          [final === bundle.runs, `expected ${bundle.runs} runs after the import, got ${final}`],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'cache-put-get-race',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The cache and replay": a cache get racing another process that replaces the entry gives a whole Observed it put, never a torn one, and the last put wins',
    cause: 'cachePut and cacheGet read and replace one cache row whole',
    async check(ctx) {
      const dir = folderFor(ctx, 'cache-race');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const n = 20 + (ctx.seed % 10);
      const texts = Array.from({ length: n }, (_, i) => `Reference R-${1000 + i} ${'x'.repeat(2000 + i)}`);
      const script = join(dir, 'worker.mts');
      writeFileSync(script, workerScript(ctx));
      const ops = join(dir, 'ops.json');
      writeFileSync(
        ops,
        JSON.stringify(
          texts.map((text) => ({ op: 'cachePut', key: 'k-race', observed: observedText(text) })),
        ),
      );
      const store = openStore(path);
      const bad: string[] = [];
      try {
        const worker = tsx(ctx, script, [path, ops, '']);
        while (worker.isRunning()) {
          try {
            const got = await store.cacheGet('k-race');
            if (got !== undefined && !texts.includes(got.text)) bad.push(`text ${got.text.slice(0, 40)}`);
          } catch (error) {
            bad.push(kindOf(error));
          }
          await sleep(1);
        }
        const ended = await worker.ended;
        const last = await store.cacheGet('k-race');
        return expectAll([
          [!ended.out.includes('"ok":false'), `expected every put to succeed, got ${ended.out.slice(-300)}`],
          [
            bad.length === 0,
            `expected every read to be a whole put Observed, got ${[...new Set(bad)].slice(0, 3).join('; ')}`,
          ],
          [last?.text === texts.at(-1), `expected the last put to win, got ${last?.text.slice(0, 30)}`],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'cache-expired-delete-race',
    tier: 4,
    component: STORE,
    source: 'adversarial',
    title:
      'packages/store/src/store.ts cachePut: an entry without a ttl stays until replaced: a get that finds an expired entry while another process puts a fresh one under the key must not delete the fresh one',
    cause:
      'SqliteStore.cacheGet deletes an expired entry by key alone, so it can delete a fresher entry another process put in between',
    async check(ctx) {
      const dir = folderFor(ctx, 'cache-expired');
      const path = join(dir, 'store.sqlite');
      const key = `k-${ctx.seed}`;
      const fresh = observedText(`Fresh reference R-${2000 + (ctx.seed % 7000)}`);
      const store = openStore(path);
      try {
        await store.cachePut(key, observedText('Old reference R-1000'), 0);
        const { acted, ended, started } = await whileHeld(
          dir,
          path,
          [
            [
              `INSERT INTO cache (key, observed_json, created_at, expires_at) VALUES (?, ?, ?, NULL)
               ON CONFLICT (key) DO UPDATE SET observed_json = excluded.observed_json, created_at = excluded.created_at, expires_at = NULL`,
              [key, JSON.stringify(fresh), CLOCK],
            ],
          ],
          400,
          () => store.cacheGet(key),
        );
        const after = await caught(async () => {
          const got = await store.cacheGet(key);
          if (got?.text !== fresh.text) throw new Error(`got ${got === undefined ? 'nothing' : got.text}`);
        });
        return expectAll([
          [
            started && ended.code === 0,
            `expected the other process to commit its put, it ended ${ended.code}: ${ended.err.slice(0, 200)}`,
          ],
          [
            acted.error === undefined,
            `expected the get of the expired entry to succeed, got ${kindOf(acted.error)}`,
          ],
          [after === undefined, `expected the fresh entry, put without a ttl, to stay; ${kindOf(after)}`],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'push-same-content-race',
    tier: 4,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "The registry": pushing content a name already holds gives back that version: a push of content another process commits meanwhile returns version 1, created false',
    cause:
      'SqliteStore.pushVersion looks for held content outside its write transaction, so the same content pushed by another process in between raises a raw constraint error',
    async check(ctx) {
      const dir = folderFor(ctx, 'push-same');
      const path = join(dir, 'store.sqlite');
      const text = `id: robust-${ctx.seed}\n# R-${1000 + (ctx.seed % 9000)}\n`;
      const bytes = new TextEncoder().encode(text);
      const entries = [{ path: 'a.yaml', sha256: sha256(bytes), size: bytes.byteLength }];
      const hash = sha256(canonicalJson(entries));
      const record = { kind: 'dataset', name: 'race-ds', version: 1, hash, files: entries, createdAt: CLOCK };
      const store = openStore(path);
      try {
        const { acted, ended, started } = await whileHeld(
          dir,
          path,
          [
            [
              'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
              [entries[0]?.sha256 ?? '', bytes.byteLength, { hex: Buffer.from(bytes).toString('hex') }],
            ],
            [
              'INSERT INTO versions (kind, name, version, hash, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              ['dataset', 'race-ds', 1, hash, JSON.stringify(record), CLOCK],
            ],
          ],
          400,
          () => store.pushVersion('dataset', 'race-ds', [{ path: 'a.yaml', bytes }]),
        );
        const value = acted.value as { version: { version: number }; created: boolean } | undefined;
        const versions = (await store.listVersions('dataset', 'race-ds')).map((v) => v.version);
        return expectAll([
          [
            started && ended.code === 0,
            `expected the other push to commit, it ended ${ended.code}: ${ended.err.slice(0, 200)}`,
          ],
          [
            acted.error === undefined,
            `expected the push of held content to give back version 1, got ${kindOf(acted.error)}`,
          ],
          [
            value?.version.version === 1 && value.created === false,
            `expected { version 1, created false }, got ${show(value && { version: value.version.version, created: value.created })}`,
          ],
          [same(versions, [1]), `expected one version, got ${show(versions)}`],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'push-two-writers',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "The registry": versions of one name count up from 1: two processes pushing different content at once get distinct numbers 1 to n with no gap',
    cause: 'pushVersion numbers versions inside its write transaction',
    async check(ctx) {
      const dir = folderFor(ctx, 'push-two');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const k = 4 + (ctx.seed % 3);
      const lists = ['a', 'b'].map((tag) =>
        Array.from({ length: k }, (_, i) => ({
          op: 'push',
          kind: 'dataset',
          name: 'two-ds',
          files: [{ path: 'a.yaml', text: `# ${tag} ${i} ${ctx.seed}\n` }],
        })),
      );
      const { results, problems } = await race(ctx, dir, path, lists);
      const numbers = results
        .flat()
        .map((r) => (r.value as { version?: number } | undefined)?.version)
        .filter((v) => v !== undefined);
      const versions = await withStore(path, async (store) =>
        (await store.listVersions('dataset', 'two-ds')).map((v) => v.version),
      );
      const expected = Array.from({ length: 2 * k }, (_, i) => i + 1);
      return expectAll([
        [problems.length === 0, problems.join('; ')],
        [
          failedOps(results).length === 0,
          `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
        ],
        [
          same(
            [...numbers].sort((a, b) => Number(a) - Number(b)),
            expected,
          ),
          `expected the pushes to get 1 to ${2 * k} once each, got ${show(numbers)}`,
        ],
        [
          same(versions, expected),
          `expected the store to list versions 1 to ${2 * k}, got ${show(versions)}`,
        ],
      ]);
    },
  });

  c({
    slug: 'units-same-key',
    tier: 1,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The store" (putUnit keeps one unit per adapter and metric): two processes measuring one adapter at once leave one unit, one of the values they wrote',
    cause: 'putUnit keeps one row per adapter and metric under concurrent writers',
    async check(ctx) {
      const dir = folderFor(ctx, 'units-same');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const n = 12 + (ctx.seed % 6);
      const values = (base: number) => Array.from({ length: n }, (_, i) => base + i / 100);
      const lists = [1, 5].map((base) =>
        values(base).map((usd) => ({
          op: 'putUnit',
          unit: { adapter: 'function', metric: 'block', usd, measuredAt: CLOCK },
        })),
      );
      const { results, problems } = await race(ctx, dir, path, lists);
      const units = await withStore(path, (store) => store.listUnits('function'));
      const allowed = [values(1).at(-1), values(5).at(-1)];
      return expectAll([
        [problems.length === 0, problems.join('; ')],
        [
          failedOps(results).length === 0,
          `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
        ],
        [units.length === 1, `expected one unit for function/block, got ${units.length}`],
        [
          allowed.includes(units[0]?.usd),
          `expected the last value one writer put (${allowed.join(' or ')}), got ${units[0]?.usd}`,
        ],
      ]);
    },
  });

  c({
    slug: 'units-many-adapters',
    tier: 1,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The store": two processes putting units of different adapters at once leave every unit',
    cause: 'putUnit keeps every adapter written by concurrent writers',
    async check(ctx) {
      const dir = folderFor(ctx, 'units-many');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const n = 8 + (ctx.seed % 5);
      const lists = ['a', 'b'].map((tag) =>
        Array.from({ length: n }, (_, i) => ({
          op: 'putUnit',
          unit: { adapter: `${tag}${i}`, metric: 'block', usd: i, measuredAt: CLOCK },
        })),
      );
      const { results, problems } = await race(ctx, dir, path, lists);
      const units = await withStore(path, (store) => store.listUnits());
      return expectAll([
        [problems.length === 0, problems.join('; ')],
        [
          failedOps(results).length === 0,
          `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
        ],
        [units.length === 2 * n, `expected ${2 * n} units, got ${units.length}`],
      ]);
    },
  });

  c({
    slug: 'status-during-replace',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "campaign status": while another process replaces a failed run with a completed one, the status reader always finds the cell once, never pending and never twice',
    cause: 'putRun replaces a run in one transaction, so readers never see the cell missing or doubled',
    async check(ctx) {
      const dir = folderFor(ctx, 'status-replace');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'status-replace');
      await withStore(path, async (store) => {
        await store.putCampaign(campaignOf('c-status', base));
        await store.putRun('c-status', variant(base, base.runId, { status: 'completed' }));
      });
      const reps = 30 + (ctx.seed % 10);
      const ops = Array.from({ length: reps }, (_, i) => ({
        op: 'putRun',
        campaignId: 'c-status',
        run: variant(
          base,
          base.runId,
          i % 2 === 0 ? { status: 'failed', error: 'planted failure' } : { status: 'completed' },
        ),
      }));
      const script = join(dir, 'worker.mts');
      writeFileSync(script, workerScript(ctx));
      const opsFile = join(dir, 'ops.json');
      writeFileSync(opsFile, JSON.stringify(ops));
      const store = openStore(path);
      const bad: string[] = [];
      let reads = 0;
      try {
        const worker = tsx(ctx, script, [path, opsFile, '']);
        while (worker.isRunning()) {
          try {
            const runs = await store.listRuns({ campaignId: 'c-status' });
            if (runs.length !== 1) bad.push(`${runs.length} runs`);
            reads += 1;
          } catch (error) {
            bad.push(kindOf(error));
          }
          await sleep(1);
        }
        const ended = await worker.ended;
        return expectAll([
          [
            !ended.out.includes('"ok":false') && ended.code === 0,
            `expected every put to succeed, got ${ended.out.slice(-200)} ${ended.err.slice(0, 200)}`,
          ],
          [reads > 0, 'expected reads during the replacements'],
          [
            bad.length === 0,
            `expected the cell found exactly once on every read, got ${[...new Set(bad)].slice(0, 3).join('; ')}`,
          ],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'two-imports-same-bundle',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "campaign import": two processes importing the same bundle into one store at once both succeed, and the store holds the campaign, its runs and its version once',
    cause: 'importCampaign of the same bundle by two processes stores it once without error',
    async check(ctx) {
      const dir = folderFor(ctx, 'two-imports');
      const bundle = await exportedBundle(ctx, dir, 'two-imports', 4);
      const path = join(dir, 'target.sqlite');
      await withStore(path, async () => undefined);
      const lists = [0, 1].map(() => [{ op: 'import', folder: bundle.folder }]);
      const { results, problems } = await race(ctx, dir, path, lists);
      return withStore(path, async (store) => {
        const ids = (await store.listCampaigns()).map((x) => x.campaignId);
        const runs = (await store.listRuns({ campaignId: bundle.campaignId })).length;
        const versions = (await store.listVersions('dataset', bundle.dataset)).map((v) => v.version);
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected both imports to succeed, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [same(ids, [bundle.campaignId]), `expected the campaign once, got ${show(ids)}`],
          [runs === bundle.runs, `expected ${bundle.runs} runs, got ${runs}`],
          [same(versions, [1]), `expected the dataset version once, got ${show(versions)}`],
        ]);
      });
    },
  });

  c({
    slug: 'import-vs-conflicting-writer',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "campaign import": all or nothing: an import that meets a campaign another process stored meanwhile under the same id with other content fails with CAMPAIGN_CONFLICT and leaves none of its runs, specs or versions',
    cause:
      'importCampaign checks the campaign inside its transaction and rolls back every part on a conflict',
    async check(ctx) {
      const dir = folderFor(ctx, 'import-conflict');
      const bundle = await exportedBundle(ctx, dir, 'import-conflict', 3);
      const path = join(dir, 'target.sqlite');
      const other = { ...bundle.campaign, createdAt: '2026-10-12T00:00:00.000Z' };
      const store = openStore(path);
      try {
        const { acted, ended, started } = await whileHeld(
          dir,
          path,
          [
            [
              'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
              [other.campaignId, JSON.stringify(other), CLOCK],
            ],
          ],
          400,
          () => store.importCampaign(bundle.folder),
        );
        const runs = (await store.listRuns({ campaignId: bundle.campaignId })).length;
        const versions = (await store.listVersions('dataset', bundle.dataset)).length;
        const spec = await store.getSpec(bundle.specId, bundle.specHash);
        return expectAll([
          [
            started && ended.code === 0,
            `expected the other writer to commit, it ended ${ended.code}: ${ended.err.slice(0, 200)}`,
          ],
          [
            kindOf(acted.error) === 'StoreError CAMPAIGN_CONFLICT',
            `expected StoreError CAMPAIGN_CONFLICT, got ${kindOf(acted.error)}`,
          ],
          [runs === 0, `expected none of the bundle's runs, got ${runs}`],
          [versions === 0, `expected none of the bundle's versions, got ${versions}`],
          [spec === undefined, "expected none of the bundle's specs, the spec is there"],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'fresh-file-two-openers',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The store" (--store opens or creates the file): two processes creating the same new store file at once both open it and both writes land',
    cause: 'openStore sets up a new file safely when two processes create it at once',
    async check(ctx) {
      const dir = folderFor(ctx, 'fresh-open');
      const path = join(dir, 'nested', 'store.sqlite');
      const base = await baseRun(ctx.seed, 'fresh-open');
      const lists = ['a', 'b'].map((tag) => [
        { op: 'putCampaign', campaign: campaignOf(`c-${tag}`, base) },
        { op: 'putRun', campaignId: `c-${tag}`, run: variant(base, `r-${tag}`) },
      ]);
      const { results, problems } = await race(ctx, dir, path, lists);
      return withStore(path, async (store) => {
        const ids = (await store.listCampaigns()).map((x) => x.campaignId).sort();
        const runs = (await store.listRuns()).length;
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [same(ids, ['c-a', 'c-b']), `expected both campaigns, got ${show(ids)}`],
          [runs === 2, `expected both runs, got ${runs}`],
        ]);
      });
    },
  });

  c({
    slug: 'old-store-two-upgraders',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'packages/store/src/schema.ts (an older database is upgraded on open): two processes opening a schema 1 store at once both upgrade it and both write to the registry tables schema 2 adds',
    cause: 'openStore upgrades an older store safely when two processes open it at once',
    async check(ctx) {
      const dir = folderFor(ctx, 'two-upgraders');
      const path = join(dir, 'old.sqlite');
      const old = await schemaOneStore(ctx, path);
      const lists = ['a', 'b'].map((tag) => [
        { op: 'putRun', campaignId: old.campaign.campaignId, run: variant(old.run, `r-${tag}`) },
        { op: 'push', kind: 'dataset', name: `ds-${tag}`, files: [{ path: 'a.yaml', text: `# ${tag}\n` }] },
      ]);
      const { results, problems } = await race(ctx, dir, path, lists);
      const version = readUserVersion(path);
      return withStore(path, async (store) => {
        const runs = (await store.listRuns({ campaignId: old.campaign.campaignId })).length;
        const versions = (await store.listVersions('dataset')).length;
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [
            version === SCHEMA_VERSION,
            `expected user_version ${SCHEMA_VERSION} (the current schema) after the upgrade, got ${version}`,
          ],
          [runs === 3, `expected the old run and the two new ones, got ${runs}`],
          [versions === 2, `expected two dataset versions, got ${versions}`],
        ]);
      });
    },
  });

  c({
    slug: 'put-spec-two-writers',
    tier: 1,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The store": two processes storing specs at once, one spec in common, leave every spec readable at its hash',
    cause: 'putSpec stores specs from concurrent writers without losing any',
    async check(ctx) {
      const dir = folderFor(ctx, 'put-spec');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const common = loaded(rawSpec(`rs-common-${ctx.seed % 100}`, 2, TARGET));
      const own = ['a', 'b'].map((tag) => loaded(rawSpec(`rs-${tag}-${ctx.seed % 100}`, 2, TARGET)));
      const lists = own.map((spec) => [
        { op: 'putSpec', spec: common },
        { op: 'putSpec', spec },
        { op: 'putSpec', spec: common },
      ]);
      const { results, problems } = await race(ctx, dir, path, lists);
      return withStore(path, async (store) => {
        const missing: string[] = [];
        for (const spec of [common, ...own]) {
          const back = await store.getSpec(spec.spec.id, spec.hash);
          if (back?.hash !== spec.hash) missing.push(spec.spec.id);
        }
        return expectAll([
          [problems.length === 0, problems.join('; ')],
          [
            failedOps(results).length === 0,
            `expected no error, got ${failedOps(results).slice(0, 3).join('; ')}`,
          ],
          [missing.length === 0, `expected every spec readable, missing ${missing.join(', ')}`],
        ]);
      });
    },
  });

  c({
    slug: 'reader-during-first-write',
    tier: 2,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/running.md "The worker pool" (each run is filed as it finishes): a reader polling while another process files a large run sees no run or the whole run, never part of its blocks',
    cause: 'putRun files a run and all its blocks in one transaction',
    async check(ctx) {
      const dir = folderFor(ctx, 'first-write');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'first-write');
      await withStore(path, (store) => store.putCampaign(campaignOf('c-big', base)));
      const blocks = 300 + (ctx.seed % 50);
      const ops = Array.from({ length: 4 }, (_, i) => ({
        op: 'putRun',
        campaignId: 'c-big',
        run: sized(base, `r-big-${i}`, blocks),
      }));
      const script = join(dir, 'worker.mts');
      writeFileSync(script, workerScript(ctx));
      const opsFile = join(dir, 'ops.json');
      writeFileSync(opsFile, JSON.stringify(ops));
      const store = openStore(path);
      const bad: string[] = [];
      let reads = 0;
      try {
        const worker = tsx(ctx, script, [path, opsFile, '']);
        while (worker.isRunning()) {
          try {
            for (const run of await store.listRuns({ campaignId: 'c-big' })) {
              if (run.blocks.length !== blocks) bad.push(`${run.runId} with ${run.blocks.length} blocks`);
            }
            reads += 1;
          } catch (error) {
            bad.push(kindOf(error));
          }
          await sleep(1);
        }
        const ended = await worker.ended;
        const final = (await store.listRuns({ campaignId: 'c-big' })).length;
        return expectAll([
          [
            !ended.out.includes('"ok":false') && ended.code === 0,
            `expected every put to succeed, got ${ended.out.slice(-200)} ${ended.err.slice(0, 200)}`,
          ],
          [reads > 0, 'expected reads during the writes'],
          [
            bad.length === 0,
            `expected only whole runs of ${blocks} blocks, saw ${[...new Set(bad)].slice(0, 3).join('; ')}`,
          ],
          [final === 4, `expected 4 runs at the end, got ${final}`],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'export-during-writes',
    tier: 3,
    component: BUNDLE,
    source: 'adversarial',
    title:
      'docs/running.md "The store" (exportCampaign writes a versioned bundle): an export taken while another process files runs reads back, its manifest counting exactly the runs it holds',
    cause: 'exportCampaign writes a bundle consistent with one read of the campaign while runs are filed',
    async check(ctx) {
      const dir = folderFor(ctx, 'export-writes');
      const path = join(dir, 'store.sqlite');
      const base = await baseRun(ctx.seed, 'export-writes');
      await withStore(path, async (store) => {
        await store.putCampaign(campaignOf('c-exp', base));
        await store.putRun('c-exp', variant(base, 'r-000'));
      });
      const n = 15 + (ctx.seed % 5);
      const ops = Array.from({ length: n }, (_, i) => ({
        op: 'putRun',
        campaignId: 'c-exp',
        run: variant(base, `r-${String(i + 1).padStart(3, '0')}`),
      }));
      const script = join(dir, 'worker.mts');
      writeFileSync(script, workerScript(ctx));
      const opsFile = join(dir, 'ops.json');
      writeFileSync(opsFile, JSON.stringify(ops));
      const store = openStore(path);
      const bad: string[] = [];
      let exports = 0;
      try {
        const worker = tsx(ctx, script, [path, opsFile, '']);
        while (worker.isRunning() || exports === 0) {
          const out = join(dir, `out-${exports}`);
          try {
            const folder = await store.exportCampaign('c-exp', out);
            const bundle = await readCampaignBundle(folder);
            if (bundle.runs.length < 1 || bundle.runs.length > n + 1) bad.push(`${bundle.runs.length} runs`);
          } catch (error) {
            bad.push(kindOf(error));
          }
          exports += 1;
          await sleep(1);
        }
        const ended = await worker.ended;
        return expectAll([
          [
            !ended.out.includes('"ok":false') && ended.code === 0,
            `expected every put to succeed, got ${ended.out.slice(-200)} ${ended.err.slice(0, 200)}`,
          ],
          [
            bad.length === 0,
            `expected every export to read back, got ${[...new Set(bad)].slice(0, 3).join('; ')}`,
          ],
        ]);
      } finally {
        await store.close();
      }
    },
  });

  c({
    slug: 'push-vs-import',
    tier: 3,
    component: STORE,
    source: 'adversarial',
    title:
      'docs/datasets.md "Run a campaign again elsewhere": a push and an import of the same dataset name racing end with whole numbered versions, any refusal being the documented VERSION_CONFLICT',
    cause: 'pushVersion and importCampaign number and check dataset versions inside their transactions',
    async check(ctx) {
      const dir = folderFor(ctx, 'push-import');
      const bundle = await exportedBundle(ctx, dir, 'push-import', 2);
      const path = join(dir, 'target.sqlite');
      await withStore(path, async () => undefined);
      const lists = [
        [
          {
            op: 'push',
            kind: 'dataset',
            name: bundle.dataset,
            files: [{ path: 'other.yaml', text: `# other ${ctx.seed}\n` }],
          },
        ],
        [{ op: 'import', folder: bundle.folder }],
      ];
      const { results, problems } = await race(ctx, dir, path, lists);
      const versions = await withStore(path, (store) => store.listVersions('dataset', bundle.dataset));
      const numbers = versions.map((v) => v.version);
      return expectAll([
        [problems.length === 0, problems.join('; ')],
        [
          failedOps(results, ['VERSION_CONFLICT']).length === 0,
          `expected success or VERSION_CONFLICT, got ${failedOps(results, ['VERSION_CONFLICT']).join('; ')}`,
        ],
        [
          same(
            numbers,
            Array.from({ length: numbers.length }, (_, i) => i + 1),
          ),
          `expected versions numbered from 1 with no gap, got ${show(numbers)}`,
        ],
        [
          new Set(versions.map((v) => v.hash)).size === versions.length,
          'expected each version to hold its own content',
        ],
      ]);
    },
  });

  c({
    slug: 'cli-same-campaign-id',
    tier: 5,
    component: CLI_CAMPAIGN,
    source: 'adversarial',
    title:
      'docs/running.md "Exit codes": campaign run with an existing campaign id is bad input, exit 2: also when another process stores that campaign between the command\'s check and its write',
    cause:
      'packages/cli/src/main.ts: main rethrows every error that is not a CommanderError, so a file-system or parse error inside a command escapes as an uncaught throw; main must print the message on stderr and exit 2',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-same-id');
      const path = join(dir, 'store.sqlite');
      const specFile = join(dir, 'spec.yaml');
      writeFileSync(
        specFile,
        JSON.stringify(
          rawSpec(`cli-same-${ctx.seed % 100}`, 2, { adapter: 'function', agent: 'acme-sales' }),
        ),
      );
      const base = await baseRun(ctx.seed, 'cli-same-id');
      const id = `c-same-${ctx.seed % 100}`;
      // Warm the command line (its modules and the Acme agent) on another store, so the race below times
      // the store calls, not the first import.
      await cli(
        ['campaign', 'run', specFile, '--target', 'function:acme', '--store', join(dir, 'warm.sqlite')],
        dir,
      );
      await withStore(path, async () => undefined);
      const other = campaignOf(id, base);
      const { acted, ended, started } = await whileHeld(
        dir,
        path,
        [
          [
            'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
            [id, JSON.stringify(other), CLOCK],
          ],
        ],
        1500,
        () =>
          cli(
            ['campaign', 'run', specFile, '--target', 'function:acme', '--campaign', id, '--store', path],
            dir,
          ),
      );
      const result = acted.value;
      const runs = await withStore(path, async (store) => (await store.listRuns({ campaignId: id })).length);
      return expectAll([
        [
          started && ended.code === 0,
          `expected the other process to commit its campaign, it ended ${ended.code}: ${ended.err.slice(0, 200)}`,
        ],
        [
          result !== undefined && result.thrown === undefined,
          `expected an exit code, the command threw ${result?.thrown ?? kindOf(acted.error)}`,
        ],
        [
          result?.code === 2,
          `expected exit 2 for an id the store holds, got ${result?.code}; stderr ${result?.err.slice(0, 200)}`,
        ],
        [runs === 0, `expected no run filed under the other campaign, got ${runs}`],
      ]);
    },
  });

  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Bundles and schema 1 stores                                                                        */
/* ------------------------------------------------------------------------------------------------ */

type Exported = {
  folder: string;
  sourcePath: string;
  campaignId: string;
  campaign: Campaign;
  runs: number;
  dataset: string;
  specId: string;
  specHash: string;
  files: { path: string; text: string }[];
};

/**
 * A store holding one campaign with `runs` runs, its spec, and the dataset version of three files it ran
 * from, exported to `<dir>/bundles/<campaignId>`.
 */
async function exportedBundle(ctx: ItemContext, dir: string, tag: string, runs: number): Promise<Exported> {
  const sourcePath = join(dir, 'source.sqlite');
  const base = await baseRun(ctx.seed, tag);
  const spec = loaded(rawSpec(`tb-${tag}-${ctx.seed % 100}`, 2, TARGET));
  const dataset = `ds-${tag}`;
  const files = [
    { path: 'a.yaml', text: `${JSON.stringify(spec.spec)}\n` },
    { path: 'notes/b.txt', text: `R-${1000 + (ctx.seed % 9000)} ${'n'.repeat(300)}\n` },
    { path: 'notes/c.txt', text: `third file ${ctx.seed}\n` },
  ];
  const campaignId = `c-${tag}-${ctx.seed % 100}`;
  let campaign: Campaign | undefined;
  await withStore(sourcePath, async (store) => {
    await store.putSpec(spec);
    const pushed = await store.pushVersion(
      'dataset',
      dataset,
      files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.text) })),
    );
    campaign = campaignOf(campaignId, base, {
      specs: [{ id: spec.spec.id, hash: spec.hash }],
      sources: [{ kind: 'dataset', name: dataset, version: 1, hash: pushed.version.hash }],
    });
    await store.putCampaign(campaign);
    for (let i = 0; i < runs; i++) await store.putRun(campaignId, variant(base, `r-${i}`, { cost: i }));
  });
  const folder = await withStore(sourcePath, (store) =>
    store.exportCampaign(campaignId, join(dir, 'bundles')),
  );
  return {
    folder,
    sourcePath,
    campaignId,
    campaign: campaign as Campaign,
    runs,
    dataset,
    specId: spec.spec.id,
    specHash: spec.hash,
    files,
  };
}

/**
 * The store tables of schema 1, copied as text from packages/store/src/schema.ts at commit 1b0d48bf
 * ("Store: SQLite store with cache, resume, JSON export and cost units"). Schema 2 (commit bde59fc6) adds
 * `blobs` and `versions`.
 */
const SCHEMA_1_SQL = `
CREATE TABLE IF NOT EXISTS specs (
  id TEXT NOT NULL,
  hash TEXT NOT NULL,
  path TEXT NOT NULL,
  yaml TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, hash)
) STRICT;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS runs (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id),
  run_id TEXT NOT NULL,
  spec_id TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  target_json TEXT NOT NULL,
  mode TEXT NOT NULL,
  repeat INTEGER NOT NULL,
  perturbation_id TEXT,
  status TEXT NOT NULL,
  cost REAL NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (campaign_id, run_id)
) STRICT;

CREATE INDEX IF NOT EXISTS runs_by_run_id ON runs (run_id);

CREATE TABLE IF NOT EXISTS blocks (
  campaign_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  given_hash TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  verdicts_json TEXT NOT NULL,
  drift_json TEXT NOT NULL,
  pass INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (campaign_id, run_id, "index"),
  FOREIGN KEY (campaign_id, run_id) REFERENCES runs (campaign_id, run_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  observed_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS units (
  adapter TEXT NOT NULL,
  metric TEXT NOT NULL,
  usd REAL NOT NULL,
  samples INTEGER,
  measured_at TEXT NOT NULL,
  PRIMARY KEY (adapter, metric)
) STRICT;
`;

/**
 * The run id the schema 1 store gave a cell, copied from packages/store/src/cell.ts at commit 1b0d48bf: the
 * cell fields parsed by the RunResult schema, then the first 16 hex characters of the SHA-256 of their
 * canonical JSON. The core's cellId replaced it at commit 61616f41.
 */
function schemaOneCellId(run: RunResult): string {
  const CellFields = RunResult.pick({
    specHash: true,
    target: true,
    mode: true,
    repeat: true,
    perturbationId: true,
  });
  const { specHash, target, mode, repeat, perturbationId } = run;
  const parsed = CellFields.safeParse({ specHash, target, mode, repeat, perturbationId });
  if (!parsed.success) throw new Error('the cell fields of the old run do not parse');
  return sha256(canonicalJson(parsed.data)).slice(0, 16);
}

type SchemaOne = {
  campaign: Campaign;
  older: Campaign;
  spec: LoadedSpec;
  run: RunResult;
  observed: Observed;
  cacheKey: string;
  unit: { adapter: string; metric: string; usd: number; samples: number; measuredAt: string };
};

/** Writes a run as the schema 1 store split it: the summary in `runs`, each block in `blocks`. */
function insertRunByHand(db: Sqlite.DatabaseSync, campaignId: string, run: RunResult): void {
  const { blocks, ...summary } = run;
  db.prepare(
    `INSERT INTO runs (campaign_id, run_id, spec_id, spec_hash, target_json, mode, repeat, perturbation_id,
       status, cost, started_at, finished_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    campaignId,
    summary.runId,
    summary.specId,
    summary.specHash,
    canonicalJson(summary.target),
    summary.mode,
    summary.repeat,
    summary.perturbationId ?? null,
    summary.status,
    summary.cost,
    summary.startedAt,
    summary.finishedAt,
    JSON.stringify(summary),
  );
  for (const block of blocks) {
    const { observed, verdicts, drift, ...rest } = block;
    db.prepare(
      `INSERT INTO blocks (campaign_id, run_id, "index", given_hash, observed_json, verdicts_json, drift_json, pass, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      campaignId,
      summary.runId,
      block.index,
      block.givenHash,
      JSON.stringify(observed),
      JSON.stringify(verdicts),
      JSON.stringify(drift),
      block.pass ? 1 : 0,
      JSON.stringify(rest),
    );
  }
}

/**
 * A store file as schema 1 wrote it: the schema 1 SQL, user_version 1, and one row of every record kind
 * (spec, two campaigns of the schema 1 Campaign shape, a run with its blocks, a cache entry, a unit). The run
 * is a real run of the spec on a function agent, under the run id the schema 1 store gave its cell.
 */
async function schemaOneStore(ctx: ItemContext, path: string): Promise<SchemaOne> {
  const spec = loaded(rawSpec(`old-${ctx.seed % 100}`, 3, TARGET));
  const adapter = functionAdapter({
    respond: (messages) => {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const block = Number(/block (\d+)/.exec(String(last?.content ?? ''))?.[1] ?? 0);
      return observedText(`Recorded under R-${1000 + block}.`, 0);
    },
  });
  const live = await runSpec(spec.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    target: TARGET,
    now: () => new Date(CLOCK),
  });
  const run = variant(live, schemaOneCellId(live));
  // The schema 1 Campaign: specs without a pinned target, no sources (both came later).
  const campaign: Campaign = {
    campaignId: `c-old-${ctx.seed % 100}`,
    specs: [{ id: spec.spec.id, hash: spec.hash }],
    targets: [TARGET],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: '2026-10-11T12:00:00.000Z',
  };
  const older: Campaign = {
    ...campaign,
    campaignId: `c-older-${ctx.seed % 100}`,
    createdAt: '2026-10-11T09:00:00.000Z',
  };
  const observed = observedText(`Cached reference R-${1000 + (ctx.seed % 9000)}`, 0.5);
  const cacheKey = sha256(`old-cache-${ctx.seed}`);
  const unit = { adapter: 'function', metric: 'block', usd: 0.0125, samples: 8, measuredAt: CLOCK };
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA_1_SQL);
    db.exec('PRAGMA user_version = 1');
    db.prepare('INSERT INTO specs (id, hash, path, yaml, created_at) VALUES (?, ?, ?, ?, ?)').run(
      spec.spec.id,
      spec.hash,
      spec.path,
      canonicalJson(spec.spec),
      CLOCK,
    );
    for (const each of [older, campaign]) {
      db.prepare('INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)').run(
        each.campaignId,
        JSON.stringify(each),
        CLOCK,
      );
    }
    insertRunByHand(db, campaign.campaignId, run);
    db.prepare('INSERT INTO cache (key, observed_json, created_at, expires_at) VALUES (?, ?, ?, NULL)').run(
      cacheKey,
      JSON.stringify(observed),
      CLOCK,
    );
    db.prepare('INSERT INTO units (adapter, metric, usd, samples, measured_at) VALUES (?, ?, ?, ?, ?)').run(
      unit.adapter,
      unit.metric,
      unit.usd,
      unit.samples,
      unit.measuredAt,
    );
  } finally {
    db.close();
  }
  return { campaign, older, spec, run, observed, cacheKey, unit };
}

function readUserVersion(path: string): number {
  const db = new DatabaseSync(path);
  try {
    return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? -1);
  } finally {
    db.close();
  }
}

function tablesOf(path: string): string[] {
  const db = new DatabaseSync(path);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* robust-resume                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

type Pause =
  | { kind: 'specs' }
  | { kind: 'campaign' }
  | { kind: 'block'; spec: string; block: number; occurrence?: number }
  | { kind: 'cell'; after: number }
  /** The nth COMMIT of the store: the first sets up the new file, each later one files a run. */
  /** Killed at the COMMIT of the nth run record. */
  | { kind: 'commit'; n: number }
  | { kind: 'report' };

type RunnerConfig = {
  path: string;
  campaignId: string;
  createdAt: string;
  specs: RawSpec[];
  repeats: number;
  concurrency: number;
  budgetUsd?: number;
  costPerBlock: number;
  log: string;
  marker: string;
  cache: boolean;
  pause?: Pause;
  failAt?: { spec: string; block: number };
};

const RUNNER_TARGET: TargetRef = { adapter: 'function', agent: 'robust' };

/**
 * The campaign runner child: stores the specs and the campaign, then runs every cell through runCampaign
 * (the code `campaign run` and `campaign resume` call) on a function agent that logs each block it answers.
 * It stops at the planted point: it writes the marker file and blocks for the parent's SIGKILL, or, at the
 * nth COMMIT of the store, writes the marker and kills itself in the middle of the write of a run record.
 */
const runnerScript = (
  ctx: ItemContext,
) => `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { planCampaign, runCampaign, validateSpec } from ${JSON.stringify(src(ctx, 'core'))};
import { openMemoryStore, openStore } from ${JSON.stringify(src(ctx, 'store'))};
import { functionAdapter } from ${JSON.stringify(src(ctx, 'adapters'))};
import { createScriptedDriver } from ${JSON.stringify(src(ctx, 'users'))};
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pause = cfg.pause ?? {};
const hang = () => { writeFileSync(cfg.marker, String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
if (pause.kind === 'commit') {
  // Killed at the COMMIT of the nth run record, whatever else the store commits before it (specs, campaign,
  // cache): the record is written inside putRun's one transaction.
  let records = 0;
  let inRecord = false;
  const probe = openMemoryStore();
  const proto = Object.getPrototypeOf(probe);
  await probe.close();
  const putRun = proto.putRun;
  proto.putRun = async function (...args) {
    records += 1;
    inRecord = records === pause.n;
    try { return await putRun.apply(this, args); } finally { inRecord = false; }
  };
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'COMMIT' && inRecord) { writeFileSync(cfg.marker, 'commit'); process.kill(process.pid, 'SIGKILL'); }
    return exec.call(this, sql);
  };
}
const seen = new Map();
const respond = (messages) => {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const m = /^(\\S+) block (\\d+)/.exec(String(last?.content ?? ''));
  const spec = m ? m[1] : '?';
  const block = m ? Number(m[2]) : -1;
  appendFileSync(cfg.log, spec + ' ' + block + '\\n');
  const key = spec + ' ' + block;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if (pause.kind === 'block' && pause.spec === spec && pause.block === block && seen.get(key) === (pause.occurrence ?? 1)) hang();
  if (cfg.failAt && cfg.failAt.spec === spec && cfg.failAt.block === block) throw new Error('planted agent failure');
  const text = 'Recorded under R-' + (1000 + block) + '.';
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: { usd: cfg.costPerBlock }, latencyMs: 1 };
};
const loaded = cfg.specs.map((raw) => validateSpec(raw, raw.id + '.yaml'));
const store = openStore(cfg.path);
for (const spec of loaded) await store.putSpec(spec);
if (pause.kind === 'specs') hang();
const target = ${JSON.stringify(RUNNER_TARGET)};
await store.putCampaign({
  campaignId: cfg.campaignId,
  specs: loaded.map((l) => ({ id: l.spec.id, hash: l.hash })),
  targets: [target],
  modes: ['F'],
  repeats: { T: 0, F: cfg.repeats, P: 0 },
  budgetUsd: cfg.budgetUsd ?? 0,
  judge: { mode: 'system1', judges: [] },
  createdAt: cfg.createdAt,
});
if (pause.kind === 'campaign') hang();
const plan = planCampaign(loaded.map((l) => ({ spec: l.spec, hash: l.hash })), [target], ['F'], cfg.repeats);
const adapter = functionAdapter({ respond });
let heard = 0;
await runCampaign({
  campaignId: cfg.campaignId,
  cells: plan.cells,
  specFor: (cell) => loaded.find((l) => l.hash === cell.specHash).spec,
  adapterFor: () => adapter,
  driver: () => createScriptedDriver(),
  checks: [],
  store,
  ...(cfg.cache ? { cache: store } : {}),
  concurrency: cfg.concurrency,
  ...(cfg.budgetUsd === undefined ? {} : { budgetUsd: cfg.budgetUsd }),
  onCell: () => { heard += 1; if (pause.kind === 'cell' && pause.after === heard) hang(); },
});
if (pause.kind === 'report') hang();
await store.close();
console.log('END');
`;

type Killed = { ended: Ended; marked: boolean; killed: boolean };

/** Runs the runner child until its planted point and kills it there (or lets it kill itself). */
async function killedCampaign(ctx: ItemContext, dir: string, cfg: RunnerConfig): Promise<Killed> {
  const script = join(dir, 'runner.mts');
  writeFileSync(script, runnerScript(ctx));
  const file = join(dir, `runner-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(cfg));
  const child = tsx(ctx, script, [file]);
  const marked = await waitFor(() => existsSync(cfg.marker) || !child.isRunning(), 90_000, 5);
  let killed = false;
  if (child.isRunning()) {
    killPid(child.pid);
    killed = true;
  }
  const ended = await child.ended;
  return { ended, marked: marked && existsSync(cfg.marker), killed };
}

function runnerConfig(
  dir: string,
  tag: string,
  ctx: ItemContext,
  extra: Partial<RunnerConfig> = {},
): RunnerConfig {
  const specs = (extra.specs ??
    [0, 1, 2].map((i) => rawSpec(`rb-${tag}-${i}`, 3, RUNNER_TARGET))) as RawSpec[];
  return {
    path: join(dir, 'store.sqlite'),
    campaignId: `c-${tag}-${ctx.seed % 100}`,
    createdAt: CLOCK,
    repeats: 1,
    concurrency: 1,
    costPerBlock: 0,
    log: join(dir, 'agent.log'),
    marker: join(dir, 'marker'),
    cache: false,
    ...extra,
    specs,
  };
}

/**
 * The documented recovery: runCampaign over the stored campaign's cells, which reuses every cell with a
 * completed run in the store and runs the others. The agent is the same function agent, logging to the
 * same file.
 */
async function resumeHere(
  cfg: RunnerConfig,
  options: { budgetUsd?: number; cache?: boolean; concurrency?: number } = {},
): Promise<{ outcomes: CellOutcome[]; cells: PlannedCell[]; error?: unknown }> {
  const specs = cfg.specs.map(loaded);
  const plan = planCampaign(
    specs.map((l) => ({ spec: l.spec, hash: l.hash })),
    [RUNNER_TARGET],
    ['F'],
    cfg.repeats,
  );
  const adapter = functionAdapter({
    respond: (messages) => {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const m = /^(\S+) block (\d+)/.exec(String(last?.content ?? ''));
      const block = m ? Number(m[2]) : -1;
      writeFileSync(cfg.log, `${m ? m[1] : '?'} ${block}\n`, { flag: 'a' });
      return observedText(`Recorded under R-${1000 + block}.`, cfg.costPerBlock);
    },
  });
  const store = openStore(cfg.path);
  try {
    const outcomes = await runCampaign({
      campaignId: cfg.campaignId,
      cells: plan.cells,
      specFor: (cell) => {
        const found = specs.find((l) => l.hash === cell.specHash);
        if (!found) throw new Error(`no spec for ${cell.cellId}`);
        return found.spec;
      },
      adapterFor: () => adapter,
      driver: () => createScriptedDriver(),
      checks: [],
      store,
      ...((options.cache ?? cfg.cache) ? { cache: store } : {}),
      concurrency: options.concurrency ?? cfg.concurrency,
      ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
    });
    return { outcomes, cells: plan.cells };
  } catch (error) {
    return { outcomes: [], cells: plan.cells, error };
  } finally {
    await store.close();
  }
}

async function storedRuns(cfg: RunnerConfig): Promise<RunResult[]> {
  return withStore(cfg.path, (store) => store.listRuns({ campaignId: cfg.campaignId }));
}

/** A count of `spec block` lines added to the log between two readings. */
function delta(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, n] of after) {
    const d = n - (before.get(key) ?? 0);
    if (d !== 0) out.set(key, d);
  }
  return out;
}

/** Every cell holds one completed run of `blocks` blocks, and no other run is stored. */
function wholeCells(
  runs: readonly RunResult[],
  cells: readonly PlannedCell[],
  blocks: number,
): string | undefined {
  const ids = cells.map((cell) => cell.cellId).sort();
  const held = runs.map((run) => run.runId).sort();
  if (!same(held, ids)) return `expected one run per cell (${ids.length}), the store holds ${show(held)}`;
  const bad = runs.filter((run) => run.status !== 'completed' || run.blocks.length !== blocks);
  if (bad.length > 0)
    return `expected every run completed with ${blocks} blocks, got ${bad.map((r) => `${r.runId} ${r.status} ${r.blocks.length}`).join(', ')}`;
  return undefined;
}

/** The pause block of an item: 1 or 2 of a three-block spec, from the seed. */
const pauseBlock = (seed: number) => 1 + (seed % 2);

function resumeItems(): BankItem[] {
  const out: BankItem[] = [];
  const r = (spec: Spec) => out.push(item('resume', spec));

  r({
    slug: 'kill-before-first-run',
    tier: 1,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "campaign resume": a campaign killed after it was stored and before its first run is completed by the recovery, every cell run once',
    cause: 'runCampaign runs every cell of a stored campaign that has no run',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-before');
      const cfg = runnerConfig(dir, 'before', ctx, { pause: { kind: 'campaign' } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = await storedRuns(cfg);
      const resumed = await resumeHere(cfg);
      const counts = logCounts(cfg.log);
      const runs = await storedRuns(cfg);
      const twice = [...counts.entries()].filter(([, n]) => n !== 1).map(([k]) => k);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed at the planted point, it ended ${killed.ended.code} ${killed.ended.signal}: ${killed.ended.err.slice(0, 200)}`,
        ],
        [before.length === 0, `expected no run before the recovery, got ${before.length}`],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
        [
          counts.size === 9 && twice.length === 0,
          `expected each of the 9 blocks answered once, got ${countsText(counts)}`,
        ],
      ]);
    },
  });

  r({
    slug: 'kill-mid-run',
    tier: 2,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "The worker pool": after a kill in the middle of a cell, the recovery reuses the finished cell, runs the killed and the unstarted cells, and every cell ends with one completed run',
    cause: 'runCampaign reuses finished cells and reruns a cell killed mid run',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-mid');
      const pb = pauseBlock(ctx.seed);
      const cfg = runnerConfig(dir, 'mid', ctx, { pause: { kind: 'block', spec: `rb-mid-1`, block: pb } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      const runs = await storedRuns(cfg);
      const reused = resumed.outcomes.map((o) => o.reused);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed at block ${pb} of rb-mid-1, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          same(reused, [true, false, false]),
          `expected cell 0 reused and cells 1 and 2 run, got reused ${show(reused)}`,
        ],
        [
          ![...added.keys()].some((k) => k.startsWith('rb-mid-0 ')),
          `expected the finished cell never run again, the recovery answered ${countsText(added)}`,
        ],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'no-finished-run-lost',
    tier: 1,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "The worker pool": each run is filed as it finishes, so a crash loses no finished run: after a kill mid cell the finished run is stored whole and nothing of the killed cell is',
    cause: 'runCampaign files each run as it finishes and nothing before',
    async check(ctx) {
      const dir = folderFor(ctx, 'no-lost');
      const cfg = runnerConfig(dir, 'lost', ctx, {
        pause: { kind: 'block', spec: 'rb-lost-1', block: pauseBlock(ctx.seed) },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const runs = await storedRuns(cfg);
      const first = runs[0];
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [
          runs.length === 1,
          `expected exactly the finished run stored, got ${runs.length}: ${show(runs.map((x) => x.specId))}`,
        ],
        [
          first?.specId === 'rb-lost-0' && first.status === 'completed' && first.blocks.length === 3,
          `expected rb-lost-0 completed with 3 blocks, got ${first?.specId} ${first?.status} ${first?.blocks.length}`,
        ],
      ]);
    },
  });

  r({
    slug: 'kill-between-runs',
    tier: 2,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "campaign resume": a campaign killed between two cells is completed by the recovery, which runs only the cells with no run',
    cause: 'runCampaign reuses the cells filed before a kill between cells',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-between');
      const cfg = runnerConfig(dir, 'between', ctx, { pause: { kind: 'cell', after: 1 } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      const runs = await storedRuns(cfg);
      const expected = [
        'rb-between-1 0',
        'rb-between-1 1',
        'rb-between-1 2',
        'rb-between-2 0',
        'rb-between-2 1',
        'rb-between-2 2',
      ];
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed after the first cell, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          same([...added.keys()].sort(), expected) && [...added.values()].every((n) => n === 1),
          `expected the recovery to answer the blocks of cells 1 and 2 once, got ${countsText(added)}`,
        ],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'kill-during-record-write',
    tier: 3,
    component: STORE,
    source: 'hostile',
    title:
      'docs/running.md "The worker pool": a process killed while it writes the record of the second run leaves the first run whole and no part of the second; the recovery files the second once',
    cause: 'putRun writes a run record in one transaction that a kill rolls back whole',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-write');
      const cfg = runnerConfig(dir, 'write', ctx, { pause: { kind: 'commit', n: 2 } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const between = await storedRuns(cfg);
      const resumed = await resumeHere(cfg);
      const runs = await storedRuns(cfg);
      const blocksBetween = between.map((x) => `${x.specId}:${x.blocks.length}`);
      return expectAll([
        [
          killed.marked && killed.ended.signal === 'SIGKILL',
          `expected the writer killed at the commit of its second run record, it ended ${killed.ended.code} ${killed.ended.signal}: ${killed.ended.err.slice(0, 200)}`,
        ],
        [
          same(blocksBetween, ['rb-write-0:3']),
          `expected only rb-write-0 with 3 blocks after the kill, got ${show(blocksBetween)}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'kill-during-final-report',
    tier: 1,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "campaign resume": a campaign killed after its last run, while reporting, is resumed with every cell reused and no block answered again',
    cause: 'runCampaign reuses every completed cell of a campaign killed after its runs',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-report');
      const cfg = runnerConfig(dir, 'report', ctx, { pause: { kind: 'report' } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed while reporting, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          resumed.outcomes.length === 3 && resumed.outcomes.every((o) => o.reused && o.state === 'pass'),
          `expected 3 cells reused and passing, got ${show(resumed.outcomes.map((o) => [o.state, o.reused]))}`,
        ],
        [added.size === 0, `expected no block answered again, got ${countsText(added)}`],
      ]);
    },
  });

  r({
    slug: 'budget-counts-stored-run-once',
    tier: 3,
    component: CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "The budget": the spend is the cost of the runs in the store plus the runs finished in this command: a stored run of $3 counts once, so with a budget of $6.50 the recovery runs both remaining cells',
    cause: 'runCampaign counts the cost of each stored run once against the budget on resume',
    async check(ctx) {
      const dir = folderFor(ctx, 'budget-once');
      const cfg = runnerConfig(dir, 'once', ctx, {
        costPerBlock: 1,
        pause: { kind: 'block', spec: 'rb-once-1', block: pauseBlock(ctx.seed) },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const resumed = await resumeHere(cfg, { budgetUsd: 6.5 });
      const states = resumed.outcomes.map((o) => (o.budgetStop ? 'budget' : o.state));
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed mid cell, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          same(states, ['pass', 'pass', 'pass']),
          `expected the spend to reach $3 then $6 and both cells to start under $6.50, got ${show(states)}`,
        ],
      ]);
    },
  });

  r({
    slug: 'budget-exact-spend',
    tier: 3,
    component: CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "The budget": after a kill mid cell, a budget of $4 lets the killed cell run ($3 stored, then $6) and stops the last cell at exactly $6 spent: the killed partial run costs nothing',
    cause: 'runCampaign computes the resumed spend from the stored runs and the runs of the command only',
    async check(ctx) {
      const dir = folderFor(ctx, 'budget-exact');
      const cfg = runnerConfig(dir, 'exact', ctx, {
        costPerBlock: 1,
        pause: { kind: 'block', spec: 'rb-exact-1', block: pauseBlock(ctx.seed) },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const resumed = await resumeHere(cfg, { budgetUsd: 4 });
      const last = resumed.outcomes[2];
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed mid cell, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          resumed.outcomes[1]?.state === 'pass',
          `expected the killed cell to run again, got ${resumed.outcomes[1]?.state}`,
        ],
        [
          last?.state === 'stopped' && last.budgetStop?.spentUsd === 6 && last.budgetStop.budgetUsd === 4,
          `expected the last cell stopped at $6 of $4, got ${show(last && { state: last.state, budgetStop: last.budgetStop })}`,
        ],
      ]);
    },
  });

  r({
    slug: 'failed-cell-replaced',
    tier: 2,
    component: CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "campaign resume": a failed cell runs again and its new run replaces the old one under the same run id: one completed run per cell after the recovery',
    cause: 'runCampaign reruns a failed cell and the store replaces its run',
    async check(ctx) {
      const dir = folderFor(ctx, 'failed-replaced');
      const cfg = runnerConfig(dir, 'failed', ctx, {
        failAt: { spec: 'rb-failed-1', block: pauseBlock(ctx.seed) },
        pause: { kind: 'block', spec: 'rb-failed-2', block: 0 },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const between = (await storedRuns(cfg)).map((x) => `${x.specId}:${x.status}`).sort();
      const resumed = await resumeHere(cfg);
      const runs = await storedRuns(cfg);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed at the third cell, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [
          same(between, ['rb-failed-0:completed', 'rb-failed-1:failed']),
          `expected a completed and a failed run before the recovery, got ${show(between)}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'cache-partial-run-resumes-at-first-miss',
    tier: 3,
    component: 'packages/core/src/runner/run.ts',
    source: 'contract',
    title:
      'docs/running.md "The cache and replay": a run resumes from its first unfinished block; the blocks the cache holds are read back, and from the first block it does not hold the adapter answers every later block live',
    cause:
      'runSpec reads back the cached blocks of a killed run and sends the run live from its first uncached block',
    async check(ctx) {
      const dir = folderFor(ctx, 'cache-partial');
      const pb = pauseBlock(ctx.seed);
      const cfg = runnerConfig(dir, 'cpart', ctx, {
        cache: true,
        pause: { kind: 'block', spec: 'rb-cpart-1', block: pb },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      const run = resumed.outcomes[1]?.run;
      const again = [...added.entries()].filter(([key]) => key.startsWith('rb-cpart-1 '));
      const early = again.filter(([key]) => Number(key.split(' ')[1]) < pb);
      const late = again.filter(([key]) => Number(key.split(' ')[1]) >= pb);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed at block ${pb}, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [run?.status === 'completed', `expected the killed cell's run completed, got ${run?.status}`],
        [
          early.length === 0,
          `expected the blocks before ${pb} read back from the cache, the adapter answered ${countsText(new Map(early))}`,
        ],
        [
          late.length > 0 &&
            late.every(([, n]) => n === 1) &&
            late.some(([key]) => key === `rb-cpart-1 ${pb}`),
          `expected every block from ${pb} on answered live once, got ${countsText(new Map(late))}`,
        ],
      ]);
    },
  });

  r({
    slug: 'cache-written-run-replays',
    tier: 4,
    component: 'packages/core/src/runner/run.ts',
    source: 'contract',
    title:
      'docs/running.md "The cache and replay": a cell whose blocks all reached the cache before the kill during its record write is replayed from the cache on resume, cacheHit true and no block answered again',
    cause: 'runSpec replays a run whose every block the cache holds',
    async check(ctx) {
      const dir = folderFor(ctx, 'cache-written');
      const cfg = runnerConfig(dir, 'cwrite', ctx, { cache: true, pause: { kind: 'commit', n: 2 } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      const run = resumed.outcomes[1]?.run;
      return expectAll([
        [
          killed.marked && killed.ended.signal === 'SIGKILL',
          `expected the writer killed at the commit of its second run record, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          run?.cacheHit === true && run.status === 'completed',
          `expected the second cell replayed from the cache, got cacheHit ${run?.cacheHit} ${run?.status}`,
        ],
        [
          ![...added.keys()].some((k) => k.startsWith('rb-cwrite-1 ')),
          `expected no block of the second cell answered again, got ${countsText(added)}`,
        ],
      ]);
    },
  });

  r({
    slug: 'status-pending-after-write-kill',
    tier: 2,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "Outcomes": after a kill during the write of a run record, campaign status --json reports that cell pending with no run id, and exits 1',
    cause: 'campaign status reads a cell whose record write was killed as pending',
    async check(ctx) {
      const dir = folderFor(ctx, 'status-write');
      const cfg = runnerConfig(dir, 'swrite', ctx, { pause: { kind: 'commit', n: 2 } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const res = await cli(['campaign', 'status', cfg.campaignId, '--store', cfg.path, '--json'], dir);
      let cells: Array<{ state?: string; runId?: string }> = [];
      try {
        cells = (JSON.parse(res.out) as { cells: typeof cells }).cells;
      } catch {
        cells = [];
      }
      return expectAll([
        [
          killed.marked && killed.ended.signal === 'SIGKILL',
          `expected the writer killed at the commit of its second run record, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [
          res.code === 1,
          `expected exit 1 with a pending cell, got ${res.code ?? res.thrown}: ${res.err.slice(0, 200)}`,
        ],
        [
          same(
            cells.map((x) => x.state),
            ['pass', 'pending', 'pending'],
          ),
          `expected states pass, pending, pending, got ${show(cells.map((x) => x.state))}`,
        ],
        [
          cells[1]?.runId === undefined,
          `expected no run id on the cell whose write was killed, got ${cells[1]?.runId}`,
        ],
      ]);
    },
  });

  r({
    slug: 'second-resume-idempotent',
    tier: 1,
    component: CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "campaign resume": resuming a campaign the recovery already completed reuses every cell and answers no block',
    cause: 'runCampaign reuses every completed cell on a second resume',
    async check(ctx) {
      const dir = folderFor(ctx, 'resume-twice');
      const cfg = runnerConfig(dir, 'twice', ctx, {
        pause: { kind: 'block', spec: 'rb-twice-0', block: pauseBlock(ctx.seed) },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const first = await resumeHere(cfg);
      const before = logCounts(cfg.log);
      const second = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [
          first.error === undefined && second.error === undefined,
          `expected both resumes to finish, got ${kindOf(first.error ?? second.error)}`,
        ],
        [
          second.outcomes.every((o) => o.reused),
          `expected every cell reused, got ${show(second.outcomes.map((o) => o.reused))}`,
        ],
        [added.size === 0, `expected no block answered, got ${countsText(added)}`],
      ]);
    },
  });

  r({
    slug: 'concurrent-cells-killed',
    tier: 3,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "The worker pool": with two cells in flight at the kill, the recovery reruns only the cells with no completed run, and every cell ends with one completed run',
    cause: 'runCampaign reuses exactly the cells filed before a kill with cells in flight',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-pool');
      const cfg = runnerConfig(dir, 'pool', ctx, {
        concurrency: 2,
        specs: [0, 1, 2, 3].map((i) => rawSpec(`rb-pool-${i}`, 3, RUNNER_TARGET)),
        pause: { kind: 'block', spec: 'rb-pool-1', block: pauseBlock(ctx.seed) },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const filed = new Set((await storedRuns(cfg)).map((x) => x.specId));
      const before = logCounts(cfg.log);
      const resumed = await resumeHere(cfg);
      const added = delta(before, logCounts(cfg.log));
      const rerunFiled = [...added.keys()].map((k) => k.split(' ')[0] as string).filter((s) => filed.has(s));
      const runs = await storedRuns(cfg);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          rerunFiled.length === 0,
          `expected no filed cell answered again, got ${[...new Set(rerunFiled)].join(', ')} (filed: ${[...filed].join(', ')})`,
        ],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'repeat-killed',
    tier: 2,
    component: CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "Cells": with two repeats of one spec, a kill in repeat 1 leaves repeat 0 reused and repeat 1 run again under its own cell id',
    cause: 'runCampaign tells repeats apart by cell id on resume',
    async check(ctx) {
      const dir = folderFor(ctx, 'kill-repeat');
      const pb = pauseBlock(ctx.seed);
      const cfg = runnerConfig(dir, 'repeat', ctx, {
        repeats: 2,
        specs: [rawSpec('rb-repeat-0', 3, RUNNER_TARGET)],
        pause: { kind: 'block', spec: 'rb-repeat-0', block: pb, occurrence: 2 },
      });
      const killed = await killedCampaign(ctx, dir, cfg);
      const resumed = await resumeHere(cfg);
      const runs = await storedRuns(cfg);
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed in repeat 1, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [resumed.error === undefined, `expected the recovery to finish, got ${kindOf(resumed.error)}`],
        [
          same(
            resumed.outcomes.map((o) => o.reused),
            [true, false],
          ),
          `expected repeat 0 reused and repeat 1 run, got ${show(resumed.outcomes.map((o) => o.reused))}`,
        ],
        [
          same(runs.map((x) => x.repeat).sort(), [0, 1]),
          `expected one run per repeat, got ${show(runs.map((x) => x.repeat))}`,
        ],
        [wholeCells(runs, resumed.cells, 3) === undefined, wholeCells(runs, resumed.cells, 3) ?? ''],
      ]);
    },
  });

  r({
    slug: 'cli-resume-after-kill',
    tier: 4,
    component: CLI_CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "campaign resume": a campaign run killed mid cell (process target) is completed by campaign resume with the same --process-command, from the specs in the store even with the spec files gone; one cell reused',
    cause: 'campaign resume completes a killed campaign from the store',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-resume');
      const job = await killedCli(ctx, dir, 'cli', 1);
      for (const file of job.specFiles) unlinkSync(file);
      const res = await cli(
        ['campaign', 'resume', job.campaignId, '--store', job.path, '--process-command', job.command],
        dir,
      );
      const counts = logCounts(job.log);
      const runs = await withStore(job.path, (store) => store.listRuns({ campaignId: job.campaignId }));
      return expectAll([
        [job.killed, `expected the command killed mid cell: ${job.note}`],
        [res.code === 0, `expected exit 0, got ${res.code ?? res.thrown}: ${res.err.slice(0, 300)}`],
        [
          /^3 cells: 3 pass, 0 fail, 0 failed, 1 reused\. Spent \$0\.00\.$/m.test(res.out),
          `expected the summary "3 cells: 3 pass, 0 fail, 0 failed, 1 reused. Spent $0.00.", got ${res.out.slice(-300)}`,
        ],
        [
          (counts.get(`${job.specIds[0]} 0`) ?? 0) === 1,
          `expected the finished cell never answered again, got ${countsText(counts)}`,
        ],
        [
          runs.length === 3 && runs.every((x) => x.status === 'completed'),
          `expected 3 completed runs, got ${show(runs.map((x) => x.status))}`,
        ],
      ]);
    },
  });

  r({
    slug: 'cli-resume-latest',
    tier: 3,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "campaign status": without a campaign id, resume takes the latest campaign of the store: the one killed after an earlier finished campaign',
    cause: 'campaign resume without an id resumes the newest campaign of the store',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-latest');
      const job = await killedCli(ctx, dir, 'late', 1, async (path, command, specFile) => {
        const res = await cli(
          [
            'campaign',
            'run',
            specFile,
            '--campaign',
            'c-earlier',
            '--store',
            path,
            '--process-command',
            command,
          ],
          dir,
        );
        return res.code === 0
          ? undefined
          : `the earlier campaign did not run: ${res.code ?? res.thrown} ${res.err.slice(0, 200)}`;
      });
      const res = await cli(
        ['campaign', 'resume', '--store', job.path, '--process-command', job.command],
        dir,
      );
      return expectAll([
        [job.killed, `expected the command killed mid cell: ${job.note}`],
        [res.code === 0, `expected exit 0, got ${res.code ?? res.thrown}: ${res.err.slice(0, 300)}`],
        [
          res.out.startsWith(`Campaign ${job.campaignId}:`),
          `expected the killed campaign ${job.campaignId} resumed, got ${res.out.split('\n')[0]}`,
        ],
      ]);
    },
  });

  r({
    slug: 'cli-status-after-kill',
    tier: 2,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "campaign status" and "Outcomes": after a kill mid cell, status prints one passing cell and two pending cells (mark ·), and exits 1',
    cause: 'campaign status shows the cells a killed campaign never finished as pending',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-status');
      const job = await killedCli(ctx, dir, 'stat', 1);
      const res = await cli(['campaign', 'status', job.campaignId, '--store', job.path], dir);
      const lines = res.out.split('\n');
      const marks = lines.filter((l) => /^[✓✗!·] /.test(l)).map((l) => l[0]);
      return expectAll([
        [job.killed, `expected the command killed mid cell: ${job.note}`],
        [res.code === 1, `expected exit 1, got ${res.code ?? res.thrown}: ${res.err.slice(0, 200)}`],
        [same(marks, ['✓', '·', '·']), `expected marks ✓ · ·, got ${show(marks)}: ${res.out.slice(0, 400)}`],
      ]);
    },
  });

  r({
    slug: 'cli-rerun-after-early-kill',
    tier: 2,
    component: CLI_CAMPAIGN,
    source: 'hostile',
    title:
      'docs/running.md "campaign run" (an id the store already holds is refused): a run killed after storing its specs but before its campaign is not stored, so campaign run with the same --campaign runs every cell',
    cause: 'campaign run accepts an id whose earlier run was killed before the campaign was stored',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-early');
      const agent = writeProcessAgent(dir);
      const specs = [0, 1, 2].map((i) => rawSpec(`rb-early-${i}`, 2, PROC_TARGET));
      const cfg = runnerConfig(dir, 'early', ctx, { specs, pause: { kind: 'specs' } });
      const killed = await killedCampaign(ctx, dir, cfg);
      const files = specs.map((spec) => {
        const file = join(dir, `${spec.id}.yaml`);
        writeFileSync(file, JSON.stringify(spec));
        return file;
      });
      const command = JSON.stringify([
        process.execPath,
        agent,
        join(dir, 'proc.log'),
        join(dir, 'proc-marker'),
        'none',
        '-1',
      ]);
      const before = await withStore(cfg.path, async (store) => store.getCampaign(cfg.campaignId));
      const res = await cli(
        [
          'campaign',
          'run',
          ...files,
          '--campaign',
          cfg.campaignId,
          '--store',
          cfg.path,
          '--process-command',
          command,
        ],
        dir,
      );
      return expectAll([
        [
          killed.marked && killed.killed,
          `expected the run killed after its specs, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [before === undefined, 'expected no campaign stored before the rerun'],
        [res.code === 0, `expected exit 0, got ${res.code ?? res.thrown}: ${res.err.slice(0, 300)}`],
        [
          /^3 cells: 3 pass, 0 fail, 0 failed\. /m.test(res.out),
          `expected 3 passing cells, got ${res.out.slice(-200)}`,
        ],
      ]);
    },
  });

  r({
    slug: 'two-resumes-at-once',
    tier: 5,
    component: CLI_CAMPAIGN,
    source: 'adversarial',
    title:
      'docs/running.md "campaign resume" and "The store": two campaign resume commands of one killed campaign at once both finish, and the store holds exactly one completed run per cell',
    cause: 'two campaign resume commands of one campaign leave one completed run per cell',
    async check(ctx) {
      const dir = folderFor(ctx, 'two-resumes');
      const job = await killedCli(ctx, dir, 'pair', 1);
      const script = join(dir, 'cli-child.mts');
      writeFileSync(script, cliChild(ctx));
      const argv = JSON.stringify([
        'campaign',
        'resume',
        job.campaignId,
        '--store',
        job.path,
        '--process-command',
        job.command,
      ]);
      const children = [0, 1].map(() => tsx(ctx, script, [argv, dir]));
      const ends = await Promise.all(children.map((c) => c.ended));
      const runs = await withStore(job.path, (store) => store.listRuns({ campaignId: job.campaignId }));
      const ids = runs.map((x) => x.runId);
      return expectAll([
        [job.killed, `expected the command killed mid cell: ${job.note}`],
        [
          ends.every((e) => e.code === 0),
          `expected both resumes to exit 0, got ${ends.map((e) => `${e.code} ${e.err.slice(0, 150)}`).join(' | ')}`,
        ],
        [runs.length === 3 && new Set(ids).size === 3, `expected one run per cell, got ${show(ids)}`],
        [
          runs.every((x) => x.status === 'completed'),
          `expected every run completed, got ${show(runs.map((x) => x.status))}`,
        ],
      ]);
    },
  });

  return out;
}

const PROC_TARGET: TargetRef = { adapter: 'process', agent: 'robust-agent' };

/**
 * The process agent of the command-line items: logs `spec block` for every block it answers, and, at the
 * planted block, the first time, writes its pid to the marker and waits (at most 30 s) for the kill.
 */
const PROCESS_AGENT = `import fs from 'node:fs';
const input = fs.readFileSync(0, 'utf8');
const [log, marker, pauseSpec, pauseBlock] = process.argv.slice(2);
const m = /^(\\S+) block (\\d+)/.exec(input.trim());
const spec = m ? m[1] : '?';
const block = m ? Number(m[2]) : -1;
fs.appendFileSync(log, spec + ' ' + block + '\\n');
if (spec === pauseSpec && String(block) === pauseBlock && !fs.existsSync(marker)) {
  fs.writeFileSync(marker, String(process.pid));
  setTimeout(() => process.exit(3), 30000);
} else {
  process.stdout.write('Recorded under R-' + (1000 + block) + '.\\n');
}
`;

function writeProcessAgent(dir: string): string {
  const agent = join(dir, 'agent.mjs');
  writeFileSync(agent, PROCESS_AGENT);
  return agent;
}

type CliJob = {
  path: string;
  campaignId: string;
  command: string;
  log: string;
  specIds: string[];
  specFiles: string[];
  killed: boolean;
  note: string;
};

/**
 * `campaign run` of three two-block process-target specs in a child process, killed (by its pid) when the
 * agent reaches block 1 of the spec at `pauseSpec`; the agent's own pid, which it wrote, is killed too.
 */
async function killedCli(
  ctx: ItemContext,
  dir: string,
  tag: string,
  pauseSpec: number,
  first?: (path: string, command: string, specFile: string) => Promise<string | undefined>,
): Promise<CliJob> {
  const agent = writeProcessAgent(dir);
  const specIds = [0, 1, 2].map((i) => `rc-${tag}-${i}`);
  const specFiles = specIds.map((id) => {
    const file = join(dir, `${id}.yaml`);
    writeFileSync(file, JSON.stringify(rawSpec(id, 2, PROC_TARGET)));
    return file;
  });
  const log = join(dir, 'proc.log');
  const marker = join(dir, 'proc-marker');
  const path = join(dir, 'store.sqlite');
  const command = JSON.stringify([process.execPath, agent, log, marker, specIds[pauseSpec] ?? '', '1']);
  if (first) {
    const earlierSpec = join(dir, 'earlier.yaml');
    writeFileSync(earlierSpec, JSON.stringify(rawSpec(`rc-${tag}-earlier`, 1, PROC_TARGET)));
    const problem = await first(path, command, earlierSpec);
    if (problem)
      return { path, campaignId: '', command, log, specIds, specFiles, killed: false, note: problem };
  }
  const campaignId = `c-${tag}-${ctx.seed % 100}`;
  const script = join(dir, 'cli-child.mts');
  writeFileSync(script, cliChild(ctx));
  const argv = [
    'campaign',
    'run',
    ...specFiles,
    '--campaign',
    campaignId,
    '--store',
    path,
    '--concurrency',
    '1',
    '--process-command',
    command,
  ];
  const child = tsx(ctx, script, [JSON.stringify(argv), dir]);
  const reached = await waitFor(() => existsSync(marker) || !child.isRunning(), 120_000, 10);
  let killed = false;
  if (child.isRunning()) {
    killPid(child.pid);
    killed = true;
  }
  const ended = await child.ended;
  if (existsSync(marker)) {
    const agentPid = Number(readFileSync(marker, 'utf8'));
    if (Number.isInteger(agentPid) && agentPid > 1) killPid(agentPid);
  }
  return {
    path,
    campaignId,
    command,
    log,
    specIds,
    specFiles,
    killed: reached && killed,
    note: `the command ended ${ended.code} ${ended.signal}: ${ended.out.slice(-200)} ${ended.err.slice(0, 200)}`,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* robust-transfer                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/**
 * A child that runs one store call with fs/promises writeFile wrapped: at the nth write it records the file
 * in the marker and kills itself, before the write or after writing half of it.
 */
const writerScript = (ctx: ItemContext) => `import fsp from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const [task, nth, mode, marker, ...args] = process.argv.slice(2);
const real = fsp.writeFile;
let n = 0;
fsp.writeFile = async function (file, data, ...rest) {
  n += 1;
  if (n === Number(nth)) {
    writeFileSync(marker, String(file));
    if (mode === 'half') {
      const bytes = Buffer.from(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
      await real.call(fsp, file, bytes.subarray(0, Math.floor(bytes.length / 2)));
    }
    process.kill(process.pid, 'SIGKILL');
    await new Promise(() => {});
  }
  return real.call(fsp, file, data, ...rest);
};
syncBuiltinESMExports();
const store = await import(${JSON.stringify(src(ctx, 'store'))});
if (task === 'export') {
  const s = store.openStore(args[0]);
  await s.exportCampaign(args[1], args[2]);
  await s.close();
} else if (task === 'restore') {
  const s = store.openStore(args[0]);
  const version = await s.getVersion('dataset', args[1], '1');
  const files = await s.readVersionFiles(version);
  await s.close();
  await store.restoreFiles(files, args[2], { single: false });
}
console.log('END');
`;

/** A child that runs one store call and kills itself at the nth COMMIT, mid transaction. */
const commitKillScript = (ctx: ItemContext) => `import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [task, nth, marker, ...args] = process.argv.slice(2);
let n = 0;
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql === 'COMMIT' && ++n === Number(nth)) { writeFileSync(marker, 'commit'); process.kill(process.pid, 'SIGKILL'); }
  return exec.call(this, sql);
};
const { openStore } = await import(${JSON.stringify(src(ctx, 'store'))});
const s = openStore(args[0]);
if (task === 'import') await s.importCampaign(args[1]);
else if (task === 'push') {
  const files = JSON.parse(readFileSync(args[2], 'utf8')).map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.text) }));
  await s.pushVersion('dataset', args[1], files);
}
await s.close();
console.log('END');
`;

async function killedWriter(
  ctx: ItemContext,
  dir: string,
  task: 'export' | 'restore',
  nth: number,
  mode: 'before' | 'half',
  args: string[],
): Promise<{ ended: Ended; marked: string | undefined }> {
  const script = join(dir, 'writer.mts');
  writeFileSync(script, writerScript(ctx));
  const marker = join(dir, `writer-marker-${Date.now()}`);
  const ended = await tsx(ctx, script, [task, String(nth), mode, marker, ...args]).ended;
  return { ended, marked: existsSync(marker) ? readFileSync(marker, 'utf8') : undefined };
}

async function killedAtCommit(
  ctx: ItemContext,
  dir: string,
  task: 'import' | 'push',
  args: string[],
): Promise<{ ended: Ended; marked: boolean }> {
  const script = join(dir, 'commit-kill.mts');
  writeFileSync(script, commitKillScript(ctx));
  const marker = join(dir, `commit-marker-${Date.now()}`);
  const ended = await tsx(ctx, script, [task, '1', marker, ...args]).ended;
  return { ended, marked: existsSync(marker) };
}

type Snapshot = { campaigns: number; runs: number; versions: number; specs: number };

/** What a store holds of every kind a bundle carries, counted by hand. */
function snapshotOf(path: string): Snapshot {
  if (!existsSync(path)) return { campaigns: 0, runs: 0, versions: 0, specs: 0 };
  const db = new DatabaseSync(path);
  try {
    const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0);
    return {
      campaigns: count('campaigns'),
      runs: count('runs'),
      versions: count('versions'),
      specs: count('specs'),
    };
  } finally {
    db.close();
  }
}

const EMPTY: Snapshot = { campaigns: 0, runs: 0, versions: 0, specs: 0 };

/** Imports a folder into a new store: the error kind and what the store then holds. */
async function importInto(
  dir: string,
  folder: string,
  name = 'target.sqlite',
): Promise<{ kind: string; after: Snapshot }> {
  const path = join(dir, name);
  const kind = await withStore(path, async (store) => kindOf(await caught(store.importCampaign(folder))));
  return { kind, after: snapshotOf(path) };
}

/** A copy of the bundle folder to damage. */
function damagedCopy(bundle: Exported, dir: string, tag: string): string {
  const copy = join(dir, `damaged-${tag}`, bundle.campaignId);
  cpSync(bundle.folder, copy, { recursive: true });
  return copy;
}

function detailOf(result: ItemResult): string {
  return result.pass ? '' : result.detail;
}

function refusedWhole(result: { kind: string; after: Snapshot }, what: string): ItemResult {
  return expectAll([
    [
      result.kind === 'StoreError BUNDLE_INVALID',
      `expected ${what} refused with StoreError BUNDLE_INVALID, got ${result.kind}`,
    ],
    [
      same(result.after, EMPTY),
      `expected nothing of the bundle visible, the store holds ${show(result.after)}`,
    ],
  ]);
}

function sourceHome(bundle: Exported, folder: string): string {
  return join(folder, 'sources', 'dataset', `${bundle.dataset}@1`);
}

function transferItems(): BankItem[] {
  const out: BankItem[] = [];
  const t = (spec: Spec) => out.push(item('transfer', spec));

  /** A damaged-member item: the bundle with one change, refused whole. */
  const damaged = (
    slug: string,
    tier: Tier,
    title: string,
    cause: string,
    damage: (bundle: Exported, folder: string, seed: number) => void,
  ) =>
    t({
      slug,
      tier,
      component: BUNDLE,
      source: 'hostile',
      title,
      cause,
      async check(ctx) {
        const dir = folderFor(ctx, `t-${slug}`);
        const bundle = await exportedBundle(ctx, dir, slug.slice(0, 12), 3);
        const folder = damagedCopy(bundle, dir, slug);
        damage(bundle, folder, ctx.seed);
        return refusedWhole(await importInto(dir, folder), `a bundle with ${slug.replace(/-/g, ' ')}`);
      },
    });

  t({
    slug: 'killed-export-refused',
    tier: 2,
    component: BUNDLE,
    source: 'hostile',
    title:
      'packages/store/src/bundle.ts (the manifest is written last, so a bundle without one did not finish): an export killed after two of its files is refused by import with BUNDLE_INVALID, nothing imported',
    cause: 'writeCampaignBundle writes the manifest last so an interrupted export is refused',
    async check(ctx) {
      const dir = folderFor(ctx, 'killed-export');
      const bundle = await exportedBundle(ctx, dir, 'kexp', 3);
      const out2 = join(dir, 'again');
      const killed = await killedWriter(ctx, dir, 'export', 3, 'before', [
        bundle.sourcePath,
        bundle.campaignId,
        out2,
      ]);
      const folder = join(out2, bundle.campaignId);
      const result = await importInto(dir, folder);
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL' && killed.marked !== undefined,
          `expected the exporter killed at its third file, it ended ${killed.ended.code} ${killed.ended.signal}: ${killed.ended.err.slice(0, 200)}`,
        ],
        [
          refusedWhole(result, 'the interrupted bundle').pass,
          detailOf(refusedWhole(result, 'the interrupted bundle')),
        ],
      ]);
    },
  });

  t({
    slug: 'killed-export-rerun',
    tier: 2,
    component: BUNDLE,
    source: 'hostile',
    title:
      'docs/datasets.md "Run a campaign again elsewhere": re-running an export killed half way, into the same folder, gives a bundle that imports whole: every run, the spec and the dataset version',
    cause: 'exportCampaign rewrites an interrupted bundle folder into a complete one',
    async check(ctx) {
      const dir = folderFor(ctx, 'killed-export-rerun');
      const bundle = await exportedBundle(ctx, dir, 'krerun', 3);
      const out2 = join(dir, 'again');
      const killed = await killedWriter(ctx, dir, 'export', 2, 'half', [
        bundle.sourcePath,
        bundle.campaignId,
        out2,
      ]);
      const folder = await withStore(bundle.sourcePath, (store) =>
        store.exportCampaign(bundle.campaignId, out2),
      );
      const result = await importInto(dir, folder);
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL',
          `expected the exporter killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [result.kind === 'no error', `expected the re-run bundle to import, got ${result.kind}`],
        [
          same(result.after, { campaigns: 1, runs: bundle.runs, versions: 1, specs: 1 }),
          `expected 1 campaign, ${bundle.runs} runs, 1 version, 1 spec, got ${show(result.after)}`,
        ],
      ]);
    },
  });

  t({
    slug: 'half-written-run-file',
    tier: 3,
    component: BUNDLE,
    source: 'hostile',
    title:
      'packages/store/src/bundle.ts: an export killed in the middle of writing a run file leaves a bundle import refuses with BUNDLE_INVALID, nothing imported',
    cause: 'readCampaignBundle refuses a bundle whose writer was killed mid file',
    async check(ctx) {
      const dir = folderFor(ctx, 'half-run');
      const bundle = await exportedBundle(ctx, dir, 'khalf', 3);
      const out2 = join(dir, 'again');
      const killed = await killedWriter(ctx, dir, 'export', 2, 'half', [
        bundle.sourcePath,
        bundle.campaignId,
        out2,
      ]);
      const result = await importInto(dir, join(out2, bundle.campaignId));
      const verdict = refusedWhole(result, 'the half-written bundle');
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL' && (killed.marked ?? '').includes('/runs/'),
          `expected the exporter killed while writing a run file, it ended ${killed.ended.code} ${killed.ended.signal} at ${killed.marked}`,
        ],
        [verdict.pass, detailOf(verdict)],
      ]);
    },
  });

  t({
    slug: 'killed-reexport-over-complete',
    tier: 3,
    component: BUNDLE,
    source: 'hostile',
    title:
      'packages/store/src/bundle.ts (the old manifest goes first): an export over a complete bundle killed at its first file leaves a folder import refuses, never the old manifest over new files',
    cause: 'writeCampaignBundle removes the old manifest before it writes anything',
    async check(ctx) {
      const dir = folderFor(ctx, 'reexport');
      const bundle = await exportedBundle(ctx, dir, 'kover', 3);
      const killed = await killedWriter(ctx, dir, 'export', 1, 'half', [
        bundle.sourcePath,
        bundle.campaignId,
        join(dir, 'bundles'),
      ]);
      const result = await importInto(dir, bundle.folder);
      const verdict = refusedWhole(result, 'the interrupted re-export');
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL',
          `expected the exporter killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [verdict.pass, detailOf(verdict)],
      ]);
    },
  });

  damaged(
    'truncated-run-file',
    1,
    'docs/datasets.md "Run a campaign again elsewhere": a bundle whose run file is cut short is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a run file that is not whole JSON',
    (_bundle, folder) => {
      const runs = readdirSync(join(folder, 'runs'));
      const file = join(folder, 'runs', runs[0] as string);
      truncateSync(file, Math.floor(readFileSync(file).length / 2));
    },
  );

  damaged(
    'missing-run-file',
    1,
    'docs/datasets.md "Run a campaign again elsewhere": a bundle missing one run file is refused with BUNDLE_INVALID (the manifest counts it) and nothing is imported',
    'readCampaignBundle checks the run count against the manifest',
    (_bundle, folder) => {
      const runs = readdirSync(join(folder, 'runs'));
      unlinkSync(join(folder, 'runs', runs[runs.length - 1] as string));
    },
  );

  damaged(
    'missing-campaign-file',
    1,
    'docs/datasets.md "Run a campaign again elsewhere": a bundle without campaign.json is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a bundle without its campaign',
    (_bundle, folder) => unlinkSync(join(folder, 'campaign.json')),
  );

  damaged(
    'truncated-manifest',
    1,
    'packages/store/src/bundle.ts: a bundle whose manifest is cut short is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a manifest that is not whole JSON',
    (_bundle, folder) => truncateSync(join(folder, 'manifest.json'), 20),
  );

  damaged(
    'missing-spec-file',
    2,
    'docs/datasets.md "campaign import checks every spec against its hash": a bundle missing its spec file is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle checks the spec count against the manifest',
    (_bundle, folder) => {
      for (const file of readdirSync(join(folder, 'specs'))) unlinkSync(join(folder, 'specs', file));
    },
  );

  damaged(
    'truncated-spec-file',
    2,
    'docs/datasets.md "campaign import checks every spec against its hash": a bundle whose spec file is cut short is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a spec file that is not whole',
    (_bundle, folder) => {
      const file = join(folder, 'specs', readdirSync(join(folder, 'specs'))[0] as string);
      truncateSync(file, Math.floor(readFileSync(file).length / 2));
    },
  );

  damaged(
    'missing-dataset-file',
    2,
    'docs/datasets.md "every file against its SHA-256": a bundle missing a file of its dataset version is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a version whose file is missing',
    (bundle, folder) => unlinkSync(join(sourceHome(bundle, folder), 'files', 'notes', 'b.txt')),
  );

  damaged(
    'truncated-dataset-file',
    2,
    'docs/datasets.md "every file against its SHA-256": a bundle whose dataset file is cut short is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle checks every version file against its hash',
    (bundle, folder) => truncateSync(join(sourceHome(bundle, folder), 'files', 'notes', 'b.txt'), 10),
  );

  damaged(
    'missing-version-record',
    2,
    'docs/datasets.md "sources/<kind>/<name>@<version>/version.json": a bundle whose version.json is missing is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a source folder without its version record',
    (bundle, folder) => unlinkSync(join(sourceHome(bundle, folder), 'version.json')),
  );

  damaged(
    'missing-source-folder',
    2,
    'docs/datasets.md "Run a campaign again elsewhere": a bundle missing a whole source folder is refused with BUNDLE_INVALID (the manifest counts it) and nothing is imported',
    'readCampaignBundle checks the source count against the manifest',
    (bundle, folder) => rmSync(sourceHome(bundle, folder), { recursive: true, force: true }),
  );

  damaged(
    'stray-run-file',
    2,
    'packages/store/src/bundle.ts (export into an empty folder): a bundle holding a run file its manifest does not count, left by another export, is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses run files the manifest does not count',
    (_bundle, folder) => {
      const runs = readdirSync(join(folder, 'runs'));
      const first = JSON.parse(readFileSync(join(folder, 'runs', runs[0] as string), 'utf8')) as RunResult;
      writeFileSync(join(folder, 'runs', 'stray.json'), JSON.stringify({ ...first, runId: 'r-stray' }));
    },
  );

  damaged(
    'duplicate-run-file',
    2,
    'packages/store/src/bundle.ts: a bundle where one run appears in two files is refused with BUNDLE_INVALID and nothing is imported',
    'readCampaignBundle refuses a run that appears in two files',
    (_bundle, folder) => {
      const runs = readdirSync(join(folder, 'runs')).sort();
      const last = runs[runs.length - 1] as string;
      const first = readFileSync(join(folder, 'runs', runs[0] as string));
      writeFileSync(join(folder, 'runs', last), first);
    },
  );

  t({
    slug: 'killed-import-invisible',
    tier: 3,
    component: STORE,
    source: 'hostile',
    title:
      'docs/datasets.md "campaign import ... all or nothing": an import killed during its write leaves no campaign, run, spec or version visible, and importing again completes',
    cause: 'importCampaign writes the whole bundle in one transaction that a kill rolls back',
    async check(ctx) {
      const dir = folderFor(ctx, 'killed-import');
      const bundle = await exportedBundle(ctx, dir, 'kimp', 3);
      const path = join(dir, 'target.sqlite');
      await withStore(path, async () => undefined);
      const killed = await killedAtCommit(ctx, dir, 'import', [path, bundle.folder]);
      const between = snapshotOf(path);
      const again = await withStore(path, async (store) =>
        kindOf(await caught(store.importCampaign(bundle.folder))),
      );
      const after = snapshotOf(path);
      return expectAll([
        [
          killed.marked && killed.ended.signal === 'SIGKILL',
          `expected the importer killed at its commit, it ended ${killed.ended.code} ${killed.ended.signal}: ${killed.ended.err.slice(0, 200)}`,
        ],
        [same(between, EMPTY), `expected nothing visible after the killed import, got ${show(between)}`],
        [again === 'no error', `expected the second import to succeed, got ${again}`],
        [
          same(after, { campaigns: 1, runs: bundle.runs, versions: 1, specs: 1 }),
          `expected the whole bundle after the second import, got ${show(after)}`,
        ],
      ]);
    },
  });

  t({
    slug: 'conflict-import-leaves-nothing',
    tier: 3,
    component: STORE,
    source: 'contract',
    title:
      'docs/datasets.md "campaign import ... all or nothing": an import refused because the store holds the campaign with other content adds none of the bundle\'s specs, versions or runs',
    cause: 'importCampaign rolls back the specs and versions it wrote before a campaign conflict',
    async check(ctx) {
      const dir = folderFor(ctx, 'conflict-import');
      const bundle = await exportedBundle(ctx, dir, 'kconf', 3);
      const path = join(dir, 'target.sqlite');
      const base = await baseRun(ctx.seed, 'kconf-other');
      await withStore(path, (store) =>
        store.putCampaign(campaignOf(bundle.campaignId, base, { createdAt: '2026-10-12T00:00:00.000Z' })),
      );
      const kind = await withStore(path, async (store) =>
        kindOf(await caught(store.importCampaign(bundle.folder))),
      );
      const after = snapshotOf(path);
      return expectAll([
        [kind === 'StoreError CAMPAIGN_CONFLICT', `expected StoreError CAMPAIGN_CONFLICT, got ${kind}`],
        [
          same(after, { campaigns: 1, runs: 0, versions: 0, specs: 0 }),
          `expected only the store's own campaign, got ${show(after)}`,
        ],
      ]);
    },
  });

  t({
    slug: 'version-conflict-leaves-nothing',
    tier: 3,
    component: STORE,
    source: 'contract',
    title:
      'docs/datasets.md "A version number the other store already holds with other content stops the import": the import fails with VERSION_CONFLICT and stores no campaign, run or spec',
    cause: 'importCampaign stops on a version conflict before anything is visible',
    async check(ctx) {
      const dir = folderFor(ctx, 'version-conflict');
      const bundle = await exportedBundle(ctx, dir, 'kver', 3);
      const path = join(dir, 'target.sqlite');
      await withStore(path, (store) =>
        store.pushVersion('dataset', bundle.dataset, [
          { path: 'other.yaml', bytes: new TextEncoder().encode(`# other ${ctx.seed}\n`) },
        ]),
      );
      const kind = await withStore(path, async (store) =>
        kindOf(await caught(store.importCampaign(bundle.folder))),
      );
      const after = snapshotOf(path);
      return expectAll([
        [kind === 'StoreError VERSION_CONFLICT', `expected StoreError VERSION_CONFLICT, got ${kind}`],
        [
          same(after, { campaigns: 0, runs: 0, versions: 1, specs: 0 }),
          `expected only the store's own version, got ${show(after)}`,
        ],
      ]);
    },
  });

  t({
    slug: 'version-path-escape',
    tier: 5,
    component: STORE,
    source: 'hostile',
    title:
      'docs/datasets.md "The registry" (a version is a set of paths inside it; push refuses a path with ..): an import whose version names a file path that leaves the version is refused with BUNDLE_INVALID and stores nothing',
    cause:
      'importCampaign stores bundle versions without checking their file paths, so a path that leaves the version is accepted',
    async check(ctx) {
      const dir = folderFor(ctx, 'path-escape');
      const bundle = await exportedBundle(ctx, dir, 'kpath', 2);
      const folder = damagedCopy(bundle, dir, 'escape');
      const home = sourceHome(bundle, folder);
      const bytes = new TextEncoder().encode(`escaped R-${1000 + (ctx.seed % 9000)}\n`);
      writeFileSync(join(home, 'escape.yaml'), bytes);
      const entries = [{ path: '../escape.yaml', sha256: sha256(bytes), size: bytes.byteLength }];
      const hash = sha256(canonicalJson(entries));
      const version = JSON.parse(readFileSync(join(home, 'version.json'), 'utf8')) as Record<string, unknown>;
      writeFileSync(join(home, 'version.json'), JSON.stringify({ ...version, files: entries, hash }));
      const campaign = JSON.parse(readFileSync(join(folder, 'campaign.json'), 'utf8')) as Campaign;
      const sources = (campaign.sources ?? []).map((s) => ({ ...s, hash }));
      writeFileSync(join(folder, 'campaign.json'), JSON.stringify({ ...campaign, sources }));
      const path = join(dir, 'target.sqlite');
      const kind = await withStore(path, async (store) => kindOf(await caught(store.importCampaign(folder))));
      const stored = await withStore(path, async (store) =>
        (await store.listVersions('dataset')).flatMap((v) => v.files.map((f) => f.path)),
      );
      return expectAll([
        [
          kind === 'StoreError BUNDLE_INVALID',
          `expected the version with path ../escape.yaml refused with StoreError BUNDLE_INVALID, got ${kind}`,
        ],
        [stored.length === 0, `expected no version stored, the registry now lists the paths ${show(stored)}`],
      ]);
    },
  });

  t({
    slug: 'killed-push-invisible',
    tier: 2,
    component: STORE,
    source: 'hostile',
    title:
      'docs/datasets.md "The registry" (versions count up from 1): a dataset push killed during its write leaves no version, and pushing again gives version 1',
    cause: 'pushVersion writes the blobs and the version in one transaction that a kill rolls back',
    async check(ctx) {
      const dir = folderFor(ctx, 'killed-push');
      const path = join(dir, 'store.sqlite');
      await withStore(path, async () => undefined);
      const files = [
        { path: 'a.yaml', text: `# a ${ctx.seed}\n` },
        { path: 'b/c.yaml', text: `# c ${ctx.seed}\n` },
      ];
      const filesJson = join(dir, 'files.json');
      writeFileSync(filesJson, JSON.stringify(files));
      const killed = await killedAtCommit(ctx, dir, 'push', [path, 'kpush', filesJson]);
      const between = snapshotOf(path);
      const pushed = await withStore(path, (store) =>
        store.pushVersion(
          'dataset',
          'kpush',
          files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.text) })),
        ),
      );
      return expectAll([
        [
          killed.marked && killed.ended.signal === 'SIGKILL',
          `expected the push killed at its commit, it ended ${killed.ended.code} ${killed.ended.signal}: ${killed.ended.err.slice(0, 200)}`,
        ],
        [between.versions === 0, `expected no version after the killed push, got ${between.versions}`],
        [
          pushed.version.version === 1 && pushed.created,
          `expected version 1 created by the second push, got ${pushed.version.version} created ${pushed.created}`,
        ],
      ]);
    },
  });

  t({
    slug: 'killed-restore-rerun',
    tier: 3,
    component: REGISTRY,
    source: 'hostile',
    title:
      'docs/datasets.md "Exact": after a restore killed while writing a file, restoring again names the half-written file and writes nothing; with --force every file holds the exact pushed bytes',
    cause: 'restoreFiles finds the half-written file of a killed restore and replaces it with force',
    async check(ctx) {
      const dir = folderFor(ctx, 'killed-restore');
      const bundle = await exportedBundle(ctx, dir, 'krest', 1);
      const target = join(dir, 'restored');
      const killed = await killedWriter(ctx, dir, 'restore', 2, 'half', [
        bundle.sourcePath,
        bundle.dataset,
        target,
      ]);
      const files = await withStore(bundle.sourcePath, async (store) => {
        const version = await store.getVersion('dataset', bundle.dataset, '1');
        if (!version) throw new Error("the item's dataset version is missing");
        return store.readVersionFiles(version);
      });
      const half =
        killed.marked === undefined
          ? ''
          : killed.marked
              .slice(target.length + 1)
              .split('\\')
              .join('/');
      const plain = await restoreFiles(files, target, { single: false });
      const forced = await restoreFiles(files, target, { single: false, force: true });
      const wrong = files.filter(
        (f) =>
          !existsSync(join(target, f.path)) || sha256(readFileSync(join(target, f.path))) !== sha256(f.bytes),
      );
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL' && killed.marked !== undefined,
          `expected the restore killed at its second file, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [
          plain.written === 0 && same(plain.conflicts, [half]),
          `expected the re-run to name ${half} and write nothing, got written ${plain.written} conflicts ${show(plain.conflicts)}`,
        ],
        [
          forced.conflicts.length === 0 && wrong.length === 0,
          `expected every file exact after --force, wrong: ${wrong.map((f) => f.path).join(', ')}`,
        ],
      ]);
    },
  });

  t({
    slug: 'reexport-after-new-runs',
    tier: 3,
    component: BUNDLE,
    source: 'hostile',
    title:
      'docs/datasets.md "campaign export": an export killed half way and re-run after the campaign gained a run gives a bundle that imports every run, the new one included',
    cause: 'exportCampaign rewrites an interrupted bundle with the runs the campaign holds now',
    async check(ctx) {
      const dir = folderFor(ctx, 'reexport-new');
      const bundle = await exportedBundle(ctx, dir, 'knew', 3);
      const out2 = join(dir, 'again');
      const killed = await killedWriter(ctx, dir, 'export', 3, 'half', [
        bundle.sourcePath,
        bundle.campaignId,
        out2,
      ]);
      const base = await baseRun(ctx.seed, 'knew-extra');
      await withStore(bundle.sourcePath, (store) =>
        store.putRun(bundle.campaignId, variant(base, 'r-extra')),
      );
      const folder = await withStore(bundle.sourcePath, (store) =>
        store.exportCampaign(bundle.campaignId, out2),
      );
      const result = await importInto(dir, folder);
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL',
          `expected the exporter killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [result.kind === 'no error', `expected the re-run bundle to import, got ${result.kind}`],
        [result.after.runs === bundle.runs + 1, `expected ${bundle.runs + 1} runs, got ${result.after.runs}`],
      ]);
    },
  });

  t({
    slug: 'cli-import-interrupted',
    tier: 2,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/datasets.md "Run a campaign again elsewhere" exit codes: campaign import of an interrupted bundle exits 2 with the reason, and the store holds nothing of it',
    cause: 'campaign import exits 2 on a bundle that does not read',
    async check(ctx) {
      const dir = folderFor(ctx, 'cli-import');
      const bundle = await exportedBundle(ctx, dir, 'kcli', 2);
      const out2 = join(dir, 'again');
      const killed = await killedWriter(ctx, dir, 'export', 2, 'before', [
        bundle.sourcePath,
        bundle.campaignId,
        out2,
      ]);
      const path = join(dir, 'target.sqlite');
      const res = await cli(['campaign', 'import', join(out2, bundle.campaignId), '--store', path], dir);
      const after = snapshotOf(path);
      return expectAll([
        [
          killed.ended.signal === 'SIGKILL',
          `expected the exporter killed, it ended ${killed.ended.code} ${killed.ended.signal}`,
        ],
        [res.code === 2, `expected exit 2, got ${res.code ?? res.thrown}`],
        [/invalid|manifest/i.test(res.err), `expected the reason on stderr, got ${res.err.slice(0, 200)}`],
        [same(after, EMPTY), `expected nothing stored, got ${show(after)}`],
      ]);
    },
  });

  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* robust-version                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The floors file at commit 9d7c734d (format version 1: one floor per component, no ladder version), copied
 * as text. The empty one is the first floors file, commit 923ed828.
 */
const FLOORS_V1 = `{
  "version": 1,
  "floors": {
    "judges": 7,
    "stats": 1
  },
  "evidence": {
    "judges": {
      "level": 7,
      "seeds": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "hidden"],
      "hiddenSeed": 163857621,
      "head": "454fcc95eabc0404150acb4f74f9c35113f89788"
    },
    "stats": {
      "level": 2,
      "seeds": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "hidden"],
      "hiddenSeed": 707151630,
      "head": "2a1704ce6f752251b12985a23e109056de8c6953"
    }
  }
}
`;
const FLOORS_V1_EMPTY = `{
  "version": 1,
  "floors": {}
}
`;

function floorsRoot(ctx: ItemContext, tag: string, text: string): string {
  const root = folderFor(ctx, tag);
  mkdirSync(join(root, 'validators'), { recursive: true });
  writeFileSync(join(root, 'validators', 'floors.json'), text);
  return root;
}

/**
 * A bundle as commit 1b0d48bf wrote it (schema 1): manifest `{ format, schemaVersion: 1, campaignId,
 * counts: { runs, blocks } }`, campaign.json and runs/<runId>.json, pretty printed; no specs, no sources.
 */
function schemaOneBundle(dir: string, campaign: Campaign, runs: RunResult[], schemaVersion = 1): string {
  const folder = join(dir, 'old-bundles', campaign.campaignId);
  mkdirSync(join(folder, 'runs'), { recursive: true });
  const write = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  write(join(folder, 'campaign.json'), campaign);
  for (const run of runs) write(join(folder, 'runs', `${encodeURIComponent(run.runId)}.json`), run);
  write(join(folder, 'manifest.json'), {
    format: 'driftbench-campaign',
    schemaVersion,
    campaignId: campaign.campaignId,
    counts: { runs: runs.length, blocks: runs.reduce((total, run) => total + run.blocks.length, 0) },
  });
  return folder;
}

/** An old spec file: today's fields renamed back to the names they had before commit 331e1267. */
function oldSpecFile(dir: string, name: string, body: Record<string, unknown>): string {
  const file = join(dir, `${name}.yaml`);
  writeFileSync(file, JSON.stringify(body, null, 2));
  return file;
}

async function loadIssues(file: string): Promise<{ threw?: string; ok?: boolean; text: string }> {
  try {
    const result = await loadSpecFile(file);
    if (result.ok) return { ok: true, text: '' };
    return { ok: false, text: result.errors.map((e) => `${e.path} ${e.code} ${e.message}`).join('; ') };
  } catch (error) {
    return { threw: kindOf(error), text: '' };
  }
}

function versionItems(): BankItem[] {
  const out: BankItem[] = [];
  const v = (spec: Spec) => out.push(item('version', spec));

  /** One record kind of a schema 1 store, read by today's openStore. */
  const oldRecord = (
    slug: string,
    tier: Tier,
    title: string,
    cause: string,
    read: (store: SqliteStore, old: SchemaOne, path: string) => Promise<ItemResult>,
    component: string = STORE,
  ) =>
    v({
      slug,
      tier,
      component,
      source: 'contract',
      title,
      cause,
      async check(ctx) {
        const dir = folderFor(ctx, `v-${slug}`);
        const path = join(dir, 'old.sqlite');
        const old = await schemaOneStore(ctx, path);
        const opened = await caught(async () => {
          const store = openStore(path);
          await store.close();
        });
        if (opened !== undefined)
          return fail(`expected today's openStore to open a schema 1 store, got ${kindOf(opened)}`);
        return withStore(path, (store) => read(store, old, path));
      },
    });

  oldRecord(
    'schema-1-upgraded',
    1,
    'packages/store/src/schema.ts (an older database is upgraded on open): a store written with the schema 1 SQL (commit 1b0d48bf) opens with the current user_version (SCHEMA_VERSION) and the registry tables of schema 2',
    'openStore upgrades a schema 1 store to the current schema on open',
    async (_store, _old, path) => {
      const version = readUserVersion(path);
      const tables = tablesOf(path);
      return expectAll([
        [
          version === SCHEMA_VERSION,
          `expected user_version ${SCHEMA_VERSION} (the current schema), got ${version}`,
        ],
        [
          tables.includes('blobs') && tables.includes('versions'),
          `expected the blobs and versions tables, got ${show(tables)}`,
        ],
      ]);
    },
    SCHEMA,
  );

  oldRecord(
    'schema-1-campaign',
    1,
    'packages/store/src/schema.ts: a schema 1 campaign row (no sources, no pinned target) reads back equal through getCampaign',
    'getCampaign reads a schema 1 campaign row',
    async (store, old) => {
      const back = await store.getCampaign(old.campaign.campaignId);
      return same(back, old.campaign)
        ? PASS
        : fail(`expected the campaign ${show(old.campaign)}, got ${show(back)}`);
    },
  );

  oldRecord(
    'schema-1-campaign-order',
    1,
    'docs/running.md "The store" (campaigns newest first): two schema 1 campaigns list newest first by their createdAt',
    'listCampaigns orders schema 1 campaigns newest first',
    async (store, old) => {
      const ids = (await store.listCampaigns()).map((c) => c.campaignId);
      return same(ids, [old.campaign.campaignId, old.older.campaignId])
        ? PASS
        : fail(`expected ${old.campaign.campaignId} then ${old.older.campaignId}, got ${show(ids)}`);
    },
  );

  oldRecord(
    'schema-1-spec',
    1,
    'packages/store/src/schema.ts: a schema 1 specs row reads back through getSpec at the hash it was stored under',
    'getSpec reads a schema 1 spec row at its hash',
    async (store, old) => {
      const back = await caught(async () => {
        const spec = await store.getSpec(old.spec.spec.id, old.spec.hash);
        if (spec?.hash !== old.spec.hash)
          throw new Error(`got ${spec === undefined ? 'nothing' : spec.hash}`);
      });
      return back === undefined
        ? PASS
        : fail(`expected spec ${old.spec.spec.id}@${old.spec.hash} back, ${kindOf(back)}`);
    },
  );

  oldRecord(
    'schema-1-run',
    2,
    'packages/store/src/schema.ts: a schema 1 run, its summary in runs and one row per block, reads back equal through getRun',
    'getRun reads a schema 1 run with its blocks',
    async (store, old) => {
      const back = await store.getRun(old.run.runId, old.campaign.campaignId);
      return same(back, old.run)
        ? PASS
        : fail(
            `expected the run back equal (${old.run.blocks.length} blocks), got ${back === undefined ? 'nothing' : `${back.blocks.length} blocks, differing`}`,
          );
    },
  );

  oldRecord(
    'schema-1-cache',
    1,
    'packages/store/src/schema.ts: a schema 1 cache entry without expiry reads back equal through cacheGet',
    'cacheGet reads a schema 1 cache row',
    async (store, old) => {
      const back = await store.cacheGet(old.cacheKey);
      return same(back, old.observed) ? PASS : fail(`expected the cached Observed back, got ${show(back)}`);
    },
  );

  oldRecord(
    'schema-1-units',
    1,
    'packages/store/src/schema.ts: a schema 1 units row reads back equal through listUnits',
    'listUnits reads a schema 1 units row',
    async (store, old) => {
      const back = await store.listUnits();
      return same(back, [old.unit]) ? PASS : fail(`expected ${show([old.unit])}, got ${show(back)}`);
    },
  );

  oldRecord(
    'schema-1-registry-usable',
    2,
    'packages/store/src/schema.ts (schema 2 adds the registry): after the upgrade a dataset push gives version 1',
    'the upgraded schema 1 store takes registry pushes',
    async (store) => {
      const pushed = await caught(
        store.pushVersion('dataset', 'after-upgrade', [
          { path: 'a.yaml', bytes: new TextEncoder().encode('# a\n') },
        ]),
      );
      const versions = (await store.listVersions('dataset', 'after-upgrade')).map((x) => x.version);
      return expectAll([
        [pushed === undefined, `expected the push to succeed, got ${kindOf(pushed)}`],
        [same(versions, [1]), `expected version 1, got ${show(versions)}`],
      ]);
    },
  );

  v({
    slug: 'schema-1-resume-reuses',
    tier: 3,
    component: CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "Cells" (a cell id is the run id): a campaign run by the schema 1 store, whose run ids came from the store\'s own cellId (commit 1b0d48bf), resumes today with its run reused, not run again',
    cause: 'the core cellId gives a schema 1 run the id the schema 1 store gave it',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-resume');
      const path = join(dir, 'old.sqlite');
      const old = await schemaOneStore(ctx, path);
      let calls = 0;
      const adapter = functionAdapter({
        respond: () => {
          calls += 1;
          return observedText('Recorded under R-1000.');
        },
      });
      const plan = planCampaign([{ spec: old.spec.spec, hash: old.spec.hash }], [TARGET], ['F'], 1);
      const outcomes = await withStore(path, (store) =>
        runCampaign({
          campaignId: old.campaign.campaignId,
          cells: plan.cells,
          specFor: () => old.spec.spec,
          adapterFor: () => adapter,
          driver: () => createScriptedDriver(),
          checks: [],
          store,
        }),
      );
      return expectAll([
        [
          plan.cells[0]?.cellId === old.run.runId,
          `expected today's cell id ${plan.cells[0]?.cellId} to be the stored run id ${old.run.runId}`,
        ],
        [outcomes[0]?.reused === true, `expected the stored run reused, got reused ${outcomes[0]?.reused}`],
        [calls === 0, `expected no block sent to the agent, got ${calls}`],
      ]);
    },
  });

  v({
    slug: 'schema-1-cli-status',
    tier: 3,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "campaign status": a schema 1 store opened by today\'s command line prints its campaign with the one cell passing, exit 0',
    cause: 'campaign status reads a campaign of a schema 1 store',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-status');
      const path = join(dir, 'old.sqlite');
      const old = await schemaOneStore(ctx, path);
      const res = await cli(['campaign', 'status', old.campaign.campaignId, '--store', path], dir);
      return expectAll([
        [res.code === 0, `expected exit 0, got ${res.code ?? res.thrown}: ${res.err.slice(0, 300)}`],
        [
          /^✓ .* pass {2}3 blocks$/m.test(res.out),
          `expected one passing cell of 3 blocks, got ${res.out.slice(0, 300)}`,
        ],
      ]);
    },
  });

  v({
    slug: 'schema-1-bundle-imports',
    tier: 2,
    component: BUNDLE,
    source: 'contract',
    title:
      'packages/store/src/bundle.ts (a bundle of an older schema is read): a bundle in the schema 1 format of commit 1b0d48bf, without specs or sources, imports its campaign and runs equal',
    cause: 'readCampaignBundle reads a schema 1 bundle',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-bundle-1');
      const base = await baseRun(ctx.seed, 'v-bundle-1');
      const runs = [0, 1].map((i) => variant(base, `r-${i}`));
      const campaign = campaignOf(`c-oldb-${ctx.seed % 100}`, base);
      const folder = schemaOneBundle(dir, campaign, runs);
      const path = join(dir, 'target.sqlite');
      return withStore(path, async (store) => {
        const kind = kindOf(await caught(store.importCampaign(folder)));
        const back = await store.getCampaign(campaign.campaignId);
        const stored = await store.listRuns({ campaignId: campaign.campaignId });
        return expectAll([
          [kind === 'no error', `expected the schema 1 bundle to import, got ${kind}`],
          [same(back, campaign), 'expected the campaign back equal'],
          [
            same(stored.map((r) => r.runId).sort(), ['r-0', 'r-1']) &&
              stored.every((r) =>
                same(
                  r,
                  runs.find((x) => x.runId === r.runId),
                ),
              ),
            'expected both runs back equal',
          ],
        ]);
      });
    },
  });

  v({
    slug: 'schema-2-bundle-without-sources',
    tier: 3,
    component: BUNDLE,
    source: 'contract',
    title:
      "packages/store/src/bundle.ts: a schema 2 bundle of the format between commits bde59fc6 and b23ac340 (the campaign records its sources, the bundle carries no sources folder) imports and keeps the campaign's sources field",
    cause: 'readCampaignBundle reads a schema 2 bundle written before bundles carried sources',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-bundle-2');
      const base = await baseRun(ctx.seed, 'v-bundle-2');
      const campaign = campaignOf(`c-old2-${ctx.seed % 100}`, base, {
        sources: [{ kind: 'dataset', name: 'old-ds', version: 1, hash: sha256(`old-ds-${ctx.seed}`) }],
      });
      const folder = schemaOneBundle(dir, campaign, [variant(base, 'r-0')], 2);
      const path = join(dir, 'target.sqlite');
      return withStore(path, async (store) => {
        const kind = kindOf(await caught(store.importCampaign(folder)));
        const back = await store.getCampaign(campaign.campaignId);
        return expectAll([
          [kind === 'no error', `expected the old schema 2 bundle to import, got ${kind}`],
          [
            same(back?.sources, campaign.sources),
            `expected the campaign's sources kept, got ${show(back?.sources)}`,
          ],
        ]);
      });
    },
  });

  v({
    slug: 'schema-1-bundle-status-named',
    tier: 3,
    component: CLI_CAMPAIGN,
    source: 'contract',
    title:
      'docs/running.md "Exit codes": campaign status of a campaign imported from a schema 1 bundle, which carried no specs, refuses with exit 2 and a message naming the missing spec, never a crash',
    cause: 'campaign status names the missing spec of a campaign imported from an old bundle',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-bundle-status');
      const base = await baseRun(ctx.seed, 'v-bundle-status');
      const campaign = campaignOf(`c-olds-${ctx.seed % 100}`, base);
      const folder = schemaOneBundle(dir, campaign, [variant(base, base.runId)]);
      const path = join(dir, 'target.sqlite');
      await withStore(path, (store) => store.importCampaign(folder));
      const res = await cli(['campaign', 'status', campaign.campaignId, '--store', path], dir);
      return expectAll([
        [res.thrown === undefined, `expected an exit code, the command threw ${res.thrown}`],
        [res.code === 2, `expected exit 2, got ${res.code}`],
        [
          res.err.includes(base.specId),
          `expected the message to name spec ${base.specId}, got ${res.err.slice(0, 200)}`,
        ],
      ]);
    },
  });

  v({
    slug: 'old-spec-steps',
    tier: 1,
    component: LOAD,
    source: 'contract',
    title:
      'docs/reference/spec.md ("An unknown key is an error"): a spec file written before commit 331e1267, with `steps` for the stage catalogue, is refused with an error naming steps, never a throw',
    cause: 'the spec loader names the renamed key steps of an old spec',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-steps');
      const file = oldSpecFile(dir, 'old-steps', {
        id: 'old-steps',
        kind: 'conversation',
        channel: 'chat',
        lang: 'EN',
        steps: ['open', 'close'],
        blocks: [{ user: 'Hello', expect: { must: ['R-\\d{4}'] } }],
      });
      const res = await loadIssues(file);
      return expectAll([
        [res.threw === undefined, `expected a load result, the loader threw ${res.threw}`],
        [
          res.ok === false && /steps/.test(res.text),
          `expected a refusal naming steps, got ${res.ok ? 'accepted' : res.text}`,
        ],
      ]);
    },
  });

  v({
    slug: 'old-spec-expect-step',
    tier: 1,
    component: LOAD,
    source: 'contract',
    title:
      'docs/reference/spec.md ("An unknown key is an error"): a block of an old spec with expect.step (now expect.stage) is refused with an error naming step, never a throw',
    cause: 'the spec loader names the renamed key expect.step of an old spec',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-step');
      const file = oldSpecFile(dir, 'old-step', {
        id: 'old-step',
        kind: 'conversation',
        channel: 'chat',
        lang: 'EN',
        blocks: [{ user: 'Hello', expect: { step: 'open' } }],
      });
      const res = await loadIssues(file);
      return expectAll([
        [res.threw === undefined, `expected a load result, the loader threw ${res.threw}`],
        [
          res.ok === false && /\bstep\b/.test(res.text),
          `expected a refusal naming step, got ${res.ok ? 'accepted' : res.text}`,
        ],
      ]);
    },
  });

  v({
    slug: 'old-spec-step-after',
    tier: 2,
    component: LOAD,
    source: 'contract',
    title:
      'docs/reference/spec.md ("An unknown key is an error"): an old perturbation with recovery.step_after (now stage_after) is refused with an error naming step_after, never a throw',
    cause: 'the spec loader names the renamed key recovery.step_after of an old spec',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-step-after');
      const file = oldSpecFile(dir, 'old-step-after', {
        id: 'old-step-after',
        kind: 'conversation',
        channel: 'chat',
        lang: 'EN',
        blocks: [{ user: 'Hello' }, { user: 'Next' }],
        perturbations: [
          {
            id: 'aside',
            class: 'D1_off_topic',
            inject_at: 1,
            user: 'What time is it?',
            recovery: { within_blocks: 1, step_after: 'open' },
          },
        ],
      });
      const res = await loadIssues(file);
      return expectAll([
        [res.threw === undefined, `expected a load result, the loader threw ${res.threw}`],
        [
          res.ok === false && /step_after/.test(res.text),
          `expected a refusal naming step_after, got ${res.ok ? 'accepted' : res.text}`,
        ],
      ]);
    },
  });

  v({
    slug: 'old-spec-rules-custom',
    tier: 2,
    component: LOAD,
    source: 'contract',
    title:
      'packages/core/src/schema/spec.ts history (rules.custom was a reserved free map in phase 0): an old spec with rules.custom loads or is refused with a named error, never a throw',
    cause: 'the spec loader reads an old rules.custom map without throwing',
    async check(ctx) {
      const dir = folderFor(ctx, 'v-custom');
      const file = oldSpecFile(dir, 'old-custom', {
        id: 'old-custom',
        kind: 'conversation',
        channel: 'chat',
        lang: 'EN',
        blocks: [{ user: 'Hello' }],
        rules: { custom: { reserved_check: { note: 'planned' } } },
      });
      const res = await loadIssues(file);
      return expectAll([
        [res.threw === undefined, `expected a load result, the loader threw ${res.threw}`],
        [
          res.ok === true || /custom/.test(res.text),
          `expected the spec to load or a refusal naming custom, got ${res.text}`,
        ],
      ]);
    },
  });

  v({
    slug: 'floors-v1-read',
    tier: 1,
    component: FLOORS,
    source: 'contract',
    title:
      'docs/validators.md "Floors" (a format version 1 file is read as ladder version 1 throughout): the floors file of commit 9d7c734d reads with each floor and its evidence at ladder version 1',
    cause: 'readFloors migrates a format version 1 file to ladder version 1',
    async check(ctx) {
      const root = floorsRoot(ctx, 'v-floors-read', FLOORS_V1);
      const read = await caught(async () => {
        const file = readFloors(root);
        if (!same(file.floors, { judges: 7, stats: 1 })) throw new Error(`floors ${show(file.floors)}`);
        if (!same(file.ladderVersion, { judges: 1, stats: 1 }))
          throw new Error(`ladderVersion ${show(file.ladderVersion)}`);
        if (file.evidence?.judges?.ladderVersion !== 1 || file.evidence?.stats?.ladderVersion !== 1)
          throw new Error('evidence not at ladder version 1');
      });
      return read === undefined ? PASS : fail(`expected floors 7 and 1 at ladder version 1, ${kindOf(read)}`);
    },
  });

  v({
    slug: 'floors-v1-empty',
    tier: 1,
    component: FLOORS,
    source: 'contract',
    title:
      'docs/validators.md "Floors": the first floors file (commit 923ed828, format version 1, no floor) reads as a file holding no floor',
    cause: 'readFloors reads an empty format version 1 file',
    async check(ctx) {
      const root = floorsRoot(ctx, 'v-floors-empty', FLOORS_V1_EMPTY);
      const read = await caught(async () => {
        const file = readFloors(root);
        if (Object.keys(file.floors).length !== 0) throw new Error(`floors ${show(file.floors)}`);
      });
      return read === undefined ? PASS : fail(`expected no floor, ${kindOf(read)}`);
    },
  });

  v({
    slug: 'floors-v1-written-back',
    tier: 2,
    component: FLOORS,
    source: 'contract',
    title:
      'docs/validators.md "Floors": a format version 1 file read and written back (as validate floors --raise does) reads again with the same floors and evidence',
    cause: 'writeFloors writes a migrated version 1 file that reads back',
    async check(ctx) {
      const root = floorsRoot(ctx, 'v-floors-back', FLOORS_V1);
      const first = readFloors(root);
      writeFloors(root, first);
      const again = await caught(async () => {
        const second = readFloors(root);
        if (!same(second, first)) throw new Error(`read back ${show(second)}`);
      });
      return again === undefined
        ? PASS
        : fail(`expected the written file to read back equal, ${kindOf(again)}`);
    },
  });

  v({
    slug: 'floors-v1-evidence-without-floor',
    tier: 3,
    component: FLOORS,
    source: 'contract',
    title:
      'docs/validators.md "Floors" (a format version 1 file is read as ladder version 1 throughout): a version 1 file whose evidence names a component without a floor, valid in format 1, still reads after it is written back',
    cause:
      'migrateFloors gives a ladder version only to components with a floor, so a version 1 file with evidence for a component without one is written back unreadable',
    async check(ctx) {
      const v1 = JSON.parse(FLOORS_V1) as {
        version: 1;
        floors: Record<string, number>;
        evidence: Record<string, unknown>;
      };
      const text = JSON.stringify(
        { version: 1, floors: { judges: v1.floors.judges }, evidence: v1.evidence },
        null,
        2,
      );
      const root = floorsRoot(ctx, 'v-floors-orphan', text);
      const first = await caught(async () => {
        readFloors(root);
      });
      if (first !== undefined) return fail(`expected the version 1 file to read, ${kindOf(first)}`);
      writeFloors(root, readFloors(root));
      const again = await caught(async () => {
        readFloors(root);
      });
      return again === undefined
        ? PASS
        : fail(`expected the written-back file to read, it is refused: ${kindOf(again)}`);
    },
  });

  v({
    slug: 'floors-v1-raise-new-version',
    tier: 3,
    component: FLOORS,
    source: 'contract',
    title:
      'docs/validators.md "Floors" (a ladder version above the file\'s starts a new floor and moves the earlier one to history): raising stats to ladder version 2 on the version 1 file keeps the version 1 floor in history and reads back',
    cause: 'raiseFloor moves a migrated version 1 floor to history',
    async check(ctx) {
      const root = floorsRoot(ctx, 'v-floors-raise', FLOORS_V1);
      const file = readFloors(root);
      const level = 1 + (ctx.seed % 3);
      const evidence = {
        component: 'stats',
        ladderVersion: 2,
        level,
        top: 5,
        seeds: [
          { seed: 1, hidden: false, level },
          { seed: 777, hidden: true, level },
        ],
        hiddenSeed: { seed: 777, source: 'head', head: 'a'.repeat(40) },
      };
      const raised = raiseFloor(file, {
        component: 'stats',
        level,
        evidence,
        top: 5,
        ladderVersion: 2,
        registeredVersion: 2,
      });
      if ('refused' in raised)
        return fail(`expected the raise to be accepted, it was refused: ${raised.refused}`);
      writeFloors(root, raised.file);
      const back = await caught(async () => {
        const read = readFloors(root);
        const history = read.history?.stats ?? [];
        if (read.ladderVersion.stats !== 2 || read.floors.stats !== level)
          throw new Error(`stats at ${read.ladderVersion.stats}/${read.floors.stats}`);
        if (history.length !== 1 || history[0]?.ladderVersion !== 1 || history[0]?.floor !== 1)
          throw new Error(`history ${show(history)}`);
      });
      return back === undefined
        ? PASS
        : fail(`expected stats at ladder version 2 with the version 1 floor in history, ${kindOf(back)}`);
    },
  });

  v({
    slug: 'floors-v1-migrate-equal',
    tier: 2,
    component: FLOORS,
    source: 'contract',
    title:
      'packages/validators/src/floors.ts migrateFloors: the migration of the version 1 file is itself a valid version 2 file with the same floors',
    cause: 'migrateFloors gives a valid version 2 file for the floors file of commit 9d7c734d',
    async check(ctx) {
      const root = floorsRoot(
        ctx,
        'v-floors-migrate',
        JSON.stringify(migrateFloors(JSON.parse(FLOORS_V1)), null, 2),
      );
      const read = await caught(async () => {
        const file = readFloors(root);
        if (file.version !== 2 || !same(file.floors, { judges: 7, stats: 1 }))
          throw new Error(`read ${show(file)}`);
      });
      return read === undefined
        ? PASS
        : fail(`expected the migrated file to read as version 2, ${kindOf(read)}`);
    },
  });

  return out;
}

/* ------------------------------------------------------------------------------------------------ */

export function robustItems(): BankItem[] {
  return [...concurrencyItems(), ...resumeItems(), ...transferItems(), ...versionItems()];
}
