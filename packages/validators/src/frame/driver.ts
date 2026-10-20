/**
 * The programs of the frame's runs, written to drawn files (docs/validators.md, "The frame: the product runs apart,
 * the parent decides"). Every identifier in them is drawn per run, and so is the way the twin driver listens on
 * stdin: no helper name on the stack and no line of an entry file is the same from one run to the next, so a
 * product cannot recognise the frame by a fixed text (review of PR 892: a product keyed on the fixed helper
 * `nested` on the stack, or on the driver's fixed readline line read through `process.argv[1]`, passed under the
 * frame and was wrong for users).
 *
 * - The twin driver (runs A and B): its first line on stdin is its setup (the loader to register, the uptime shift,
 *   the call depth, the module or the command, the token); for a module, each further line is one call, and each
 *   answer is one line on stdout that starts with the token, so a line the product prints is never an answer.
 * - The plain entry (run C): a short module that imports the product, makes one call with arguments read from a file,
 *   and writes the answer to a file, as a user's own script would call the product. It has no stdin protocol.
 */

import { rngOf } from './twins';

/** Distinct drawn identifiers, each holding an upper-case letter, so none is a keyword of the language. */
function namer(seed: number, tag: string): (key: string) => string {
  const rng = rngOf(seed, `driver:${tag}`);
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const taken = new Set<string>();
  const names = new Map<string, string>();
  return (key) => {
    const known = names.get(key);
    if (known) return known;
    for (;;) {
      const length = 4 + Math.floor(rng() * 9);
      let out = '';
      while (out.length < length) out += lower[Math.floor(rng() * lower.length)];
      const at = 1 + Math.floor(rng() * (length - 1));
      out = `${out.slice(0, at)}${(out[at] as string).toUpperCase()}${out.slice(at + 1)}`;
      if (taken.has(out)) continue;
      taken.add(out);
      names.set(key, out);
      return out;
    }
  };
}

/** Fills the «name» slots of a template with drawn identifiers. */
function fill(template: string, name: (key: string) => string): string {
  return template.replace(/«([a-zA-Z]+)»/g, (_whole, key: string) => name(key));
}

/** The value codec of the runs, the same as tape.ts: tags for what JSON cannot hold. */
const CODEC = String.raw`
const «open» = '$';
let «counter» = 0;
const «handles» = new Map();
const «esc» = («key») => («key».startsWith(«open») ? «open» + «key» : «key»);
const «unesc» = («key») => («key».startsWith(«open» + «open») ? «key».slice(1) : «key»);
function «encode»(«value», «seen» = new WeakSet()) {
  if («value» === null) return null;
  switch (typeof «value») {
    case 'string': case 'boolean': return «value»;
    case 'number': return Number.isFinite(«value») ? (Object.is(«value», -0) ? { $n: '-0' } : «value») : { $n: String(«value») };
    case 'undefined': return { $u: 1 };
    case 'bigint': return { $big: «value».toString() };
    case 'symbol': return { $opaque: typeof «value» };
    case 'function': { const «id» = ++«counter»; «handles».set(«id», «value»); return { $handle: «id» }; }
  }
  if («seen».has(«value»)) return { $opaque: 'cycle' };
  «seen».add(«value»);
  try {
    if («value» instanceof Map) return { $map: [...«value».entries()].map(([«k», «v»]) => [«encode»(«k», «seen»), «encode»(«v», «seen»)]) };
    if («value» instanceof Set) return { $set: [...«value».values()].map((«v») => «encode»(«v», «seen»)) };
    if («value» instanceof Error) return { $err: { name: «value».name, message: «value».message } };
    if (Array.isArray(«value»)) return «value».map((«v») => «encode»(«v», «seen»));
    if («value» instanceof Date) return { $date: «value».toISOString() };
    if (ArrayBuffer.isView(«value»)) return { $bytes: [...new Uint8Array(«value».buffer, «value».byteOffset, «value».byteLength)] };
    const «proto» = Object.getPrototypeOf(«value»);
    if («proto» !== Object.prototype && «proto» !== null) return { $opaque: («proto» && «proto».constructor && «proto».constructor.name) || 'object' };
    return Object.fromEntries(Object.entries(«value»).map(([«k», «v»]) => [«esc»(«k»), «encode»(«v», «seen»)]));
  } finally {
    «seen».delete(«value»);
  }
}
function «decode»(«x») {
  if («x» === null || typeof «x» !== 'object') return «x»;
  if (Array.isArray(«x»)) return «x».map(«decode»);
  if ('$n' in «x») return «x».$n === '-0' ? -0 : Number(«x».$n);
  if ('$u' in «x») return undefined;
  if ('$big' in «x») return BigInt(«x».$big);
  if ('$map' in «x») return new Map(«x».$map.map(([«k», «v»]) => [«decode»(«k»), «decode»(«v»)]));
  if ('$set' in «x») return new Set(«x».$set.map(«decode»));
  if ('$date' in «x») return new Date(«x».$date);
  if ('$bytes' in «x») return Uint8Array.from(«x».$bytes);
  if ('$handle' in «x») return «handles».get(«x».$handle);
  if ('$fn' in «x») return (0, eval)('(' + «x».$fn + ')');
  if ('$err' in «x») { const «Class» = { Error, RangeError, TypeError, SyntaxError, ReferenceError, EvalError, URIError }[«x».$err.name] || Error; const «e» = new «Class»(«x».$err.message); «e».name = «x».$err.name; return «e»; }
  return Object.fromEntries(Object.entries(«x»).map(([«k», «v»]) => [«unesc»(«k»), «decode»(«v»)]));
}
`;

const TWIN = String.raw`
import { pathToFileURL as «toUrl» } from 'node:url';
const «pending» = [];
const «waiters» = [];
let «rest» = '';
let «ended» = false;
process.stdin.setEncoding('utf8');
process.stdin.«listen»('data', («chunk») => {
  «rest» += «chunk»;
  for (let «at» = «rest».indexOf('\n'); «at» >= 0; «at» = «rest».indexOf('\n')) {
    const «line» = «rest».slice(0, «at»);
    «rest» = «rest».slice(«at» + 1);
    const «waiter» = «waiters».shift();
    if («waiter») «waiter»(«line»);
    else «pending».push(«line»);
  }
});
process.stdin.«listen»('end', () => {
  «ended» = true;
  for (const «waiter» of «waiters».splice(0)) «waiter»(undefined);
});
const «next» = () =>
  «pending».length > 0
    ? Promise.resolve(«pending».shift())
    : «ended»
      ? Promise.resolve(undefined)
      : new Promise((«resolveIt») => «waiters».push(«resolveIt»));
const «setup» = JSON.parse(await «next»());
const «write» = process.stdout.write.bind(process.stdout);
const «cpuNow» = process.cpuUsage.bind(process);
const «answer» = («message») => «write»(«setup».token + ' ' + JSON.stringify(«message») + '\n');

if ('nodeOptions' in «setup») {
  if («setup».nodeOptions === null) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = «setup».nodeOptions;
}
if («setup».loader) {
  const { register: «register» } = await import(«toUrl»(«setup».loader).href);
  «register»();
}
if («setup».uptimeShift > 0) {
  const «shift» = «setup».uptimeShift;
  const «realUptime» = process.uptime;
  const «shifted» = { uptime() { return «realUptime».call(process) + «shift»; } }.uptime;
  Object.defineProperty(process, 'uptime', { value: «shifted», writable: true, configurable: true });
  const «realNow» = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', { value: { now() { return «realNow»() + «shift» * 1000; } }.now, writable: true, configurable: true });
}
«codec»
const «deeper» = («depth», «run») => («depth» <= 0 ? «run»() : «deeper»(«depth» - 1, «run»));

if («setup».command) {
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  process.stdin.pause();
  process.argv = [process.argv[0], «setup».script || «setup».command, ...«setup».args];
  await import(«toUrl»(«setup».command).href);
} else {
  let «product»;
  try {
    «product» = await import(«toUrl»(«setup».module).href);
    «answer»({ ready: true, shape: Object.fromEntries(Object.keys(«product»).map((key) => [key, typeof «product»[key] === 'function' ? { fn: 1 } : { value: «encode»(«product»[key]) }])) });
  } catch («error») {
    «answer»({ ready: false, error: String(«error» && «error».stack ? «error».stack : «error») });
  }
  for (let «text» = await «next»(); «text» !== undefined; «text» = await «next»()) {
    const «request» = JSON.parse(«text»);
    const «handle» = «request».call.startsWith('#');
    const «fn» = «handle»
      ? «handles».get(Number(«request».call.slice(1)))
      : «setup».invoke
        ? (...«rest») => «product»[«setup».invoke](«request».call, «rest»)
        : «product»[«request».call];
    try {
      if (typeof «fn» !== 'function') throw new TypeError('the product has no function ' + «request».call);
      const «args» = «decode»(«request».args);
      const «before» = «cpuNow»();
      const «result» = await «deeper»(«setup».depth, () => «fn»(...«args»));
      const «used» = «cpuNow»(«before»);
      «answer»({ id: «request».id, ret: «encode»(«result»), cpu: («used».user + «used».system) / 1000 });
    } catch («error») {
      «answer»({ id: «request».id, throws: «encode»(«error» instanceof Error ? «error» : new Error(String(«error»))) });
    }
  }
}
`;

/** The twin driver of one run, its identifiers and its stdin listener drawn from the seed and the tag. */
export function twinDriver(seed: number, tag: string): string {
  const name = namer(seed, `twin:${tag}`);
  const listen = rngOf(seed, `listen:${tag}`)() < 0.5 ? 'on' : 'addListener';
  const codec = fill(CODEC, name);
  // Function replacers: the codec holds '$', which a replacement string would read as a pattern.
  return fill(
    TWIN.replace('«codec»', () => codec).replace(/«listen»/g, () => listen),
    name,
  );
}

/**
 * The neutral wrapper module of run D: it imports the product and calls one of its functions by name through array
 * and function methods, so the product is called from another module and from native frames, not straight from the
 * driver. Its identifiers are drawn.
 */
export function wrapperModule(
  seed: number,
  tag: string,
  product: string,
): { source: string; invoke: string } {
  const name = namer(seed, `wrapper:${tag}`);
  const source = [
    `import * as ${name('product')} from ${JSON.stringify(product)};`,
    `export const ${name('invoke')} = async (${name('call')}, ${name('args')}) => {`,
    `  const ${name('fn')} = ${name('product')}[${name('call')}];`,
    `  if (typeof ${name('fn')} !== 'function') throw new TypeError('the product has no function ' + ${name('call')});`,
    `  return [${name('args')}].map((${name('list')}) => Function.prototype.apply.call(${name('fn')}, undefined, ${name('list')}))[0];`,
    `};`,
    '',
  ].join('\n');
  return { source, invoke: name('invoke') };
}

/** The codec module of run C: the value codec and the table of handles, exported under drawn names. */
export function plainCodec(
  seed: number,
  tag: string,
): { source: string; encode: string; decode: string; handles: string } {
  const name = namer(seed, `codec:${tag}`);
  const source = `${fill(CODEC, name)}\nexport { ${name('encode')}, ${name('decode')}, ${name('handles')} };\n`;
  return { source, encode: name('encode'), decode: name('decode'), handles: name('handles') };
}

/**
 * The entry of run C for a batch of calls: one fresh process that imports the product and the codec, reads the calls
 * from a file, makes them in order and writes every answer to a file. The state a call leaves (a counter, a
 * handle) is kept from one call to the next, as in the confined runs. Paths are file URLs.
 */
export function plainBatchEntry(
  seed: number,
  tag: string,
  paths: { module: string; codec: string; calls: string; out: string },
  codec: { encode: string; decode: string; handles: string },
): string {
  const name = namer(seed, `plain:${tag}`);
  const product = name('product');
  const calls = name('calls');
  const out = name('out');
  const each = name('each');
  const fn = name('fn');
  const answer = name('answer');
  const error = name('error');
  return [
    `import * as ${product} from ${JSON.stringify(paths.module)};`,
    `import { readFileSync as ${name('read')}, writeFileSync as ${name('write')} } from 'node:fs';`,
    `import { ${codec.encode} as ${name('encode')}, ${codec.decode} as ${name('decode')}, ${codec.handles} as ${name('handles')} } from ${JSON.stringify(paths.codec)};`,
    `const ${calls} = JSON.parse(${name('read')}(new URL(${JSON.stringify(paths.calls)}), 'utf8'));`,
    `const ${out} = [];`,
    `for (const ${each} of ${calls}) {`,
    `  let ${answer};`,
    `  try {`,
    `    const ${fn} = ${each}.call.startsWith('#') ? ${name('handles')}.get(Number(${each}.call.slice(1))) : ${product}[${each}.call];`,
    `    if (typeof ${fn} !== 'function') throw new TypeError('the product has no function ' + ${each}.call);`,
    `    ${answer} = { ret: ${name('encode')}(await ${fn}(...${name('decode')}(${each}.args))) };`,
    `  } catch (${error}) { ${answer} = { throws: ${name('encode')}(${error} instanceof Error ? ${error} : new Error(String(${error}))) }; }`,
    `  ${out}.push(${answer});`,
    `}`,
    `${name('write')}(new URL(${JSON.stringify(paths.out)}), JSON.stringify(${out}));`,
    '',
  ].join('\n');
}

/**
 * The relay: a worker thread of the validator's process that owns the two twin runs. The validator's thread posts a
 * call and waits on a shared flag; the relay sends it to both runs and posts back both answers. So the product's
 * calls stay synchronous for the item, and only one call is in flight.
 */
export const RELAY = String.raw`
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { workerData } from 'node:worker_threads';
const { port, signal, plans, setup } = workerData;
const flag = new Int32Array(signal);
const reply = (message) => { port.postMessage(message); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const runs = plans.map((plan) => {
  mkdirSync(plan.driverDir, { recursive: true });
  if (plan.cwd) mkdirSync(plan.cwd, { recursive: true });
  if (plan.home) mkdirSync(plan.home, { recursive: true });
  const file = join(plan.driverDir, plan.driverFile);
  writeFileSync(file, plan.driverSource);
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
  child.stdin.write(JSON.stringify({ ...setup, ...plan.setup, uptimeShift: plan.uptimeShift, depth: plan.depth }) + '\n');
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
