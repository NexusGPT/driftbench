import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterTransportError,
  AgentFailure,
  isPlainObject,
  retryableStatus,
} from '@agent-nexus/driftbench-core';
import { excerpt } from './transport';

/**
 * The process side of the adapters that reach a Python framework (crewai, pydantic-ai) through a bridge
 * script: one process per block, a JSON request on stdin, one result line on stdout.
 *
 * The bridge prints `driftbench-result <json>` on success, or `driftbench-error <json>` and exits 3 on a
 * failure it caught, with the provider's HTTP status when there was one. Anything else on stdout is noise
 * the adapter ignores; stderr is kept for error messages.
 */

/** One process run: the command, its arguments, what goes to stdin, where it runs. */
export type ExecRequest = {
  command: string;
  args: readonly string[];
  input: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
};

export type ExecReply = { stdout: string; stderr: string; exitCode: number | null };

/** Runs one process. The default spawns it; tests pass a function that plays the bridge. */
export type ExecLike = (request: ExecRequest) => Promise<ExecReply>;

/**
 * Spawns the command, writes the input to stdin, and collects stdout and stderr until it exits or the
 * timeout kills it. A command that cannot start (not installed) is a transport error marked exhausted:
 * retrying it changes nothing, but it is the transport that failed, not the agent.
 */
export const spawnExec: ExecLike = (request) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...request.env }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new AdapterTransportError(`${request.command} gave no answer within ${request.timeoutMs} ms`));
    }, request.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new AdapterTransportError(`${request.command} could not start: ${cause.message}`, {
          cause,
          exhausted: true,
        }),
      );
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    child.stdin.on('error', () => {
      // A process that exits before reading stdin closes the pipe; its exit code tells what happened.
    });
    child.stdin.end(request.input);
  });

const RESULT = 'driftbench-result ';
const ERROR = 'driftbench-error ';
const NETWORK_TYPE = /connection|timeout|connecterror|readerror|network/i;

/**
 * The result a bridge printed. A `driftbench-error` with a 429 or a 5xx, or a connection or timeout error
 * type, is a transport error the runner retries under the shared policy; any other failure is the agent's.
 */
export function readBridgeReply(reply: ExecReply, label: string): unknown {
  const lines = reply.stdout.split('\n');
  const result = lines.findLast((line) => line.startsWith(RESULT));
  if (result !== undefined && reply.exitCode === 0) {
    try {
      return JSON.parse(result.slice(RESULT.length));
    } catch {
      throw new AgentFailure(`${label} printed a result that is not JSON: ${excerpt(result)}`);
    }
  }
  const error = lines.findLast((line) => line.startsWith(ERROR));
  if (error !== undefined) {
    let failure: unknown;
    try {
      failure = JSON.parse(error.slice(ERROR.length));
    } catch {
      failure = undefined;
    }
    const type = isPlainObject(failure) && typeof failure.type === 'string' ? failure.type : 'Error';
    const message = isPlainObject(failure) && typeof failure.message === 'string' ? failure.message : error;
    const status = isPlainObject(failure) && typeof failure.status === 'number' ? failure.status : undefined;
    const text = `${label} failed: ${type}: ${excerpt(message)}`;
    if (status !== undefined && retryableStatus(status)) {
      throw new AdapterTransportError(text, { status });
    }
    if (status === undefined && NETWORK_TYPE.test(type)) throw new AdapterTransportError(text);
    throw new AgentFailure(text);
  }
  throw new AgentFailure(
    `${label} exited ${reply.exitCode ?? 'on a signal'} without a result: ${excerpt(reply.stderr || reply.stdout) || 'no output'}`,
  );
}

/**
 * Writes a bridge script the adapter ships as text to a stable path under the temporary folder, once, and
 * returns the path. The name carries the hash of the text, so a changed bridge never reuses an old file.
 */
export function bridgeFile(name: string, source: string): string {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const folder = join(tmpdir(), 'driftbench-bridges');
  const path = join(folder, `${name}-${hash}.py`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path, source, { mode: 0o644 });
  return path;
}
