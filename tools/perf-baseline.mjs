#!/usr/bin/env node
/**
 * driftbench performance baseline.
 *
 * Measures the paths a user waits on and prints one JSON document and one table:
 *   node-bare          an empty Node.js process, the floor under every other row
 *   cli-help           `driftbench --help`, the cold start (10 runs)
 *   cli-version        `driftbench --version`, what the CI smoke step runs (10 runs)
 *   load:<package>     importing each built package entry point in a fresh process
 *   acme-run           the Acme campaign on a fresh store: 7 specs, 14 cells, no model
 *   acme-replay        the Acme conversations replayed from the cache of a seeded store
 *   generate-acme-t2   `driftbench generate` on the approved Acme map at strength 2
 *   judge-replay       `driftbench judge run` on the recorded Acme council cassette
 *   validator-smoke    `driftbench validate stats --seed 1`, from source as CI runs it
 *
 * Two kinds of number come out of every row.
 *   Clock: wall time, CPU time and peak memory, as a median over several runs with the quartiles and the
 *     range. They depend on the host, and a loaded host moves them a lot: read the spread before the median.
 *   Counts: modules loaded, data files read and read again, bytes hashed, JSON parses, child processes,
 *     network connections. A probe counts them in a separate run, so the probe never touches a timing.
 *     They do not depend on the clock, and the same tree gives the same counts on every host.
 * Each row also carries a SHA-256 of what the command printed and wrote. Two trees whose hashes are equal
 * behave the same on that row, byte for byte.
 *
 * No model is called: children get a small environment without any key, and the probe counts network
 * connections, which stay at 0.
 *
 * Usage: node tools/perf-baseline.mjs [options]
 *   --out <file>       also write the JSON document to this file
 *   --markdown <file>  also write the table to this file
 *   --compare <file>   print a before and after table against an earlier JSON document
 *   --only <text>      run only the rows whose name contains this text; repeat it
 *   --runs <n>         timing runs per row, in place of each row's default
 *   --count-runs <n>   probe runs per row (default 2; two runs show whether the counts are stable)
 *   --runtime <mode>   dist (the built packages, default) or source (through tsx)
 *   --build            build the JavaScript of every package first, without the type declarations
 *   --json             print only the JSON document
 *   --label <text>     a name for this measurement, kept in the document
 *   --from <file>      measure nothing: print the tables of this earlier JSON document (with --compare, --markdown)
 * Exit: 0 measured, 1 a row failed, changed its output between runs, or differs in output from --compare,
 *   2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Scratch space inside the tree (ignored by git), so every relative path a command writes is the same on every host. */
const WORK = join(ROOT, '.cache', 'perf-baseline');
const PROBE_FILE = join(WORK, 'probe.mjs');

/**
 * The probe, loaded into a measured process with `--import`. In `light` mode it only reports the clock and
 * memory of the process at exit. In `full` mode it also counts what the process did.
 */
export const PROBE_SOURCE = String.raw`
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodeModule from 'node:module';
import net from 'node:net';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const out = process.env.DRIFTBENCH_PERF_OUT;
const full = process.env.DRIFTBENCH_PERF_PROBE === 'full';
const writeFileSync = fs.writeFileSync;
const statSync = fs.statSync;
const counts = {
  hash_objects: 0, hash_bytes: 0, json_parse_calls: 0, json_parse_chars: 0, json_stringify_calls: 0,
  child_processes: 0, network_connections: 0, dir_lists: 0, stats: 0,
};
const modules = { builtin: new Set(), dependency: new Set(), workspace: new Set() };
const moduleFiles = new Set();
const reads = [];
const writes = [];
let gc = 0;
let observer;

const pathOf = (target) => {
  if (typeof target === 'string') return target;
  if (target instanceof URL) return fileURLToPath(target);
  if (Buffer.isBuffer(target)) return target.toString();
  return '<descriptor>';
};
const sizeOf = (value, encoding) =>
  typeof value === 'string'
    ? Buffer.byteLength(value, typeof encoding === 'string' ? encoding : undefined)
    : value && typeof value.byteLength === 'number'
      ? value.byteLength
      : 0;

if (full) {
  if (typeof nodeModule.registerHooks === 'function') {
    nodeModule.registerHooks({
      load(url, context, nextLoad) {
        if (url.startsWith('node:')) modules.builtin.add(url);
        else if (url.startsWith('file:')) {
          const file = fileURLToPath(url);
          moduleFiles.add(file);
          (file.includes('/node_modules/') ? modules.dependency : modules.workspace).add(file);
        }
        return nextLoad(url, context);
      },
    });
  }

  const wrap = (object, name, before, after) => {
    const original = object[name];
    if (typeof original !== 'function') return;
    object[name] = function (...args) {
      before?.(args);
      const result = Reflect.apply(original, this, args);
      if (after === undefined) return result;
      if (result && typeof result.then === 'function') {
        return result.then((value) => {
          after(args, value);
          return value;
        });
      }
      after(args, result);
      return result;
    };
    for (const key of Reflect.ownKeys(original)) {
      if (key !== 'length' && key !== 'name' && key !== 'prototype') {
        Reflect.defineProperty(object[name], key, Reflect.getOwnPropertyDescriptor(original, key));
      }
    }
  };
  const read = (args, value) => reads.push([pathOf(args[0]), sizeOf(value)]);
  const write = (args) => writes.push([pathOf(args[0]), sizeOf(args[1], args[2])]);
  const count = (name) => () => {
    counts[name] += 1;
  };

  wrap(fs, 'readFileSync', undefined, read);
  wrap(fs.promises, 'readFile', undefined, read);
  wrap(fs, 'readFile', (args) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') return;
    args[args.length - 1] = function (error, value) {
      if (!error) read(args, value);
      return Reflect.apply(callback, this, [error, value]);
    };
  });
  for (const name of ['writeFileSync', 'appendFileSync', 'writeFile', 'appendFile']) wrap(fs, name, write);
  for (const name of ['writeFile', 'appendFile']) wrap(fs.promises, name, write);
  for (const name of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) wrap(fs, name, count('dir_lists'));
  for (const name of ['readdir', 'opendir']) wrap(fs.promises, name, count('dir_lists'));
  for (const name of ['statSync', 'lstatSync', 'existsSync', 'accessSync', 'stat', 'lstat', 'access']) {
    wrap(fs, name, count('stats'));
  }
  for (const name of ['stat', 'lstat', 'access']) wrap(fs.promises, name, count('stats'));

  const createHash = crypto.createHash;
  crypto.createHash = function (...args) {
    counts.hash_objects += 1;
    const hash = Reflect.apply(createHash, this, args);
    const update = hash.update;
    hash.update = function (data, encoding) {
      counts.hash_bytes += sizeOf(data, encoding);
      return update.call(this, data, encoding);
    };
    return hash;
  };
  if (typeof crypto.hash === 'function') {
    wrap(crypto, 'hash', (args) => {
      counts.hash_objects += 1;
      counts.hash_bytes += sizeOf(args[1]);
    });
  }

  const parse = JSON.parse;
  const stringify = JSON.stringify;
  JSON.parse = function (...args) {
    counts.json_parse_calls += 1;
    if (typeof args[0] === 'string') counts.json_parse_chars += args[0].length;
    return Reflect.apply(parse, JSON, args);
  };
  JSON.stringify = function (...args) {
    counts.json_stringify_calls += 1;
    return Reflect.apply(stringify, JSON, args);
  };

  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    wrap(childProcess, name, count('child_processes'));
  }
  // A connection to a local pipe (tsx talks to its own loader over one) is not the network.
  wrap(net.Socket.prototype, 'connect', (args) => {
    const target = Array.isArray(args[0]) ? args[0][0] : args[0];
    const pipe = typeof target === 'string' ? Number.isNaN(Number(target)) : typeof target?.path === 'string';
    if (!pipe) counts.network_connections += 1;
  });
  if (typeof globalThis.fetch === 'function') wrap(globalThis, 'fetch', count('network_connections'));

  nodeModule.syncBuiltinESMExports();
  observer = new PerformanceObserver((list) => {
    gc += list.getEntries().length;
  });
  observer.observe({ entryTypes: ['gc'] });
}

process.on('exit', () => {
  const cpu = process.cpuUsage();
  const report = {
    wall_ms: performance.now(),
    cpu_ms: (cpu.user + cpu.system) / 1000,
    max_rss_mb: process.resourceUsage().maxRSS / 1024,
    heap_used_mb: process.memoryUsage().heapUsed / 1048576,
    extra: globalThis.__driftbenchPerf ?? null,
  };
  if (full) {
    gc += observer.takeRecords().length;
    const data = reads.filter(([file]) => !moduleFiles.has(file));
    const sum = (rows) => rows.reduce((total, row) => total + row[1], 0);
    let moduleBytes = 0;
    for (const file of moduleFiles) {
      try {
        moduleBytes += statSync(file).size;
      } catch {}
    }
    report.counts = {
      modules: modules.builtin.size + modules.dependency.size + modules.workspace.size,
      modules_builtin: modules.builtin.size,
      modules_dependency: modules.dependency.size,
      modules_workspace: modules.workspace.size,
      module_bytes: moduleBytes,
      file_reads: data.length,
      file_reads_distinct: new Set(data.map(([file]) => file)).size,
      file_read_bytes: sum(data),
      file_writes: writes.length,
      file_write_bytes: sum(writes),
      ...counts,
    };
    const byPackage = {};
    for (const file of modules.dependency) {
      const inside = file.slice(file.lastIndexOf('/node_modules/') + 14).split('/');
      const name = inside[0].startsWith('@') ? inside[0] + '/' + inside[1] : inside[0];
      byPackage[name] = (byPackage[name] ?? 0) + 1;
    }
    const timesRead = {};
    for (const [file] of data) timesRead[file] = (timesRead[file] ?? 0) + 1;
    const cwd = process.cwd() + '/';
    report.files_read_again = Object.fromEntries(
      Object.entries(timesRead)
        .filter(([, times]) => times > 1)
        .map(([file, times]) => [file.startsWith(cwd) ? file.slice(cwd.length) : file.split('/').at(-1), times])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    );
    const byWorkspace = {};
    for (const file of modules.workspace) {
      const match = /\/(packages|examples)\/([^/]+)\//.exec(file);
      const name = match ? match[1] + '/' + match[2] : 'other';
      byWorkspace[name] = (byWorkspace[name] ?? 0) + 1;
    }
    report.modules_by_workspace = Object.fromEntries(
      Object.entries(byWorkspace).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    );
    report.modules_by_package = Object.fromEntries(
      Object.entries(byPackage).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    );
    report.noisy = { gc_events: gc, json_parse_chars: counts.json_parse_chars };
    delete report.counts.json_parse_chars;
  }
  if (out) writeFileSync(out, JSON.stringify(report));
});
`;

/** Writes the probe where `runNode` loads it from. */
export function writeProbe() {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(PROBE_FILE, PROBE_SOURCE);
}

/** The value at quantile q (0 to 1) of the numbers, by linear interpolation. */
export function quantile(values, q) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Median, quartiles and range of the numbers. `spread_pct` is the interquartile range over the median. */
export function summarize(values) {
  const round = (value) => Math.round(value * 100) / 100;
  const median = quantile(values, 0.5);
  const p25 = quantile(values, 0.25);
  const p75 = quantile(values, 0.75);
  return {
    median: round(median),
    p25: round(p25),
    p75: round(p75),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    spread_pct: median === 0 ? 0 : round(((p75 - p25) / median) * 100),
    runs: values.length,
  };
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** An ISO 8601 instant, such as the time a run started. */
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
/** The measured latency of a real process, as a stored run records it: the field, and the evidence of the budget check. */
const LATENCY = /("latencyMs": )\d+(\.\d+)?|(latency )\d+(\.\d+)?( ms)/g;

/** Text with every clock value a stored run carries replaced: instants and measured latencies. */
export const maskClock = (text) =>
  text
    .replace(INSTANT, '<instant>')
    .replace(LATENCY, (_all, field, _a, word, _b, unit) =>
      field !== undefined ? `${field}"<latency>"` : `${word}<latency>${unit}`,
    );

/**
 * One hash for a folder: every file's path and content hash, in path order. `skip` names files left out, and
 * `mask` rewrites the text of each file first, for files that record when or where they were made.
 */
export function treeHash(folder, { skip = [], mask } = {}) {
  const rows = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!skip.includes(relative(folder, path))) {
        const content = mask === undefined ? readFileSync(path) : mask(readFileSync(path, 'utf8'));
        rows.push(`${relative(folder, path)}\0${sha256(content)}`);
      }
    }
  };
  walk(folder);
  return { files: rows.length, sha256: sha256(rows.join('\n')) };
}

/** The environment of a measured process: enough to run Node.js, and no key of any kind. */
function childEnv(extra) {
  const env = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot', 'TEMP', 'TMP']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { ...env, NO_COLOR: '1', ...extra };
}

/** Runs one Node.js process. `probe` is `light`, `full` or undefined for a process with nothing added. */
export function runNode(args, { probe, cwd = ROOT } = {}) {
  const outFile = join(WORK, `probe-${process.pid}.json`);
  rmSync(outFile, { force: true });
  const nodeArgs = probe === undefined ? args : ['--import', pathToFileURL(PROBE_FILE).href, ...args];
  const env = childEnv(
    probe === undefined ? {} : { DRIFTBENCH_PERF_PROBE: probe, DRIFTBENCH_PERF_OUT: outFile },
  );
  const start = process.hrtime.bigint();
  const child = spawnSync(process.execPath, nodeArgs, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const wall = Number(process.hrtime.bigint() - start) / 1e6;
  if (child.error) throw child.error;
  const report =
    probe !== undefined && existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : undefined;
  rmSync(outFile, { force: true });
  return { wall_ms: wall, status: child.status, stdout: child.stdout, stderr: child.stderr, report };
}

function cli(runtime) {
  return runtime === 'source'
    ? ['--import', 'tsx', join(ROOT, 'packages/cli/src/bin.ts')]
    : [join(ROOT, 'packages/cli/dist/bin.js')];
}

function packageNames() {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Text with every path under the work folder and the tree root replaced, so a hash does not depend on the host. */
const portable = (text) =>
  text.replaceAll(WORK, '<work>').replaceAll(ROOT, '<root>').replace(INSTANT, '<instant>');

/**
 * The hash of a stored campaign: its exported bundle (the campaign, every run record, every spec) with the
 * clock values and the path of the tree masked (a run record names its spec file by absolute path). The
 * manifest is left out, because it holds the hashes of the files before the mask.
 */
function campaignHash(bin, id, work) {
  const exported = runNode([
    ...bin,
    'campaign',
    'export',
    id,
    '--store',
    join(work, 'acme.db'),
    '--out',
    join(work, 'export'),
  ]);
  if (exported.status !== 0) throw new Error(`campaign export failed\n${exported.stderr}`);
  const tree = treeHash(join(work, 'export', id), {
    skip: ['manifest.json'],
    mask: (text) => portable(maskClock(text)),
  });
  return { run_records: tree.files, campaign_sha256: tree.sha256 };
}

/**
 * The rows. Each has `args(work)`, the Node.js arguments of one run, and may have `prepare(work)` (untimed,
 * before every run), `outputs(run, work)` (what is hashed, beyond stdout) and `check(run)` (a reason the run is
 * not the one this row means to measure, or undefined).
 */
export function scenarios(runtime) {
  const bin = cli(runtime);
  const acmeSpecs = 'examples/acme/specs';
  const conversations = 'examples/acme/specs/conversations';
  const cassette = 'examples/acme/criteria/council.cassette.json';
  const seedStore = join(WORK, 'seed', 'acme.db');
  const rows = [
    { name: 'node-bare', runtime: 'node', runs: 10, args: () => ['-e', ''] },
    { name: 'cli-help', runtime, runs: 10, args: () => [...bin, '--help'] },
    { name: 'cli-version', runtime, runs: 10, args: () => [...bin, '--version'] },
  ];
  for (const name of packageNames()) {
    const entry =
      runtime === 'source'
        ? join(ROOT, 'packages', name, 'src/index.ts')
        : join(ROOT, 'packages', name, 'dist/index.js');
    rows.push({
      name: `load:${name}`,
      runtime,
      runs: 5,
      args: () => [
        ...(runtime === 'source' ? ['--import', 'tsx'] : []),
        '--input-type=module',
        '-e',
        'const start = performance.now(); await import(process.argv[1]); globalThis.__driftbenchPerf = { import_ms: performance.now() - start };',
        pathToFileURL(entry).href,
      ],
    });
  }
  rows.push(
    {
      name: 'acme-run',
      runtime,
      runs: 5,
      args: (work) => [
        ...bin,
        'campaign',
        'run',
        acmeSpecs,
        '--repeats',
        '2',
        '--campaign',
        'perf-acme-run',
        '--store',
        join(work, 'acme.db'),
      ],
      check: (run) =>
        /14 cells: 14 pass, 0 fail, 0 failed\. Spent \$0\.00\./.test(run.stdout)
          ? undefined
          : 'the campaign did not end on 14 passing cells at no cost',
      outputs: (_run, work) => campaignHash(bin, 'perf-acme-run', work),
    },
    {
      name: 'acme-replay',
      runtime,
      runs: 5,
      setup: () => {
        rmSync(dirname(seedStore), { recursive: true, force: true });
        mkdirSync(dirname(seedStore), { recursive: true });
        const seeded = runNode([
          ...bin,
          'campaign',
          'run',
          conversations,
          '--repeats',
          '2',
          '--campaign',
          'perf-acme-seed',
          '--store',
          seedStore,
        ]);
        if (seeded.status !== 0) throw new Error(`acme-replay: seeding the store failed\n${seeded.stderr}`);
      },
      prepare: (work) => {
        for (const suffix of ['', '-wal', '-shm']) {
          if (existsSync(seedStore + suffix)) cpSync(seedStore + suffix, join(work, `acme.db${suffix}`));
        }
      },
      args: (work) => [
        ...bin,
        'campaign',
        'run',
        conversations,
        '--repeats',
        '2',
        '--campaign',
        'perf-acme-replay',
        '--store',
        join(work, 'acme.db'),
      ],
      check: (run) => {
        const replayed = run.stdout
          .split('\n')
          .filter((line) => line.includes('replayed from the cache')).length;
        return replayed === 12 ? undefined : `${replayed} of 12 cells came from the cache`;
      },
      outputs: (_run, work) => campaignHash(bin, 'perf-acme-replay', work),
    },
    {
      name: 'generate-acme-t2',
      runtime,
      runs: 5,
      args: (work) => [
        ...bin,
        'generate',
        '--map',
        'examples/acme/map/approved.yaml',
        '--out',
        join(work, 'generated'),
        '--baseline',
        acmeSpecs,
        '--t',
        '2',
      ],
      outputs: (_run, work) => {
        const tree = treeHash(join(work, 'generated'));
        return { files_written: tree.files, tree_sha256: tree.sha256 };
      },
    },
    {
      name: 'judge-replay',
      runtime,
      runs: 5,
      args: () => [...bin, 'judge', 'run', '--criteria', 'examples/acme/criteria', '--cassette', cassette],
      check: (run) =>
        /12 of 12 criteria separated/.test(run.stdout)
          ? undefined
          : 'the recorded judge set did not separate 12 of 12',
      outputs: () => ({ cassette_sha256: sha256(readFileSync(join(ROOT, cassette))) }),
    },
    {
      // The validators spawn their bank from source files, so this row runs through tsx, as CI does.
      name: 'validator-smoke',
      runtime: 'source',
      runs: 3,
      args: () => [...cli('source'), 'validate', 'stats', '--seed', '1', '--json'],
    },
  );
  return rows;
}

/** Measures one row: `runs` timing runs with the light probe, then `countRuns` runs with the full probe. */
export function measure(row, { runs, countRuns }) {
  const work = join(WORK, 'work');
  const fresh = () => {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    row.prepare?.(work);
  };
  const result = { name: row.name, runtime: row.runtime };
  const hashes = new Set();
  const statuses = new Set();
  const record = (run) => {
    const problem = row.check?.(run);
    if (problem !== undefined)
      throw new Error(`${row.name}: ${problem}\n${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`);
    statuses.add(run.status);
    const outputs = { stdout_sha256: sha256(portable(run.stdout)), ...row.outputs?.(run, work) };
    hashes.add(JSON.stringify(outputs));
    return outputs;
  };
  row.setup?.();

  const timings = [];
  let outputs;
  for (let index = 0; index < (runs ?? row.runs); index += 1) {
    fresh();
    const run = runNode(row.args(work), { probe: 'light' });
    if (run.report === undefined)
      throw new Error(`${row.name}: the process wrote no report\n${run.stderr.slice(-2000)}`);
    outputs = record(run);
    timings.push({
      wall: run.wall_ms,
      cpu: run.report.cpu_ms,
      rss: run.report.max_rss_mb,
      extra: run.report.extra,
    });
  }
  if (timings.length > 0) {
    result.wall_ms = summarize(timings.map((timing) => timing.wall));
    result.cpu_ms = summarize(timings.map((timing) => timing.cpu));
    result.max_rss_mb = summarize(timings.map((timing) => timing.rss));
    if (timings[0].extra?.import_ms !== undefined) {
      result.import_ms = summarize(timings.map((timing) => timing.extra.import_ms));
    }
  }

  const counted = [];
  for (let index = 0; index < countRuns; index += 1) {
    fresh();
    const run = runNode(row.args(work), { probe: 'full' });
    if (run.report?.counts === undefined)
      throw new Error(`${row.name}: the probe wrote no counts\n${run.stderr.slice(-2000)}`);
    outputs = record(run);
    counted.push(run.report);
  }
  if (counted.length > 0) {
    result.counts = counted[0].counts;
    result.modules_by_package = counted[0].modules_by_package;
    result.modules_by_workspace = counted[0].modules_by_workspace;
    result.files_read_again = counted[0].files_read_again;
    const unstable = Object.keys(result.counts).filter((key) =>
      counted.some((report) => report.counts[key] !== result.counts[key]),
    );
    result.counts_stable = counted.length > 1 ? unstable.length === 0 : null;
    if (unstable.length > 0) {
      result.counts_unstable = Object.fromEntries(
        unstable.map((key) => [key, counted.map((report) => report.counts[key]).join(' / ')]),
      );
    }
    // Kept as text: these move from run to run, and are here to be read, not compared.
    result.noisy = {
      gc_events: counted.map((report) => report.noisy.gc_events).join(' / '),
      json_parse_chars: counted.map((report) => report.noisy.json_parse_chars).join(' / '),
    };
  }
  result.exit_code = statuses.size === 1 ? [...statuses][0] : [...statuses].join(' / ');
  result.outputs = outputs;
  result.output_stable = hashes.size === 1 && statuses.size === 1;
  rmSync(work, { recursive: true, force: true });
  return result;
}

const number = (value) => (value === undefined || value === null ? '' : String(value));
const pad = (rows) => {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`);
};

/** The table of a document, as Markdown lines. */
export function table(document) {
  const head = [
    'row',
    'wall ms (median)',
    'wall p25 to p75',
    'spread %',
    'cpu ms',
    'peak MB',
    'modules',
    'reads',
    'read again',
    'hashes',
    'hashed kB',
    'JSON parses',
    'children',
    'network',
    'stable',
  ];
  const body = document.rows.map((row) => {
    const counts = row.counts ?? {};
    return [
      row.name,
      number(row.wall_ms?.median),
      row.wall_ms ? `${row.wall_ms.p25} to ${row.wall_ms.p75}` : '',
      number(row.wall_ms?.spread_pct),
      number(row.cpu_ms?.median),
      number(row.max_rss_mb?.median),
      number(counts.modules),
      number(counts.file_reads),
      counts.file_reads === undefined ? '' : String(counts.file_reads - counts.file_reads_distinct),
      number(counts.hash_objects),
      counts.hash_bytes === undefined ? '' : String(Math.round(counts.hash_bytes / 1024)),
      number(counts.json_parse_calls),
      number(counts.child_processes),
      number(counts.network_connections),
      row.output_stable && row.counts_stable !== false ? 'yes' : 'no',
    ];
  });
  const rows = pad([head, head.map(() => ''), ...body]);
  rows[1] = rows[1].replace(/[^|]/g, '-');
  return rows;
}

/** A before and after table of two documents, row by row. */
export function compare(before, after) {
  const head = [
    'row',
    'wall ms',
    'cpu ms',
    'modules',
    'reads',
    'hashes',
    'JSON parses',
    'children',
    'output',
  ];
  const change = (a, b) => {
    if (a === undefined || b === undefined) return '';
    if (a === b) return `${a} (same)`;
    const pct = a === 0 ? '' : ` (${b > a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%)`;
    return `${a} to ${b}${pct}`;
  };
  const body = [];
  for (const row of after.rows) {
    const old = before.rows.find((candidate) => candidate.name === row.name);
    if (old === undefined) continue;
    const same =
      JSON.stringify(old.outputs) === JSON.stringify(row.outputs) && old.exit_code === row.exit_code;
    body.push([
      row.name,
      change(old.wall_ms?.median, row.wall_ms?.median),
      change(old.cpu_ms?.median, row.cpu_ms?.median),
      change(old.counts?.modules, row.counts?.modules),
      change(old.counts?.file_reads, row.counts?.file_reads),
      change(old.counts?.hash_objects, row.counts?.hash_objects),
      change(old.counts?.json_parse_calls, row.counts?.json_parse_calls),
      change(old.counts?.child_processes, row.counts?.child_processes),
      same ? 'identical' : 'CHANGED',
    ]);
  }
  const rows = pad([head, head.map(() => ''), ...body]);
  rows[1] = rows[1].replace(/[^|]/g, '-');
  return rows;
}

function git(args) {
  const child = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return child.status === 0 ? child.stdout.trim() : null;
}

/**
 * Builds the JavaScript of every package with the package's own build command, less `--dts`. Type
 * declarations never run, so a tree whose declarations do not compile can still be measured.
 */
function build() {
  for (const name of packageNames()) {
    const folder = join(ROOT, 'packages', name);
    const command = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.build;
    if (typeof command !== 'string' || !command.startsWith('tsup ')) continue;
    const words = command.split(' ').filter((word) => word !== '--dts');
    const child = spawnSync('pnpm', ['exec', ...words, '--silent'], {
      cwd: folder,
      encoding: 'utf8',
      env: childEnv(),
    });
    if (child.status !== 0) return `${name}: ${child.stdout}${child.stderr}`;
  }
  return undefined;
}

async function main() {
  let options;
  try {
    options = parseArgs({
      options: {
        out: { type: 'string' },
        markdown: { type: 'string' },
        compare: { type: 'string' },
        only: { type: 'string', multiple: true },
        runs: { type: 'string' },
        'count-runs': { type: 'string', default: '2' },
        runtime: { type: 'string', default: 'dist' },
        build: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        label: { type: 'string', default: 'baseline' },
        from: { type: 'string' },
      },
    }).values;
  } catch (cause) {
    process.stderr.write(`perf-baseline: ${cause.message}\n`);
    return 2;
  }
  const runs = options.runs === undefined ? undefined : Number(options.runs);
  const countRuns = Number(options['count-runs']);
  if (
    (runs !== undefined && (!Number.isSafeInteger(runs) || runs < 0)) ||
    !Number.isSafeInteger(countRuns) ||
    countRuns < 0 ||
    !['dist', 'source'].includes(options.runtime)
  ) {
    process.stderr.write(
      'perf-baseline: --runs and --count-runs take whole numbers, --runtime takes dist or source\n',
    );
    return 2;
  }
  const log = (text) => process.stderr.write(`${text}\n`);

  if (options.from !== undefined) {
    const document = JSON.parse(readFileSync(resolve(options.from), 'utf8'));
    return print(document, options, false);
  }

  if (options.build) {
    log('building the JavaScript of every package');
    const problem = build();
    if (problem !== undefined) {
      process.stderr.write(`perf-baseline: the build failed\n${problem}\n`);
      return 1;
    }
  }
  if (options.runtime === 'dist' && !existsSync(join(ROOT, 'packages/cli/dist/bin.js'))) {
    process.stderr.write(
      'perf-baseline: packages/cli/dist/bin.js is missing. Run `pnpm build`, or pass --build or --runtime source.\n',
    );
    return 2;
  }

  writeProbe();
  const selected = scenarios(options.runtime).filter(
    (row) => options.only === undefined || options.only.some((text) => row.name.includes(text)),
  );
  const loadBefore = loadavg();
  const rows = [];
  let failed = false;
  for (const row of selected) {
    log(`measuring ${row.name}`);
    try {
      const measured = measure(row, { runs, countRuns });
      if (!measured.output_stable) failed = true;
      rows.push(measured);
    } catch (cause) {
      failed = true;
      rows.push({ name: row.name, runtime: row.runtime, error: String(cause.message).split('\n')[0] });
      log(String(cause.message));
    }
  }
  const document = {
    tool: 'tools/perf-baseline.mjs',
    label: options.label,
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    date: new Date().toISOString().slice(0, 10),
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: availableParallelism(),
      load_1m_before: Math.round(loadBefore[0] * 10) / 10,
      load_1m_after: Math.round(loadavg()[0] * 10) / 10,
    },
    runtime: options.runtime,
    rows,
  };
  rmSync(PROBE_FILE, { force: true });

  return print(document, options, failed);
}

/** The Markdown page of a document: what was measured, on what, and the table. */
export function page(document) {
  const host = document.host;
  return [
    `# Performance: ${document.label}`,
    '',
    `Written by \`node tools/perf-baseline.mjs\` on ${document.date}, at commit \`${document.commit}\`${document.dirty ? ' with local changes' : ''}.`,
    `Host: Node.js ${host.node}, ${host.platform} ${host.arch}, ${host.cpus} cores, load average ${host.load_1m_before} before and ${host.load_1m_after} after.`,
    '',
    'Wall time, CPU time and peak memory are medians over several runs of a fresh process. On a loaded host',
    'they move a lot: read the spread (the interquartile range over the median) before the median. CPU time and',
    'peak memory are those of the measured process alone, not of the child processes it starts.',
    '',
    'The counts come from one more run under a probe, and do not depend on the clock: modules loaded, data files',
    'read, reads of a file already read, hash objects and kilobytes hashed, JSON parses, child processes and',
    'network connections. The last column says whether two probe runs gave the same counts and every run gave the',
    'same output. The JSON document beside this page holds every number, the modules per dependency and the',
    'SHA-256 of what each row printed and wrote.',
    '',
    ...table(document),
    '',
  ].join('\n');
}

/** Prints a document and its tables, and writes the files the options name. */
function print(document, options, failed) {
  const lines = table(document);
  if (options.out !== undefined)
    writeFileSync(resolve(options.out), `${JSON.stringify(document, null, 2)}\n`);
  if (options.markdown !== undefined) writeFileSync(resolve(options.markdown), page(document));
  let changed = false;
  if (options.json) process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  else {
    if (options.from === undefined) process.stdout.write(`${JSON.stringify(document, null, 2)}\n\n`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  if (options.compare !== undefined) {
    const before = JSON.parse(readFileSync(resolve(options.compare), 'utf8'));
    const rows = compare(before, document);
    changed = rows.some((row) => row.includes('CHANGED'));
    if (!options.json) {
      process.stdout.write(`\nBefore (${before.label}, ${before.commit}) and after (${document.label}):\n`);
      process.stdout.write(`${rows.join('\n')}\n`);
    }
  }
  return failed || changed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
