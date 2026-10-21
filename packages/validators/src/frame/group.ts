import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { rngOf } from './twins';

/**
 * Run C starts nothing that outlives it (review of PR 969: a detached process of run C wrote into the tree after the
 * invocation ended, after the last look). Run C is started by a small launcher. The launcher starts it in a session of
 * its own (so a process group holds what it starts), waits for it, and then kills the whole group and every process
 * that carries the run's tag in its environment, until none is left. The tag is a name and a value drawn from the seed
 * and the tag of the frame, set in the environment of run C only and inherited by what it starts: a grandchild that
 * calls setsid and re-parents to init still carries it. Where Linux gives an unprivileged user a PID namespace
 * (`unshare --user --pid --fork --kill-child`), run C is also started as the first process of one: when it ends the
 * kernel kills every process in the namespace, whatever its session or environment. What neither stops: on a system
 * with no namespaces, a grandchild that leaves the session, clears its environment and outlives the frame
 * (docs/validators.md section 12.9).
 */
const LAUNCHER = String.raw`
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const [name, value, prefix, ...asked] = process.argv.slice(1);
const command = [...JSON.parse(prefix), ...asked];
const mark = Buffer.from(name + '=' + value + '\0');
function tagged() {
  const found = [];
  if (fs.existsSync('/proc/self/environ')) {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^[0-9]+$/.test(entry) || Number(entry) === process.pid) continue;
      try { if (fs.readFileSync('/proc/' + entry + '/environ').includes(mark)) found.push(Number(entry)); } catch {}
    }
    return found;
  }
  try {
    const text = execFileSync('ps', ['eww', '-A', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 28 });
    for (const line of text.split('\n')) {
      const at = line.trim().indexOf(' ');
      if (at > 0 && line.includes(name + '=' + value)) {
        const pid = Number(line.trim().slice(0, at));
        if (pid !== process.pid) found.push(pid);
      }
    }
  } catch {}
  return found;
}
const child = spawn(command[0], command.slice(1), {
  env: { ...process.env, [name]: value },
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
});
function sweep() {
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  for (const pid of tagged()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
}
function finish(code) {
  let tries = 0;
  (function again() {
    sweep();
    if (tagged().length === 0 || ++tries > 100) process.exit(code);
    else setTimeout(again, 20);
  })();
}
process.on('SIGTERM', () => finish(143));
child.on('error', () => finish(127));
child.on('exit', (code, signal) => finish(code === null ? (signal ? 1 : 0) : code));
`;

let namespaces: string[] | undefined;

/**
 * The words that start a command as the first process of a PID namespace, or none. Two ways, tried in this order: an
 * unprivileged user namespace (`unshare --user --map-user=uid --pid --fork --kill-child`), and where the system forbids
 * that but gives the user passwordless sudo (GitHub's Linux runners), a namespace made by root whose process drops
 * back to the same uid and gid (`sudo -n -E unshare --pid --fork --kill-child -- setpriv --reuid --regid`). The run
 * keeps the user's uid, gid, environment and working folder either way. DRIFTBENCH_FRAME_NO_NAMESPACE=1 turns it off
 * (the mutation run of the tests that pin it).
 */
export function namespacePrefix(): string[] {
  if (process.env.DRIFTBENCH_FRAME_NO_NAMESPACE === '1') return [];
  if (namespaces !== undefined) return namespaces;
  namespaces = [];
  if (process.platform !== 'linux' || process.getuid === undefined || process.getgid === undefined)
    return namespaces;
  const uid = process.getuid();
  const gid = process.getgid();
  const ways = [
    ['unshare', '--user', `--map-user=${uid}`, `--map-group=${gid}`, '--pid', '--fork', '--kill-child', '--'],
    [
      'sudo',
      '-n',
      '-E',
      'unshare',
      '--pid',
      '--fork',
      '--kill-child',
      '--',
      'setpriv',
      `--reuid=${uid}`,
      `--regid=${gid}`,
      '--clear-groups',
      '--',
    ],
  ];
  for (const way of ways) {
    const probe = spawnSync(way[0] as string, [...way.slice(1), 'true'], { stdio: 'ignore' });
    if (probe.status === 0) {
      namespaces = way;
      break;
    }
  }
  return namespaces;
}

/** Whether run C starts in a PID namespace here. */
export const namespaceAvailable = (): boolean => namespacePrefix().length > 0;

/** The name and value that tag what one run C starts, drawn from the seed and the tag. */
export function runTag(seed: number, tag: string): { name: string; value: string } {
  const rng = rngOf(seed, `group:${tag}`);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const word = (length: number) =>
    Array.from({ length }, () => letters[Math.floor(rng() * letters.length)]).join('');
  return {
    name: `${word(5).toUpperCase()}_${word(6).toUpperCase()}`,
    value: `${word(10)}${Math.floor(rng() * 1e9)}`,
  };
}

/**
 * `spawnSync` for run C: the command runs in a session of its own, and when it ends nothing it started is left alive.
 * The result is the one of the command (its status, its output).
 */
export function spawnGrouped(
  command: string,
  args: readonly string[],
  tag: { name: string; value: string },
  options: SpawnSyncOptions & { encoding: 'utf8' },
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ['-e', LAUNCHER, tag.name, tag.value, JSON.stringify(namespacePrefix()), command, ...args],
    options,
  );
}
