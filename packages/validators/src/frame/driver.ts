/**
 * The driver of one run of the frame: a plain module written to a drawn file, started as `node <file> [args]`. Its
 * first line on stdin is its setup (the loader to register, the uptime shift, the call depth, the module or the
 * command, the token); nothing about the validator reaches its argv. For a module, each further line is one call,
 * and each answer is one line on stdout that starts with the token, so a line the product prints itself is never
 * taken for an answer. For a command, the driver sets the command's own argv and imports it.
 */
export const DRIVER = String.raw`
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const first = await lines.next();
const setup = JSON.parse(first.value);
const token = setup.token;
const write = process.stdout.write.bind(process.stdout);
const answer = (message) => write(token + ' ' + JSON.stringify(message) + '\n');

if (setup.loader) {
  const { register } = await import(pathToFileURL(setup.loader).href);
  register();
}
if (setup.uptimeShift > 0) {
  const shift = setup.uptimeShift;
  const uptime = process.uptime;
  const shifted = { uptime() { return uptime.call(process) + shift; } }.uptime;
  Object.defineProperty(process, 'uptime', { value: shifted, writable: true, configurable: true });
  const now = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', { value: { now() { return now() + shift * 1000; } }.now, writable: true, configurable: true });
}

const OPEN = '$';
const esc = (key) => (key.startsWith(OPEN) ? OPEN + key : key);
const unesc = (key) => (key.startsWith(OPEN + OPEN) ? key.slice(1) : key);
function encode(value, seen = new WeakSet()) {
  if (value === null) return null;
  switch (typeof value) {
    case 'string': case 'boolean': return value;
    case 'number': return Number.isFinite(value) ? (Object.is(value, -0) ? { $n: '-0' } : value) : { $n: String(value) };
    case 'undefined': return { $u: 1 };
    case 'bigint': return { $big: value.toString() };
    case 'symbol': case 'function': return { $opaque: typeof value };
  }
  if (seen.has(value)) return { $opaque: 'cycle' };
  seen.add(value);
  try {
    if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [encode(k, seen), encode(v, seen)]) };
    if (value instanceof Set) return { $set: [...value.values()].map((v) => encode(v, seen)) };
    if (value instanceof Error) return { $err: { name: value.name, message: value.message } };
    if (Array.isArray(value)) return value.map((v) => encode(v, seen));
    if (value instanceof Date) return { $date: value.toISOString() };
    if (ArrayBuffer.isView(value)) return { $bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)] };
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return { $opaque: (proto && proto.constructor && proto.constructor.name) || 'object' };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [esc(k), encode(v, seen)]));
  } finally {
    seen.delete(value);
  }
}
function decode(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(decode);
  if ('$n' in x) return x.$n === '-0' ? -0 : Number(x.$n);
  if ('$u' in x) return undefined;
  if ('$big' in x) return BigInt(x.$big);
  if ('$map' in x) return new Map(x.$map.map(([k, v]) => [decode(k), decode(v)]));
  if ('$set' in x) return new Set(x.$set.map(decode));
  if ('$date' in x) return new Date(x.$date);
  if ('$bytes' in x) return Uint8Array.from(x.$bytes);
  if ('$err' in x) { const e = new Error(x.$err.message); e.name = x.$err.name; return e; }
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [unesc(k), decode(v)]));
}
const nested = (depth, run) => (depth <= 0 ? run() : nested(depth - 1, run));

if (setup.command) {
  process.argv = [process.argv[0], setup.command, ...setup.args];
  await import(pathToFileURL(setup.command).href);
} else {
  let product;
  try {
    product = await import(pathToFileURL(setup.module).href);
    answer({ ready: true });
  } catch (error) {
    answer({ ready: false, error: String(error && error.stack ? error.stack : error) });
  }
  for (;;) {
    const next = await lines.next();
    if (next.done) break;
    const request = JSON.parse(next.value);
    const fn = product[request.call];
    try {
      if (typeof fn !== 'function') throw new TypeError('the product has no function ' + request.call);
      const args = decode(request.args);
      const value = await nested(setup.depth, () => fn(...args));
      answer({ id: request.id, ret: encode(value) });
    } catch (error) {
      answer({ id: request.id, throws: encode(error instanceof Error ? error : new Error(String(error))) });
    }
  }
}
`;

/**
 * The relay: a worker thread of the validator's process that owns the two runs. The validator's thread posts a
 * call and waits on a shared flag; the relay sends it to both runs and posts back both answers. So the product's
 * calls stay synchronous for the item, and only one call is in flight.
 */
export const RELAY = String.raw`
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { workerData } from 'node:worker_threads';
const { port, signal, plans, driver, setup } = workerData;
const flag = new Int32Array(signal);
const reply = (message) => { port.postMessage(message); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const runs = plans.map((plan) => {
  mkdirSync(plan.driverDir, { recursive: true });
  if (plan.cwd) mkdirSync(plan.cwd, { recursive: true });
  const file = join(plan.driverDir, plan.driverFile);
  writeFileSync(file, driver);
  const child = spawn(process.execPath, [file, ...plan.argvTail], {
    cwd: plan.cwd ?? process.cwd(),
    env: plan.env ?? process.env,
    execArgv: [],
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const run = { plan, child, waiting: [], stderr: '', exited: undefined };
  child.stderr.on('data', (chunk) => { run.stderr = (run.stderr + chunk).slice(-4000); });
  child.on('exit', (code, sig) => {
    run.exited = 'the run ' + plan.run + ' ended (' + (sig ?? code) + '): ' + run.stderr.split('\n').slice(-6).join(' ');
    for (const waiter of run.waiting.splice(0)) waiter({ dead: run.exited });
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith(setup.token + ' ')) return;
    const message = JSON.parse(line.slice(setup.token.length + 1));
    const waiter = run.waiting.shift();
    if (waiter) waiter(message);
  });
  child.stdin.write(JSON.stringify({ ...setup, uptimeShift: plan.uptimeShift, depth: plan.depth }) + '\n');
  return run;
});
const ask = (run, line) =>
  new Promise((resolve) => {
    if (run.exited) return resolve({ dead: run.exited });
    run.waiting.push(resolve);
    if (line !== undefined) run.child.stdin.write(line + '\n');
  });
const ready = await Promise.all(runs.map((run) => ask(run)));
reply({ ready });
let id = 0;
port.on('message', async (message) => {
  if (message.close) {
    for (const run of runs) run.child.kill();
    reply({ closed: true });
    return;
  }
  id += 1;
  const line = JSON.stringify({ id, call: message.call, args: message.args });
  const answers = await Promise.all(runs.map((run) => ask(run, line)));
  reply({ answers });
});
`;
