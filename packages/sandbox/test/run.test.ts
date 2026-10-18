import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { candidatePids, orphanPids, PROCESS_SCAN_TIMEOUT_MS, scanWorkingFolders } from '../src/process-scan';
import { runProcess } from '../src/run';

const scan = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawnSync: scan };
});

let root: string;
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
if (!platform) throw new Error('process.platform has no descriptor');
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'sandbox-scan-test-')));
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  scan.mockReset();
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const run = (args = ['-c', 'printf done'], timeoutMs = 5000) =>
  runProcess('/bin/sh', args, 'fictional command', {
    cwd: root,
    env: process.env,
    timeoutMs,
    maxOutputBytes: 1024,
  });

it('bounds a slow lsof and records that the cwd sweep was skipped', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  scan.mockImplementation((file, args, options) => {
    if (file === 'ps') return { status: 0, stdout: '101 1 00:00\n' };
    if (file !== 'lsof') return actual.spawnSync(file, args, options);
    // A real subprocess uses the production timeout options. Without a bound it lasts 1.8 seconds.
    return actual.spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1800)'], options);
  });
  const record = await run();
  expect(record.exitCode).toBe(0);
  expect(record.stdout).toBe('done');
  expect(record.stderr).toContain('cwd sweep skipped');
  expect(record.stderr).toContain('1000 ms');
  expect(vi.mocked(spawnSync).mock.calls.filter(([file]) => file === 'lsof')).toHaveLength(1);
});

it('asks lsof only about processes born since the sandbox folder, including reparented processes', async () => {
  scan.mockImplementation((file) =>
    file === 'ps'
      ? { status: 0, stdout: '101 1 00:00\n102 101 00:04\n103 1 01:00\n104 1 1-02:00:00\n' }
      : { status: 0, stdout: '' },
  );
  await run();
  expect(scan).toHaveBeenCalledWith(
    'lsof',
    ['-nP', '-a', '-d', 'cwd', '-Fpn', '-p', '101,102'],
    expect.objectContaining({ timeout: PROCESS_SCAN_TIMEOUT_MS, killSignal: 'SIGKILL' }),
  );
});

it('does not call lsof when there are no candidates', () => {
  scan.mockReturnValue({ status: 0, stdout: '101 1 1-02:00:00\n' });
  expect(scanWorkingFolders(candidatePids(root))).toEqual({ folders: [] });
  expect(scan).toHaveBeenCalledTimes(1);
});

it.each([
  { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: '' },
  { status: 0, stdout: '101 1 unknown-age\n' },
])('falls back to bounded host-wide lsof when ps cannot produce safe candidates: %j', async (ps) => {
  scan.mockImplementation((file) => (file === 'ps' ? ps : { status: 0, stdout: '' }));
  await run();
  expect(scan).toHaveBeenCalledWith(
    'lsof',
    ['-nP', '-a', '-d', 'cwd', '-Fpn'],
    expect.objectContaining({ timeout: PROCESS_SCAN_TIMEOUT_MS, killSignal: 'SIGKILL' }),
  );
});

it('preserves readable lsof entries on exit 1 but discards partial output after a timeout', () => {
  scan.mockReturnValue({ status: 1, stdout: `p101\nn${root}\np102\nn${root}/sub\n` });
  expect(scanWorkingFolders([101, 102]).folders).toEqual([
    { pid: 101, cwd: root },
    { pid: 102, cwd: `${root}/sub` },
  ]);
  scan.mockReturnValue({
    status: null,
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    stdout: `p101\nn${root}\n`,
  });
  expect(scanWorkingFolders([101])).toEqual({
    folders: [],
    note: 'driftbench: cwd sweep skipped; lsof timed out after 1000 ms',
  });
});

it('bounds both cwd sweeps when the command times out and then exits', async () => {
  scan.mockImplementation((file) =>
    file === 'ps'
      ? { status: 0, stdout: '101 1 00:00\n' }
      : { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: '' },
  );
  const record = await run(['-c', 'sleep 30'], 100);
  expect(record.exitCode).toBe(124);
  expect(record.stderr).toContain('cwd sweep skipped');
  expect(record.stderr).toContain('timed out after 100 ms');
  const calls = scan.mock.calls.filter(([file]) => file === 'lsof');
  expect(calls).toHaveLength(2);
  for (const [, , options] of calls) {
    expect(options).toMatchObject({ timeout: PROCESS_SCAN_TIMEOUT_MS, killSignal: 'SIGKILL' });
  }
});

it('asks first about the young processes the system adopted and their young descendants', () => {
  expect(
    orphanPids([
      { pid: 101, ppid: 1 },
      { pid: 102, ppid: 101 },
      { pid: 103, ppid: 102 },
      { pid: 104, ppid: 900 },
      { pid: 105, ppid: 104 },
    ]).sort(),
  ).toEqual([101, 102, 103]);
  expect(orphanPids([])).toEqual([]);
});
