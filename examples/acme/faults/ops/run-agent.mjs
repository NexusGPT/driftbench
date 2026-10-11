/**
 * Runs the real Acme ops agent (examples/acme/ops/agent.mjs) as the process adapter would: the same
 * arguments, the same working folder, the same stimulus on stdin, the protocol variables a fault keeps.
 * The ops faults wrap it: each changes the environment before the run or the workspace and the reply after.
 * Fictional data only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const AGENT = fileURLToPath(new URL('../../ops/agent.mjs', import.meta.url));

/** Runs the agent; returns its reply (stdout without the final line break) and its exit code. */
export function runAgent({ env = process.env } = {}) {
  const fromFile = process.argv[2] ?? process.env.DRIFTBENCH_STIMULUS_FILE;
  const input = fromFile !== undefined && existsSync(fromFile) ? undefined : readFileSync(0, 'utf8');
  const ran = spawnSync(process.execPath, [AGENT, ...process.argv.slice(2)], {
    env,
    cwd: process.cwd(),
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  if (ran.stderr) process.stderr.write(ran.stderr);
  return { reply: (ran.stdout ?? '').replace(/[\r\n]+$/, ''), exitCode: ran.status ?? 1 };
}

/** Prints the reply and exits as the agent did. */
export function finish({ reply, exitCode }) {
  process.stdout.write(`${reply}\n`);
  process.exitCode = exitCode;
}
