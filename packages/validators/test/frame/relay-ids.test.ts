import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameError } from '../../src/frame';
import { RELAY } from '../../src/frame/driver';
import { checkReply } from '../../src/frame/isolate';

/**
 * The relay matches the answer of each run to the request it asked (PR 1432: on Node 22 run A answered a call with the
 * answer of another, GitHub run 39881420053). These tests start the real relay worker with fake runs: a child process
 * that answers every request with the id of the request, or with another id. The run that answers another id is named
 * in the frame error with both ids; with the id check of the relay removed, the answer is taken for the answer.
 */

vi.setConfig({ testTimeout: 60_000 });

const TOKEN = 'test-token-0123';

/** A fake run: answers the start, then every request with `id + shift` (shift 0 is an honest run). */
const FAKE_RUN = String.raw`
import { createInterface } from 'node:readline';
const shift = Number(process.argv[2]);
let token;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (token === undefined) {
    token = message.token;
    process.stdout.write(token + ' ' + JSON.stringify({ ready: true }) + '\n');
    return;
  }
  process.stdout.write(token + ' ' + JSON.stringify({ id: message.id + shift, ret: message.id }) + '\n');
});
`;

const folders: string[] = [];
const workers: Worker[] = [];
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The real relay worker over fake runs A, B and D, one per shift. The first reply is the start of the runs. */
function relayOf(shifts: [number, number, number]) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-ids-'));
  folders.push(dir);
  const plans = (['A', 'B', 'D'] as const).map((run, index) => ({
    run,
    driverDir: join(dir, run),
    driverFile: 'run.mjs',
    driverSource: FAKE_RUN,
    argvTail: [String(shifts[index])],
    setup: {},
    uptimeShift: 0,
    depth: 0,
  }));
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(4);
  const flag = new Int32Array(signal);
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(RELAY)}`), {
    execArgv: [],
    workerData: { port: port2, signal, plans, setup: { token: TOKEN, tag: 'relay-ids' } },
    transferList: [port2],
  });
  workers.push(worker);
  worker.unref();
  port1.unref();
  const next = (): Record<string, unknown> => {
    const waited = Atomics.wait(flag, 0, 0, 30_000);
    const reply = receiveMessageOnPort(port1)?.message as Record<string, unknown> | undefined;
    Atomics.store(flag, 0, 0);
    if (waited === 'timed-out' || reply === undefined) throw new Error('the relay did not answer within 30 s');
    return reply;
  };
  next();
  return {
    call(name: string) {
      port1.postMessage({ call: name, args: [], freeze: false });
      return next();
    },
  };
}

describe('the relay checks the id of every answer', () => {
  it('takes the answers of runs that answer the request they were asked', () => {
    const relay = relayOf([0, 0, 0]);
    for (const expected of [1, 2]) {
      const reply = relay.call('f');
      expect(() => checkReply(reply, expected, 'f')).not.toThrow();
      expect(reply.answers).toEqual([
        { id: expected, ret: expected },
        { id: expected, ret: expected },
        { id: expected, ret: expected },
      ]);
    }
  });

  it('fails the call with a frame error that names both ids when a run answers another request', () => {
    const relay = relayOf([10, 0, 0]);
    const reply = relay.call('bootstrapCI');
    expect(() => checkReply(reply, 1, 'bootstrapCI')).toThrow(FrameError);
    expect(() => checkReply(reply, 1, 'bootstrapCI')).toThrow(
      /the run A answered request 11 while request 1 was waiting \(call 1, bootstrapCI\)/,
    );
  });

  it('names the run that answered another request, when it is not run A', () => {
    const relay = relayOf([0, 0, -1]);
    relay.call('f');
    const reply = relay.call('wilson');
    expect(() => checkReply(reply, 2, 'wilson')).toThrow(
      /the run D answered request 1 while request 2 was waiting \(call 2, wilson\)/,
    );
  });
});
