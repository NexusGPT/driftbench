import type { IOSetup, PointerIO } from '../blind/bank/index';
import { pinSut, resolveSut } from '../sut/adapter';
import { blindBinding } from '../sut/blind-binding/index';
import type { PointerSut } from '../sut/port';
import {
  type CallMessage,
  type Descriptor,
  decode,
  methodsOf,
  PARTS,
  wireError,
} from './rpc';

/**
 * The process that holds the reader. The process of an item (`item-child.ts`) starts it, sends it calls
 * (`reader-link.ts`) and keeps the oracle of the item to itself: this process loads the reader, runs the calls and
 * returns their answers as data. It has no channel to the parent of the runner, no verdict to send and no oracle to
 * reach. What a reader does to `process.send` or to the descriptor of its channel here reaches only the answers it
 * gives, which are its outputs anyway.
 *
 * It resolves the system under test from the module the runner named when it started it (`pinSut`), before the
 * reader loads, and ignores the variable after that.
 */

type Reply = { resolve(value: unknown): void; reject(cause: Error): void };

async function main(): Promise<void> {
  // First of all, before any of the reader loads: a change of the variable from now on changes nothing.
  pinSut();
  // The channel as it is now: the reader may wrap `process.send` when it loads.
  const send = (process.send as (message: unknown) => boolean).bind(process);
  process.on('disconnect', () => process.exit(0));

  let loading: Promise<PointerSut> | undefined;
  const sutOnce = (): Promise<PointerSut> => {
    loading ??= resolveSut();
    return loading;
  };

  let asked = 0;
  const waiting = new Map<number, Reply>();
  const ask = (message: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++asked;
      waiting.set(id, { resolve, reject });
      send({ ...message, id });
    });
  const stub =
    (fn: number) =>
    (...args: unknown[]): Promise<unknown> =>
      ask({ t: 'cb', fn, args });

  /** The callbacks the harness lends a blind adapter: the effects ride beside the call, the fetch is asked for. */
  function ioOf(call: number, setup: IOSetup | undefined): PointerIO {
    const fixture = () => {
      if (!setup) throw new Error('transport fixture absent');
      return setup;
    };
    const effect = (op: string, args: unknown[]) => send({ t: 'io', call, op, args });
    return {
      readKey() {
        effect('readKey', []);
        return fixture().key;
      },
      fetch: async (request) => (await ask({ t: 'iofetch', call, args: [request] })) as never,
      readCassette() {
        effect('readCassette', []);
        return structuredClone(fixture().cached) as never;
      },
      writeCassette(path, value, committed) {
        effect('writeCassette', [path, value, committed]);
      },
      log(value) {
        effect('log', [value]);
      },
      plan(value) {
        effect('plan', [value]);
      },
    };
  }

  function describe(sut: PointerSut): Descriptor {
    const parts: Record<string, string[]> = {};
    for (const part of PARTS) {
      const value = (sut as unknown as Record<string, unknown>)[part];
      if (value !== undefined && value !== null) parts[part] = methodsOf(value);
    }
    return { name: sut.name, isolate: sut.isolate === true, parts };
  }

  const reply = (message: { t: 'ok' | 'err'; id: number; value?: unknown; error?: unknown }): void => {
    try {
      send(message);
    } catch (cause) {
      // An answer that cannot cross the wire (a function, a cycle) is reported as the failure it is.
      send({ t: 'err', id: message.id, error: wireError(cause) });
    }
  };

  async function serve(message: CallMessage): Promise<void> {
    try {
      const args = message.args.map((arg) => decode(arg, stub));
      let value: unknown;
      if (message.target === 'ping') {
        value = true;
      } else if (message.target === 'ready') {
        const sut = await sutOnce();
        await sut.ready?.();
        value = describe(sut);
      } else if (message.target === 'sut') {
        const sut = await sutOnce();
        const path = message.path;
        let owner: unknown = sut;
        for (const step of path.slice(0, -1)) owner = (owner as Record<string, unknown>)[step];
        const name = path[path.length - 1] as string;
        const method = (owner as Record<string, unknown> | undefined)?.[name];
        if (typeof method !== 'function') throw new Error(`the reader has no ${path.join('.')}`);
        value = await (method as (...rest: unknown[]) => unknown).apply(owner, args);
      } else if (message.target === 'blind') {
        const [request, wanted] = args as [
          Parameters<ReturnType<typeof blindBinding>['execute']>[0],
          { present: boolean; setup?: IOSetup },
        ];
        const io = wanted.present ? ioOf(message.id, wanted.setup) : undefined;
        value = await blindBinding(resolveSut).execute(request, io);
      } else {
        throw new Error(`no target ${String(message.target)}`);
      }
      reply({ t: 'ok', id: message.id, value });
    } catch (cause) {
      reply({ t: 'err', id: message.id, error: wireError(cause) });
    }
  }

  process.on('message', (raw: unknown) => {
    if (raw === null || typeof raw !== 'object') return;
    const message = raw as { t?: unknown; id?: unknown; value?: unknown; error?: { name: string; message: string } };
    if (message.t === 'call') {
      void serve(raw as CallMessage);
    } else if ((message.t === 'cbok' || message.t === 'cberr') && typeof message.id === 'number') {
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.t === 'cbok') pending.resolve(message.value);
      else pending.reject(new Error(message.error?.message ?? 'the callback failed'));
    }
  });
}

if (process.env.DRIFTBENCH_POINTER_READER_HOST === '1' && process.send) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  });
}
