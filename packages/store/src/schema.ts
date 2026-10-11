/**
 * The version of the store's tables and of the export bundle. Opening a database or reading a bundle
 * written by a newer version fails with a clear error; an older database is upgraded on open.
 */
export const SCHEMA_VERSION = 1;

/**
 * The tables. Each row keeps its record as JSON; the plain columns are copies of record fields, kept
 * for filters and for SQL read by hand. A run's blocks live in `blocks`, one row per block, and the
 * run's own JSON holds everything else. Times are ISO 8601 text in UTC.
 *
 * Runs are keyed by campaign and run id: a run id is a cell id, which leaves the campaign out, so the
 * same cell run in two campaigns gives two rows.
 *
 * `specs.yaml` holds the canonical JSON of the normalised spec, which any YAML 1.2 parser reads; its
 * SHA-256 starts with the spec hash.
 */
export const SCHEMA_SQL = `
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
