import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, type SqliteStore } from '../src/index';
import { sha256 } from '../src/registry';
import { campaign, observed, storeError, tempDir } from './fixtures';

/**
 * Another process writes to the same store file between this store's check and its write: the holder opens
 * a write transaction, runs its statements, says "ready", holds the lock for a while, then commits. The
 * store call starts on "ready", so its check sees the store before the holder's commit and its write waits
 * for the lock. Fictional data only.
 */
const HOLDER = `import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [path, file, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('BEGIN IMMEDIATE');
for (const [sql, params] of JSON.parse(readFileSync(file, 'utf8'))) {
  db.prepare(sql).run(...params.map((p) => (p && typeof p === 'object' ? Buffer.from(p.hex, 'hex') : p)));
}
console.log('ready');
setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(holdMs));
`;

type Param = string | number | null | { hex: string };

let dir: string;
let path: string;
let store: SqliteStore;

beforeEach(async () => {
  dir = await tempDir();
  path = join(dir, 'store.sqlite');
  store = openStore(path);
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

/** Runs `act` while another process holds a write transaction that ran `statements`; both must end. */
async function whileHeld<T>(statements: [string, Param[]][], act: () => Promise<T>) {
  const script = join(dir, 'holder.mjs');
  const file = join(dir, 'statements.json');
  await writeFile(script, HOLDER);
  await writeFile(file, JSON.stringify(statements));
  const child = spawn(process.execPath, [script, path, file, '400'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (chunk) => {
    err += String(chunk);
  });
  const outcome = new Promise<{ value?: T; error?: unknown }>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('ready')) {
        act().then(
          (value) => resolve({ value }),
          (error: unknown) => resolve({ error }),
        );
      }
    });
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`the holder exited ${code}: ${err}`));
    });
  });
  const ended = new Promise<number | null>((resolve) => child.on('exit', resolve));
  const result = await outcome;
  expect(await ended).toBe(0);
  return result;
}

describe('a store and another process writing the same rows', () => {
  it('putCampaign of a campaign another process commits meanwhile with the same content succeeds, and keeps one', async () => {
    const record = campaign('c-race-equal');
    const { error } = await whileHeld(
      [
        [
          'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
          [record.campaignId, JSON.stringify(record), '2026-10-12T00:00:00.000Z'],
        ],
      ],
      () => store.putCampaign(record),
    );
    expect(error).toBeUndefined();
    expect((await store.listCampaigns()).map((each) => each.campaignId)).toEqual(['c-race-equal']);
  });

  it('putCampaign of other content than the campaign committed meanwhile raises CAMPAIGN_CONFLICT, not a raw SQLite error', async () => {
    const theirs = campaign('c-race-other');
    const mine = campaign('c-race-other', { budgetUsd: theirs.budgetUsd + 1 });
    const { error } = await whileHeld(
      [
        [
          'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
          [theirs.campaignId, JSON.stringify(theirs), '2026-10-12T00:00:00.000Z'],
        ],
      ],
      () => store.putCampaign(mine),
    );
    const failure = await storeError(() => {
      throw error;
    });
    expect(failure.code).toBe('CAMPAIGN_CONFLICT');
  });

  it('cacheGet that finds an expired entry never deletes the fresh one another process put meanwhile', async () => {
    await store.cachePut('k-race', observed('Old reference R-1000'), 0);
    const fresh = observed('Fresh reference R-2000');
    const { error } = await whileHeld(
      [
        [
          `INSERT INTO cache (key, observed_json, created_at, expires_at) VALUES (?, ?, ?, NULL)
           ON CONFLICT (key) DO UPDATE SET observed_json = excluded.observed_json, created_at = excluded.created_at, expires_at = NULL`,
          ['k-race', JSON.stringify(fresh), '2026-10-12T00:00:00.000Z'],
        ],
      ],
      () => store.cacheGet('k-race'),
    );
    expect(error).toBeUndefined();
    expect((await store.cacheGet('k-race'))?.text).toBe(fresh.text);
  });

  it('pushVersion of content another process commits meanwhile gives back version 1, created false', async () => {
    const bytes = new TextEncoder().encode('id: race\n# R-1001\n');
    const entries = [{ path: 'a.yaml', sha256: sha256(bytes), size: bytes.byteLength }];
    const hash = sha256(new TextEncoder().encode(canonicalJson(entries)));
    const record = {
      kind: 'dataset',
      name: 'race-ds',
      version: 1,
      hash,
      files: entries,
      createdAt: '2026-10-12T00:00:00.000Z',
    };
    const { value, error } = await whileHeld(
      [
        [
          'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
          [entries[0]?.sha256 ?? '', bytes.byteLength, { hex: Buffer.from(bytes).toString('hex') }],
        ],
        [
          'INSERT INTO versions (kind, name, version, hash, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['dataset', 'race-ds', 1, hash, JSON.stringify(record), record.createdAt],
        ],
      ],
      () => store.pushVersion('dataset', 'race-ds', [{ path: 'a.yaml', bytes }]),
    );
    expect(error).toBeUndefined();
    expect(value?.version.version).toBe(1);
    expect(value?.created).toBe(false);
    expect((await store.listVersions('dataset', 'race-ds')).map((each) => each.version)).toEqual([1]);
  });
});
