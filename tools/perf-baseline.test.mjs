import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compare,
  maskClock,
  quantile,
  runNode,
  summarize,
  table,
  treeHash,
  writeProbe,
} from './perf-baseline.mjs';

let folder;
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'perf-baseline-'));
  writeProbe();
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('perf-baseline statistics', () => {
  it('interpolates quantiles and reports the spread around the median', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(quantile([10], 0.75)).toBe(10);
    expect(summarize([100, 110, 120, 130, 400])).toEqual({
      median: 120,
      p25: 110,
      p75: 130,
      min: 100,
      max: 400,
      spread_pct: 16.67,
      runs: 5,
    });
  });

  it('hashes a folder by path and content, in an order that does not depend on the file system', () => {
    const one = join(folder, 'one');
    const two = join(folder, 'two');
    for (const [root, order] of [
      [one, ['b.txt', 'a/c.txt']],
      [two, ['a/c.txt', 'b.txt']],
    ]) {
      for (const name of order) {
        mkdirSync(join(root, name, '..'), { recursive: true });
        writeFileSync(join(root, name), `content of ${name}`);
      }
    }
    expect(treeHash(one)).toEqual(treeHash(two));
    expect(treeHash(one).files).toBe(2);
    writeFileSync(join(two, 'b.txt'), 'content of b.txt.');
    expect(treeHash(two).sha256).not.toBe(treeHash(one).sha256);
    expect(treeHash(two, { skip: ['b.txt'] })).toEqual(treeHash(one, { skip: ['b.txt'] }));
    writeFileSync(
      join(one, 'b.txt'),
      'at 2026-01-02T03:04:05.678Z "latencyMs": 12, latency 12 ms, at most 900',
    );
    writeFileSync(
      join(two, 'b.txt'),
      'at 2026-01-02T03:04:09Z "latencyMs": 7.5, latency 7.5 ms, at most 900',
    );
    expect(treeHash(two, { mask: maskClock })).toEqual(treeHash(one, { mask: maskClock }));
    writeFileSync(
      join(two, 'b.txt'),
      'at 2026-01-02T03:04:09Z "latencyMs": 7.5, latency 7.5 ms, at most 901',
    );
    expect(treeHash(two, { mask: maskClock })).not.toEqual(treeHash(one, { mask: maskClock }));
  });
});

describe('perf-baseline probe', () => {
  it('counts reads, repeated reads, hashing, JSON parses, writes and child processes of a process', () => {
    const data = join(folder, 'data.json');
    const script = join(folder, 'work.mjs');
    writeFileSync(data, '{"plan":"Acme Mobile S"}');
    writeFileSync(
      script,
      `import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const file = process.argv[2];
const first = readFileSync(file, 'utf8');
await readFile(file, 'utf8');
JSON.parse(first);
createHash('sha256').update('abc').update('de').digest('hex');
writeFileSync(file + '.out', 'four');
execFileSync(process.execPath, ['-e', '']);
process.stdout.write('done');
`,
    );
    const run = runNode([script, data], { probe: 'full' });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('done');
    expect(run.report.counts).toMatchObject({
      modules_workspace: 1,
      file_reads: 2,
      file_reads_distinct: 1,
      file_read_bytes: 48,
      file_writes: 1,
      file_write_bytes: 4,
      hash_objects: 1,
      hash_bytes: 5,
      json_parse_calls: 1,
      child_processes: 1,
      network_connections: 0,
    });
  });

  it('reports only the clock and memory in light mode, and nothing without a probe', () => {
    const light = runNode(['-e', ''], { probe: 'light' });
    expect(light.report.counts).toBeUndefined();
    expect(light.report.max_rss_mb).toBeGreaterThan(0);
    expect(runNode(['-e', '']).report).toBeUndefined();
  });

  it('gives a measured process no key from the environment', () => {
    process.env.ACME_TEST_API_KEY = 'fictional';
    try {
      const run = runNode(['-e', 'process.stdout.write(String(process.env.ACME_TEST_API_KEY))']);
      expect(run.stdout).toBe('undefined');
    } finally {
      delete process.env.ACME_TEST_API_KEY;
    }
  });
});

describe('perf-baseline tables', () => {
  const row = (modules, stdout) => ({
    name: 'cli-help',
    exit_code: 0,
    wall_ms: { median: 100, p25: 90, p75: 110, spread_pct: 20 },
    cpu_ms: { median: 80 },
    max_rss_mb: { median: 50 },
    counts: { modules, file_reads: 3, file_reads_distinct: 2, hash_objects: 1, hash_bytes: 2048 },
    counts_stable: true,
    output_stable: true,
    outputs: { stdout_sha256: stdout },
  });

  it('prints one line per row', () => {
    const lines = table({ rows: [row(10, 'a')] });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(
      /^\| cli-help +\| 100 +\| 90 to 110 +\| 20 +\| 80 +\| 50 +\| 10 +\| 3 +\| 1 +\| 1 +\| 2 /,
    );
  });

  it('marks a row whose output changed between two documents', () => {
    const same = compare({ rows: [row(10, 'a')] }, { rows: [row(4, 'a')] });
    expect(same[2]).toContain('10 to 4 (-60.0%)');
    expect(same[2]).toContain('identical');
    expect(compare({ rows: [row(10, 'a')] }, { rows: [row(10, 'b')] })[2]).toContain('CHANGED');
  });
});
