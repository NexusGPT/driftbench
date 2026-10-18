import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  type CheckSet,
  type LoadedSpec,
  loadSpecs,
  type SandboxProvider,
  type Spec,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import {
  AUDIT_FILE,
  type Candidate,
  type FaultDef,
  faultAdapter,
  GATE_DEFAULTS,
  GATE_REPORT_FILE,
  GATED_DIR,
  type GateOptions,
  gateFiles,
  HOLDOUT_DIR,
  importFaultSet,
  REVIEW_FILE,
  renderFunnel,
  runGate,
} from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import type { Command } from 'commander';
import { exists } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { type CampaignScope, defaultDeps, parseTarget, resolveAdapter, showTarget } from './campaign';

export type GateCommandOptions = {
  reference: string[];
  faults: string;
  out: string;
  k?: string;
  route?: string[];
  origin?: string[];
  judgeFamily?: string;
  seed?: string;
  holdout?: string;
  audit?: string;
  overlap?: string;
  date?: string;
  concurrency?: string;
  force?: boolean;
  json?: boolean;
};

/** What the gate runs with. Tests pass their own. */
export type GateDeps = {
  /** The reference adapter of a target, or undefined when this build has none for it. */
  adapterFor(target: ReturnType<typeof parseTarget>, scope: CampaignScope): Promise<AgentAdapter | undefined>;
  checks: CheckSet;
  artifacts?: ArtifactReaderRegistry;
  driver(): UserDriver;
  /** The sandboxes of the process faults. */
  provider(scope: CampaignScope): Promise<SandboxProvider>;
  now(): Date;
};

export const defaultGateDeps: GateDeps = {
  adapterFor: (target, scope) => defaultDeps.adapterFor(target, scope),
  checks: defaultDeps.checks,
  ...(defaultDeps.artifacts ? { artifacts: defaultDeps.artifacts } : {}),
  driver: () => defaultDeps.driver(),
  provider: async (scope) => localProvider({ dir: await scope.tempDir() }),
  now: () => new Date(),
};

/**
 * `driftbench gate <specs> --reference <target> --faults <set> --out <dir>`: the validity gate. Nine
 * stages in order (observed state, leakage, shortcut, contrast, red first, stability, difficulty, label
 * audit, freshness); each rejects or marks with a named reason. Writes the gated suite, the sealed holdout,
 * gate-report.json, review.yaml and label-audit.yaml. Runs the deterministic agents only: no model is called.
 */
export function registerGateCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: GateDeps = defaultGateDeps,
): void {
  program
    .command('gate')
    .description('Pass candidate blocks through the nine-stage validity gate and write the gated suite')
    .argument('<specs>', 'the candidate specs: a folder or a file')
    .requiredOption(
      '--reference <adapter:agent>',
      'a reference agent, such as function:acme-sales; repeat it for several',
      collect,
    )
    .requiredOption(
      '--faults <path>',
      'the fault set: a module, or a folder whose index module exports faults',
    )
    .requiredOption('--out <dir>', 'the folder to write the gated suite and gate-report.json into')
    .option('--k <n>', `repeats on the reference for pass^k (default ${GATE_DEFAULTS.k})`)
    .option(
      '--route <tag=target>',
      'run specs with this tag on this reference, such as flow:price-sheet=process:acme-ops',
      collect,
    )
    .option(
      '--origin <path>',
      'specs the candidates came from, for the 13-gram overlap check; repeat it',
      collect,
    )
    .option('--judge-family <family>', 'the model family of the judge, for the family check')
    .option(
      '--seed <n>',
      `the seed of the label audit sample and the holdout split (default ${GATE_DEFAULTS.seed})`,
    )
    .option(
      '--holdout <share>',
      `the share of gated specs sealed in the holdout (default ${GATE_DEFAULTS.holdoutShare})`,
    )
    .option(
      '--audit <n>',
      `blocks sampled per family for the label audit (default ${GATE_DEFAULTS.auditPerFamily})`,
    )
    .option(
      '--overlap <share>',
      `the 13-gram overlap above which a block is rejected (default ${GATE_DEFAULTS.overlap})`,
    )
    .option('--date <YYYY-MM-DD>', 'the creation date the gated blocks record (default today)')
    .option('--concurrency <n>', 'specs run at the same time (default 4)')
    .option('--force', 'replace the output of an earlier run in the folder')
    .option('--json', 'print the report as JSON')
    .action(async (specs: string, options: GateCommandOptions) => {
      setExit(await gateCommand(specs, options, io, deps));
    });
}

/**
 * Exit 0 when the gated suite is written with at least one accepted block, 1 when it is written with none,
 * 2 on a usage or input error (nothing is written).
 */
export async function gateCommand(
  specsPath: string,
  options: GateCommandOptions,
  io: Io,
  deps: GateDeps = defaultGateDeps,
): Promise<number> {
  const parsed = parseOptions(options, deps.now());
  if (typeof parsed === 'string') {
    io.err(`${parsed}\n`);
    return 2;
  }
  const root = resolve(io.cwd, specsPath);
  const candidates = await loadCandidates(root, io);
  if (!candidates) return 2;

  let origin: Spec[] | undefined;
  if ((options.origin ?? []).length > 0) {
    const loaded = await loadSpecs((options.origin ?? []).map((path) => resolve(io.cwd, path)));
    const valid = loaded.filter((result): result is LoadedSpec => result.ok);
    if (valid.length === 0 || valid.length < loaded.length) {
      io.err(
        valid.length === 0
          ? 'No spec found under --origin.\n'
          : 'An --origin spec is invalid; run driftbench spec validate on it.\n',
      );
      return 2;
    }
    origin = valid.map((result) => result.spec);
  }

  const references = parsed.references;
  const routes = parsed.routes;
  const targetOf = (spec: Spec): string => {
    if (spec.target) {
      const own = showTarget(spec.target);
      if (references.includes(own)) return own;
    }
    const route = routes.find((entry) => (spec.tags ?? []).includes(entry.tag));
    return route?.target ?? (references[0] as string);
  };
  const misrouted = candidates
    .filter(({ spec }) => spec.target && !references.includes(showTarget(spec.target)))
    .map(({ spec }) => `${spec.id} (${showTarget(spec.target as NonNullable<Spec['target']>)})`);
  if (misrouted.length > 0) {
    io.err(`These specs name a target that is not a --reference: ${misrouted.join(', ')}.\n`);
    return 2;
  }
  for (const route of routes) {
    if (!references.includes(route.target)) {
      io.err(`--route ${route.tag}=${route.target}: ${route.target} is not a --reference.\n`);
      return 2;
    }
  }

  const faultPath = resolve(io.cwd, options.faults);
  let faults: FaultDef[];
  try {
    faults = [...(await importFaultSet(await faultModule(faultPath))).faults];
  } catch (cause) {
    io.err(`Cannot load the fault set ${display(faultPath, io)}: ${message(cause)}\n`);
    return 2;
  }

  const outPath = resolve(io.cwd, options.out);
  const reportPath = join(outPath, GATE_REPORT_FILE);
  if (await exists(reportPath)) {
    if (!options.force) {
      io.err(
        `${display(reportPath, io)} already exists: an earlier run wrote this folder. Pass --force to replace its output.\n`,
      );
      return 2;
    }
    for (const entry of [GATED_DIR, HOLDOUT_DIR, GATE_REPORT_FILE, REVIEW_FILE, AUDIT_FILE]) {
      await rm(join(outPath, entry), { recursive: true, force: true });
    }
  }

  const scope = openScope();
  try {
    const adapters = new Map<string, AgentAdapter>();
    for (const target of references) {
      const adapter = await resolveAdapter(
        parseTarget(target),
        () => deps.adapterFor(parseTarget(target), scope),
        io,
        [],
        { reference: true },
      );
      if (!adapter) {
        return 2;
      }
      adapters.set(target, adapter);
    }
    const provider = await deps.provider(scope);
    const unreachable = faults.filter((fault) => !references.includes(fault.target));
    if (unreachable.length > 0 && !options.json) {
      io.out(
        `Note: ${unreachable.map((fault) => fault.id).join(', ')} wrap a target that is not a --reference; they do not run.\n`,
      );
    }
    const result = await runGate({
      candidates,
      targetOf,
      references: adapters,
      faults: faults.map((def) => ({ def, adapter: faultAdapter(def, () => provider) })),
      run: {
        checks: deps.checks,
        ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
        driver: () => deps.driver(),
      },
      options: { ...parsed.options, ...(origin ? { origin } : {}) },
      concurrency: parsed.concurrency,
    });
    const files = gateFiles(result, candidates, {
      source: portable(display(root, io)),
      references,
      faultSet: portable(display(faultPath, io)),
      options: { ...parsed.options, ...(origin ? { origin } : {}) },
    });
    for (const file of files) {
      const target = join(outPath, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text);
    }
    const accepted = result.blocks.filter((record) => record.status === 'accepted').length;
    if (options.json) {
      const report = files.find((file) => file.path === GATE_REPORT_FILE);
      io.out(report?.text ?? '{}\n');
    } else {
      io.out(renderFunnel(result));
      io.out(`Wrote ${files.length} files to ${display(outPath, io)}.\n`);
    }
    return accepted > 0 ? 0 : 1;
  } finally {
    await scope.close(io);
  }
}

type Parsed = {
  references: string[];
  routes: { tag: string; target: string }[];
  options: GateOptions;
  concurrency: number;
};

function parseOptions(options: GateCommandOptions, now: Date): Parsed | string {
  const references: string[] = [];
  for (const text of options.reference) {
    const target = parseTarget(text);
    if (target.agent === undefined || target.adapter === '' || target.agent === '') {
      return `--reference takes adapter:agent, such as function:acme-sales, not "${text}".`;
    }
    const shown = showTarget(target);
    if (!references.includes(shown)) references.push(shown);
  }
  const routes: Parsed['routes'] = [];
  for (const text of options.route ?? []) {
    const at = text.indexOf('=');
    if (at <= 0 || at === text.length - 1)
      return `--route takes tag=target, such as flow:price-sheet=process:acme-ops, not "${text}".`;
    routes.push({ tag: text.slice(0, at), target: showTarget(parseTarget(text.slice(at + 1))) });
  }
  const k = whole(options.k, 'k', 1, GATE_DEFAULTS.k);
  const seed = whole(options.seed, 'seed', 0, GATE_DEFAULTS.seed);
  const audit = whole(options.audit, 'audit', 0, GATE_DEFAULTS.auditPerFamily);
  const concurrency = whole(options.concurrency, 'concurrency', 1, 4);
  const holdout = share(options.holdout, 'holdout', GATE_DEFAULTS.holdoutShare);
  const overlap = share(options.overlap, 'overlap', GATE_DEFAULTS.overlap);
  for (const value of [k, seed, audit, concurrency, holdout, overlap])
    if (typeof value === 'string') return value;
  const date = options.date ?? now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return `--date takes a date written YYYY-MM-DD, not "${date}".`;
  }
  return {
    references,
    routes,
    concurrency: concurrency as number,
    options: {
      k: k as number,
      seed: seed as number,
      date,
      holdoutShare: holdout as number,
      auditPerFamily: audit as number,
      ngram: GATE_DEFAULTS.ngram,
      overlap: overlap as number,
      ...(options.judgeFamily ? { judgeFamily: options.judgeFamily } : {}),
      wording: {
        dimensions: [...GATE_DEFAULTS.wording.dimensions],
        deviations: [...GATE_DEFAULTS.wording.deviations],
      },
    },
  };
}

async function loadCandidates(root: string, io: Io): Promise<Candidate[] | undefined> {
  const results = await loadSpecs([root]);
  if (results.length === 0) {
    io.err('No spec files found.\n');
    return undefined;
  }
  const base = (await isFolder(root)) ? root : dirname(root);
  const candidates: Candidate[] = [];
  let invalid = false;
  for (const result of results) {
    if (!result.ok) {
      invalid = true;
      io.err(`✗ ${display(result.path, io)}\n`);
      for (const issue of result.errors)
        io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
      continue;
    }
    candidates.push({ spec: result.spec, hash: result.hash, path: portable(relative(base, result.path)) });
  }
  if (invalid) {
    io.err('Fix the invalid specs first: nothing was gated.\n');
    return undefined;
  }
  const seen = new Set<string>();
  for (const { spec } of candidates) {
    if (seen.has(spec.id)) {
      io.err(`Two candidate specs share the id ${spec.id}: the gate keys blocks by spec id.\n`);
      return undefined;
    }
    seen.add(spec.id);
  }
  return candidates;
}

/** A fault set path: a module file, or a folder holding index.ts, index.mjs or index.js. */
async function faultModule(path: string): Promise<string> {
  if (!(await isFolder(path))) return path;
  for (const name of ['index.ts', 'index.mjs', 'index.js']) {
    if (await exists(join(path, name))) return join(path, name);
  }
  throw new Error('the folder holds no index.ts, index.mjs or index.js');
}

/** The gate's scope: a temporary folder for the process sandboxes, removed at the end. */
function openScope(): CampaignScope & { close(io: Io): Promise<void> } {
  let made: Promise<string> | undefined;
  return {
    tempDir() {
      made ??= mkdtemp(join(tmpdir(), 'driftbench-gate-'));
      return made;
    },
    async close(io) {
      const folder = await made?.catch(() => undefined);
      if (folder === undefined) return;
      try {
        await rm(folder, { recursive: true, force: true });
      } catch (cause) {
        io.err(`The sandbox folder ${folder} could not be removed: ${message(cause)}\n`);
      }
    },
  };
}

function whole(text: string | undefined, name: string, minimum: number, fallback: number): number | string {
  if (text === undefined) return fallback;
  const value = optionNumber(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < minimum) {
    return `--${name} must be a whole number of at least ${minimum}, got "${text}".`;
  }
  return value;
}

function share(text: string | undefined, name: string, fallback: number): number | string {
  if (text === undefined) return fallback;
  const value = optionNumber(text);
  if (text.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1) {
    return `--${name} must be a number from 0 to 1, got "${text}".`;
  }
  return value;
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function display(path: string, io: Io): string {
  const shown = relative(io.cwd, path);
  return shown === '' ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
