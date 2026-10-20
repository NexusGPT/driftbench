import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { findRoot } from '../root';
import { confine, SourceGuard, seal, tsxPath } from './confine';
import { plainBatchEntry, plainCodec, RELAY, twinDriver, wrapperModule } from './driver';
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
import { rngOf, type TwinPlan, twinPlans, userEnv } from './twins';

/**
 * The frame: the product runs apart, the parent decides (docs/validators.md, the section of that name). The
 * cheater audits of the system, blocks and estate ladders found products that gave the right answer only when they
 * saw a validator run them: by its process arguments, its loader, its working folder, its environment, its call
 * stack or its uptime. No check that runs the product in the validator's own process can hide those. The frame
 * runs the product in two child processes that differ in each of them (twins.ts), records every call and both
 * answers on a tape, and gives the item the answers as data, so the item's verdict is computed in the parent from
 * recorded outputs only. A call whose two answers differ is the frame's own finding: the product's answer depends
 * on how it is run.
 *
 * Both twins are still programs the frame wrote, and a review of this frame found products keyed on what the twins
 * share (an .mjs entry, a stdin that is no terminal, no node options). So each call is made a third time, in run C:
 * a fresh process per call that loads the product through a plain entry file, as a user's own script does (a
 * TypeScript entry under the tsx loader, no stdin protocol, the answer written to a file). Run C answering
 * differently from run A is a finding too. No run makes the validator indistinguishable from a user; run C narrows
 * the gap (docs/validators.md section 12.9).
 */

const START_MS = 120_000;
const CALL_MS = 300_000;
/** The time run C may take to make all the calls of a frame. */
const BATCH_MS = 1_800_000;

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
  /**
   * Make each call in run C too (default true). Run C is one fresh process that makes every call of the frame once,
   * in order, when the frame is read (`divergence()`, `tainted()`) or closed. A call that differs is a finding that
   * holds for the whole frame (`tainted()`), since a product that answers by how it is run does so on any call.
   */
  plain?: boolean;
  /**
   * What a function in an argument becomes (the default refuses it). `'source'` sends its source text, which the
   * confined run rebuilds: for a pure function of the validator, such as a statistic handed to the product. A
   * function the product returned is always a handle and is sent back as one.
   */
  functions?: 'source';
  /**
   * Files or folders the confined runs may read besides the bundled product (confine.ts), by absolute path: a data
   * file the product reads through `import.meta.url`. Never a folder that holds the expected values.
   */
  reads?: string[];
};

export type Frame<T> = {
  /** The product, as the item calls it: each call goes to both runs and answers what run A answered. */
  product: T;
  /** Every call so far, with the answers of all runs. Reading it makes the calls in run C first, if any are held. */
  readonly tape: Tape;
  /** Where the time of the frame went, in milliseconds: encoding, waiting for the confined runs, decoding, run C. */
  spent(): {
    calls: number;
    encodeMs: number;
    relayMs: number;
    decodeMs: number;
    plainMs: number;
    top: Array<{ name: string; calls: number; ms: number; slow: number }>;
  };
  /** The number of calls so far: a mark for `cpuSince` and `divergenceSince`; it does not run run C. */
  position(): number;
  /** The first call whose runs answered differently, as a message, or undefined. */
  divergence(): string | undefined;
  /** The processor time the product used for the calls from the tape position `from` on, in milliseconds (run A). */
  cpuSince(from: number): number;
  /** The first divergence among the calls from the tape position `from` on, or undefined. */
  divergenceSince(from: number): string | undefined;
  /** The message of the first sampled run C call that differed from run A, or undefined: it taints every call. */
  tainted(): string | undefined;
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

const describeRun = (plan: TwinPlan | 'C') =>
  plan === 'C'
    ? "run C (user-shaped: a plain entry file per call under the tsx loader, the user's environment)"
    : plan.run === 'A'
      ? 'run A (confined: the validator folder and environment)'
      : plan.run === 'B'
        ? `run B (confined: a fresh folder, a bare environment, uptime +${plan.uptimeShift} s)`
        : 'run D (confined: behind a neutral wrapper module, a fresh folder, neutral arguments)';

/** The tsx loader as a node option for run C, when tsx is installed (found from the product's checkout too). */
function loaderOption(module: string): string[] {
  const tsx = tsxPath(module);
  return tsx ? ['--import', pathToFileURL(tsx).href] : [];
}

/** A folder name drawn from the seed and the tag: letters only, six to thirteen of them. */
function drawnFolder(seed: number, tag: string): string {
  const rng = rngOf(seed, tag);
  let folder = '';
  while (folder.length < 6 + Math.floor(rng() * 8))
    folder += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)];
  return folder;
}

type PlainRun = {
  dir: string;
  codec: string;
  codecNames: { encode: string; decode: string; handles: string };
  count: number;
  /** The file of the calls run C makes, one JSON line each, in the order they were made. */
  calls: string;
  /** Run C's environment: the user's (`userEnv`). */
  env: Record<string, string>;
};

/** Opens run C: a drawn folder in the project's cache, holding the codec module. */
function openPlain(seed: number, tag: string): PlainRun {
  const rng = rngOf(seed, `plain:${tag}`);
  let folder = '';
  while (folder.length < 6 + Math.floor(rng() * 8))
    folder += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)];
  const dir = join(projectCache(), folder);
  mkdirSync(dir, { recursive: true });
  const codec = plainCodec(seed, tag);
  const codecPath = join(dir, `${folder.slice(0, 4)}${Math.floor(rng() * 1000)}.mjs`);
  writeFileSync(codecPath, codec.source);
  return {
    dir,
    codec: codecPath,
    codecNames: codec,
    count: 0,
    calls: join(dir, 'calls.jsonl'),
    env: userEnv(),
  };
}

/** The lines of a file, read in blocks: an answer can be tens of megabytes, so the file is never read whole. */
function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, 'r');
  try {
    const block = Buffer.alloc(8 * 1024 * 1024);
    let rest = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, block, 0, block.length, null);
      if (read === 0) break;
      rest = Buffer.concat([rest, block.subarray(0, read)]);
      for (let at = rest.indexOf(10); at >= 0; at = rest.indexOf(10)) {
        yield rest.subarray(0, at).toString('utf8');
        rest = rest.subarray(at + 1);
      }
    }
    if (rest.length > 0) yield rest.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Run C: one fresh process that makes every call recorded in `plain.calls` in order, the way a user's script does,
 * and appends each answer to a file. Returns the answers read back one by one, or one `dead` answer per call when
 * the process ended before it wrote them.
 */
function plainRunAll(
  plain: PlainRun,
  seed: number,
  tag: string,
  module: string,
  count: number,
): Array<Outcome | { dead: string }> {
  plain.count += 1;
  const stem = `${tag.length.toString(36)}${plain.count}`;
  // .mts: an ES module whatever the folder's package type, so the entry may await at its top level.
  const entry = join(plain.dir, `${stem}.mts`);
  const out = join(plain.dir, `${stem}.out.jsonl`);
  writeFileSync(
    entry,
    plainBatchEntry(
      seed,
      `${tag}:${plain.count}`,
      {
        module: pathToFileURL(module).href,
        codec: pathToFileURL(plain.codec).href,
        calls: pathToFileURL(plain.calls).href,
        out: pathToFileURL(out).href,
      },
      plain.codecNames,
    ),
  );
  const ran = spawnSync(process.execPath, [...loaderOption(module), entry], {
    cwd: findRoot(dirname(module)),
    env: plain.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: BATCH_MS,
  });
  try {
    const answers: Array<Outcome | { dead: string }> = [];
    if (existsSync(out)) for (const line of linesOf(out)) answers.push(JSON.parse(line) as Outcome);
    const dead = {
      dead: `run C ended (${ran.status ?? ran.signal}) after ${answers.length} of ${count} calls: ${(ran.stderr ?? '').split('\n').slice(-6).join(' ')}`,
    };
    while (answers.length < count) answers.push(dead);
    return answers;
  } finally {
    for (const file of [entry, out]) rmSync(file, { force: true });
  }
}

/** How a call is compared between runs: what the caller keeps of the answer, or the throw. */
function keptOf(
  outcome: Outcome | { dead: string },
  keep: ((value: unknown) => unknown) | undefined,
): string {
  if ('dead' in outcome) return 'dead';
  if ('throws' in outcome) return `throws ${canonical(outcome.throws)}`;
  return canonical(keep ? encode(keep(decode(outcome.ret))) : outcome.ret);
}

const outcomeText = (outcome: Outcome | { dead: string }) =>
  'dead' in outcome
    ? outcome.dead
    : 'throws' in outcome
      ? `threw ${shortText(outcome.throws, 80)}`
      : shortText(outcome.ret, 80);

/** Runs the product module under the frame. Close the frame when the item is done. */
export function isolate<T>(options: IsolateOptions): Frame<T> {
  const tag = options.tag ?? options.module;
  const module = resolve(options.module);
  // The product runs from a bundle in a folder of its own, in processes that may read that folder and nothing else
  // of the project (confine.ts): the expected values stay in this process and are out of the product's reach.
  const sealFolder = join(projectCache(), drawnFolder(options.seed, `seal:${tag}`));
  const { file: sealed, inputs } = seal(module, sealFolder, drawnFolder(options.seed, `bundle:${tag}`));
  // Run C is unconfined and can read the expected values: it must not leave them in a file a later run reads.
  const guard = new SourceGuard([...inputs, ...(options.reads ?? [])]);
  const plans = twinPlans(options.seed, tag, projectCache()).map((plan) => {
    const confined = confine(
      { ...plan, driverSource: twinDriver(options.seed, `${tag}:${plan.run}`), setup: { module: sealed } },
      { reads: [dirname(sealed), ...(options.reads ?? [])] },
    );
    if (!plan.wrap) return confined;
    // Run D reaches the product through a wrapper module of the run's own folder.
    const wrapper = wrapperModule(options.seed, `${tag}:${plan.run}`, pathToFileURL(sealed).href);
    const file = join(confined.driverDir, `${drawnFolder(options.seed, `wrapper:${tag}`)}.mjs`);
    writeFileSync(file, wrapper.source);
    return { ...confined, setup: { ...confined.setup, module: file, invoke: wrapper.invoke } };
  });
  const token = randomBytes(16).toString('hex');
  const setup = { token, module: sealed };
  const plain = options.plain === false ? undefined : openPlain(options.seed, tag);
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(4);
  const relay: Relay = {
    // A data URL: the relay is an ES module, and it carries no file of the validator into the runs.
    worker: new Worker(new URL(`data:text/javascript,${encodeURIComponent(RELAY)}`), {
      execArgv: [],
      workerData: { port: port2, signal, plans, setup },
      transferList: [port2],
      stderr: false,
    }),
    port: port1,
    flag: new Int32Array(signal),
  };
  relay.worker.unref();
  port1.unref();
  const tape: Tape = [];
  const found: Array<{ at: number; message: string }> = [];
  let first: string | undefined;
  let taint: string | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    try {
      flushPlain();
    } catch {
      // a flush that fails leaves the finding it made
    }
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
    rmSync(sealFolder, { recursive: true, force: true });
    if (plain) rmSync(plain.dir, { recursive: true, force: true });
  };
  const started = wait(relay, START_MS, 'the start of the product') as {
    ready: Array<{
      ready?: boolean;
      error?: string;
      dead?: string;
      shape?: Record<string, { fn?: 1; value?: Json }>;
    }>;
  };
  const failed = started.ready.find((each) => each.ready !== true);
  if (failed) {
    close();
    throw new FrameError(
      `the product did not load: ${(failed.error ?? failed.dead ?? '').split('\n').slice(0, 4).join(' ')}`,
    );
  }
  // A function the product returned is a handle: calling it calls the product's function in each run.
  const handleOf = new WeakMap<object, number>();
  const revive = (handle: number): unknown => {
    const fn = (...args: unknown[]) => call(`#${handle}`, args);
    handleOf.set(fn, handle);
    return fn;
  };
  const ship = (fn: (...args: never[]) => unknown): Json | undefined => {
    const handle = handleOf.get(fn);
    if (handle !== undefined) return { $handle: handle };
    return options.functions === 'source' ? { $fn: fn.toString() } : undefined;
  };
  const byName = new Map<string, { calls: number; ms: number; slow: number }>();
  const spent = { calls: 0, encodeMs: 0, relayMs: 0, decodeMs: 0, plainMs: 0 };
  type Recorded = { call: string; entry: Entry; expected: string; head: string; at: number };
  const recorded: Recorded[] = [];
  let compared = 0;
  /**
   * Makes every call of the frame in run C, in one fresh process and in order, and compares the answers not yet
   * compared with the ones of run A. Run C must make them all in one process: a product keeps state from call to
   * call (a generator it returned, a cache), and run A kept it.
   */
  const flushPlain = (): void => {
    if (!plain || compared >= recorded.length) return;
    const t3 = performance.now();
    const answers = plainRunAll(plain, options.seed, tag, module, recorded.length);
    spent.plainMs += performance.now() - t3;
    for (let index = compared; index < recorded.length; index += 1) {
      const held = recorded[index] as Recorded;
      const c = answers[index] as Outcome | { dead: string };
      if (!('dead' in c)) held.entry.plain = c;
      if (keptOf(c, options.keep?.[held.call]) !== held.expected) {
        const message = `${held.head}, ${describeRun('C')} answered ${outcomeText(c)}`;
        found.push({ at: held.at, message });
        first ??= message;
        taint ??= message;
      }
    }
    compared = recorded.length;
    // Run C is unconfined and can read the expected values: it must not leave them in a file a later run reads.
    const changed = guard.check();
    if (changed.length > 0) {
      const message = `run C wrote the product's files (${changed.map((path) => path.split('/').slice(-2).join('/')).join(', ')}); they are put back`;
      found.push({ at: tape.length - 1, message });
      first ??= message;
      taint ??= message;
    }
  };
  const call = (name: string, args: unknown[]): unknown => {
    if (closed) throw new FrameError(`the frame is closed: ${name} was not called`);
    const t0 = performance.now();
    const sent = encode(args, true, `${name}(arguments)`, new WeakSet(), ship);
    const t1 = performance.now();
    relay.port.postMessage({ call: name, args: sent });
    const { answers } = wait(relay, CALL_MS, `${name}()`) as { answers: Array<Outcome | { dead: string }> };
    spent.calls += 1;
    spent.encodeMs += t1 - t0;
    const took = performance.now() - t1;
    spent.relayMs += took;
    const each = byName.get(name) ?? { calls: 0, ms: 0, slow: 0 };
    each.calls += 1;
    each.ms += took;
    if (took > 50) each.slow += 1;
    byName.set(name, each);
    const [a, b, d] = answers as [
      Outcome | { dead: string },
      Outcome | { dead: string },
      Outcome | { dead: string },
    ];
    if ('dead' in a) throw new FrameError(a.dead);
    const entry: Entry = { call: name, args: sent, ...a };
    if ('cpu' in a && typeof a.cpu === 'number') entry.cpu = a.cpu;
    if (!('dead' in b)) entry.twin = b;
    if (!('dead' in d)) entry.wrapped = d;
    tape.push(entry);
    const kept = (outcome: Outcome | { dead: string }): string => {
      if ('dead' in outcome) return `dead`;
      if ('throws' in outcome) return `throws ${canonical(outcome.throws)}`;
      const keep = options.keep?.[name];
      return canonical(keep ? encode(keep(decode(outcome.ret))) : outcome.ret);
    };
    const head = `${name}(${shortText(sent as Json, 80)}): ${describeRun(plans[0] as TwinPlan)} answered ${outcomeText(a)}`;
    // The runs are compared with run A in turn; the first difference found is the frame's finding.
    for (const [other, plan] of [
      [b, plans[1]],
      [d, plans[2]],
    ] as const) {
      if (kept(a) !== kept(other)) {
        const message = `${head}, ${describeRun(plan as TwinPlan)} answered ${outcomeText(other)}`;
        found.push({ at: tape.length - 1, message });
        first ??= message;
      }
    }
    if (plain) {
      // Run C makes this call later, with all the others, in one fresh process; the answer of run A is kept.
      appendFileSync(plain.calls, `${JSON.stringify({ call: name, args: sent })}\n`);
      recorded.push({
        call: name,
        entry,
        expected: keptOf(a, options.keep?.[name]),
        head,
        at: tape.length - 1,
      });
    }
    if ('throws' in a) throw decode(a.throws);
    const t2 = performance.now();
    const value = decode(a.ret, revive);
    spent.decodeMs += performance.now() - t2;
    return value;
  };
  const shape = started.ready[0]?.shape;
  const product = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        const known = shape?.[name];
        if (shape && !known) return undefined;
        if (known && known.fn !== 1) return decode(known.value);
        return (...args: unknown[]) => call(name, args);
      },
      has: (_target, name) => typeof name === 'string' && (shape ? name in shape : true),
      ownKeys: () => (shape ? Object.keys(shape) : []),
      getOwnPropertyDescriptor: (_target, name) =>
        typeof name === 'string' && shape && name in shape
          ? { enumerable: true, configurable: true }
          : undefined,
    },
  ) as T;
  return {
    product,
    get tape() {
      flushPlain();
      return tape;
    },
    position: () => tape.length,
    spent: () => ({
      ...spent,
      top: [...byName.entries()]
        .sort((x, y) => y[1].ms - x[1].ms)
        .slice(0, 8)
        .map(([name, each]) => ({ name, ...each })),
    }),
    divergence: () => {
      flushPlain();
      return first;
    },
    cpuSince: (from) => tape.slice(from).reduce((sum, each) => sum + (each.cpu ?? 0), 0),
    divergenceSince: (from) => found.find((each) => each.at >= from)?.message,
    tainted: () => {
      flushPlain();
      return taint;
    },
    close,
  };
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
 * Runs a product command under the frame: four times, each in a fresh working folder of its own. Runs A and B go
 * through drawn drivers with the twin differences of twins.ts (environment, uptime, the driver's place); run D is a third twin; run C is the
 * plain command, `node [--import tsx] <script> <args>`, as a user types it. Each run sees the command's own argv.
 * The working folder's path is written `<work>` in what is recorded, so the runs compare. The validator reads run A.
 */
export function isolateCommand(options: CommandOptions): CommandRun {
  const [script, ...args] = options.command;
  const tag = options.tag ?? script;
  // The command runs from a bundle, in processes that read that folder and their own working folder, write that
  // working folder and start no process (confine.ts); run C is the plain command, unconfined.
  const sealFolder = join(projectCache(), drawnFolder(options.seed, `seal:${tag}:command`));
  const { file: sealed, inputs } = seal(
    resolve(script),
    sealFolder,
    drawnFolder(options.seed, `bundle:${tag}:command`),
  );
  const guard = new SourceGuard(inputs);
  const plans = twinPlans(options.seed, tag, projectCache()).map((plan) =>
    confine(
      { ...plan, setup: { command: sealed, script: resolve(script) } },
      { reads: [dirname(sealed)], writes: [join(plan.driverDir, 'w')] },
    ),
  );
  const token = randomBytes(16).toString('hex');
  const plainRun = openPlain(options.seed, `${tag}:command`);
  const plainDir = plainRun.dir;
  const runs: Array<TwinPlan | 'C'> = [...plans, 'C'];
  const results = runs.map((plan) => {
    const home = plan === 'C' ? plainDir : plan.driverDir;
    const work = join(home, 'w');
    mkdirSync(work, { recursive: true });
    if (plan !== 'C' && plan.home) mkdirSync(plan.home, { recursive: true });
    try {
      for (const [path, text] of Object.entries(options.files ?? {})) {
        const target = resolve(work, path);
        if (!target.startsWith(work)) throw new FrameError(`the file ${path} is outside the working folder`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      }
      let ran: ReturnType<typeof spawnSync>;
      if (plan === 'C') {
        ran = spawnSync(process.execPath, [...loaderOption(resolve(script)), resolve(script), ...args], {
          cwd: work,
          env: plainRun.env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: options.timeoutMs ?? CALL_MS,
        });
      } else {
        const driver = join(plan.driverDir, plan.driverFile);
        writeFileSync(driver, twinDriver(options.seed, `${tag}:command:${plan.run}`));
        const setup = {
          token,
          args,
          ...plan.setup,
          uptimeShift: plan.uptimeShift,
          depth: 0,
        };
        ran = spawnSync(process.execPath, [driver], {
          cwd: work,
          env: plan.env ?? process.env,
          input: `${JSON.stringify(setup)}\n`,
          encoding: 'utf8',
          timeout: options.timeoutMs ?? CALL_MS,
        });
      }
      const clean = (text: string | Buffer | null | undefined) =>
        String(text ?? '')
          .split(work)
          .join('<work>');
      const files: Record<string, string | null> = {};
      for (const path of options.collect ?? []) {
        const target = resolve(work, path);
        files[path] = existsSync(target) ? clean(readFileSync(target, 'utf8')) : null;
      }
      return { plan, status: ran.status, stdout: clean(ran.stdout), stderr: clean(ran.stderr), files };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  rmSync(sealFolder, { recursive: true, force: true });
  const [a, b, d, c] = results as [
    (typeof results)[number],
    (typeof results)[number],
    (typeof results)[number],
    (typeof results)[number],
  ];
  let divergence: string | undefined;
  const changedByC = guard.check();
  if (changedByC.length > 0)
    divergence = `run C wrote the command's files (${changedByC.join(', ')}); they are put back`;
  const differ = (what: string, other: typeof a) => (x: unknown, y: unknown) => {
    if (divergence === undefined && canonical(encode(x)) !== canonical(encode(y)))
      divergence = `${what}: ${describeRun(a.plan)} gave ${shortText(encode(x), 80)}, ${describeRun(other.plan)} gave ${shortText(encode(y), 80)}`;
  };
  for (const other of [b, d, c]) {
    differ('status', other)(a.status, other.status);
    differ('stdout', other)(a.stdout, other.stdout);
    for (const path of options.collect ?? []) differ(path, other)(a.files[path], other.files[path]);
  }
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
      wrapped: { ret: encode(recorded(d)) },
      plain: { ret: encode(recorded(c)) },
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
