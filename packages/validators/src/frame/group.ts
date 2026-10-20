import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { rngOf } from './twins';

/**
 * Run C starts nothing that outlives it (review of PR 969: a detached process of run C wrote into the tree after the
 * invocation ended, after the last look). Run C is started by a small launcher. The launcher starts it in a session of
 * its own (so a process group holds what it starts), waits for it, and then kills the whole group and every process
 * that carries the run's tag in its environment, until none is left. The tag is a name and a value drawn from the seed
 * and the tag of the frame, set in the environment of run C only and inherited by what it starts: a grandchild that
 * calls setsid and re-parents to init still carries it. What this does not stop: a grandchild that both leaves the
 * session and clears its environment (docs/validators.md section 12.9).
 */
const LAUNCHER = String.raw`
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const [name, value, ...command] = process.argv.slice(1);
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
  options: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer> {
  return spawnSync(process.execPath, ['-e', LAUNCHER, tag.name, tag.value, command, ...args], options);
}
