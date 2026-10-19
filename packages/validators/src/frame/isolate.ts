import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { findRoot } from '../root';
import { DRIVER, RELAY } from './driver';
import {
  canonical,
  decode,
  type Entry,
  encode,
  FrameError,
  type Json,
  type Outcome,
  shortText,
  type Tape,
} from './tape';
import { type TwinPlan, twinPlans } from './twins';

/**
 * The frame: the product runs apart, the parent decides (docs/validators.md, the section of that name). The
 * cheater audits of the system, blocks and estate ladders found products that gave the right answer only when they
 * saw a validator run them: by its process arguments, its loader, its working folder, its environment, its call
 * stack or its uptime. No check that runs the product in the validator's own process can hide those. The frame
 * runs the product in two child processes that differ in each of them (twins.ts), records every call and both
 * answers on a tape, and gives the item the answers as data, so the item's verdict is computed in the parent from
 * recorded outputs only. A call whose two answers differ is the frame's own finding: the product's answer depends
 * on how it is run.
 */

const START_MS = 120_000;
const CALL_MS = 300_000;

/** The loader for TypeScript sources, registered inside the driver so that no node option shows in the runs. */
function loaderPath(): string | undefined {
  try {
    const cjs = createRequire(import.meta.url).resolve('tsx/esm/api');
    const esm = cjs.replace(/\.cjs$/, '.mjs');
    return existsSync(esm) ? esm : undefined;
  } catch {
    return undefined;
  }
}

function projectCache(): string {
  return join(findRoot(dirname(new URL(import.meta.url).pathname)), 'node_modules', '.cache');
}

/** What the validator keeps of an answer before the two runs are compared, by export name. */
export type Keep = Record<string, (value: unknown) => unknown>;

export type IsolateOptions = {
  /** The absolute path of the product module (a .ts source is loaded through tsx). */
  module: string;
  /** The item's seed: it draws the two runs. */
  seed: number;
  /** A tag that separates the frames of one seed (the item id). */
  tag?: string;
  /** What to keep of an answer before the runs are compared: drop what is allowed to differ, such as a clock. */
  keep?: Keep;
};

export type Frame<T> = {
  /** The product, as the item calls it: each call goes to both runs and answers what run A answered. */
  product: T;
  /** Every call so far, with the answers of both runs. */
  tape: Tape;
  /** The first call whose two runs answered differently, as a message, or undefined. */
  divergence(): string | undefined;
  /** Ends both runs and removes their files. */
  close(): void;
};

type Relay = { worker: Worker; port: MessagePort; flag: Int32Array };

function wait(relay: Relay, ms: number, what: string): Record<string, unknown> {
  const waited = Atomics.wait(relay.flag, 0, 0, ms);
  const reply = receiveMessageOnPort(relay.port)?.message as Record<string, unknown> | undefined;
  Atomics.store(relay.flag, 0, 0);
  if (waited === 'timed-out' || reply === undefined)
    throw new FrameError(`no answer to ${what} within ${ms / 1000} s`);
  return reply;
}

const describeRun = (plan: TwinPlan) =>
  plan.run === 'A'
    ? 'run A (the validator folder and environment)'
    : `run B (a fresh folder, a bare environment, uptime +${plan.uptimeShift} s)`;

const outcomeText = (outcome: Outcome | { dead: string }) =>
  'dead' in outcome
    ? outcome.dead
    : 'throws' in outcome
      ? `threw ${shortText(outcome.throws, 80)}`
      : shortText(outcome.ret, 80);

/** Runs the product module under the frame. Close the frame when the item is done. */
export function isolate<T>(options: IsolateOptions): Frame<T> {
  const plans = twinPlans(options.seed, options.tag ?? options.module, projectCache());
  const token = randomBytes(16).toString('hex');
  const setup = { token, module: resolve(options.module), loader: loaderPath() };
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(4);
  const relay: Relay = {
    // A data URL: the relay is an ES module, and it carries no file of the validator into the runs.
    worker: new Worker(new URL(`data:text/javascript,${encodeURIComponent(RELAY)}`), {
      execArgv: [],
      workerData: { port: port2, signal, plans, driver: DRIVER, setup },
      transferList: [port2],
      stderr: false,
    }),
    port: port1,
    flag: new Int32Array(signal),
  };
  relay.worker.unref();
  port1.unref();
  const tape: Tape = [];
  let first: string | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      relay.port.postMessage({ close: true });
      wait(relay, 10_000, 'close');
    } catch {
      // the runs are ended by terminate below
    }
    void relay.worker.terminate();
    for (const plan of plans) {
      rmSync(plan.driverDir, { recursive: true, force: true });
      if (plan.cwd) rmSync(plan.cwd, { recursive: true, force: true });
    }
  };
  const started = wait(relay, START_MS, 'the start of the product') as {
    ready: Array<{ ready?: boolean; error?: string; dead?: string }>;
  };
  const failed = started.ready.find((each) => each.ready !== true);
  if (failed) {
    close();
    throw new FrameError(
      `the product did not load: ${(failed.error ?? failed.dead ?? '').split('\n').slice(0, 4).join(' ')}`,
    );
  }
  const call = (name: string, args: unknown[]): unknown => {
    if (closed) throw new FrameError(`the frame is closed: ${name} was not called`);
    const sent = encode(args, true, `${name}(arguments)`);
    relay.port.postMessage({ call: name, args: sent });
    const { answers } = wait(relay, CALL_MS, `${name}()`) as { answers: Array<Outcome | { dead: string }> };
    const [a, b] = answers as [Outcome | { dead: string }, Outcome | { dead: string }];
    if ('dead' in a) throw new FrameError(a.dead);
    const entry: Entry = { call: name, args: sent, ...a };
    if (!('dead' in b)) entry.twin = b;
    tape.push(entry);
    const kept = (outcome: Outcome | { dead: string }): string => {
      if ('dead' in outcome) return `dead`;
      if ('throws' in outcome) return `throws ${canonical(outcome.throws)}`;
      const keep = options.keep?.[name];
      return canonical(keep ? encode(keep(decode(outcome.ret))) : outcome.ret);
    };
    if (first === undefined && kept(a) !== kept(b))
      first = `${name}(${shortText(sent as Json, 80)}): ${describeRun(plans[0])} answered ${outcomeText(a)}, ${describeRun(plans[1])} answered ${outcomeText(b)}`;
    if ('throws' in a) throw decode(a.throws);
    return decode(a.ret);
  };
  const product = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (...args: unknown[]) => call(name, args);
      },
    },
  ) as T;
  return { product, tape, divergence: () => first, close };
}

export type CommandOptions = {
  /** The command: a script path (.js, .mjs or .ts) and its arguments, as a user types them after `node`. */
  command: [string, ...string[]];
  seed: number;
  tag?: string;
  /** The files to write into the working folder before the command runs, by path relative to it. */
  files?: Record<string, string>;
  /** The files to read back from the working folder after it ran. */
  collect?: string[];
  /** Text on stdin. */
  input?: string;
  timeoutMs?: number;
};

export type CommandRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  files: Record<string, string | null>;
  /** The first difference between the two runs (status, stdout or a collected file), or undefined. */
  divergence?: string;
  tape: Tape;
};

/**
 * Runs a product command under the frame: twice, each time in a fresh working folder of its own, with the command's
 * own argv and the twin differences of twins.ts (environment, uptime, the driver's place). The working folder's
 * path is written `<work>` in what is recorded, so the two runs compare. The validator reads run A.
 */
export function isolateCommand(options: CommandOptions): CommandRun {
  const [script, ...args] = options.command;
  const plans = twinPlans(options.seed, options.tag ?? script, projectCache());
  const token = randomBytes(16).toString('hex');
  const loader = loaderPath();
  const results = plans.map((plan) => {
    const work = join(plan.driverDir, 'w');
    mkdirSync(work, { recursive: true });
    try {
      for (const [path, text] of Object.entries(options.files ?? {})) {
        const target = resolve(work, path);
        if (!target.startsWith(work)) throw new FrameError(`the file ${path} is outside the working folder`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      }
      const driver = join(plan.driverDir, plan.driverFile);
      writeFileSync(driver, DRIVER);
      const setup = {
        token,
        command: resolve(script),
        args,
        loader,
        uptimeShift: plan.uptimeShift,
        depth: 0,
      };
      const ran = spawnSync(process.execPath, [driver], {
        cwd: work,
        env: plan.env ?? process.env,
        input: `${JSON.stringify(setup)}\n${options.input ?? ''}`,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? CALL_MS,
      });
      const clean = (text: string | null | undefined) => (text ?? '').split(work).join('<work>');
      const files: Record<string, string | null> = {};
      for (const path of options.collect ?? []) {
        const target = resolve(work, path);
        files[path] = existsSync(target) ? clean(readFileSync(target, 'utf8')) : null;
      }
      return { plan, status: ran.status, stdout: clean(ran.stdout), stderr: clean(ran.stderr), files };
    } finally {
      rmSync(plan.driverDir, { recursive: true, force: true });
    }
  });
  const [a, b] = results as [(typeof results)[number], (typeof results)[number]];
  let divergence: string | undefined;
  const differ = (what: string, x: unknown, y: unknown) => {
    if (divergence === undefined && canonical(encode(x)) !== canonical(encode(y)))
      divergence = `${what}: ${describeRun(a.plan)} gave ${shortText(encode(x), 80)}, ${describeRun(b.plan)} gave ${shortText(encode(y), 80)}`;
  };
  differ('status', a.status, b.status);
  differ('stdout', a.stdout, b.stdout);
  for (const path of options.collect ?? []) differ(path, a.files[path], b.files[path]);
  const recorded = (run: typeof a) => ({
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    files: run.files,
  });
  const tape: Tape = [
    {
      call: 'command',
      args: encode(options.command),
      ret: encode(recorded(a)),
      twin: { ret: encode(recorded(b)) },
    },
  ];
  return {
    status: a.status,
    stdout: a.stdout,
    stderr: a.stderr,
    files: a.files,
    ...(divergence ? { divergence } : {}),
    tape,
  };
}
