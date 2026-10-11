import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import {
  Campaign,
  type CostUnit,
  canonicalJson,
  type LoadedSpec,
  Observed,
  type RunFilter,
  RunResult,
  type Store,
  validateSpec,
} from '@driftbench/core';
import { type CampaignBundle, readCampaignBundle, writeCampaignBundle } from './bundle';
import { describeCause, describeIssues, StoreError } from './errors';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { loadSqlite } from './sqlite';
import { unitProblems } from './units';

type Row = Record<string, unknown>;

/** The latest moment a JavaScript Date can hold, in milliseconds. */
const MAX_DATE_MS = 8.64e15;

/**
 * Opens (or creates) the store at a file path, creating the parent folder when it is missing.
 * Needs Node.js 22.13 or newer for `node:sqlite`; an older Node.js gets a `NODE_VERSION` error.
 */
export function openStore(path: string): SqliteStore {
  const { DatabaseSync } = loadSqlite();
  let db: DatabaseSync | undefined;
  try {
    if (path !== ':memory:' && !path.startsWith('file:')) mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    setUp(db, path);
  } catch (cause) {
    closeQuietly(db);
    if (cause instanceof StoreError) throw cause;
    throw new StoreError('OPEN_FAILED', `cannot open the store at ${path}: ${describeCause(cause)}`, {
      cause,
    });
  }
  return new SqliteStore(db, path);
}

/** A store held in memory, with the same tables and the same behaviour. Its content goes with `close`. */
export function openMemoryStore(): SqliteStore {
  return openStore(':memory:');
}

function setUp(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      'SCHEMA_VERSION',
      `the store at ${path} has schema version ${version}; this version of driftbench reads ${SCHEMA_VERSION} and older`,
    );
  }
  if (version < SCHEMA_VERSION) {
    transaction(db, () => {
      db.exec(SCHEMA_SQL);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }
}

/** Closes a database that failed to set up. The setup error is the one the caller reports. */
function closeQuietly(db: DatabaseSync | undefined): void {
  try {
    db?.close();
  } catch {
    // Already closed, or never opened: nothing is left to release.
  }
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = work();
    db.exec('COMMIT');
    return out;
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite already rolled back on its own; the error worth reporting is the one that caused it.
    }
    throw cause;
  }
}

function statements(db: DatabaseSync) {
  return {
    upsertSpec: db.prepare(
      `INSERT INTO specs (id, hash, path, yaml, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id, hash) DO UPDATE SET path = excluded.path, yaml = excluded.yaml`,
    ),
    selectSpec: db.prepare('SELECT path, yaml FROM specs WHERE id = ? AND hash = ?'),
    insertCampaign: db.prepare('INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)'),
    selectCampaign: db.prepare('SELECT id, json FROM campaigns WHERE id = ?'),
    deleteBlocks: db.prepare('DELETE FROM blocks WHERE campaign_id = ? AND run_id = ?'),
    deleteRun: db.prepare('DELETE FROM runs WHERE campaign_id = ? AND run_id = ?'),
    insertRun: db.prepare(
      `INSERT INTO runs (campaign_id, run_id, spec_id, spec_hash, target_json, mode, repeat, perturbation_id,
         status, cost, started_at, finished_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertBlock: db.prepare(
      `INSERT INTO blocks (campaign_id, run_id, "index", given_hash, observed_json, verdicts_json, drift_json,
         pass, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectRun: db.prepare('SELECT campaign_id, run_id, json FROM runs WHERE campaign_id = ? AND run_id = ?'),
    selectRunsById: db.prepare(
      'SELECT campaign_id, run_id, json FROM runs WHERE run_id = ? ORDER BY campaign_id',
    ),
    selectBlocks: db.prepare(
      `SELECT "index", observed_json, verdicts_json, drift_json, json FROM blocks
       WHERE campaign_id = ? AND run_id = ? ORDER BY "index"`,
    ),
    upsertCache: db.prepare(
      `INSERT INTO cache (key, observed_json, created_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET observed_json = excluded.observed_json, created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ),
    selectCache: db.prepare('SELECT observed_json, expires_at FROM cache WHERE key = ?'),
    deleteCache: db.prepare('DELETE FROM cache WHERE key = ?'),
    upsertUnit: db.prepare(
      `INSERT INTO units (adapter, metric, usd, samples, measured_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (adapter, metric) DO UPDATE SET usd = excluded.usd, samples = excluded.samples,
         measured_at = excluded.measured_at`,
    ),
    selectUnits: db.prepare(
      'SELECT adapter, metric, usd, samples, measured_at FROM units ORDER BY adapter, metric',
    ),
    selectUnitsOf: db.prepare(
      'SELECT adapter, metric, usd, samples, measured_at FROM units WHERE adapter = ? ORDER BY metric',
    ),
  } satisfies Record<string, StatementSync>;
}

/**
 * The SQLite store. Every write validates its record before it touches a table; every read
 * validates the record it rebuilt, so a corrupt row raises a `CORRUPT_ROW` error, never a bad value.
 */
export class SqliteStore implements Store {
  /** The database path, or `:memory:`. */
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly sql: ReturnType<typeof statements>;
  private closed = false;

  constructor(db: DatabaseSync, path: string) {
    this.db = db;
    this.path = path;
    this.sql = statements(db);
  }

  async putSpec(spec: LoadedSpec): Promise<void> {
    this.live();
    if (spec?.ok !== true) throw new StoreError('INVALID_RECORD', 'putSpec takes a spec the loader accepted');
    const checked = validateSpec(spec.spec, spec.path);
    if (!checked.ok) {
      const errors = checked.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`);
      throw new StoreError('INVALID_RECORD', `putSpec refused an invalid spec: ${errors.join('; ')}`);
    }
    if (checked.hash !== spec.hash) {
      throw new StoreError(
        'INVALID_RECORD',
        `putSpec refused spec ${checked.spec.id}: its hash says ${spec.hash} but its content hashes to ${checked.hash}`,
      );
    }
    this.sql.upsertSpec.run(checked.spec.id, checked.hash, spec.path, canonicalJson(checked.spec), now());
  }

  async getSpec(id: string, hash: string): Promise<LoadedSpec | undefined> {
    this.live();
    const row = this.sql.selectSpec.get(id, hash);
    if (row === undefined) return undefined;
    const where = `the specs row ${id}@${hash}`;
    const loaded = validateSpec(parseColumn(row, 'yaml', where), text(row, 'path', where));
    if (!loaded.ok) {
      const errors = loaded.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`);
      throw corrupt(`${where} does not hold a valid spec: ${errors.join('; ')}`);
    }
    if (loaded.spec.id !== id || loaded.hash !== hash) {
      throw corrupt(`${where} holds spec ${loaded.spec.id}@${loaded.hash}`);
    }
    return loaded;
  }

  async putCampaign(campaign: Campaign): Promise<void> {
    this.live();
    this.putCampaignNow(campaign);
  }

  async getCampaign(campaignId: string): Promise<Campaign | undefined> {
    this.live();
    const row = this.sql.selectCampaign.get(campaignId);
    return row === undefined ? undefined : readCampaign(row);
  }

  /** Stores a run under a campaign. A run put again under the same campaign and run id replaces the first. */
  async putRun(campaignId: string, run: RunResult): Promise<void> {
    this.live();
    transaction(this.db, () => this.putRunNow(campaignId, run));
  }

  /**
   * Reads one run. A run id is a cell id, so two campaigns can hold the same one: pass the campaign
   * id to pick, or the call raises `RUN_AMBIGUOUS` when the id is in more than one campaign.
   */
  async getRun(runId: string, campaignId?: string): Promise<RunResult | undefined> {
    this.live();
    if (campaignId !== undefined) {
      const row = this.sql.selectRun.get(campaignId, runId);
      return row === undefined ? undefined : this.readRun(row);
    }
    const rows = this.sql.selectRunsById.all(runId);
    const [row] = rows;
    if (row === undefined) return undefined;
    if (rows.length > 1) {
      const campaigns = rows.map((each) => String(each.campaign_id)).join(', ');
      throw new StoreError(
        'RUN_AMBIGUOUS',
        `run ${runId} is in ${rows.length} campaigns (${campaigns}); pass the campaign id to getRun, or list one campaign's runs`,
      );
    }
    return this.readRun(row);
  }

  /** Lists runs, oldest start first, filtered by campaign, spec, mode and status when the filter sets them. */
  async listRuns(filter: RunFilter = {}): Promise<RunResult[]> {
    this.live();
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    for (const [column, value] of [
      ['campaign_id', filter.campaignId],
      ['spec_id', filter.specId],
      ['mode', filter.mode],
      ['status', filter.status],
    ] as const) {
      if (value === undefined) continue;
      clauses.push(`${column} = ?`);
      params.push(value);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare(`SELECT campaign_id, run_id, json FROM runs${where} ORDER BY started_at, campaign_id, run_id`)
      .all(...params);
    return rows.map((row) => this.readRun(row));
  }

  async cacheGet(key: string): Promise<Observed | undefined> {
    this.live();
    const row = this.sql.selectCache.get(key);
    if (row === undefined) return undefined;
    const where = `the cache row ${key}`;
    if (row.expires_at !== null) {
      const expiresAt = Date.parse(text(row, 'expires_at', where));
      if (Number.isNaN(expiresAt)) throw corrupt(`${where} holds an expiry that is not a date`);
      if (Date.now() >= expiresAt) {
        this.sql.deleteCache.run(key);
        return undefined;
      }
    }
    const parsed = Observed.safeParse(parseColumn(row, 'observed_json', where));
    if (!parsed.success) {
      throw corrupt(`${where} does not match the Observed schema: ${describeIssues(parsed.error.issues)}`);
    }
    return parsed.data;
  }

  /** Caches an Observed. Without a ttl the entry stays until replaced; with one it is gone `ttlMs` after the put. */
  async cachePut(key: string, observed: Observed, ttlMs?: number): Promise<void> {
    this.live();
    if (typeof key !== 'string' || key === '') throw new StoreError('INVALID_RECORD', 'cachePut needs a key');
    const parsed = Observed.safeParse(observed);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `cachePut refused an invalid Observed: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const at = Date.now();
    let expiresAt: string | null = null;
    if (ttlMs !== undefined) {
      if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs < 0 || at + ttlMs > MAX_DATE_MS) {
        throw new StoreError(
          'INVALID_RECORD',
          `cachePut needs a ttl of 0 or more milliseconds within the date range, or none to keep the entry; got ${ttlMs}`,
        );
      }
      expiresAt = new Date(at + ttlMs).toISOString();
    }
    this.sql.upsertCache.run(
      key,
      toJson(parsed.data, `the Observed for cache key ${key}`),
      new Date(at).toISOString(),
      expiresAt,
    );
  }

  /** Keeps one unit per adapter and metric: a new measurement replaces the old one. */
  async putUnit(unit: CostUnit): Promise<void> {
    this.live();
    const problems = unitProblems(unit);
    if (problems.length > 0) {
      throw new StoreError('INVALID_RECORD', `putUnit refused an invalid unit: ${problems.join('; ')}`);
    }
    this.sql.upsertUnit.run(unit.adapter, unit.metric, unit.usd, unit.samples ?? null, unit.measuredAt);
  }

  /** Lists units sorted by adapter and metric, for one adapter when it is given. */
  async listUnits(adapter?: string): Promise<CostUnit[]> {
    this.live();
    const rows = adapter === undefined ? this.sql.selectUnits.all() : this.sql.selectUnitsOf.all(adapter);
    return rows.map((row) => {
      const unit: Row = {
        adapter: row.adapter,
        metric: row.metric,
        usd: row.usd,
        measuredAt: row.measured_at,
      };
      if (row.samples !== null) unit.samples = row.samples;
      const problems = unitProblems(unit);
      if (problems.length > 0) {
        throw corrupt(
          `the units row ${String(row.adapter)}/${String(row.metric)} is invalid: ${problems.join('; ')}`,
        );
      }
      return unit as CostUnit;
    });
  }

  /**
   * Writes `<dir>/<campaignId>/` with `campaign.json`, `runs/<runId>.json` and `manifest.json`, and
   * returns that folder. Ids that are not plain file names are percent-encoded.
   */
  async exportCampaign(campaignId: string, dir: string): Promise<string> {
    this.live();
    const campaign = await this.getCampaign(campaignId);
    if (campaign === undefined) {
      throw new StoreError('CAMPAIGN_MISSING', `exportCampaign: campaign ${campaignId} is not in the store`);
    }
    return writeCampaignBundle(dir, campaign, await this.listRuns({ campaignId }));
  }

  /**
   * Reads a folder `exportCampaign` wrote and stores its campaign and runs, all or nothing. The
   * campaign must be new to this store or equal to the one it holds. Returns what it read.
   */
  async importCampaign(folder: string): Promise<CampaignBundle> {
    this.live();
    const bundle = await readCampaignBundle(folder);
    this.live();
    transaction(this.db, () => {
      this.putCampaignNow(bundle.campaign);
      for (const run of bundle.runs) this.putRunNow(bundle.campaign.campaignId, run);
    });
    return bundle;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private live(): void {
    if (this.closed) throw new StoreError('CLOSED', `the store at ${this.path} is closed`);
  }

  private putCampaignNow(campaign: Campaign): void {
    const parsed = Campaign.safeParse(campaign);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `putCampaign refused an invalid Campaign: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const { campaignId } = parsed.data;
    const row = this.sql.selectCampaign.get(campaignId);
    if (row !== undefined) {
      if (canonicalJson(readCampaign(row)) === canonicalJson(parsed.data)) return;
      throw new StoreError(
        'CAMPAIGN_CONFLICT',
        `campaign ${campaignId} is already stored with other content; a campaign is immutable, so a re-run takes a new campaign id`,
      );
    }
    this.sql.insertCampaign.run(campaignId, toJson(parsed.data, `campaign ${campaignId}`), now());
  }

  private putRunNow(campaignId: string, run: RunResult): void {
    const parsed = RunResult.safeParse(run);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `putRun refused an invalid RunResult: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const { blocks, ...summary } = parsed.data;
    const what = `run ${summary.runId}`;
    let previous = -1;
    for (const block of blocks) {
      if (block.index <= previous) {
        throw new StoreError(
          'INVALID_RECORD',
          `putRun refused ${what}: block indexes must rise strictly, in order`,
        );
      }
      previous = block.index;
    }
    if (this.sql.selectCampaign.get(campaignId) === undefined) {
      throw new StoreError(
        'CAMPAIGN_MISSING',
        `putRun: campaign ${campaignId} is not in the store; put the campaign before its runs`,
      );
    }
    const rows = blocks.map((block) => {
      const { observed, verdicts, drift, ...rest } = block;
      const label = `${what} block ${block.index}`;
      return [
        campaignId,
        summary.runId,
        block.index,
        block.givenHash,
        toJson(observed, label),
        toJson(verdicts, label),
        toJson(drift, label),
        block.pass ? 1 : 0,
        toJson(rest, label),
      ] satisfies SQLInputValue[];
    });
    const runJson = toJson(summary, what);

    this.sql.deleteBlocks.run(campaignId, summary.runId);
    this.sql.deleteRun.run(campaignId, summary.runId);
    this.sql.insertRun.run(
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
      runJson,
    );
    for (const values of rows) this.sql.insertBlock.run(...values);
  }

  private readRun(row: Row): RunResult {
    const campaignId = String(row.campaign_id);
    const runId = String(row.run_id);
    const where = `the runs row ${campaignId}/${runId}`;
    const summary = parseObject(row, 'json', where);
    const blockRows = this.sql.selectBlocks.all(campaignId, runId);
    const blocks = blockRows.map((blockRow) => {
      const blockWhere = `the blocks row ${campaignId}/${runId}/${String(blockRow.index)}`;
      return {
        ...parseObject(blockRow, 'json', blockWhere),
        observed: parseColumn(blockRow, 'observed_json', blockWhere),
        verdicts: parseColumn(blockRow, 'verdicts_json', blockWhere),
        drift: parseColumn(blockRow, 'drift_json', blockWhere),
      };
    });
    const parsed = RunResult.safeParse({ ...summary, blocks });
    if (!parsed.success) {
      throw corrupt(`${where} does not match the RunResult schema: ${describeIssues(parsed.error.issues)}`);
    }
    if (parsed.data.runId !== runId) throw corrupt(`${where} holds run ${parsed.data.runId}`);
    parsed.data.blocks.forEach((block, i) => {
      if (block.index !== blockRows[i]?.index) {
        throw corrupt(`${where} has block row ${String(blockRows[i]?.index)} holding block ${block.index}`);
      }
    });
    return parsed.data;
  }
}

function readCampaign(row: Row): Campaign {
  const where = `the campaigns row ${String(row.id)}`;
  const parsed = Campaign.safeParse(parseColumn(row, 'json', where));
  if (!parsed.success) {
    throw corrupt(`${where} does not match the Campaign schema: ${describeIssues(parsed.error.issues)}`);
  }
  if (parsed.data.campaignId !== row.id) throw corrupt(`${where} holds campaign ${parsed.data.campaignId}`);
  return parsed.data;
}

function corrupt(message: string): StoreError {
  return new StoreError('CORRUPT_ROW', message);
}

function text(row: Row, column: string, where: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw corrupt(`${where} holds no text in column ${column}`);
  return value;
}

function parseColumn(row: Row, column: string, where: string): unknown {
  const value = text(row, column, where);
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new StoreError(
      'CORRUPT_ROW',
      `${where} holds corrupt JSON in column ${column}: ${describeCause(cause)}`,
      {
        cause,
      },
    );
  }
}

function parseObject(row: Row, column: string, where: string): Row {
  const value = parseColumn(row, column, where);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${where} holds no JSON object in column ${column}`);
  }
  return value as Row;
}

function toJson(value: unknown, what: string): string {
  try {
    return JSON.stringify(value);
  } catch (cause) {
    throw new StoreError('INVALID_RECORD', `${what} cannot be written as JSON: ${describeCause(cause)}`, {
      cause,
    });
  }
}

function now(): string {
  return new Date().toISOString();
}
