import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/** Fictional data only: the Acme sales assistant and a campaign record another process writes. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'examples/acme/specs/conversations/plan-upgrade.yaml';

const HOLDER = `import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [path, file, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('BEGIN IMMEDIATE');
for (const [sql, params] of JSON.parse(readFileSync(file, 'utf8'))) db.prepare(sql).run(...params);
console.log('ready');
setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(holdMs));
`;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  try {
    return { code: await main(argv, io), out, err };
  } catch (cause) {
    return { code: undefined, out, err, thrown: cause instanceof Error ? cause.message : String(cause) };
  }
}

describe('campaign run when another process stores the same campaign id meanwhile', () => {
  it('exits 2, as for an id the store already held, and files no run under the other campaign', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-race-'));
    made.push(dir);
    const path = join(dir, 'store.sqlite');
    // Warm the command line and the Acme agent on another store, so the race below times the store calls.
    expect(
      (await cli(['campaign', 'run', SPEC, '--target', 'function:acme', '--store', join(dir, 'warm.sqlite')]))
        .code,
    ).toBe(0);
    await openStore(path).close();
    const other = {
      campaignId: 'c-same',
      specs: [{ id: 'acme-other', hash: 'abc123abc123' }],
      targets: [{ adapter: 'function', agent: 'acme' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-12T00:00:00.000Z',
    };
    await writeFile(join(dir, 'holder.mjs'), HOLDER);
    await writeFile(
      join(dir, 'statements.json'),
      JSON.stringify([
        [
          'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?)',
          ['c-same', JSON.stringify(other), other.createdAt],
        ],
      ]),
    );
    const child = spawn(
      process.execPath,
      [join(dir, 'holder.mjs'), path, join(dir, 'statements.json'), '1500'],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const ended = new Promise<number | null>((resolve) => child.on('exit', resolve));
    const result = await new Promise<Awaited<ReturnType<typeof cli>>>((resolve) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('ready')) {
          void cli([
            'campaign',
            'run',
            SPEC,
            '--target',
            'function:acme',
            '--campaign',
            'c-same',
            '--store',
            path,
          ]).then(resolve);
        }
      });
    });
    expect(await ended).toBe(0);
    expect(result).not.toHaveProperty('thrown');
    expect(result.code).toBe(2);
    expect(result.err).toContain('Campaign c-same already exists.');
    const store = openStore(path);
    try {
      expect(await store.listRuns({ campaignId: 'c-same' })).toEqual([]);
    } finally {
      await store.close();
    }
  }, 60_000);
});
