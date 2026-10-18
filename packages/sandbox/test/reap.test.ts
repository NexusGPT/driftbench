import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider, reapFolder } from '@agent-nexus/driftbench-sandbox';
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
# A trace beside the script: that it started, and which signal ended it, for a failure to read.
trace = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0] if sys.argv[0] != '-c' else '.')), 'trace.log')
def note(text):
    with open(trace, 'a') as out:
        out.write(text + '\\n')
import signal
for number in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
    signal.signal(number, lambda got, frame: (note('signal %d' % got), os._exit(0)))
note('started %d in %s' % (os.getpid(), os.getcwd()))
time.sleep(600)
`;

const alive = (marker: string): number[] => {
  const ps = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) throw new Error(`ps failed: ${ps.stderr}`);
  return ps.stdout
    .split('\n')
    .filter((line) => line.includes(marker) && !line.includes('-o pid=,command='))
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
  it('reapFolder ends what was left running in a sandbox folder, even a process that left its process group', async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-reap-test-')));
    parents.push(parent);
    const box = await localProvider({ dir: parent }).create({});
    const byPath = `reap-path-${randomUUID()}`;
    const byPlace = `reap-cwd-${randomUUID()}`;
    await writeFile(join(box.root, 'daemon.py'), DAEMON);
    // One names the folder in its command line; the other only runs inside it. Started as a guard script
    // starts them, straight from the folder: on Linux CI a daemon started through the sandbox's own command
    // ends with that command (SIGKILL, cause not isolated), so the leak shows on macOS only that way; the
    // unit runner and estate run tests cover that path.
    await mkdir(join(box.root, 'sub'), { recursive: true });
    const first = spawnSync('python3', [join(box.root, 'daemon.py'), byPath], {
      cwd: box.root,
      stdio: 'ignore',
    });
    const second = spawnSync('python3', ['-c', "exec(open('../daemon.py').read())", byPlace], {
      cwd: join(box.root, 'sub'),
      stdio: 'ignore',
    });
    const started = { exitCode: first.status === 0 && second.status === 0 ? 0 : 1, stdout: '', stderr: '' };
    // What a failure needs to be read: the command's output and every python process the system lists.
    const context = () =>
      `exit ${started.exitCode}; stdout ${started.stdout}; stderr ${started.stderr}; python: ${(
        spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout ?? ''
      )
        .split('\n')
        .filter((line) => line.includes('python'))
        .join(' | ')}; traces: ${['trace.log', 'sub/trace.log']
        .map((name) => {
          try {
            return readFileSync(join(box.root, name), 'utf8').trim();
          } catch {
            return `${name} missing`;
          }
        })
        .join(' | ')}`;
    expect(started.exitCode, context()).toBe(0);
    await until(() => alive(byPath).length > 0 && alive(byPlace).length > 0);
    expect(alive(byPath), context()).toHaveLength(1);
    expect(alive(byPlace), context()).toHaveLength(1);
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
