import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider, reapFolder } from '@driftbench/sandbox';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * A daemon a guard script starts and leaves behind: it forks, starts a new session (so it leaves the run's
 * process group), and sleeps. The marker in its arguments lets the test find it.
 */
const DAEMON = `import os, sys, time
child = os.fork()
if child > 0:
    # The first child leaves the session before this one returns: the caller's group can go at once.
    os.waitpid(child, 0)
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)
null = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(null, fd)
time.sleep(600)
`;

const alive = (marker: string): number[] => {
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) throw new Error(`ps failed: ${ps.stderr}`);
  return ps.stdout
    .split('\n')
    .filter((line) => line.includes(marker) && !line.includes(' ps -axo'))
    .map((line) => Number.parseInt(line.trim(), 10));
};

const until = async (test: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
};

const parents: string[] = [];
afterAll(async () => {
  // A failed test must not leave its daemons running either.
  await reapFolder(parents);
  for (const parent of parents) await rm(parent, { recursive: true, force: true });
});

describe('processes a run leaves behind', () => {
  it('reapFolder ends what a sandbox command left running, even a process that left its process group', async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-reap-test-')));
    parents.push(parent);
    const box = await localProvider({ dir: parent }).create({});
    const byPath = `reap-path-${randomUUID()}`;
    const byPlace = `reap-cwd-${randomUUID()}`;
    await writeFile(join(box.root, 'daemon.py'), DAEMON);
    // One names the folder in its command line; the other only runs inside it.
    const started = await box.exec(
      `python3 "$PWD/daemon.py" ${byPath}; mkdir -p sub && cd sub && python3 -c "exec(open('../daemon.py').read())" ${byPlace}`,
      { timeoutMs: 10_000 },
    );
    expect(started.exitCode).toBe(0);
    await until(() => alive(byPath).length > 0 && alive(byPlace).length > 0);
    expect(alive(byPath)).toHaveLength(1);
    expect(alive(byPlace)).toHaveLength(1);
    await reapFolder([box.root]);
    await box.destroy();
    await until(() => alive(byPath).length === 0 && alive(byPlace).length === 0);
    expect(alive(byPath)).toEqual([]);
    expect(alive(byPlace)).toEqual([]);
  }, 30_000);

  it('reapFolder ends the processes of one folder only, and never this process', async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-reap-test-')));
    parents.push(parent);
    const mine = join(parent, 'mine');
    const other = join(parent, 'other');
    const markers = { mine: `reap-mine-${randomUUID()}`, other: `reap-other-${randomUUID()}` };
    for (const [folder, marker] of [
      [mine, markers.mine],
      [other, markers.other],
    ] as const) {
      spawnSync('mkdir', ['-p', folder]);
      await writeFile(join(folder, 'daemon.py'), DAEMON);
      const run = spawnSync('python3', [join(folder, 'daemon.py'), marker], { cwd: folder, stdio: 'ignore' });
      expect(run.status).toBe(0);
    }
    await until(() => alive(markers.mine).length > 0 && alive(markers.other).length > 0);
    const ended = await reapFolder([mine]);
    expect(ended).toEqual(alive(markers.mine).length === 0 ? ended : []);
    await until(() => alive(markers.mine).length === 0);
    expect(alive(markers.mine)).toEqual([]);
    expect(alive(markers.other)).toHaveLength(1);
    expect(ended).not.toContain(process.pid);
    await reapFolder([other]);
    await until(() => alive(markers.other).length === 0);
    expect(alive(markers.other)).toEqual([]);
  }, 30_000);
});
