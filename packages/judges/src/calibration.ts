import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { cohenKappa, type Interval, krippendorffAlpha, wilson } from '@agent-nexus/driftbench-stats';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { JudgeClient } from './client';
import { JudgeClass, type JudgeOutcome, type JudgeRequest } from './contract';
import type { AssignmentRow, CouncilMode, UnassignedCriterion } from './council';
import { CriterionFixture, fixtureInputs, fixtureRequest, type LoadedCriterion } from './criteria';
import { withCriterionSettings } from './criterion-settings';
import { familyOfModel, normalizeFamily } from './family';

/**
 * Calibration (P2.3): a judge earns a criterion, it is never assumed to own one.
 *
 * Every judge answers, on its own, every criterion's fixture pair `repeats` times and every hand-labelled
 * block once. Per judge and criterion the report gives:
 * - the separation: in how many repeats the pass fixture passed and the fail fixture failed;
 * - Cohen's kappa between the judge and the hand labels, with a Wilson interval on the raw agreement;
 * and per criterion Krippendorff's alpha across the judges.
 *
 * A judge meets the bar on a criterion when it separates the pair in every repeat and its kappa is at
 * least `kappaMin` (0.8). A council votes three judges of one class, so a class can take a criterion only
 * when three of its judges meet the bar. The criterion goes to the cheapest judge that meets the bar in
 * such a class; that judge leads the row and the next two cheapest judges at the bar of its class sit
 * with it. When no class has three judges at the bar the criterion stays unassigned: it is still judged,
 * it never gates, and the report says why.
 *
 * Judges answer as they vote in a council: an answer that does not parse is asked again once with the
 * large budget, and a judge that gives no answer at all counts as inconclusive. An inconclusive answer
 * never separates a pair and always disagrees with a label.
 */

export const KAPPA_MIN = 0.8;
export const DEFAULT_REPEATS = 3;
const COUNCIL_SIZE = 3;

/** A block a human labelled: a fixture-shaped slice, its id, and the human's pass or fail. */
/**
 * The element of a labelled block a human label is about. A message is a transcript line by index; a tool
 * call is a tool the transcript calls, by name and occurrence; a field is a dot path into the block's ledger;
 * a span is a trace span id, which the transcript cannot show.
 */
export const AnnotationAnchor = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message').describe('A transcript line.'),
    index: z.number().int().min(0).describe('The index of the line in the transcript, from 0.'),
  }),
  z.strictObject({
    kind: z.literal('tool_call').describe('A tool the transcript calls.'),
    tool: z.string().min(1).describe('The tool name.'),
    occurrence: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Which call of that tool, from 1; 1 when absent.'),
  }),
  z.strictObject({
    kind: z.literal('field').describe('A field of the ledger or of a tool output.'),
    path: z.string().min(1).describe('The dot path of the field.'),
  }),
  z.strictObject({
    kind: z.literal('span').describe('A trace span, which the transcript cannot show.'),
    span_id: z.string().min(1).describe('The span id the run recorded.'),
  }),
]);
export type AnnotationAnchor = z.infer<typeof AnnotationAnchor>;

export const LabelledBlock = CriterionFixture.extend({
  id: z.string().min(1).describe('The id of the block; a new label for the same id replaces the old one.'),
  label: z.enum(['pass', 'fail']).describe("The human's verdict on the criterion: pass or fail."),
  flags: z
    .array(z.literal('sent text not stored'))
    .optional()
    .describe('Labels with unavailable sent text are excluded from calibration.'),
  anchor: AnnotationAnchor.optional().describe(
    'The element of the block the label is about; absent: the whole block.',
  ),
});
export type LabelledBlock = z.infer<typeof LabelledBlock>;

/** A saved annotation can remain useful to a reviewer even when its stimulus cannot train a judge. */
export function calibrationEligible(block: LabelledBlock): boolean {
  return !block.flags?.includes('sent text not stored');
}

/**
 * Why an anchor does not point at an element of its block, or undefined when it does or has none. A span
 * anchor is never a problem here: the transcript cannot show a span (see `anchorNote`).
 */
export function anchorProblem(block: LabelledBlock): string | undefined {
  const anchor = block.anchor;
  if (anchor === undefined) return undefined;
  switch (anchor.kind) {
    case 'message': {
      if (anchor.index >= block.transcript.length) {
        return `anchor: no transcript line ${anchor.index} (the block has ${block.transcript.length})`;
      }
      return undefined;
    }
    case 'tool_call': {
      const calls = block.transcript.filter(
        (entry) => entry.role === 'tool_call' && entry.tool === anchor.tool,
      );
      if (calls.length === 0) return `anchor: calls no ${anchor.tool}`;
      const wanted = anchor.occurrence ?? 1;
      if (wanted > calls.length) return `anchor: calls ${anchor.tool} ${calls.length} times, not ${wanted}`;
      return undefined;
    }
    case 'field': {
      if (fieldAt(block.given?.ledger ?? {}, anchor.path)) return undefined;
      const inOutputs = block.transcript.some(
        (entry) => entry.role === 'tool_result' && jsonHasPath(entry.text, anchor.path),
      );
      return inOutputs ? undefined : `anchor: no ledger field or tool output field ${anchor.path}`;
    }
    case 'span':
      return undefined;
  }
}

/** The note an anchor carries for a reader, when the transcript cannot check it. */
export function anchorNote(block: LabelledBlock): string | undefined {
  if (block.anchor?.kind === 'span') {
    return `span ${block.anchor.span_id}: not checkable from the transcript, the label stands as written`;
  }
  return undefined;
}

/** Whether a JSON text holds the dot path, with every key present. False for text that is not JSON. */
function jsonHasPath(text: string, path: string): boolean {
  try {
    return fieldAt(JSON.parse(text), path);
  } catch {
    return false;
  }
}

function fieldAt(root: unknown, path: string): boolean {
  let at: unknown = root;
  for (const key of path.split('.')) {
    if (at === null || typeof at !== 'object' || !(key in at)) return false;
    at = (at as Record<string, unknown>)[key];
  }
  return true;
}

/** One labels file: the hand-labelled blocks of one criterion. */
export const LabelFile = z.strictObject({
  criterion: z.string().min(1).describe('The name of the criterion the labels are for.'),
  /** Who labelled, for a reader. */
  labelled_by: z.string().optional().describe('Who labelled, for a reader.'),
  blocks: z.array(LabelledBlock).min(1).describe('The labelled blocks.'),
});
export type LabelFile = z.infer<typeof LabelFile>;

export type LabelIssue = { readonly path: string; readonly message: string };

export type LabelsLoad = {
  /** The labelled blocks per criterion name. */
  readonly labels: ReadonlyMap<string, readonly LabelledBlock[]>;
  readonly issues: readonly LabelIssue[];
};

const YAML_EXT = new Set(['.yaml', '.yml']);

/**
 * Loads a labels folder: one YAML file per criterion, named after it. A criterion needs at least one
 * pass and one fail label, or kappa has nothing to measure. Problems are returned, never thrown.
 */
export async function loadLabels(dir: string): Promise<LabelsLoad> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => YAML_EXT.has(extname(name))).sort();
  } catch (cause) {
    return {
      labels: new Map(),
      issues: [{ path: dir, message: `cannot read the folder: ${message(cause)}` }],
    };
  }
  const labels = new Map<string, LabelledBlock[]>();
  const issues: LabelIssue[] = [];
  if (names.length === 0) issues.push({ path: dir, message: 'no labels file (.yaml or .yml)' });
  const ids = new Map<string, string>();
  for (const name of names) {
    const path = join(dir, name);
    let value: unknown;
    try {
      value = parseYaml(await readFile(path, 'utf8'));
    } catch (cause) {
      issues.push({ path, message: `not YAML: ${message(cause)}` });
      continue;
    }
    const parsed = LabelFile.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path, message: `${issue.path.join('.') || '(root)'}: ${issue.message}` });
      }
      continue;
    }
    const file = parsed.data;
    const stem = basename(name, extname(name));
    if (file.criterion !== stem) {
      issues.push({ path, message: `the labels are for ${file.criterion}, the file is ${stem}` });
      continue;
    }
    for (const block of file.blocks) {
      const twin = ids.get(block.id);
      if (twin) issues.push({ path, message: `block id ${block.id} is also used in ${twin}` });
      ids.set(block.id, path);
      const problem = anchorProblem(block);
      if (problem !== undefined) issues.push({ path, message: `block ${block.id}: ${problem}` });
    }
    const usable = file.blocks.filter(calibrationEligible);
    const kinds = new Set(usable.map((block) => block.label));
    if (kinds.size < 2) {
      issues.push({
        path,
        message:
          kinds.size === 0
            ? 'no calibration labels: sent text not stored'
            : `every block is labelled ${[...kinds][0]}: a criterion needs a pass and a fail label`,
      });
    }
    labels.set(file.criterion, usable);
  }
  return { labels, issues };
}

/** The request a labelled block sends, as a fixture would. */
export function labelRequest(criterion: LoadedCriterion, block: LabelledBlock): JudgeRequest {
  if (!calibrationEligible(block))
    throw new Error(`${block.id}: sent text not stored; excluded from calibration`);
  const base = fixtureRequest(criterion, 'pass');
  return withCriterionSettings(
    {
      criterion: base.criterion,
      transcript: block.transcript,
      ...(block.artifact === undefined ? {} : { artifact: block.artifact }),
      ...(block.given === undefined ? {} : { given: block.given }),
      // A block that carries no input of its own reads those of the criterion's pass fixture.
      ...fixtureInputs(criterion.def.inputs, block.inputs ?? criterion.fixtures.pass.inputs),
    },
    criterion.def,
  );
}

export type CalibrationConfig = {
  readonly judges: readonly JudgeClient[];
  readonly criteria: readonly LoadedCriterion[];
  readonly labels: ReadonlyMap<string, readonly LabelledBlock[]>;
  /** How many times each fixture is judged. Default 3. */
  readonly repeats?: number;
  /** The council mode the assignment is written for. Default hybrid. */
  readonly mode?: CouncilMode;
  /** The model family of the agent under test: a judge of that family is left out. Default none. */
  readonly agentFamily?: string;
  /** The kappa a judge needs against the labels. Default 0.8. */
  readonly kappaMin?: number;
  /**
   * How a criterion is assigned. `council` (default): the cheapest judge at the bar in a class that seats
   * three judges at the bar, with the next two. `cheapest`: the one cheapest judge at the bar, alone.
   */
  readonly rule?: 'council' | 'cheapest';
};

export type Separation = {
  /** The pass fixture's outcome in each repeat. */
  readonly pass: readonly JudgeOutcome[];
  /** The fail fixture's outcome in each repeat. */
  readonly fail: readonly JudgeOutcome[];
  /** Repeats in which the pass fixture passed and the fail fixture failed. */
  readonly separated: number;
  readonly repeats: number;
};

export type LabelAgreement = {
  readonly n: number;
  readonly agree: number;
  /** Cohen's kappa between the judge and the labels; undefined when it cannot be computed. */
  readonly kappa?: number;
  /** The Wilson 95% interval on agree / n. */
  readonly agreement: Interval;
  /** PABAK: 2 * agree / n - 1, the raw agreement rescaled to a chance-free kappa. Undefined with no blocks. */
  readonly pabak?: number;
  /** Gwet's AC1 for two categories, pass and not pass. Undefined with no blocks, or when chance agreement is 1. */
  readonly ac1?: number;
  /** The confusion counts and the rates drawn from them; fail is the positive class and inconclusive counts as wrong. A rate with an empty denominator is left out. */
  readonly metrics: {
    readonly tp: number;
    readonly fp: number;
    readonly tn: number;
    readonly fn: number;
    readonly sensitivity?: number;
    readonly specificity?: number;
    readonly balancedAccuracy?: number;
    readonly falsePositiveRate?: number;
    readonly falseNegativeRate?: number;
  };
  /** Per block: the human label and the judge's answer. */
  readonly blocks: readonly {
    readonly id: string;
    readonly label: 'pass' | 'fail';
    readonly judged: JudgeOutcome;
    /** The element the human label is about, when the label names one. */
    readonly anchor?: AnnotationAnchor;
  }[];
};

export type JudgeCalibration = {
  readonly judge: string;
  readonly cls: JudgeClass;
  readonly cost: number;
  readonly separation: Separation;
  readonly labels: LabelAgreement;
  /** Calls that gave no answer at all. */
  readonly errors: number;
  /** Calls made, re-asks included, and what they cost in US dollars as the clients reported it. */
  readonly calls: number;
  readonly spentUsd: number;
  /** Calls whose cost is unknown. Present only when above 0: spentUsd is then a lower bound. */
  readonly costIncompleteCalls?: number;
  readonly meetsBar: boolean;
  /** Why the judge misses the bar, when it does. */
  readonly misses: readonly string[];
};

export type CriterionAssignment =
  | {
      readonly status: 'assigned';
      readonly owner: string;
      readonly cls: JudgeClass;
      readonly judges: readonly string[];
      readonly rejudge: readonly string[];
      /**
       * The one model family every judge of the row belongs to, when they share one. Judges of one family
       * share its blind spots: such a council is weaker evidence than one across families.
       */
      readonly singleFamily?: string;
    }
  | { readonly status: 'unassigned'; readonly reason: string };

export type CriterionCalibration = {
  readonly criterion: string;
  readonly gating: boolean;
  readonly judges: readonly JudgeCalibration[];
  /** Krippendorff's alpha across every judge, over the fixtures and the labelled blocks. */
  readonly alpha?: number;
  /** Groups of labelled blocks that hold the same slice under both labels; absent when there are none. */
  readonly labelConflicts?: readonly (readonly string[])[];
  /** Ids of labelled blocks equal to a fixture of the criterion, which inflates agreement; absent when none. */
  readonly fixtureLeaks?: readonly string[];
  /** `few-labels` when a class has fewer than 5 labelled blocks; absent when there is nothing to warn of. */
  readonly warnings?: readonly string[];
  readonly assignment: CriterionAssignment;
};

export type CalibrationReport = {
  readonly mode: CouncilMode;
  readonly repeats: number;
  readonly kappaMin: number;
  /** The assignment rule used; absent means council. */
  readonly rule?: 'cheapest';
  readonly criteria: readonly CriterionCalibration[];
  /** Per judge, kappa over every labelled block of every criterion. */
  readonly pooled: readonly {
    readonly judge: string;
    readonly n: number;
    readonly agree: number;
    readonly kappa?: number;
    readonly agreement: Interval;
  }[];
  /** Judges left out because they share the agent's family. */
  readonly excluded: readonly string[];
  readonly errors: number;
  /** What every call cost in US dollars, summed from the clients that report a cost; 0 for a replay without one. */
  readonly spentUsd: number;
  /** Calls whose cost is unknown. Present only when above 0: spentUsd is then a lower bound. */
  readonly costIncompleteCalls?: number;
};

/** Runs calibration. Never throws on a judge failure: the failure is an inconclusive answer, counted. */
export async function calibrate(config: CalibrationConfig): Promise<CalibrationReport> {
  const repeats = config.repeats ?? DEFAULT_REPEATS;
  if (!Number.isInteger(repeats) || repeats < 1)
    throw new RangeError('repeats must be a whole number from 1');
  const mode = config.mode ?? 'hybrid';
  const kappaMin = config.kappaMin ?? KAPPA_MIN;
  const agentFamily = config.agentFamily ?? 'none';
  const excluded = config.judges
    .filter((judge) => familiesOf(judge).includes(familyOfModel(agentFamily) ?? normalizeFamily(agentFamily)))
    .map((j) => j.id);
  const judges = config.judges.filter((judge) => !excluded.includes(judge.id));

  const criteria: CriterionCalibration[] = [];
  const pooled = new Map<string, { judged: JudgeOutcome[]; human: ('pass' | 'fail')[] }>();
  let errors = 0;
  let spentUsd = 0;
  let costIncompleteCalls = 0;

  for (const criterion of config.criteria) {
    const blocks = (config.labels.get(criterion.def.name) ?? []).filter(calibrationEligible);
    const rows: JudgeCalibration[] = [];
    // Units for alpha: the pass fixture, the fail fixture, then each labelled block; one row per judge.
    const matrix: (JudgeOutcome | null)[][] = [];
    for (const judge of judges) {
      const counter = { errors: 0, spentUsd: 0, calls: 0, costIncomplete: 0 };
      const pass: JudgeOutcome[] = [];
      const fail: JudgeOutcome[] = [];
      for (let r = 0; r < repeats; r += 1) {
        pass.push(await answer(judge, fixtureRequest(criterion, 'pass'), counter));
        fail.push(await answer(judge, fixtureRequest(criterion, 'fail'), counter));
      }
      const judged: JudgeOutcome[] = [];
      for (const block of blocks) judged.push(await answer(judge, labelRequest(criterion, block), counter));
      errors += counter.errors;
      spentUsd += counter.spentUsd;
      costIncompleteCalls += counter.costIncomplete;

      const separated = pass.filter((outcome, r) => outcome === 'pass' && fail[r] === 'fail').length;
      const labels = agreement(
        blocks.map((block) => block.id),
        blocks.map((block) => block.label),
        judged,
        blocks.map((block) => block.anchor),
      );
      const misses: string[] = [];
      if (separated < repeats) misses.push(`separates the fixture pair ${separated} of ${repeats} times`);
      if (labels.kappa === undefined) misses.push('has no kappa: the labels hold fewer than two classes');
      else if (labels.kappa < kappaMin) misses.push(`kappa ${fixed(labels.kappa)} is under ${kappaMin}`);
      if (counter.errors > 0) misses.push(`${counter.errors} call(s) gave no answer`);
      rows.push({
        judge: judge.id,
        cls: judge.cls,
        cost: judge.cost,
        separation: { pass, fail, separated, repeats },
        labels,
        errors: counter.errors,
        calls: counter.calls,
        spentUsd: counter.spentUsd,
        ...(counter.costIncomplete > 0 ? { costIncompleteCalls: counter.costIncomplete } : {}),
        meetsBar: misses.length === 0,
        misses,
      });
      matrix.push([pass[0] as JudgeOutcome, fail[0] as JudgeOutcome, ...judged].map(vote));

      const own = pooled.get(judge.id) ?? { judged: [], human: [] };
      own.judged.push(...judged);
      own.human.push(...blocks.map((block) => block.label));
      pooled.set(judge.id, own);
    }
    const alpha = alphaOf(matrix);
    const conflicts = labelConflicts(blocks);
    const leaks = fixtureLeaks(criterion, blocks);
    criteria.push({
      criterion: criterion.def.name,
      gating: criterion.def.gating === true,
      judges: rows,
      ...(alpha === undefined ? {} : { alpha }),
      ...(conflicts.length === 0 ? {} : { labelConflicts: conflicts }),
      ...(leaks.length === 0 ? {} : { fixtureLeaks: leaks }),
      ...(labelWarnings(blocks).length === 0 ? {} : { warnings: labelWarnings(blocks) }),
      assignment:
        config.rule === 'cheapest' ? assignCheapest(rows, judges, mode) : assign(rows, judges, mode),
    });
  }

  return {
    mode,
    repeats,
    kappaMin,
    ...(config.rule === 'cheapest' ? { rule: 'cheapest' as const } : {}),
    criteria,
    pooled: judges.map((judge) => {
      const own = pooled.get(judge.id) ?? { judged: [], human: [] };
      const { kappa, n, agree, agreement: interval } = agreement([], own.human, own.judged);
      return { judge: judge.id, n, agree, ...(kappa === undefined ? {} : { kappa }), agreement: interval };
    }),
    excluded,
    errors,
    spentUsd,
    ...(costIncompleteCalls > 0 ? { costIncompleteCalls } : {}),
  };
}

/** The blocks that hold one slice (transcript, artifact, given) under both labels, one group of ids per slice. */
export function labelConflicts(blocks: readonly LabelledBlock[]): string[][] {
  const bySlice = new Map<string, LabelledBlock[]>();
  for (const block of blocks) {
    const key = JSON.stringify([block.transcript, block.artifact ?? null, block.given ?? null]);
    bySlice.set(key, [...(bySlice.get(key) ?? []), block]);
  }
  return [...bySlice.values()]
    .filter((group) => new Set(group.map((block) => block.label)).size > 1)
    .map((group) => group.map((block) => block.id));
}

/** The warnings a labels set earns: `few-labels` when a class holds fewer than 5 labelled blocks (any labels given). */
export function labelWarnings(blocks: readonly LabelledBlock[]): string[] {
  if (blocks.length === 0) return [];
  const few = (['pass', 'fail'] as const).some((label) => blocks.filter((b) => b.label === label).length < 5);
  return few ? ['few-labels'] : [];
}

/** The ids of the labelled blocks whose transcript, artifact and given equal those of a fixture of the criterion. */
export function fixtureLeaks(criterion: LoadedCriterion, blocks: readonly LabelledBlock[]): string[] {
  const slice = (x: { transcript: unknown; artifact?: unknown; given?: unknown }) =>
    JSON.stringify([x.transcript, x.artifact ?? null, x.given ?? null]);
  const fixtures = new Set([slice(criterion.fixtures.pass), slice(criterion.fixtures.fail)]);
  return blocks.filter((block) => fixtures.has(slice(block))).map((block) => block.id);
}

/** True for a judge result or a thrown judge failure whose cost is unknown in part or in whole. */
const unpriced = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'costIncomplete' in value && value.costIncomplete === true;

/** One answer as a council vote would get it: an unparsed answer is asked again with the large budget. */
async function answer(
  judge: JudgeClient,
  request: JudgeRequest,
  counter: { errors: number; spentUsd: number; calls: number; costIncomplete: number },
): Promise<JudgeOutcome> {
  try {
    counter.calls += 1;
    let result = await judge.judge({ ...request, budget: 'normal' });
    counter.spentUsd += result.costUsd ?? 0;
    if (unpriced(result)) counter.costIncomplete += 1;
    if (result.defaultJudge?.failure) {
      counter.errors += 1;
      return 'inconclusive';
    }
    if (result.unparsed) {
      counter.calls += 1;
      result = await judge.judge({ ...request, budget: 'large' });
      counter.spentUsd += result.costUsd ?? 0;
      if (unpriced(result)) counter.costIncomplete += 1;
      if (result.defaultJudge?.failure) {
        counter.errors += 1;
        return 'inconclusive';
      }
    }
    return result.unparsed ? 'inconclusive' : result.answer.outcome;
  } catch (cause) {
    if (unpriced(cause)) counter.costIncomplete += 1;
    counter.errors += 1;
    return 'inconclusive';
  }
}

/** Gwet's AC1 for pass against the rest: the observed agreement less the chance agreement of the pass category. */
function ac1Of(human: readonly string[], judged: readonly string[]): number | undefined {
  const n = human.length;
  if (n === 0) return undefined;
  const po = human.filter((label, i) => judged[i] === label).length / n;
  const pi = (human.filter((l) => l === 'pass').length + judged.filter((l) => l === 'pass').length) / (2 * n);
  const pe = 2 * pi * (1 - pi);
  return pe === 1 ? undefined : (po - pe) / (1 - pe);
}

export function agreement(
  ids: readonly string[],
  human: readonly ('pass' | 'fail')[],
  judged: readonly JudgeOutcome[],
  anchors: readonly (AnnotationAnchor | undefined)[] = [],
): LabelAgreement {
  const n = human.length;
  const agree = human.filter((label, i) => judged[i] === label).length;
  const interval = n === 0 ? { estimate: 0, lower: 0, upper: 1 } : wilson(agree, n);
  let kappa: number | undefined;
  if (n > 0 && new Set(human).size > 1) {
    kappa = cohenKappa([...judged], [...human], { categories: ['pass', 'fail', 'inconclusive'] }).kappa;
  }
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  human.forEach((label, i) => {
    const hit = judged[i] === (label === 'fail' ? 'fail' : 'pass');
    if (label === 'fail') {
      if (hit) tp += 1;
      else fn += 1;
    } else if (hit) tn += 1;
    else fp += 1;
  });
  const sensitivity = tp + fn === 0 ? undefined : tp / (tp + fn);
  const specificity = tn + fp === 0 ? undefined : tn / (tn + fp);
  return {
    n,
    agree,
    metrics: {
      tp,
      fp,
      tn,
      fn,
      ...(sensitivity === undefined ? {} : { sensitivity, falseNegativeRate: 1 - sensitivity }),
      ...(specificity === undefined ? {} : { specificity, falsePositiveRate: 1 - specificity }),
      ...(sensitivity === undefined || specificity === undefined
        ? {}
        : { balancedAccuracy: (sensitivity + specificity) / 2 }),
    },
    ...(kappa === undefined ? {} : { kappa }),
    ...(n === 0 ? {} : { pabak: (2 * agree) / n - 1 }),
    ...(ac1Of(human, judged) === undefined ? {} : { ac1: ac1Of(human, judged) }),
    agreement: interval,
    blocks: ids.map((id, i) => {
      const anchor = anchors[i];
      return {
        id,
        label: human[i] as 'pass' | 'fail',
        judged: judged[i] as JudgeOutcome,
        ...(anchor === undefined ? {} : { anchor }),
      };
    }),
  };
}

function vote(outcome: JudgeOutcome): JudgeOutcome | null {
  return outcome === 'inconclusive' ? null : outcome;
}

function alphaOf(matrix: (JudgeOutcome | null)[][]): number | undefined {
  if (matrix.length < 2) return undefined;
  try {
    return krippendorffAlpha(matrix).alpha;
  } catch {
    // No pairable value: every judge was inconclusive on every unit.
    return undefined;
  }
}

function classesOf(mode: CouncilMode): JudgeClass[] {
  if (mode === 'system1') return ['system1'];
  if (mode === 'llm') return ['system2'];
  return ['system1', 'system2'];
}

function byCost<T extends { cost: number; id: string }>(a: T, b: T): number {
  return a.cost - b.cost || a.id.localeCompare(b.id);
}

function familiesOf(judge: JudgeClient): string[] {
  return [
    ...new Set(
      [judge.family, ...(judge.families ?? [])].map(
        (family) => familyOfModel(family) ?? normalizeFamily(family),
      ),
    ),
  ];
}

/** The cheapest-judge rule: the one cheapest judge at the bar, in a class the mode uses, judges alone. */
function assignCheapest(
  rows: readonly JudgeCalibration[],
  judges: readonly JudgeClient[],
  mode: CouncilMode,
): CriterionAssignment {
  const classes = classesOf(mode);
  const [owner] = rows
    .filter((row) => row.meetsBar && classes.includes(row.cls))
    .map((row) => ({ id: row.judge, cost: row.cost, cls: row.cls }))
    .sort(byCost);
  if (!owner) {
    const missing = rows.map((row) => `${row.judge} ${row.misses.join(' and ')}`).join('; ');
    return { status: 'unassigned', reason: `no judge meets the bar${missing ? `: ${missing}` : ''}` };
  }
  const client = judges.find((j) => j.id === owner.id);
  const families = client ? familiesOf(client) : [];
  const [only] = families;
  return {
    status: 'assigned',
    owner: owner.id,
    cls: owner.cls,
    judges: [owner.id],
    rejudge: [],
    ...(families.length === 1 && only !== undefined ? { singleFamily: only } : {}),
  };
}

/** The assignment rule of the module comment: the cheapest judge at the bar in a class with three. */
function assign(
  rows: readonly JudgeCalibration[],
  judges: readonly JudgeClient[],
  mode: CouncilMode,
): CriterionAssignment {
  const classes = classesOf(mode);
  const atBar = (cls: JudgeClass) =>
    rows
      .filter((row) => row.cls === cls && row.meetsBar)
      .map((row) => ({ id: row.judge, cost: row.cost }))
      .sort(byCost);
  const ranked = rows
    .filter((row) => row.meetsBar && classes.includes(row.cls))
    .map((row) => ({ id: row.judge, cost: row.cost, cls: row.cls }))
    .sort(byCost);
  for (const owner of ranked) {
    const seated = atBar(owner.cls);
    if (seated.length < COUNCIL_SIZE) continue;
    const other: JudgeClass = owner.cls === 'system1' ? 'system2' : 'system1';
    let rejudge: string[] = [];
    if (mode === 'hybrid') {
      // A split goes to the other class: its judges at the bar first, then its cheapest others.
      const pool = judges
        .filter((judge) => judge.cls === other)
        .map((judge) => ({
          id: judge.id,
          cost: judge.cost,
          bar: rows.find((row) => row.judge === judge.id)?.meetsBar === true,
        }))
        .sort((a, b) => Number(b.bar) - Number(a.bar) || byCost(a, b));
      if (pool.length < COUNCIL_SIZE) continue;
      rejudge = pool.slice(0, COUNCIL_SIZE).map((judge) => judge.id);
    }
    const seatedIds = seated.slice(0, COUNCIL_SIZE).map((judge) => judge.id);
    const families = new Set(
      [...seatedIds, ...rejudge].flatMap((id) => {
        const judge = judges.find((j) => j.id === id);
        return judge ? familiesOf(judge) : [id];
      }),
    );
    const [only] = families;
    return {
      status: 'assigned',
      owner: owner.id,
      cls: owner.cls,
      judges: seatedIds,
      rejudge,
      ...(families.size === 1 && only !== undefined ? { singleFamily: only } : {}),
    };
  }
  const counts = classes
    .map((cls) => {
      const total = rows.filter((row) => row.cls === cls).length;
      return `${cls} has ${atBar(cls).length} of ${total} judges at the bar`;
    })
    .join(', ');
  const missing = rows
    .filter((row) => !row.meetsBar)
    .map((row) => `${row.judge} ${row.misses.join(' and ')}`)
    .join('; ');
  return {
    status: 'unassigned',
    reason: `no class has ${COUNCIL_SIZE} judges at the bar (${counts})${missing ? `: ${missing}` : ''}`,
  };
}

function fixed(value: number): string {
  return value.toFixed(2);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// The assignment table: what calibration writes and a council reads.

const AssignedEntry = z.strictObject({
  criterion: z.string().min(1),
  status: z.literal('assigned'),
  owner: z.string().min(1),
  class: JudgeClass,
  judges: z.array(z.string().min(1)),
  rejudge: z.array(z.string().min(1)),
  /** Every judge of the row is of this one family: weaker evidence than a council across families. */
  single_family: z.string().optional(),
  /** The owner's measured cost per call on this criterion in US dollars, when its client reports a cost. */
  cost_per_call_usd: z.number().optional(),
  /** The owner's separation, as "k of n". */
  separation: z.string(),
  /** The owner's kappa against the labels. */
  kappa: z.number(),
});

const UnassignedEntry = z.strictObject({
  criterion: z.string().min(1),
  status: z.literal('unassigned'),
  reason: z.string().min(1),
});

export const AssignmentTable = z.strictObject({
  version: z.literal(1),
  mode: z.enum(['system1', 'hybrid', 'llm']),
  repeats: z.number().int().min(1),
  kappa_min: z.number(),
  /** The assignment rule; absent means council. */
  rule: z.literal('cheapest').optional(),
  criteria: z.array(z.discriminatedUnion('status', [AssignedEntry, UnassignedEntry])),
});
export type AssignmentTable = z.infer<typeof AssignmentTable>;

/** The table a report gives. */
export function assignmentTable(report: CalibrationReport): AssignmentTable {
  return {
    version: 1,
    mode: report.mode,
    repeats: report.repeats,
    kappa_min: report.kappaMin,
    ...(report.rule === 'cheapest' ? { rule: 'cheapest' as const } : {}),
    criteria: report.criteria.map((criterion) => {
      const a = criterion.assignment;
      if (a.status === 'unassigned') {
        return { criterion: criterion.criterion, status: 'unassigned' as const, reason: a.reason };
      }
      const owner = criterion.judges.find((row) => row.judge === a.owner) as JudgeCalibration;
      return {
        criterion: criterion.criterion,
        status: 'assigned' as const,
        owner: a.owner,
        class: a.cls,
        judges: [...a.judges],
        rejudge: [...a.rejudge],
        ...(a.singleFamily === undefined ? {} : { single_family: a.singleFamily }),
        separation: `${owner.separation.separated} of ${owner.separation.repeats}`,
        kappa: Number(fixed(owner.labels.kappa ?? 0)),
        ...(owner.spentUsd > 0 && owner.calls > 0
          ? { cost_per_call_usd: Number((owner.spentUsd / owner.calls).toFixed(6)) }
          : {}),
      };
    }),
  };
}

export function renderAssignmentTable(table: AssignmentTable): string {
  if (table.rule === 'cheapest') {
    return `# Written by driftbench judge calibrate --assign cheapest. Each criterion is owned by the one cheapest judge\n# that separates its fixture pair in every repeat and reaches kappa ${table.kappa_min} against the hand labels; it\n# judges alone. An unassigned criterion is judged but never gates.\n${stringifyYaml(table, { lineWidth: 0 })}`;
  }
  return `# Written by driftbench judge calibrate. A criterion is owned by the cheapest judge that separates its\n# fixture pair in every repeat and reaches kappa ${table.kappa_min} against the hand labels, in a class with three\n# such judges. An unassigned criterion is judged but never gates.\n${stringifyYaml(table, { lineWidth: 0 })}`;
}

export async function writeAssignmentTable(path: string, table: AssignmentTable): Promise<void> {
  await writeFile(path, renderAssignmentTable(table), 'utf8');
}

/** What a council takes from a table: the rows calibration earned and the criteria it left unassigned. */
export type CouncilAssignment = {
  readonly assignment: readonly AssignmentRow[];
  readonly unassigned: readonly UnassignedCriterion[];
  readonly mode: CouncilMode;
};

export function councilAssignment(table: AssignmentTable): CouncilAssignment {
  const assignment: AssignmentRow[] = [];
  const unassigned: UnassignedCriterion[] = [];
  for (const entry of table.criteria) {
    if (entry.status === 'unassigned') unassigned.push({ criterion: entry.criterion, reason: entry.reason });
    else {
      assignment.push({
        criterion: entry.criterion,
        cls: entry.class,
        judges: entry.judges,
        rejudge: entry.rejudge,
        source: 'calibration',
      });
    }
  }
  return { assignment, unassigned, mode: table.mode };
}

/** Reads and validates an assignment table. Throws with the first problem. */
export async function loadAssignmentTable(path: string): Promise<AssignmentTable> {
  let value: unknown;
  try {
    value = parseYaml(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${path}: ${message(cause)}`);
  }
  const parsed = AssignmentTable.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${path}: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim());
  }
  return parsed.data;
}

/** The probability that a binomial(n, p) count is at most k. */
function binomialAtMost(k: number, n: number, p: number): number {
  let total = 0;
  let logTerm = n * Math.log(1 - p);
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logTerm += Math.log(n - i + 1) - Math.log(i) + Math.log(p) - Math.log(1 - p);
    total += Math.exp(logTerm);
  }
  return total;
}

/**
 * An exact 95% interval on the share of blocks judges agree on, from k agreeing blocks of n (Clopper-Pearson).
 * Exact, so its coverage never falls below 95% near agreement 1 at small n, where Wilson's falls short.
 */
export function agreementInterval(agree: number, n: number): { lower: number; upper: number } {
  const alpha = 0.025;
  const solve = (target: (p: number) => number) => {
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 100; step += 1) {
      const mid = (lo + hi) / 2;
      if (target(mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const lower = agree === 0 ? 0 : solve((p) => alpha - (1 - binomialAtMost(agree - 1, n, p)));
  const upper = agree === n ? 1 : solve((p) => binomialAtMost(agree, n, p) - alpha);
  return { lower, upper };
}
