import { type ChildProcess, fork } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IOSetup, PointerAdapter, PointerIO, Request } from '../blind/bank/index';
import { ioSetups } from '../blind/bank/io';
import { type PointerSut, ReaderNotReachable } from '../sut/port';
import { type Descriptor, encode, PARTS, reviveError, type Target, type WireError, wireError } from './rpc';
import { Problem } from './types';

/**
 * The side of the oracle. The process that holds the oracle of the items (`item-child.ts`) starts a second process
 * for the reader (`reader-host.ts`) and talks to it over a channel the reader has no way to turn into a verdict:
 * the reader answers calls, and every answer is data the oracle reads. The pool keeps one such process and starts
 * another when the item overruns or the process ends; a session is what one item holds of it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, 'reader-host.ts');
/** How long the reader may take to load in its process before the pool gives up. */
const LOAD_MS = 120_000;
/** How long a reader process may take to answer a ping before the pool replaces it. */
const PING_MS = 5_000;

type Pending = {
  resolve(value: unknown): void;
  reject(cause: Error): void;
  owned: number[];
  timer?: NodeJS.Timeout;
};

type Callback = (...args: unknown[]) => unknown;

/** One reader process, as the oracle sees it. */
class Host {
  /** Set when the process ended, with the words the item reports. */
  exited: string | undefined;
  descriptor: Descriptor | undefined;
  failure: WireError | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly handles = new Map<number, Callback>();
  private readonly ios = new Map<number, PointerIO>();
  private calls = 0;
  private handlesMade = 0;

  private constructor(readonly child: ChildProcess) {
    child.on('message', (message: unknown) => this.onMessage(message));
    child.on('exit', (code, signal) =>
      this.end(`the item stopped the reader's process (exit code ${code ?? signal})`),
    );
    child.on('error', (cause) => this.end(`the reader's process failed: ${cause.message}`));
  }

  /** Starts the process, and waits for the reader to load in it. A host that could not load keeps its failure. */
  static async start(module: string): Promise<Host> {
    const repo = resolve(HERE, '../../../../../..');
    const child = fork(HOST, [], {
      execArgv: ['--import', pathToFileURL(join(repo, 'node_modules/tsx/dist/esm/index.mjs')).href],
      serialization: 'advanced',
      env: {
        ...process.env,
        DRIFTBENCH_POINTER_READER_HOST: '1',
        DRIFTBENCH_POINTER_SUT: module,
        TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH ?? join(repo, 'tsconfig.json'),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const host = new Host(child);
    try {
      host.descriptor = (await host.call('ready', [], [], undefined, LOAD_MS)) as Descriptor;
    } catch (cause) {
      host.failure = wireError(cause);
      host.kill();
    }
    return host;
  }

  get alive(): boolean {
    return this.exited === undefined;
  }

  /** The reader's process is stopped: its pending calls fail, and nothing it says afterwards counts. */
  kill(): void {
    this.end('the reader was stopped');
    try {
      this.child.kill('SIGKILL');
    } catch {
      // The process is gone already.
    }
  }

  private end(why: string): void {
    if (this.exited !== undefined) return;
    this.exited = why;
    for (const [id, pending] of [...this.pending]) this.settle(id, pending).reject(new Error(why));
  }

  private settle(id: number, pending: Pending): Pending {
    this.pending.delete(id);
    this.ios.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    for (const handle of pending.owned) this.handles.delete(handle);
    return pending;
  }

  /** Sends one call and waits for its answer. Functions in the arguments become handles the reader can call back. */
  call(target: Target, path: string[], args: unknown[], io?: PointerIO, within?: number): Promise<unknown> {
    if (this.exited !== undefined) return Promise.reject(new Error(this.exited));
    const id = ++this.calls;
    const owned: number[] = [];
    let wire: unknown[];
    try {
      wire = args.map((arg) =>
        encode(arg, (fn) => {
          const handle = ++this.handlesMade;
          this.handles.set(handle, fn);
          owned.push(handle);
          return handle;
        }),
      );
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return new Promise((done, fail) => {
      const entry: Pending = { resolve: done, reject: fail, owned };
      if (within !== undefined)
        entry.timer = setTimeout(
          () =>
            this.settle(id, entry).reject(
              new Error(`no answer from the reader's process within ${Math.round(within / 1000)} s`),
            ),
          within,
        );
      this.pending.set(id, entry);
      if (io) this.ios.set(id, io);
      try {
        this.child.send({ t: 'call', id, target, path, args: wire }, (cause: Error | null) => {
          if (cause) this.settle(id, entry).reject(cause);
        });
      } catch (cause) {
        this.settle(id, entry).reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  private onMessage(raw: unknown): void {
    if (raw === null || typeof raw !== 'object') return;
    const message = raw as {
      t?: unknown;
      id?: unknown;
      call?: unknown;
      fn?: unknown;
      op?: unknown;
      args?: unknown;
      value?: unknown;
      error?: unknown;
    };
    const id = typeof message.id === 'number' ? message.id : undefined;
    const args = Array.isArray(message.args) ? (message.args as unknown[]) : [];
    if (message.t === 'ok' || message.t === 'err') {
      const pending = id === undefined ? undefined : this.pending.get(id);
      if (id === undefined || !pending) return;
      this.settle(id, pending);
      if (message.t === 'ok') pending.resolve(message.value);
      else pending.reject(reviveError(message.error as WireError));
    } else if (message.t === 'cb' && id !== undefined && typeof message.fn === 'number') {
      void this.answer(id, () => {
        const fn = this.handles.get(message.fn as number);
        if (!fn) throw new Error('the reader called a callback that is gone');
        return fn(...args);
      });
    } else if (message.t === 'iofetch' && id !== undefined && typeof message.call === 'number') {
      void this.answer(id, () => {
        const io = this.ios.get(message.call as number);
        if (!io) throw new Error('the reader asked for a fetch outside a call');
        return io.fetch(args[0] as never);
      });
    } else if (message.t === 'io' && typeof message.call === 'number') {
      this.effect(message.call, message.op, args);
    }
  }

  /** Runs what the reader asked for and tells it the result. */
  private async answer(id: number, run: () => unknown): Promise<void> {
    let reply: Record<string, unknown>;
    try {
      reply = { t: 'cbok', id, value: await run() };
    } catch (cause) {
      reply = { t: 'cberr', id, error: wireError(cause) };
    }
    if (this.exited !== undefined) return;
    try {
      this.child.send(reply);
    } catch (cause) {
      try {
        this.child.send({ t: 'cberr', id, error: wireError(cause) });
      } catch {
        // The process is gone: the pending call ends with it.
      }
    }
  }

  /** An effect the reader reports (a key read, a cassette write): the trace of the oracle counts it. */
  private effect(call: number, op: unknown, args: unknown[]): void {
    const io = this.ios.get(call);
    if (!io) return;
    try {
      if (op === 'readKey') io.readKey();
      else if (op === 'readCassette') io.readCassette();
      else if (op === 'writeCassette')
        io.writeCassette(args[0] as string, args[1] as never, args[2] as boolean);
      else if (op === 'log') io.log(args[0] as never);
      else if (op === 'plan') io.plan(args[0] as never);
    } catch {
      // A fixture that is absent throws in the reader's process too; the count is what the trace keeps.
    }
  }
}

/** What one item holds of a reader process. */
export type Session = {
  /** The reader as the items call it. */
  sut: PointerSut;
  /** The reader as the blind bank calls it. */
  adapter: PointerAdapter;
  /** The item overran: the reader's process is stopped, and the next session starts another. */
  stop(): void;
  /** Why the reader's process ended during the item, when nobody stopped it. */
  lost(): string | undefined;
  /** True when `stop` ran: the pool has no reader process until it starts another. */
  stopped(): boolean;
};

/** A reader the harness could not load: every call says why. */
function unreachable(failure: WireError): Session {
  const refuse = async (): Promise<never> => {
    throw reviveError(failure);
  };
  return {
    sut: { name: 'unreachable', isolate: true, cut: refuse, scan: refuse },
    adapter: { execute: refuse },
    stop: () => {},
    lost: () => undefined,
    stopped: () => false,
  };
}

function remoteSut(host: Host, descriptor: Descriptor): PointerSut {
  const call = (path: string[], args: unknown[]) => host.call('sut', path, args);
  const sut: Record<string, unknown> = {
    name: descriptor.name,
    isolate: descriptor.isolate,
    ready: async () => {},
    cut: (file: unknown) => call(['cut'], [file]),
    scan: (request: unknown) => call(['scan'], [request]),
  };
  for (const part of PARTS) {
    const methods = descriptor.parts[part];
    if (methods === undefined) continue;
    const api: Record<string, unknown> = {};
    for (const method of methods)
      api[method] =
        part === 'links'
          ? () => {
              throw new Problem(
                `the reader offers links (${method}), which the harness cannot call across the process boundary: the port makes them synchronous`,
              );
            }
          : (...args: unknown[]) => call([part, method], args);
    sut[part] = api;
  }
  return sut as unknown as PointerSut;
}

function remoteAdapter(host: Host): PointerAdapter {
  return {
    execute: (request: Request, io?: PointerIO) => {
      const setup: IOSetup | undefined = io ? ioSetups.get(io) : undefined;
      const wanted = io ? { present: true, ...(setup ? { setup } : {}) } : { present: false };
      return host.call('blind', [], [request, wanted], io);
    },
  };
}

/**
 * Whether a reader process answers two calls in a row. The second call is the one that finds a reader that wrote
 * into the channel after its first answer: its answer never arrives in order.
 */
async function answers(host: Host): Promise<boolean> {
  for (let call = 0; call < 2; call += 1) {
    try {
      await host.call('ping', [], [], undefined, PING_MS);
    } catch {
      return false;
    }
  }
  return true;
}

/** The reader process of an item process: started when the first item asks, replaced when it ends or overruns. */
export class HostPool {
  private current: Promise<Host> | undefined;
  private failure: WireError | undefined;

  constructor(private readonly module: string) {}

  /**
   * A session on a reader process that loaded and answers: the pool starts one when it has none, and replaces one
   * that ended or that does not answer in time (a reader stuck in a loop). A reader that cannot load is final.
   */
  async open(): Promise<Session> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.failure) return unreachable(this.failure);
      const fresh = this.current === undefined;
      let starting = this.current;
      if (!starting) {
        starting = Host.start(this.module);
        this.current = starting;
      }
      const host = await starting;
      if (host.failure) {
        this.failure = host.failure;
        this.current = undefined;
        continue;
      }
      if (host.alive && (await answers(host))) return this.sessionOn(host, starting);
      host.kill();
      if (this.current === starting) this.current = undefined;
      // A reader that has just loaded and stops answering once it is called (it corrupts its own channel) is final.
      if (fresh)
        this.failure = {
          name: 'ReaderNotReachable',
          message: new ReaderNotReachable('the process of the reader stops answering once it is called').message,
        };
    }
    return unreachable(
      this.failure ?? {
        name: 'ReaderNotReachable',
        message: new ReaderNotReachable('the process of the reader keeps ending or does not answer').message,
      },
    );
  }

  private sessionOn(host: Host, starting: Promise<Host>): Session {
    let stopped = false;
    return {
      sut: remoteSut(host, host.descriptor as Descriptor),
      adapter: remoteAdapter(host),
      stop: () => {
        stopped = true;
        host.kill();
        if (this.current === starting) this.current = undefined;
      },
      lost: () => (stopped ? undefined : host.exited),
      stopped: () => stopped,
    };
  }

  /** Stops the reader process, if any. */
  async close(): Promise<void> {
    const current = this.current;
    this.current = undefined;
    if (current) (await current).kill();
  }
}
