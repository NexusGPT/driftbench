import { type Issue, type LoadResult, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { coverage } from '@agent-nexus/driftbench-space';
import { stringify } from 'yaml';
import {
  NO_THEN_CRITERION,
  PLACEHOLDER_CRITERION,
  type Rendered,
  type RunIdentity,
  renderDraft,
  SEEDERS,
  type Seeder,
  type SpecDraft,
  specText,
} from '../seed/assemble';
import type { PreparedMap } from '../seed/map';
import {
  type BoundarySummary,
  boundarySeeder,
  coverDraft,
  type DeviationSummary,
  deviationSeeder,
  type GraphSummary,
  graphSeeder,
  type MetamorphicSummary,
  metamorphicSeeder,
  type SeedContext,
  type TwiseSummary,
  twiseSeeder,
} from '../seed/seeders';
import { type TaskInput, taskSpecs } from '../seed/tasks';
import { formatJson } from './json';

/** t-wise coverage of a set of specs on the axis map, as `driftbench space coverage --t` counts it. */
export type MeasuredCoverage = { t: number; specs: number; allowed: number; covered: number; share: number };

/**
 * `generateSuite`: every seeder over one approved map, each draft written as a spec, validated and linted
 * by the core loader, then the report. Pure: it reads nothing and writes nothing; the caller writes the
 * files. Same map, same options: the same files, byte for byte.
 */

export const DEFAULT_T = 3;
export const DEFAULT_SEED = 1;
/** The report's file name inside the output folder. */
export const REPORT_FILE = 'generate-report.json';
/** Specs every block of which has an approved phrase and a Then. */
export const COMPLETE_DIR = 'specs';
/**
 * Specs with a placeholder turn (a value with no approved phrase) or a block the map supports no Then
 * for: valid, flagged by lint, not runnable.
 */
export const INCOMPLETE_DIR = 'incomplete';

export type GenerateOptions = {
  t?: number;
  seed?: number;
  /** The most specs per seeder. */
  max?: number;
  /** The map path as the specs and the report record it (relative to the output folder). */
  mapPath: string;
  /** Specs to measure on the same map for comparison, such as the hand-written suite. */
  baseline?: { label: string; specs: Spec[] };
  /**
   * The specs the map's task families built (`task_family`), one entry per family: the caller builds them,
   * since a family's oracle runs asynchronously. A flow with a task family and none given has no specs.
   */
  tasks?: TaskInput[];
};

export type GeneratedFile = { path: string; text: string };

export type SeederTotals = {
  specs: number;
  blocks: number;
  complete: number;
  /** Incomplete specs: a placeholder turn. */
  needs_phrase: number;
  /** Incomplete specs: a block with no Then the map supports. */
  needs_then: number;
  cut: boolean;
};

export type GenerateReport = {
  generator: 'driftbench generate';
  map: {
    path: string;
    agent: string;
    version: string;
    hash: string;
    dimensions: number;
    values: number;
    constraints: number;
    phrases: number;
  };
  options: { t: number; seed: number; max: number | null };
  summary: { specs: number; blocks: number; complete: number; incomplete: number };
  seeders: Record<Seeder, SeederTotals>;
  graph: GraphSummary;
  twise: TwiseSummary;
  boundary: BoundarySummary;
  deviation: DeviationSummary;
  metamorphic: MetamorphicSummary;
  /**
   * The cover seeder: the allowed cells of the axis map no complete spec of the other seeders covered, how
   * many it built a complete spec for, and why it could not build the others.
   */
  cover: CoverSummary;
  constraints: { applied: number; list: Array<{ forbid: Record<string, string>; reason: string }> };
  no_phrase: Array<{ dimension: string; value: string; blocks: number; specs: string[] }>;
  /** Specs with a block the map supports no machine Then for, and why when a path could not be walked. */
  no_then: Array<{ spec: string; blocks: string[]; reasons: string[] }>;
  coverage: {
    t: number;
    allowed: number;
    complete: MeasuredCoverage;
    all: MeasuredCoverage;
    baseline?: MeasuredCoverage & { label: string };
  };
  /** Specs the core loader refused: a generator defect. Never written. */
  invalid: Array<{ id: string; errors: Issue[] }>;
  /** Lint warnings on complete specs: a generator defect when not empty. */
  lint: Array<{ id: string; warnings: Issue[] }>;
};

export type CoverSummary = {
  /** Cells left uncovered by the other seeders. */
  cells: number;
  /** Cells covered after the cover seeder. */
  covered: number;
  /** Cells still uncovered, each with the reasons no scenario could be built for it. */
  unbuilt: Array<{ cell: Record<string, string>; reasons: string[] }>;
  /**
   * Axis values no allowed cell holds: the map's relations rule out every pair with them (a flow with no
   * approved path, for one). No spec can cover them until the map gives them a path.
   */
  unreachable: Array<{ dimension: string; value: string }>;
};

export type GenerateResult = {
  files: GeneratedFile[];
  report: GenerateReport;
  complete: Spec[];
  all: Spec[];
};

export function generateSuite(prepared: PreparedMap, options: GenerateOptions): GenerateResult {
  const t = options.t ?? DEFAULT_T;
  const seed = options.seed ?? DEFAULT_SEED;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const context: SeedContext = { seed, t, max };
  const run: RunIdentity = { seed, mapPath: options.mapPath };

  const graph = graphSeeder(prepared, context);
  const twise = twiseSeeder(prepared, context);
  const boundary = boundarySeeder(prepared, context);
  const deviation = deviationSeeder(prepared, context);
  const metamorphic = metamorphicSeeder(prepared, context);
  const drafts: Record<Seeder, SpecDraft[]> = {
    graph: graph.drafts,
    twise: twise.drafts,
    boundary: boundary.drafts,
    deviation: deviation.drafts,
    metamorphic: metamorphic.drafts,
    task: [],
    cover: [],
  };
  const cut: Record<Seeder, boolean> = {
    graph: graph.summary.blocked.length > 0 && graph.summary.paths >= max,
    twise: twise.summary.covered < twise.summary.allowed,
    boundary: dataValues(prepared) > boundary.drafts.length,
    deviation: deviation.summary.classes > deviation.drafts.length,
    metamorphic: metamorphic.drafts.length >= max,
    task: false,
    cover: false,
  };

  const files: GeneratedFile[] = [];
  const complete: Spec[] = [];
  const all: Spec[] = [];
  const invalid: GenerateReport['invalid'] = [];
  const lint: GenerateReport['lint'] = [];
  const gaps = new Map<string, { dimension: string; value: string; blocks: number; specs: string[] }>();
  const noThen: GenerateReport['no_then'] = [];
  const seeders = {} as Record<Seeder, SeederTotals>;

  /** Renders drafts of one seeder, adds them to the suite and the seeder's totals; returns the complete ones. */
  const renderSeeder = (seeder: Seeder, list: readonly SpecDraft[]): Spec[] => {
    const own: Spec[] = [];
    const totals: SeederTotals = seeders[seeder] ?? {
      specs: 0,
      blocks: 0,
      complete: 0,
      needs_phrase: 0,
      needs_then: 0,
      cut: cut[seeder],
    };
    for (const draft of list) {
      const rendered: Rendered = renderDraft(prepared, draft, run);
      const text = specText(rendered, run, prepared.hash);
      const loaded = parseSpecText(text, 'yaml', rendered.id);
      if (!loaded.ok) {
        invalid.push({ id: rendered.id, errors: loaded.errors });
        continue;
      }
      const needsPhrase = rendered.placeholders.length > 0;
      const needsThen = rendered.noThen.length > 0;
      const unexpected = loaded.warnings.filter(
        (warning) =>
          !(
            (needsPhrase || needsThen) &&
            warning.code === 'CRITERION_UNRESOLVED' &&
            (warning.message.includes(PLACEHOLDER_CRITERION) || warning.message.includes(NO_THEN_CRITERION))
          ),
      );
      if (unexpected.length > 0) lint.push({ id: rendered.id, warnings: unexpected });
      totals.specs += 1;
      totals.blocks += rendered.blocks;
      all.push(loaded.spec);
      if (needsThen) {
        totals.needs_then += 1;
        noThen.push({ spec: rendered.id, blocks: rendered.noThen, reasons: rendered.reasons });
      }
      if (needsPhrase) {
        totals.needs_phrase += 1;
        for (const gap of rendered.placeholders) {
          const key = `${gap.dimension}=${gap.value}`;
          const entry = gaps.get(key) ?? { ...gap, blocks: 0, specs: [] };
          entry.blocks += 1;
          if (!entry.specs.includes(rendered.id)) entry.specs.push(rendered.id);
          gaps.set(key, entry);
        }
      }
      if (!needsPhrase && !needsThen) {
        totals.complete += 1;
        complete.push(loaded.spec);
        own.push(loaded.spec);
      }
      const folder = needsPhrase || needsThen ? INCOMPLETE_DIR : COMPLETE_DIR;
      files.push({ path: `${folder}/${seeder}/${rendered.id}.yaml`, text });
    }
    seeders[seeder] = totals;
    return own;
  };
  for (const seeder of SEEDERS)
    renderSeeder(seeder, seeder === 'cover' || seeder === 'task' ? [] : drafts[seeder]);

  // The task seeder: the specs the task families built, placed in the space (seed/tasks.ts).
  const header = [
    `# Generated by driftbench generate (seeder task, seed ${seed}) from ${options.mapPath}, map hash ${prepared.hash}.`,
    "# A task family's oracle wrote the Then before any agent ran; this file places it in the map's space.",
    '# Do not edit it by hand: change the family or the map and generate again. Fictional data only.',
  ].join('\n');
  for (const { id, spec } of taskSpecs(prepared, options.tasks ?? [], run)) {
    const text = `${header}\n${stringify(spec, { lineWidth: 0, aliasDuplicateObjects: false })}`;
    const loaded = parseSpecText(text, 'yaml', id);
    const totals = seeders.task;
    if (!loaded.ok) {
      invalid.push({ id, errors: loaded.errors });
      continue;
    }
    totals.specs += 1;
    totals.blocks += loaded.spec.blocks.length;
    totals.complete += 1;
    all.push(loaded.spec);
    complete.push(loaded.spec);
    files.push({ path: `${COMPLETE_DIR}/task/${id}.yaml`, text });
  }

  // The cover seeder: one scenario per allowed cell still uncovered, skipping a cell an earlier cover spec
  // already reached. A cell it cannot build is listed with the reasons.
  const uncovered = cellsOf(prepared, complete, t).filter((cell) => cell.count === 0);
  const unbuilt: CoverSummary['unbuilt'] = [];
  const reached = new Set<string>();
  for (const cell of uncovered) {
    const key = cellKey(cell.values);
    if (reached.has(key)) continue;
    if (drafts.cover.length >= max) {
      cut.cover = true;
      unbuilt.push({ cell: cell.values, reasons: ['cut by --max'] });
      continue;
    }
    const id = `gen-cover-${String(drafts.cover.length + 1).padStart(3, '0')}`;
    const built = coverDraft(prepared, context, id, cell.values);
    if (!('draft' in built)) {
      unbuilt.push({ cell: cell.values, reasons: built.reasons });
      continue;
    }
    drafts.cover.push(built.draft);
    const made = renderSeeder('cover', [built.draft]);
    for (const entry of cellsOf(prepared, made, t)) if (entry.count > 0) reached.add(cellKey(entry.values));
    if (!reached.has(key))
      unbuilt.push({
        cell: cell.values,
        reasons: [`${id} was built but ${made.length === 0 ? 'is incomplete' : 'does not reach the cell'}`],
      });
  }
  const held = new Set(
    cellsOf(prepared, [], t).flatMap((cell) =>
      Object.entries(cell.values).map(([dimension, value]) => `${dimension}=${value}`),
    ),
  );
  const coverSummary: CoverSummary = {
    cells: uncovered.length,
    covered: uncovered.filter((cell) => reached.has(cellKey(cell.values))).length,
    unbuilt,
    unreachable: prepared.axisMap.dimensions.flatMap((dimension) =>
      dimension.values
        .filter((value) => !held.has(`${dimension.id}=${value.id}`))
        .map((value) => ({ dimension: dimension.id, value: value.id })),
    ),
  };

  const measure = (specs: Spec[]) => measured(prepared, specs, t);
  const completeCoverage = measure(complete);
  const baseline = options.baseline
    ? { label: options.baseline.label, ...measure(options.baseline.specs) }
    : undefined;
  const totals = Object.values(seeders);
  const report: GenerateReport = {
    generator: 'driftbench generate',
    map: {
      path: options.mapPath,
      agent: prepared.agent,
      version: prepared.version,
      hash: prepared.hash,
      dimensions: prepared.map.dimensions.length,
      values: prepared.map.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
      constraints: prepared.map.constraints.length,
      phrases: prepared.phrases.length,
    },
    options: { t, seed, max: Number.isFinite(max) ? max : null },
    summary: {
      specs: totals.reduce((sum, entry) => sum + entry.specs, 0),
      blocks: totals.reduce((sum, entry) => sum + entry.blocks, 0),
      complete: totals.reduce((sum, entry) => sum + entry.complete, 0),
      incomplete: totals.reduce((sum, entry) => sum + entry.specs - entry.complete, 0),
    },
    seeders,
    graph: graph.summary,
    twise: twise.summary,
    boundary: boundary.summary,
    deviation: deviation.summary,
    metamorphic: metamorphic.summary,
    cover: coverSummary,
    constraints: {
      applied: prepared.map.constraints.length,
      list: prepared.map.constraints.map((constraint) => ({
        forbid: constraint.forbid,
        reason: constraint.reason,
      })),
    },
    no_phrase: [...gaps.values()],
    no_then: noThen,
    coverage: {
      t,
      allowed: completeCoverage.allowed,
      complete: completeCoverage,
      all: measure(all),
      ...(baseline ? { baseline } : {}),
    },
    invalid,
    lint,
  };
  files.push({ path: REPORT_FILE, text: formatJson(report) });
  return { files, report, complete, all };
}

/**
 * Coverage on the space map of the approved axes, by the space package's own `coverage`: the same count
 * `driftbench space coverage --map <space.yaml> <specs> --t <t>` prints.
 */
/** The allowed cells of the axis map at strength t, each with how many of the specs cover it. */
function cellsOf(
  prepared: PreparedMap,
  specs: readonly Spec[],
  t: number,
): Array<{ values: Record<string, string>; count: number }> {
  const results: LoadResult[] = specs.map((spec) => ({
    ok: true,
    path: spec.id,
    spec,
    hash: '',
    warnings: [],
  }));
  const grid = coverage(prepared.axisMap, results, {
    t: Math.min(t, prepared.axisMap.dimensions.length),
    ...(prepared.inventory ? { inventory: prepared.inventory } : {}),
  }).grid;
  return grid.cells.map((cell) => ({ values: { ...cell.values }, count: cell.count }));
}

function cellKey(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join('&');
}

function measured(prepared: PreparedMap, specs: Spec[], t: number): MeasuredCoverage {
  const results: LoadResult[] = specs.map((spec) => ({
    ok: true,
    path: spec.id,
    spec,
    hash: '',
    warnings: [],
  }));
  const strength = Math.min(t, prepared.axisMap.dimensions.length);
  const grid = coverage(prepared.axisMap, results, {
    t: strength,
    ...(prepared.inventory ? { inventory: prepared.inventory } : {}),
  }).grid;
  return {
    t: strength,
    specs: specs.length,
    allowed: grid.allowed,
    covered: grid.covered,
    share: grid.share,
  };
}

function dataValues(prepared: PreparedMap): number {
  return prepared.space.dimensions
    .filter((dimension, index) => dimension.kind === 'data' && !prepared.axes.has(index))
    .reduce((sum, dimension) => sum + dimension.values.filter((value) => value.id !== 'none').length, 0);
}

/** The summary the command prints. */
export function renderSummary(report: GenerateReport): string {
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
  const lines = [
    `Map ${report.map.agent} (${report.map.path}), hash ${report.map.hash}: ${report.map.dimensions} dimensions, ${report.map.values} values, ${report.map.constraints} constraints, ${report.map.phrases} approved phrases.`,
    `Seed ${report.options.seed}, t = ${report.options.t}${report.options.max === null ? '' : `, at most ${report.options.max} specs per seeder`}.`,
    '',
    'Seeder        specs  blocks  complete  incomplete',
  ];
  for (const seeder of SEEDERS) {
    const entry = report.seeders[seeder];
    lines.push(
      `${seeder.padEnd(12)}  ${String(entry.specs).padStart(5)}  ${String(entry.blocks).padStart(6)}  ${String(entry.complete).padStart(8)}  ${String(entry.specs - entry.complete).padStart(10)}${entry.cut ? '  (cut by --max)' : ''}`,
    );
  }
  lines.push(
    '',
    `Stage graph: ${report.graph.covered} of ${report.graph.edges} edges covered in ${report.graph.paths} paths from ${report.graph.start ?? 'no start'}.${
      report.graph.unwalked
        ? ` Paths no cell can walk: ${report.graph.unwalked.map((entry) => entry.path).join(', ')}.`
        : ''
    }`,
    `t-wise: covering array of ${report.twise.rows} rows over ${report.twise.dimensions.length} dimensions, ${report.twise.covered} of ${report.twise.allowed} allowed ${report.twise.t}-tuples (${percent(report.twise.share)}).`,
    `Constraints applied: ${report.constraints.applied}.`,
    `Deviation probes: ${report.deviation.probes.length} of ${report.deviation.classes} classes. Metamorphic families: ${report.metamorphic.families}.`,
    `Coverage on the axis map at t = ${report.coverage.t}: complete specs ${report.coverage.complete.covered} of ${report.coverage.allowed} (${percent(report.coverage.complete.share)}), all specs ${report.coverage.all.covered} (${percent(report.coverage.all.share)})${report.coverage.baseline ? `, ${report.coverage.baseline.label} ${report.coverage.baseline.covered} (${percent(report.coverage.baseline.share)})` : ''}.`,
  );
  if (report.cover.unbuilt.length > 0)
    lines.push(
      `Allowed pairs no spec could be built for: ${report.cover.unbuilt.length} (see cover.unbuilt).`,
    );
  if (report.cover.unreachable.length > 0)
    lines.push(
      `Values no allowed pair holds, so no spec can cover them until the map gives them a path: ${report.cover.unreachable.map((entry) => `${entry.dimension}=${entry.value}`).join(', ')}.`,
    );
  if (report.no_phrase.length > 0) {
    lines.push(
      '',
      `Values with no approved phrase (${report.no_phrase.length}): their blocks are placeholders in ${INCOMPLETE_DIR}/.`,
    );
    for (const gap of report.no_phrase.slice(0, 15)) {
      lines.push(`  ${gap.dimension}=${gap.value}  ${gap.blocks} block(s)`);
    }
    if (report.no_phrase.length > 15)
      lines.push(`  ... ${report.no_phrase.length - 15} more in ${REPORT_FILE}`);
  }
  if (report.no_then.length > 0) {
    const named = report.no_then.slice(0, 10).map((entry) => entry.spec);
    const more = report.no_then.length > 10 ? ', ...' : '';
    lines.push(
      '',
      `Specs with a block the map supports no machine Then for (${report.no_then.length}), in ${INCOMPLETE_DIR}/: ${named.join(', ')}${more}.`,
    );
    const counts = new Map<string, number>();
    for (const entry of report.no_then) {
      for (const reason of new Set(entry.reasons.map((text) => text.replace(/^path [^:]+: /, '')))) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    if (top.length > 0) lines.push('  Most frequent reasons:');
    for (const [reason, count] of top) lines.push(`  ${String(count).padStart(4)}  ${reason}`);
  }
  if (report.invalid.length > 0 || report.lint.length > 0) {
    lines.push(
      '',
      `Generator defects: ${report.invalid.length} invalid spec(s), ${report.lint.length} complete spec(s) with lint warnings.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
