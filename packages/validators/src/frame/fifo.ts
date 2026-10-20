import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { FrameError } from './tape';
import type { TwinPlan } from './twins';

/**
 * The channel between the validator and the confined runs when the file system has named pipes: each run reads its
 * requests from one pipe and writes its answers to another, and the validator waits for an answer with one blocking
 * read. The relay thread (driver.ts RELAY) is the fallback where there is no `mkfifo`. A call costs two system
 * calls on each side and one process wake-up, instead of a thread hop and a stream per direction.
 */

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms: number): void => {
  Atomics.wait(sleeper, 0, 0, ms);
};

/** The names of the two pipes of a run, in its driver folder. */
export const pipesOf = (driverDir: string): { req: string; res: string } => ({
  req: join(driverDir, 'q'),
  res: join(driverDir, 'a'),
});

/** Whether named pipes can be made here: `mkfifo` exists and works in `dir`. */
export function fifoAvailable(dir: string): boolean {
  if (process.platform === 'win32') return false;
  const probe = join(dir, 'probe-pipe');
  const made = spawnSync('mkfifo', [probe], { stdio: 'ignore' });
  spawnSync('rm', ['-f', probe], { stdio: 'ignore' });
  return made.status === 0;
}

export type FifoRun = {
  plan: TwinPlan;
  child: ChildProcess;
  req: number;
  res: number;
  /** Bytes read from the answer pipe and not yet used. */
  rest: Buffer;
  errors: string;
  ended: boolean;
};

type Answer = Record<string, unknown>;

/** Starts one run: makes its pipes, starts the driver, and connects to it. */
export function startRun(plan: TwinPlan, errFd: number, deadlineMs: number): FifoRun {
  const { req, res } = pipesOf(plan.driverDir);
  for (const path of [req, res]) {
    const made = spawnSync('mkfifo', [path], { stdio: 'ignore' });
    if (made.status !== 0) throw new FrameError(`mkfifo ${path} failed`);
  }
  const child = spawn(process.execPath, [join(plan.driverDir, plan.driverFile), ...plan.argvTail], {
    cwd: plan.cwd ?? process.cwd(),
    env: plan.env ?? process.env,
    execArgv: [],
    // A stdin pipe nobody writes to: the run's stdin is a pipe, as in the relay's runs.
    stdio: ['pipe', 'ignore', errFd],
  });
  child.unref();
  // The run opens its answer pipe for writing first, then its request pipe for reading. Keep a reader on the answer
  // pipe (not blocking) so its open returns, then wait for it to open the request pipe, which is the sign that it runs.
  const early = openSync(res, constants.O_RDONLY | constants.O_NONBLOCK);
  const deadline = Date.now() + deadlineMs;
  let reqFd = -1;
  for (;;) {
    try {
      reqFd = openSync(req, constants.O_WRONLY | constants.O_NONBLOCK);
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENXIO') throw cause;
      if (Date.now() > deadline) {
        closeSync(early);
        child.kill();
        throw new FrameError(`the run ${plan.run} did not start within ${deadlineMs / 1000} s`);
      }
      sleep(2);
    }
  }
  // The run holds the answer pipe open for writing now: this open waits for no one, and reads block.
  const resFd = openSync(res, constants.O_RDONLY);
  closeSync(early);
  return { plan, child, req: reqFd, res: resFd, rest: Buffer.alloc(0), errors: '', ended: false };
}

/** Writes a whole line to the request pipe, waiting while the run has not read what it was sent. */
export function send(run: FifoRun, line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let at = 0;
  while (at < bytes.length) {
    try {
      at += writeSync(run.req, bytes, at);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') {
        sleep(0.2);
        continue;
      }
      if (code === 'EPIPE') {
        run.ended = true;
        return;
      }
      throw cause;
    }
  }
}

const BLOCK = 1024 * 1024;

/** The next answer of a run: the JSON of its next line that starts with the token, or `dead` when it ended. */
export function receive(run: FifoRun, token: string): Answer {
  const prefix = `${token} `;
  const block = Buffer.alloc(BLOCK);
  for (;;) {
    const at = run.rest.indexOf(10);
    if (at >= 0) {
      const line = run.rest.subarray(0, at).toString('utf8');
      run.rest = run.rest.subarray(at + 1);
      if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length)) as Answer;
      continue;
    }
    if (run.ended) return { dead: `the run ${run.plan.run} ended` };
    let read = 0;
    try {
      read = readSync(run.res, block, 0, BLOCK, null);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EAGAIN') {
        sleep(0.2);
        continue;
      }
      throw cause;
    }
    if (read === 0) {
      run.ended = true;
      return { dead: `the run ${run.plan.run} ended${run.errors ? `: ${run.errors}` : ''}` };
    }
    run.rest = Buffer.concat([run.rest, block.subarray(0, read)]);
  }
}

/** Ends a run: closing its request pipe is the end of its input. */
export function stop(run: FifoRun): void {
  for (const fd of [run.req, run.res]) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
  run.child.kill();
}
