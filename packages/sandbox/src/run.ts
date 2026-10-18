import { spawn } from 'node:child_process';
import { readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { constants } from 'node:os';
import { sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ExecutionRecord } from '@agent-nexus/driftbench-core';
import { trackGroup, untrackGroup } from './cleanup';
import { TIMEOUT_EXIT_CODE } from './limits';
import { orphanPids, scanWorkingFolders, youngProcesses } from './process-scan';

/**
 * Runs one process with bounded output and a timeout, and returns its execution record. The process
 * leads its own process group, so a timeout kills everything it started, and so does its exit: a
 * background child left running is killed with it.
 */

export type RunOptions = {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Runs after a timeout killed the process, before the record returns. Its error joins stderr. */
  onTimeout?: () => Promise<void>;
};

/** How long the output streams may stay open after the process exited, held by a child that escaped. */
const CLOSE_GRACE_MS = 1000;

/**
 * Spawns `file` with `args`. `command` is what the record names. Rejects only when the process cannot
 * start; a failing command resolves with its exit code.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  command: string,
  options: RunOptions,
): Promise<ExecutionRecord> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) trackGroup(child.pid);
    const stdout = new Capture(options.maxOutputBytes);
    const stderr = new Capture(options.maxOutputBytes);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A command may exit without reading its input; the broken pipe is not an error of the run.
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');

    let timedOut = false;
    let settled = false;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let cleanup: Promise<string | undefined> | undefined;
    let grace: NodeJS.Timeout | undefined;
    let sweepNote: string | undefined;

    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group is already gone.
      }
      if (options.cwd !== undefined) {
        const note = killInside(realFolder(options.cwd));
        sweepNote ??= note;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      if (options.onTimeout) {
        cleanup = options.onTimeout().then(
          () => undefined,
          (error: unknown) => `driftbench: cleanup after the timeout failed: ${String(error)}`,
        );
      }
    }, options.timeoutMs);

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      if (child.pid !== undefined) untrackGroup(child.pid);
      const status = exit ?? { code, signal };
      const notes: string[] = [];
      if (sweepNote) notes.push(sweepNote);
      if (timedOut) notes.push(`driftbench: timed out after ${options.timeoutMs} ms; the command was killed`);
      const build = (cleanupNote: string | undefined): ExecutionRecord => {
        if (cleanupNote) notes.push(cleanupNote);
        const err = stderr.text();
        const record: ExecutionRecord = {
          command,
          exitCode: timedOut ? TIMEOUT_EXIT_CODE : exitCodeOf(status.code, status.signal),
          stdout: stdout.text(),
          stderr: notes.length === 0 ? err : [err, ...notes].filter((part) => part !== '').join('\n'),
          startedAt,
          latencyMs: Math.round((performance.now() - start) * 1000) / 1000,
        };
        if (stdout.truncated || stderr.truncated) record.truncated = true;
        return record;
      };
      if (cleanup) cleanup.then((note) => resolve(build(note)));
      else resolve(build(undefined));
    };

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      // Whatever the command left running in its group goes with it.
      killGroup();
      grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code, signal);
      }, CLOSE_GRACE_MS);
    });
    child.once('close', (code, signal) => finish(code, signal));
  });
}

function realFolder(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
}

/**
 * Kills processes whose working folder is inside `root`: the children the command left behind, also
 * one that started its own process group (the group kill does not reach it, and its parent is gone, so no
 * walk of the process tree finds it). A child that moved to another folder is not found.
 */
function killInside(root: string): string | undefined {
  const inside = (folder: string) => folder === root || folder.startsWith(`${root}${sep}`);
  const end = (pids: readonly number[]) => {
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // It ended on its own, or it is not ours to kill.
      }
    }
  };
  try {
    if (process.platform === 'linux') {
      const pids: number[] = [];
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          if (inside(readlinkSync(`/proc/${entry}/cwd`))) pids.push(Number(entry));
        } catch {
          // Not readable: another user's process, or one that just ended.
        }
      }
      end(pids);
      return undefined;
    }
    // No /proc: a working folder costs a subprocess, slow on a busy host, and a child that wakes within
    // that time has run. The processes the system adopted are few and are asked first, then ended.
    const young = youngProcesses(root);
    const first = young ? orphanPids(young) : [];
    let note: string | undefined;
    const sweep = (pids?: readonly number[]) => {
      const found = scanWorkingFolders(pids);
      end(found.folders.filter(({ cwd }) => inside(cwd)).map(({ pid }) => pid));
      note ??= found.note;
    };
    if (first.length > 0) sweep(first);
    const spared = new Set(first);
    sweep(young?.map(({ pid }) => pid).filter((pid) => !spared.has(pid)));
    return note;
  } catch {
    // The listing is unavailable: the group kill has still run.
    return process.platform === 'linux'
      ? undefined
      : 'driftbench: cwd sweep skipped; process listing unavailable';
  }
}

/** The shell convention: a process killed by a signal exits with 128 plus the signal number. */
function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal !== null) return 128 + (constants.signals[signal] ?? 0);
  return 1;
}

/** Keeps the first `limit` bytes of a stream and drains the rest, noting that it cut. */
class Capture {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const room = this.limit - this.size;
    if (chunk.length <= room) {
      this.chunks.push(chunk);
      this.size += chunk.length;
      return;
    }
    if (room > 0) {
      this.chunks.push(chunk.subarray(0, room));
      this.size += room;
    }
    this.truncated = true;
  }

  text(): string {
    const all = Buffer.concat(this.chunks, this.size);
    return (this.truncated ? all.subarray(0, utf8End(all)) : all).toString('utf8');
  }
}

/** The length of the longest prefix of `buffer` that ends on a whole UTF-8 character. */
export function utf8End(buffer: Buffer): number {
  let index = buffer.length - 1;
  let trailing = 0;
  while (index >= 0 && trailing < 3 && ((buffer[index] ?? 0) & 0xc0) === 0x80) {
    index -= 1;
    trailing += 1;
  }
  if (index < 0) return buffer.length;
  const lead = buffer[index] ?? 0;
  const width = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return trailing + 1 >= width ? buffer.length : index;
}
