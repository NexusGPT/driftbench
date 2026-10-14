import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { type Inventory, type LoadedSpec, loadInventory, loadSpecs } from '@agent-nexus/driftbench-core';
import {
  AUDIT_FILE,
  coverElements,
  evidenceFromReport,
  formatJson,
  GATE_REPORT_FILE,
  GATED_DIR,
  type GateEvidence,
  type GateSeal,
  HOLDOUT_DIR,
  mergeEvidence,
  REVIEW_FILE,
  SEAL_FILE,
  type Selection,
  sealFromJson,
  selectGolden,
} from '@agent-nexus/driftbench-generate';
import { textTable as table } from '@agent-nexus/driftbench-report';
import {
  coverage,
  DEFAULT_MAX_CELLS,
  gridSize,
  loadSpaceMap,
  type SpaceCoverage,
} from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';

export { exists };

export const GOLDEN_FILE = 'golden.json';
export const GOLDEN_SPECS_DIR = 'specs';

export type SelectOptions = {
  cover: string;
  specs: string;
  out: string;
  k?: string;
  t?: string;
  force?: boolean;
  json?: boolean;
};

/** Registers `driftbench select`. */
export function registerSelectCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('select')
    .description(
      'Choose the golden set: the fewest gated conversations covering the cells of the map, then the k best.',
    )
    .requiredOption('--cover <map>', 'the map of situations (YAML or JSON)')
    .requiredOption(
      '--specs <dir>',
      'the gated specs: a folder written by driftbench gate, or a folder of specs; sealed specs never count',
    )
    .requiredOption('--out <dir>', 'the folder to write the golden set into')
    .option('--k <n>', 'the size of the golden set; without it, the whole cover')
    .option('--t <n>', 'cells on every subset of t dimensions (default 2: pairs)')
    .option('--force', 'replace the golden set an earlier run wrote in the folder')
    .option('--json', 'print one JSON document')
    .action(async (options: SelectOptions) => {
      setExit(await selectCommand(options, io));
    });
}

/**
 * `driftbench select --cover <map> --specs <dir> --out <dir> [--k n] [--t n]`. Exit 0 when the golden set
 * is written and covers every required cell, 1 when it is written and a required cell stays empty, 2 on a
 * usage or input error (nothing written).
 */
export async function selectCommand(options: SelectOptions, io: Io): Promise<number> {
  const mapPath = resolve(io.cwd, options.cover);
  const loaded = await loadSpaceMap(mapPath);
  if (!loaded.ok) {
    io.err(`✗ ${display(mapPath, io)}\n`);
    for (const issue of loaded.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    io.err('The map is invalid, so nothing was selected.\n');
    return 2;
  }
  const map = loaded.map;
  const dimensions = map.dimensions.length;
  const t = whole(options.t, 't', 1, 2);
  if (typeof t === 'string' || t > dimensions) {
    io.err(
      typeof t === 'string'
        ? `${t}\n`
        : `--t ${t}: the map has ${dimensions} dimensions, so t is a whole number from 1 to ${dimensions}.\n`,
    );
    return 2;
  }
  const k = options.k === undefined ? undefined : whole(options.k, 'k', 1, 1);
  if (typeof k === 'string') {
    io.err(`${k}\n`);
    return 2;
  }
  if (gridSize(map) > DEFAULT_MAX_CELLS) {
    io.err(`The full grid is over the limit of ${DEFAULT_MAX_CELLS} cells. Merge values or split the map.\n`);
    return 2;
  }

  let inventory: Inventory | undefined;
  if (map.inventory !== undefined) {
    const inventoryPath = resolve(dirname(mapPath), map.inventory);
    const read = await loadInventory(inventoryPath);
    if (!read.ok) {
      io.err(
        `The inventory the map names, ${display(inventoryPath, io)}, is invalid: nothing was selected.\n`,
      );
      return 2;
    }
    inventory = read.inventory;
  }

  const root = resolve(io.cwd, options.specs);
  const pool = await readPool(root, io);
  if (typeof pool === 'number') return pool;
  if (pool.specs.length === 0) {
    io.err('No unsealed spec found under --specs: there is nothing to select from.\n');
    return 2;
  }

  const outPath = resolve(io.cwd, options.out);
  const manifestPath = join(outPath, GOLDEN_FILE);
  if (inside(outPath, root) || inside(root, outPath)) {
    io.err('--out and --specs overlap: write the golden set to a folder of its own.\n');
    return 2;
  }
  if ((await exists(manifestPath)) && !options.force) {
    io.err(
      `${display(manifestPath, io)} already exists: an earlier run wrote this folder. Pass --force to replace it.\n`,
    );
    return 2;
  }

  const poolCoverage = coverage(map, pool.specs, { t, ...(inventory ? { inventory } : {}) });
  const elements = coverElements(poolCoverage);
  const selection = selectGolden({
    pool: pool.specs.map((spec) => spec.spec.id),
    cells: elements.cells,
    required: elements.required,
    ...(pool.evidence ? { evidence: pool.evidence.kills } : {}),
    ...(k === undefined ? {} : { k }),
  });

  const byId = new Map(pool.specs.map((spec) => [spec.spec.id, spec]));
  const chosen = selection.golden.flatMap((pick) => {
    const spec = byId.get(pick.id);
    return spec ? [spec] : [];
  });
  // The golden set measured again on its own, by the space package: the numbers printed are its numbers.
  const goldenCoverage = coverage(map, chosen, { t, ...(inventory ? { inventory } : {}) });

  if (options.force) {
    await rm(join(outPath, GOLDEN_SPECS_DIR), { recursive: true, force: true });
    await rm(manifestPath, { force: true });
  }
  const placed = goldenPaths(chosen, pool.base);
  const written: string[] = [];
  for (const spec of chosen) {
    const target = join(outPath, placed.get(spec.spec.id) ?? spec.spec.id);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(spec.path, target);
    written.push(portable(relative(outPath, target)));
  }
  const manifest = manifestOf({
    selection,
    pool,
    chosen,
    placed,
    goldenCoverage,
    poolCoverage,
    mapPath: portable(display(mapPath, io)),
    specsPath: portable(display(root, io)),
    agent: map.agent,
    version: map.version,
    t,
    k,
    io,
  });
  await writeFile(manifestPath, formatJson(manifest));

  if (options.json) io.out(formatJson(manifest));
  else {
    io.out(
      renderSelection(selection, goldenCoverage, pool, { t, k, agent: map.agent, version: map.version }),
    );
    io.out(`Wrote ${written.length + 1} files to ${display(outPath, io)}.\n`);
  }
  return goldenCoverage.required.every((cell) => cell.covered) ? 0 : 1;
}

/** The specs a selection or a seal may draw from, and what the gate wrote beside them. */
export type Pool = {
  /** The folder relative paths are taken from. */
  base: string;
  /** Valid specs that no gate seal lists. */
  specs: LoadedSpec[];
  /** Every spec a gate seal lists, with the loaded spec when it is under the folder read. */
  sealed: Array<{ id: string; file: string; hash: string; spec?: LoadedSpec }>;
  /** The gate seals found, with the file each was read from. */
  seals: Array<{ file: string; seal: GateSeal }>;
  /** The gate reports found. */
  reports: string[];
  evidence?: GateEvidence;
  /** Gate files that are not specs (review.yaml, label-audit.yaml), skipped. */
  skipped: string[];
};

/**
 * Reads a folder of gated specs. Gate seals (`holdout/seal.json`) and gate reports (`gate-report.json`)
 * are looked for under the folder and, when the folder is the gate's `specs/` folder, beside it. A spec a
 * seal lists never enters the pool, wherever it sits, and must still hash to the sealed value. Returns 2
 * after printing why when the input is unusable.
 */
export async function readPool(root: string, io: Io): Promise<Pool | number> {
  const info = await stat(root).catch(() => undefined);
  if (!info) {
    io.err(`Cannot find ${display(root, io)}.\n`);
    return 2;
  }
  const base = info.isDirectory() ? root : dirname(root);
  const results = await loadSpecs([root]);
  const skipped: string[] = [];
  const valid: LoadedSpec[] = [];
  let invalid = false;
  for (const result of results) {
    if (result.ok) {
      valid.push(result);
      continue;
    }
    if ([REVIEW_FILE, AUDIT_FILE].includes(basename(result.path))) {
      skipped.push(result.path);
      continue;
    }
    invalid = true;
    io.err(`✗ ${display(result.path, io)}\n`);
    for (const issue of result.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
  }
  if (invalid) {
    io.err('Fix the invalid specs first: nothing was read.\n');
    return 2;
  }

  const sealFiles: string[] = [];
  const reportFiles: string[] = [];
  if (info.isDirectory()) {
    for (const file of await walk(root)) {
      const name = basename(file);
      if (name === SEAL_FILE && basename(dirname(file)) === HOLDOUT_DIR) sealFiles.push(file);
      if (name === GATE_REPORT_FILE) reportFiles.push(file);
    }
    if (basename(root) === GATED_DIR) {
      const parent = dirname(root);
      if (await exists(join(parent, GATE_REPORT_FILE))) {
        reportFiles.push(join(parent, GATE_REPORT_FILE));
        if (await exists(join(parent, HOLDOUT_DIR, SEAL_FILE)))
          sealFiles.push(join(parent, HOLDOUT_DIR, SEAL_FILE));
      }
    }
  }

  const seals: Pool['seals'] = [];
  for (const file of sealFiles.sort()) {
    const seal = sealFromJson(await readJson(file));
    if (typeof seal === 'string') {
      io.err(`${display(file, io)}: ${seal}\n`);
      return 2;
    }
    seals.push({ file, seal });
  }
  const evidences: GateEvidence[] = [];
  for (const file of reportFiles.sort()) {
    const evidence = evidenceFromReport(await readJson(file));
    if (typeof evidence === 'string') {
      io.err(`${display(file, io)}: ${evidence}\n`);
      return 2;
    }
    evidences.push(evidence);
  }

  const byPath = new Map(valid.map((spec) => [spec.path, spec]));
  const sealed: Pool['sealed'] = [];
  const problems: string[] = [];
  for (const { file, seal } of seals) {
    const gateRoot = dirname(dirname(file));
    for (const entry of seal.specs) {
      const path = resolve(gateRoot, entry.path);
      const spec = byPath.get(path);
      if (spec && spec.hash !== entry.hash) {
        problems.push(
          `${display(path, io)} no longer hashes to ${entry.hash}, the value ${display(file, io)} sealed`,
        );
      }
      sealed.push({ id: entry.id, file: path, hash: entry.hash, ...(spec ? { spec } : {}) });
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) io.err(`${problem}.\n`);
    io.err('A sealed spec changed after the gate sealed it: gate the candidates again.\n');
    return 2;
  }
  const sealedPaths = new Set(sealed.map((entry) => entry.file));
  const sealedIds = new Set(sealed.map((entry) => entry.id));
  const specs = valid.filter((spec) => !sealedPaths.has(spec.path) && !sealedIds.has(spec.spec.id));
  const ids = new Map<string, string>();
  for (const spec of specs) {
    const held = ids.get(spec.spec.id);
    if (held !== undefined) {
      io.err(`Two specs share the id ${spec.spec.id}: ${display(held, io)} and ${display(spec.path, io)}.\n`);
      return 2;
    }
    ids.set(spec.spec.id, spec.path);
  }
  return {
    base,
    specs,
    sealed,
    seals,
    reports: reportFiles.sort(),
    ...(evidences.length > 0 ? { evidence: mergeEvidence(evidences) } : {}),
    skipped,
  };
}

function renderSelection(
  selection: Selection,
  golden: SpaceCoverage,
  pool: Pool,
  meta: { t: number; k: number | undefined; agent: string; version: string },
): string {
  const lines: string[] = [];
  const allowed = golden.grid.allowed;
  const unit = meta.t === 2 ? 'pairs' : meta.t === 3 ? 'triples' : `${meta.t}-tuples`;
  lines.push(
    `Golden set for map ${meta.agent}, version ${meta.version}: cells on every subset of ${meta.t} dimensions (${allowed} allowed ${unit}).`,
  );
  lines.push(
    `Pool: ${pool.specs.length} unsealed specs; ${pool.sealed.length} sealed specs left out${pool.skipped.length > 0 ? `; ${pool.skipped.length} gate files that are not specs skipped` : ''}.`,
  );
  lines.push(
    `Cover: ${selection.cover.length} conversations cover every cell the pool covers (${selection.pool.cells} of ${allowed}).`,
  );
  if (selection.kBest) {
    lines.push(
      `k = ${meta.k} is smaller than the cover: the golden set is the ${meta.k} best, ranked by required cells, then faults turned red, then cells.`,
    );
  } else if (meta.k !== undefined) {
    lines.push(`k = ${meta.k} is not smaller than the cover: the golden set is the whole cover.`);
  }
  lines.push('');
  const header = ['#', 'spec', 'adds cells', 'cumulative', 'adds required', 'adds faults red'];
  const rows = selection.golden.map((pick, index) => [
    String(index + 1),
    pick.id,
    String(pick.cells),
    `${pick.cumulative} of ${allowed}`,
    pick.required.length > 0 ? pick.required.join('; ') : '-',
    pick.faults.length > 0 ? pick.faults.join(', ') : '-',
  ]);
  lines.push(...table([header, ...rows]));
  lines.push('');
  const required = golden.required;
  const coveredRequired = required.filter((cell) => cell.covered).length;
  lines.push(
    `Cells covered: ${golden.grid.covered} of ${allowed} allowed ${unit} (${percent(golden.grid.share)}); the pool covers ${selection.pool.cells}.`,
  );
  for (const level of golden.tway) {
    if (level.t === meta.t) continue;
    lines.push(`  t = ${level.t}: ${level.covered} of ${level.allowed} allowed (${percent(level.share)}).`);
  }
  lines.push(
    `Required cells: ${coveredRequired} of ${required.length}; the pool covers ${selection.pool.required}.`,
  );
  for (const label of selection.uncoverable) lines.push(`  ✗ ${label}: no unsealed spec covers it`);
  for (const label of selection.missed) lines.push(`  ✗ ${label}: k is too small to keep it`);
  lines.push(
    pool.evidence
      ? `Faults turned red: ${selection.covered.faults} of the ${selection.pool.faults} the pool turns red (${pool.evidence.faults.size} counted faults in the gate report).`
      : 'Faults turned red: no gate report found, so no mutation evidence weighs in.',
  );
  return `${lines.join('\n')}\n`;
}

function manifestOf(input: {
  selection: Selection;
  pool: Pool;
  chosen: LoadedSpec[];
  placed: ReadonlyMap<string, string>;
  goldenCoverage: SpaceCoverage;
  poolCoverage: SpaceCoverage;
  mapPath: string;
  specsPath: string;
  agent: string;
  version: string;
  t: number;
  k: number | undefined;
  io: Io;
}) {
  const { selection, pool, chosen, goldenCoverage, poolCoverage } = input;
  const byId = new Map(chosen.map((spec) => [spec.spec.id, spec]));
  return {
    select: 'driftbench select',
    map: input.mapPath,
    agent: input.agent,
    version: input.version,
    specs: input.specsPath,
    t: input.t,
    ...(input.k === undefined ? {} : { k: input.k }),
    rule: selection.kBest
      ? 'the k best: greedy over the pool, ranked by new required cells, then new faults turned red, then new cells; ties to the spec read first (path order)'
      : 'the greedy cover: new required cells first, then new cells; ties to more new faults turned red, then the spec read first (path order)',
    pool: {
      specs: pool.specs.length,
      sealed_left_out: pool.sealed.length,
      gate_reports: pool.reports.map((file) => portable(display(file, input.io))),
      gate_seals: pool.seals.map((entry) => portable(display(entry.file, input.io))),
      cells_covered: selection.pool.cells,
      required_covered: selection.pool.required,
      faults_red: selection.pool.faults,
    },
    cover: selection.cover.map((pick) => pick.id),
    golden: selection.golden.map((pick) => {
      const spec = byId.get(pick.id);
      return {
        id: pick.id,
        path: input.placed.get(pick.id) ?? null,
        from: spec ? portable(display(spec.path, input.io)) : null,
        hash: spec?.hash ?? null,
        adds_cells: pick.cells,
        cumulative: pick.cumulative,
        adds_required: pick.required,
        adds_faults: pick.faults,
      };
    }),
    coverage: {
      allowed: goldenCoverage.grid.allowed,
      covered: goldenCoverage.grid.covered,
      share: round(goldenCoverage.grid.share),
      pool_covered: poolCoverage.grid.covered,
      tway: goldenCoverage.tway.map((level) => ({
        t: level.t,
        allowed: level.allowed,
        covered: level.covered,
        share: round(level.share),
      })),
      required: goldenCoverage.required.map((cell) => ({
        ...(cell.source === 'inventory'
          ? { flow: cell.flow, deviation: cell.deviation }
          : { values: cell.values }),
        covered: cell.covered,
        specs: cell.specs,
      })),
      faults_red: selection.covered.faults,
    },
    uncoverable_required: selection.uncoverable,
    missed_required: selection.missed,
  };
}

/**
 * Where each chosen spec is written in the golden folder: `specs/<its folder>/<its file>`, such as
 * `specs/twise/gen-twise-007.yaml`. Two specs that would land on one path keep their whole path under
 * the folder read instead.
 */
function goldenPaths(chosen: readonly LoadedSpec[], base: string): Map<string, string> {
  const short = (spec: LoadedSpec) =>
    portable(join(GOLDEN_SPECS_DIR, basename(dirname(spec.path)), basename(spec.path)));
  const counts = new Map<string, number>();
  for (const spec of chosen) counts.set(short(spec), (counts.get(short(spec)) ?? 0) + 1);
  return new Map(
    chosen.map((spec) => {
      const path = short(spec);
      return [
        spec.spec.id,
        (counts.get(path) ?? 0) > 1 ? portable(join(GOLDEN_SPECS_DIR, relative(base, spec.path))) : path,
      ];
    }),
  );
}

export { table };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    return { unreadable: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** True when `path` is `folder` or inside it. */
function inside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== path);
}

export function whole(
  text: string | undefined,
  name: string,
  minimum: number,
  fallback: number,
): number | string {
  if (text === undefined) return fallback;
  const value = optionNumber(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < minimum) {
    return `--${name} must be a whole number of at least ${minimum}, got "${text}".`;
  }
  return value;
}

export function display(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' ? '.' : rel.startsWith('..') ? path : rel;
}

export function portable(path: string): string {
  return path.split(sep).join('/');
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
