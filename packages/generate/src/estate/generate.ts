import { type CriterionDef, type Issue, parseSpecText } from '@driftbench/core';
import { stringify } from 'yaml';
import type { GeneratedFile } from '../enumerate/generate';
import { formatJson } from '../enumerate/json';
import { DEVIATION_EXPECTED } from '../seed/deviation';
import { rngFor, shuffle } from '../seed/random';
import {
  type BankPhrase,
  checkBank,
  checkSessions,
  type EstateAtom,
  type EstateMapInput,
  type EstatePlanInput,
  type EstatePlanRow,
  type InputIssue,
  type PhraseBank,
  type SessionEntry,
  type SessionIndex,
  type Situation,
  type SituationUse,
} from './inputs';
import {
  addPair,
  addWorkspace,
  type Gap,
  gap,
  MARKER_NAMES,
  MARKERS,
  type Marker,
  type StageModel,
  stageModel,
  type ThenContext,
  type ThenParts,
  thenOf,
} from './then';

/**
 * `driftbench estate generate`: every approved plan row becomes one or more task specs, by code only.
 *
 * - Given: the estate (runtime and map hash), the session state of the row's cell, the workspace seed of
 *   the situation, and the event of a hazard or a helper stop.
 * - When: an approved phrase of the phrase bank for the situation the row needs (the trigger, a situation
 *   just outside it, a near miss, a misroute, a skip temptation), drawn by the seed; or, for a replay row,
 *   the recorded ask of each session of that situation.
 * - Then: the evidence predicates of the row's atoms, as existing checks (see `then.ts`), and the outcome
 *   the situation declares: the paths it may touch, every other path untouched.
 *
 * A row that the bank, the sessions or the checks cannot fill is written to `incomplete/` with named
 * markers; nothing is guessed. Same inputs and seed give the same files, byte for byte.
 */

export const ESTATE_REPORT_FILE = 'estate-generate-report.json';
export const ESTATE_COMPLETE_DIR = 'specs';
export const ESTATE_INCOMPLETE_DIR = 'incomplete';
export const ESTATE_SEEDER = 'estate';
export const ESTATE_DEFAULT_SEED = 1;
/** The custom checks the replay runner registers. */
export const REPLAY_CUSTOM_CHECKS: readonly string[] = ['ordered'];

/** The situation each test type is asked in; `none` for a test that needs no ask. */
export const SITUATION_OF: Readonly<Record<string, SituationUse | 'none'>> = {
  obligation: 'trigger',
  outside_trigger: 'outside',
  twin: 'trigger',
  ordered_pair: 'trigger',
  skip_pressure: 'pressure',
  route_positive: 'trigger',
  route_near_miss: 'near_miss',
  misroute: 'misroute',
  read_when: 'trigger',
  script_fixture: 'trigger',
  dispatch: 'trigger',
  contract_alone: 'trigger',
  stop_resume: 'trigger',
  guard_positive: 'trigger',
  guard_negative: 'outside',
  guard_hostile: 'trigger',
  guard_speed: 'trigger',
  guard_register: 'trigger',
  tool_boundary: 'trigger',
  tool_denied: 'trigger',
  tool_deferred: 'trigger',
  stage_order: 'trigger',
  stage_skip: 'pressure',
  stage_anytime: 'trigger',
  register_sample: 'trigger',
  hazard_recovery: 'trigger',
  invariant: 'none',
  journey: 'trigger',
};

/** Negative controls: the Then is that the act does not happen. */
export const NEGATIVE_TESTS: ReadonlySet<string> = new Set([
  'outside_trigger',
  'route_near_miss',
  'guard_negative',
]);

export class EstateInputError extends Error {
  constructor(
    message: string,
    readonly issues: InputIssue[],
  ) {
    super(message);
    this.name = 'EstateInputError';
  }
}

export type EstateGenerateInput = {
  map: EstateMapInput;
  plan: EstatePlanInput;
  bank: PhraseBank;
  sessions?: SessionIndex;
};

export type EstateGenerateOptions = {
  seed?: number;
  /** Paths as the records name them: relative to the output folder, never absolute. */
  paths: { map: string; plan: string; phrases: string; sessions?: string };
  /** Custom checks the runner registers; default the replay runner's. */
  customChecks?: readonly string[];
};

export type Totals = { rows: number; specs: number; complete: number; incomplete: number };

export type EstateReport = {
  generator: 'driftbench estate generate';
  map: { path: string; runtime: string; hash: string; atoms: number };
  plan: { path: string; rows: number; approved: number; proposed: number; struck: number };
  phrases: { path: string; situations: number; phrases: number; workspaces: number };
  sessions: { path: string; sessions: number } | null;
  options: { seed: number; checks: string[] };
  summary: { specs: number; blocks: number; complete: number; incomplete: number; judged: number };
  perTestType: Record<string, Totals>;
  perMode: Record<string, Totals>;
  gaps: Array<{ marker: string; specs: number; atoms: string[]; details: string[] }>;
  replay: Array<{ spec: string; session: string; planRow: string; expect: 'pass' | 'fail' }>;
  waiting: string[];
  struck: string[];
  invalid: Array<{ id: string; errors: Issue[] }>;
  lint: Array<{ id: string; warnings: Issue[] }>;
};

export type EstateSpecRecord = {
  id: string;
  path: string;
  row: string;
  testType: string;
  mode: string;
  complete: boolean;
  markers: Marker[];
  session?: string;
  expect?: 'pass' | 'fail';
};

export type EstateGenerateResult = {
  files: GeneratedFile[];
  report: EstateReport;
  specs: EstateSpecRecord[];
};

type Context = ThenContext & {
  map: EstateMapInput;
  atoms: ReadonlyMap<string, EstateAtom>;
  bank: PhraseBank;
  sessions?: SessionIndex;
  seed: number;
  paths: EstateGenerateOptions['paths'];
};

type Built = {
  id: string;
  spec: Record<string, unknown>;
  gaps: Gap[];
  blocks: number;
  judged: number;
  session?: SessionEntry;
  expect?: 'pass' | 'fail';
};

/** Checks the inputs against each other; throws an EstateInputError listing every issue. */
export function checkEstateInputs(input: EstateGenerateInput): void {
  const issues: InputIssue[] = [];
  const { map, plan, bank, sessions } = input;
  if (plan.mapHash !== map.hash) {
    issues.push({
      path: 'plan.mapHash',
      message: `the plan was made from map ${plan.mapHash.slice(0, 12)}, the map given is ${map.hash.slice(0, 12)}`,
    });
  }
  const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const rows = new Set<string>();
  plan.rows.forEach((row, index) => {
    const at = `plan.rows.${index}`;
    if (rows.has(row.id)) issues.push({ path: `${at}.id`, message: `${row.id} twice` });
    rows.add(row.id);
    if (!(row.testType in SITUATION_OF)) {
      issues.push({ path: `${at}.testType`, message: `${row.testType} is no test type` });
    }
    row.atomIds.forEach((id, position) => {
      const atom = atoms.get(id);
      if (!atom) issues.push({ path: `${at}.atomIds.${position}`, message: `${id} is no atom of the map` });
      else if (!atom.approved && row.status !== 'struck') {
        issues.push({ path: `${at}.atomIds.${position}`, message: `${id} is not approved` });
      }
    });
  });
  issues.push(...checkBank(bank, map).map((issue) => ({ ...issue, path: `phrases.${issue.path}` })));
  if (sessions) {
    issues.push(
      ...checkSessions(sessions, bank, map).map((issue) => ({ ...issue, path: `sessions.${issue.path}` })),
    );
  }
  if (issues.length > 0) {
    throw new EstateInputError(
      `${issues.length} input issue${issues.length === 1 ? '' : 's'}; nothing written`,
      issues,
    );
  }
}

/** Generates the suite. Pure: no clock, no file system. */
export function generateEstateSuite(
  input: EstateGenerateInput,
  options: EstateGenerateOptions,
): EstateGenerateResult {
  checkEstateInputs(input);
  const seed = options.seed ?? ESTATE_DEFAULT_SEED;
  const checks = [...(options.customChecks ?? REPLAY_CUSTOM_CHECKS)].sort();
  const ctx: Context = {
    map: input.map,
    atoms: new Map(input.map.atoms.map((atom) => [atom.id, atom])),
    bank: input.bank,
    ...(input.sessions ? { sessions: input.sessions } : {}),
    seed,
    paths: options.paths,
    stages: stageModel(input.map.atoms),
    skills: new Set(
      input.map.atoms
        .filter((atom) => atom.kind === 'skill')
        .map((atom) => atom.fields?.name)
        .filter((name): name is string => typeof name === 'string'),
    ),
    customChecks: new Set(checks),
  };

  const files: GeneratedFile[] = [];
  const records: EstateSpecRecord[] = [];
  const perTestType: Record<string, Totals> = {};
  const perMode: Record<string, Totals> = {};
  const gaps = new Map<string, { specs: Set<string>; atoms: Set<string>; details: Set<string> }>();
  const invalid: EstateReport['invalid'] = [];
  const lint: EstateReport['lint'] = [];
  const replay: EstateReport['replay'] = [];
  const waiting: string[] = [];
  const struck: string[] = [];
  const used = new Set<string>();
  let blocks = 0;
  let judged = 0;

  for (const row of input.plan.rows) {
    if (row.status === 'struck') {
      struck.push(row.id);
      continue;
    }
    if (row.status !== 'approved') {
      waiting.push(row.id);
      continue;
    }
    const totalsType = totalsFor(perTestType, row.testType);
    const totalsMode = totalsFor(perMode, row.mode);
    totalsType.rows += 1;
    totalsMode.rows += 1;
    for (const built of buildRow(row, ctx, used)) {
      const markers = [...new Set(built.gaps.map((entry) => entry.marker))].sort() as Marker[];
      const complete = markers.length === 0;
      const text = specText(built, row, ctx, markers);
      const loaded = parseSpecText(text, 'yaml', built.id);
      if (!loaded.ok) {
        invalid.push({ id: built.id, errors: loaded.errors });
        continue;
      }
      const unexpected = loaded.warnings.filter((warning) => !explained(warning, markers));
      if (unexpected.length > 0) lint.push({ id: built.id, warnings: unexpected });
      const folder = complete ? ESTATE_COMPLETE_DIR : ESTATE_INCOMPLETE_DIR;
      // By mode first, so a replay run takes `specs/replay` and nothing else.
      const path = `${folder}/${row.mode}/${row.testType}/${built.id}.yaml`;
      files.push({ path, text });
      records.push({
        id: built.id,
        path,
        row: row.id,
        testType: row.testType,
        mode: row.mode,
        complete,
        markers,
        ...(built.session ? { session: built.session.name } : {}),
        ...(built.expect ? { expect: built.expect } : {}),
      });
      if (built.session && built.expect && complete) {
        replay.push({ spec: built.id, session: built.session.name, planRow: row.id, expect: built.expect });
      }
      for (const totals of [totalsType, totalsMode]) {
        totals.specs += 1;
        if (complete) totals.complete += 1;
        else totals.incomplete += 1;
      }
      blocks += built.blocks;
      if (complete && built.judged > 0) judged += 1;
      for (const entry of built.gaps) {
        const known = gaps.get(entry.marker) ?? { specs: new Set(), atoms: new Set(), details: new Set() };
        known.specs.add(built.id);
        known.atoms.add(entry.atom);
        known.details.add(entry.detail);
        gaps.set(entry.marker, known);
      }
    }
  }

  const complete = records.filter((record) => record.complete).length;
  const report: EstateReport = {
    generator: 'driftbench estate generate',
    map: {
      path: options.paths.map,
      runtime: input.map.runtime,
      hash: input.map.hash,
      atoms: input.map.atoms.length,
    },
    plan: {
      path: options.paths.plan,
      rows: input.plan.rows.length,
      approved: input.plan.rows.filter((row) => row.status === 'approved').length,
      proposed: waiting.length,
      struck: struck.length,
    },
    phrases: {
      path: options.paths.phrases,
      situations: input.bank.situations.length,
      phrases: input.bank.situations.reduce(
        (sum, situation) => sum + situation.phrases.filter((phrase) => phrase.approved).length,
        0,
      ),
      workspaces: input.bank.workspaces.length,
    },
    sessions:
      input.sessions && options.paths.sessions
        ? { path: options.paths.sessions, sessions: input.sessions.sessions.length }
        : null,
    options: { seed, checks },
    summary: { specs: records.length, blocks, complete, incomplete: records.length - complete, judged },
    perTestType: ordered(perTestType, Object.keys(SITUATION_OF)),
    perMode: ordered(perMode, ['replay', 'unit', 'live']),
    gaps: [...gaps.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([marker, entry]) => ({
        marker,
        specs: entry.specs.size,
        atoms: [...entry.atoms].sort(),
        details: [...entry.details].sort(),
      })),
    replay,
    waiting,
    struck,
    invalid,
    lint,
  };
  files.push({ path: ESTATE_REPORT_FILE, text: formatJson(report) });
  return { files, report, specs: records };
}

/**
 * The situation a row is asked in. A live guard_positive row takes a `forced` situation, whose phrase
 * instructs the guarded act: whether the guard fires must not hang on the agent choosing a forbidden act
 * (the first real run saw the agent refuse it from the standing rules, and the guard never fired). A row
 * with no forced situation stays incomplete under the phrase marker.
 */
export function useOf(row: Pick<EstatePlanRow, 'testType' | 'mode'>): SituationUse | 'none' {
  if (row.testType === 'guard_positive' && row.mode === 'live') return 'forced';
  return SITUATION_OF[row.testType] ?? 'none';
}

/** The specs of one row: one, or one per recorded session of its situation for a replay row. */
function buildRow(row: EstatePlanRow, ctx: Context, used: Set<string>): Built[] {
  const atoms = row.atomIds.map((id) => ctx.atoms.get(id) as EstateAtom);
  const use = useOf(row);
  const situation = use === 'none' ? undefined : findSituation(ctx.bank, use, row);
  if (row.mode !== 'replay') return [build(row, atoms, ctx, used, situation)];
  const sessions = situation
    ? (ctx.sessions?.sessions ?? []).filter((session) => session.situation === situation.id)
    : [];
  if (sessions.length === 0) return [build(row, atoms, ctx, used, situation, undefined, true)];
  return sessions.map((session) => build(row, atoms, ctx, used, situation, session));
}

function build(
  row: EstatePlanRow,
  atoms: readonly EstateAtom[],
  ctx: Context,
  used: Set<string>,
  situation: Situation | undefined,
  session?: SessionEntry,
  noSession = false,
): Built {
  const use = useOf(row);
  const polarity = NEGATIVE_TESTS.has(row.testType) ? 'negative' : 'positive';
  const own = row.testType === 'contract_alone' ? atoms.filter((atom) => atom.kind !== 'subagent') : atoms;
  const then = thenOf(own, polarity, ctx);
  const first = atoms[0] as EstateAtom;

  // Test types that add to or change what the atoms say.
  if (row.testType === 'stage_order' || row.testType === 'stage_skip') {
    for (const atom of atoms) stageOrder(then, atom, ctx.stages);
  }
  if (row.testType === 'guard_hostile') {
    // A malformed payload: the guard answers with some verdict instead of failing.
    then.guards = then.guards.map(({ verdict: _verdict, ...guard }) => ({ ...guard, count: { min: 1 } }));
  }
  if (row.testType === 'guard_speed') {
    gap(then, MARKERS.guardTiming, first, 'the trace records no time per guard run');
  }
  if (row.testType === 'guard_register') {
    gap(then, MARKERS.guardMessage, first, 'the trace records no guard message text');
  }
  if (noSession) {
    gap(then, MARKERS.session, first, `no recorded session of ${situation?.id ?? 'this situation'}`);
  }
  if (then.ordered.length > 0 && !ctx.customChecks.has('ordered')) {
    gap(then, MARKERS.registered, first, 'ordered');
  }

  // When: the phrase.
  let phrase: BankPhrase | undefined;
  let phraseIndex: number | undefined;
  if (use !== 'none') {
    if (!situation) {
      gap(then, MARKERS.phrase, first, `a ${use} situation for ${first.id}`);
    } else if (session) {
      phraseIndex = situation.phrases.findIndex((entry) => entry.text === session.ask);
      phrase = situation.phrases[phraseIndex];
    } else {
      const order = shuffle(
        rngFor(ctx.seed, `estate:${situation.id}`),
        situation.phrases.filter((entry) => entry.approved),
      );
      phrase = order[row.testType === 'twin' ? 1 : 0];
      if (!phrase) {
        gap(
          then,
          row.testType === 'twin' ? MARKERS.secondPhrase : MARKERS.phrase,
          first,
          `${situation.id} has ${order.length} approved phrase${order.length === 1 ? '' : 's'}`,
        );
      } else phraseIndex = situation.phrases.indexOf(phrase);
    }
  }

  // The outcome the situation declares.
  if (situation?.touches) {
    addWorkspace(then, { ...situation.touches, othersUntouched: true });
  }
  // A static test runs no ask: its static marker says what it waits for, nothing else is owed.
  const asks = use !== 'none';
  if (asks && !then.workspace && !then.ranCode && then.artifacts.length === 0) {
    gap(
      then,
      MARKERS.outcome,
      first,
      situation
        ? `${situation.id} declares no paths it may touch`
        : 'no situation of the bank declares the paths the ask may touch',
    );
  }

  // Blocks.
  const placeholder = `[no approved phrase: ${use} situation for ${first.id}]`;
  const blocks: Array<Record<string, unknown>> = [
    { id: 'ask', when: { user: phrase?.text ?? placeholder }, expect: expectOf(then, true) },
  ];
  if (row.testType === 'stop_resume') {
    const resume = findSituation(ctx.bank, 'resume', row);
    const order = resume
      ? shuffle(
          rngFor(ctx.seed, `estate:${resume.id}`),
          resume.phrases.filter((entry) => entry.approved),
        )
      : [];
    const text = order[0]?.text;
    if (text === undefined) gap(then, MARKERS.phrase, first, `a resume situation for ${first.id}`);
    blocks.push({
      id: 'resume',
      when: { user: text ?? `[no approved phrase: resume situation for ${first.id}]` },
      given: { vars: { event: 'helper_stopped' } },
      expect: expectOf(then, false),
    });
  }
  // A block left empty by other gaps is already named by them; an empty block with none is its own gap.
  const named = then.gaps.length > 0;
  for (const block of blocks) {
    if (asks && !named && Object.keys(block.expect as object).length === 0) {
      gap(then, MARKERS.noThen, first, `block ${String(block.id)} checks nothing`);
    }
  }

  // Deviation of the cell, as a perturbation before the ask.
  const deviation = row.cell.deviation;
  let perturbation: Record<string, unknown> | undefined;
  if (deviation !== undefined && deviation !== 'none') {
    const entry = ctx.bank.deviations.find((candidate) => candidate.class === deviation);
    const order = entry
      ? shuffle(
          rngFor(ctx.seed, `estate:deviation:${deviation}`),
          entry.phrases.filter((item) => item.approved),
        )
      : [];
    const text = order[0]?.text;
    if (text === undefined) gap(then, MARKERS.deviation, first, deviation);
    if (!(deviation in DEVIATION_EXPECTED)) {
      gap(then, MARKERS.deviation, first, `${deviation} is no deviation class of the spec format`);
    } else {
      perturbation = {
        id: `deviation-${deviation}`,
        class: deviation,
        inject_at: 0,
        user: text ?? `[no approved phrase: deviation ${deviation}]`,
        recovery: { within_blocks: 1 },
      };
    }
  }

  const markers = new Set(then.gaps.map((entry) => entry.marker));
  const complete = markers.size === 0;
  if (!complete) {
    const names = [...markers].sort();
    for (const block of blocks) {
      const expect = block.expect as Record<string, unknown>;
      delete expect.criteria;
      if (block === blocks[0] || Object.keys(expect).length === 0) expect.criteria = names;
    }
  }

  const id = uniqueId(specId(row.id, session?.name), used);
  const vars: Record<string, unknown> = {
    estate: { runtime: ctx.map.runtime, map_hash: ctx.map.hash },
  };
  const sessionState = row.cell.session_state;
  if (sessionState !== undefined) vars.session_state = sessionState;
  const hazard = row.cell.estate_hazard;
  if (hazard !== undefined && hazard !== 'no_hazard') vars.event = hazard;
  const seed = situation?.workspace
    ? ctx.bank.workspaces.find((candidate) => candidate.id === situation.workspace)
    : undefined;
  if (seed) vars.workspace_seed = seed.id;

  const usesStages = blocks.some((block) => (block.expect as Record<string, unknown>).stage !== undefined);
  const kinds = [...new Set(atoms.map((atom) => `kind:${atom.kind}`))];
  const expectRun = session
    ? session.violates.some((atom) => row.atomIds.includes(atom))
      ? 'fail'
      : 'pass'
    : undefined;
  const spec: Record<string, unknown> = {
    id,
    version: ctx.map.hash.slice(0, 12),
    kind: 'task',
    title: `${row.testType}: ${first.title}${session ? ` (session ${session.name})` : ''}`,
    ...(phrase ? { lang: phrase.lang.toUpperCase() } : {}),
    tier: 'generated',
    tags: ['estate', `test:${row.testType}`, `mode:${row.mode}`, ...kinds],
    target: { adapter: ctx.map.runtime },
    given: { vars, ...(seed ? { world: { workspace: { files: seed.files } } } : {}) },
    ...(usesStages ? { stages: ctx.stages.ids } : {}),
    ...(complete && then.criteria.length > 0 ? { criteria: then.criteria } : {}),
    blocks,
    ...(then.ordered.length > 0 ? { rules: { custom: { ordered: { pairs: then.ordered } } } } : {}),
    ...(perturbation ? { perturbations: [perturbation] } : {}),
    metadata: {
      estate: {
        atoms: row.atomIds,
        planRow: row.id,
        cell: row.cell,
        seeder: ESTATE_SEEDER,
        seed: ctx.seed,
        mapHash: ctx.map.hash,
        testType: row.testType,
        mode: row.mode,
        map: ctx.paths.map,
        plan: ctx.paths.plan,
        situation: situation?.id ?? null,
        phrase: phraseIndex ?? null,
        ...(session ? { session: session.name, expect: expectRun } : {}),
        ...(complete
          ? {}
          : {
              needs: then.gaps.map((entry) => ({
                marker: entry.marker,
                atom: entry.atom,
                detail: entry.detail,
              })),
            }),
      },
      ...(session ? { replay: { session: session.name, from_block: session.from_block } } : {}),
    },
  };
  return {
    id,
    spec,
    gaps: then.gaps,
    blocks: blocks.length,
    judged: complete ? then.criteria.length : 0,
    ...(session ? { session } : {}),
    ...(expectRun ? { expect: expectRun } : {}),
  };
}

/** The Then of a block as `expect`. The first block holds the outcome and the judged criteria. */
function expectOf(then: ThenParts, first: boolean): Record<string, unknown> {
  const expect: Record<string, unknown> = {};
  if (first && then.stage !== undefined) expect.stage = then.stage;
  if (then.skills.length > 0) expect.skills = then.skills.map((skill) => ({ ...skill }));
  if (then.guards.length > 0) expect.guards = then.guards.map((guard) => ({ ...guard }));
  if (then.tools.length > 0) expect.tools = then.tools.map((tool) => ({ ...tool }));
  if (then.offeredExclude.length > 0) expect.tools_offered = { exclude: [...then.offeredExclude] };
  if (first && then.must.length > 0) expect.must = [...then.must];
  if (first && then.mustNot.length > 0) expect.must_not = [...then.mustNot];
  if (first && then.lang !== undefined) expect.lang = then.lang;
  if (first && then.ranCode) expect.execution = { ran_code: true };
  if (first && then.artifacts.length > 0) expect.artifacts = then.artifacts.map((item) => ({ ...item }));
  if (first && then.workspace) {
    const { created, changed, deleted, othersUntouched } = then.workspace;
    expect.workspace = {
      ...(created.length > 0 ? { created: [...created] } : {}),
      ...(changed.length > 0 ? { changed: [...changed] } : {}),
      ...(deleted.length > 0 ? { deleted: [...deleted] } : {}),
      ...(othersUntouched ? { others_untouched: true } : {}),
    };
  }
  if (first && then.criteria.length > 0) {
    expect.criteria = then.criteria.map((criterion: CriterionDef) => criterion.name);
  }
  return expect;
}

/** A stage comes after its immediate dominator: the stage every path to it passes last. */
function stageOrder(then: ThenParts, atom: EstateAtom, stages: StageModel): void {
  if (atom.kind !== 'stage') return;
  const id = atom.fields?.id;
  if (typeof id !== 'string') return;
  const before = stages.idom.get(id);
  if (before !== undefined) addPair(then, { before: `stage:${before}`, after: `stage:${id}` });
}

/**
 * The situation of a row: a situation of the right use whose atoms hold the row's first atom and whose
 * pinned cell values agree with the row; among them the one that holds most of the row's atoms, then the
 * first in the bank.
 */
export function findSituation(
  bank: PhraseBank,
  use: SituationUse,
  row: Pick<EstatePlanRow, 'atomIds' | 'cell'>,
): Situation | undefined {
  const head = row.atomIds[0];
  let best: Situation | undefined;
  let score = -1;
  for (const situation of bank.situations) {
    if (situation.use !== use || head === undefined || !situation.atoms.includes(head)) continue;
    const pins = Object.entries(situation.cell ?? {});
    if (pins.some(([key, value]) => row.cell[key] !== undefined && row.cell[key] !== value)) continue;
    const held = row.atomIds.filter((id) => situation.atoms.includes(id)).length;
    if (held > score) {
      best = situation;
      score = held;
    }
  }
  return best;
}

/** The YAML text of a spec, with a header. */
function specText(built: Built, row: EstatePlanRow, ctx: Context, markers: readonly Marker[]): string {
  const header = [
    `# Generated by driftbench estate generate (plan row ${row.id}, seed ${ctx.seed}) from ${ctx.paths.plan} and ${ctx.paths.map}, map hash ${ctx.map.hash.slice(0, 12)}.`,
    '# Code wrote it: the ask is an approved phrase of the bank, the Then comes from the atoms of the row.',
    '# Do not edit it by hand: change the estate, the plan or the bank and generate again. Fictional data only.',
  ];
  if (markers.length > 0) {
    header.push(`# Not runnable yet: ${markers.join(', ')} (see metadata.estate.needs).`);
  }
  const body = stringify(built.spec, { lineWidth: 0, aliasDuplicateObjects: false });
  return `${header.join('\n')}\n${body}`;
}

/** A lint warning the spec's markers explain: an incomplete spec references criteria nobody defines. */
function explained(warning: Issue, markers: readonly Marker[]): boolean {
  if (markers.length === 0) return false;
  if (warning.code === 'CRITERION_UNRESOLVED') {
    return [...MARKER_NAMES].some((name) => warning.message.includes(name));
  }
  if (warning.code === 'TASK_WITHOUT_OUTCOME') {
    return markers.includes(MARKERS.outcome) || markers.includes(MARKERS.static);
  }
  return false;
}

/** A spec id from a plan row id: the characters a spec id allows, a session name after a dot. */
export function specId(rowId: string, session?: string): string {
  const clean = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  const base = `estate.${clean(rowId)}`;
  return session === undefined ? base : `${base}.${clean(session)}`;
}

function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${id}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function ordered(totals: Record<string, Totals>, order: readonly string[]): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  for (const key of order) if (totals[key]) out[key] = totals[key];
  for (const key of Object.keys(totals).sort()) if (!out[key]) out[key] = totals[key] as Totals;
  return out;
}

/** The summary the command prints. */
export function renderEstateSummary(report: EstateReport): string {
  const lines = [
    `Map ${report.map.path} (${report.map.runtime}), hash ${report.map.hash.slice(0, 12)}: ${report.map.atoms} atoms.`,
    `Plan ${report.plan.path}: ${report.plan.rows} rows, ${report.plan.approved} approved, ${report.plan.proposed} waiting, ${report.plan.struck} struck.`,
    `Phrases ${report.phrases.path}: ${report.phrases.situations} situations, ${report.phrases.phrases} approved phrases.`,
    report.sessions
      ? `Sessions ${report.sessions.path}: ${report.sessions.sessions}.`
      : 'Sessions: none given, so replay rows wait for a recorded session.',
    `Seed ${report.options.seed}; custom checks the runner registers: ${report.options.checks.join(', ') || 'none'}.`,
    '',
    `${'Test type'.padEnd(18)}${'rows'.padStart(6)}${'specs'.padStart(7)}${'complete'.padStart(10)}${'incomplete'.padStart(12)}`,
  ];
  for (const [type, totals] of Object.entries(report.perTestType)) {
    lines.push(
      `${type.padEnd(18)}${String(totals.rows).padStart(6)}${String(totals.specs).padStart(7)}${String(totals.complete).padStart(10)}${String(totals.incomplete).padStart(12)}`,
    );
  }
  lines.push(
    `${'total'.padEnd(18)}${''.padStart(6)}${String(report.summary.specs).padStart(7)}${String(report.summary.complete).padStart(10)}${String(report.summary.incomplete).padStart(12)}`,
    '',
  );
  if (report.gaps.length > 0) {
    lines.push('Gaps (what keeps a spec incomplete):');
    for (const entry of report.gaps) {
      lines.push(`  ${entry.marker.padEnd(26)} ${entry.specs} spec${entry.specs === 1 ? '' : 's'}`);
    }
  }
  if (report.replay.length > 0) {
    const fail = report.replay.filter((entry) => entry.expect === 'fail').length;
    lines.push(
      `Replay: ${report.replay.length} specs aligned to sessions, ${report.replay.length - fail} planned to pass, ${fail} to fail.`,
    );
  }
  if (report.waiting.length > 0) lines.push(`Waiting for approval: ${report.waiting.length} rows.`);
  if (report.invalid.length > 0) lines.push(`Invalid specs (a generator defect): ${report.invalid.length}.`);
  if (report.lint.length > 0)
    lines.push(`Specs with lint warnings (a generator defect): ${report.lint.length}.`);
  return `${lines.join('\n')}\n`;
}

function totalsFor(table: Record<string, Totals>, key: string): Totals {
  const known = table[key];
  if (known) return known;
  const fresh = { rows: 0, specs: 0, complete: 0, incomplete: 0 };
  table[key] = fresh;
  return fresh;
}
