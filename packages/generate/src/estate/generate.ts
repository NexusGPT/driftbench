import { type CriterionDef, type Issue, parseSpecText } from '@driftbench/core';
import { stringify } from 'yaml';
import type { GeneratedFile } from '../enumerate/generate';
import { formatJson } from '../enumerate/json';
import { DEVIATION_EXPECTED } from '../seed/deviation';
import { rngFor, shuffle } from '../seed/random';
import { codeAsk, DEVIATION_ASKS } from './asks';
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
import { STATIC_DIR, STATIC_TEST_TYPES, type StaticTest, staticCheckOf } from './static';
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
 * markers. Same inputs and seed give the same files, byte for byte.
 *
 * Fallbacks (on by default, off with `fallback: false`), so a row is never blocked by a missing phrase or
 * an undeclared outcome alone. Each is marked on the spec, and a reviewed input always wins:
 * - the ask: with no approved phrase for the row, an ask written by code from the atoms (`asks.ts`), tag
 *   `ask:code`; the same for a deviation message and a resume message;
 * - the outcome: with no paths declared by the situation and none the atoms name, the effect read from the
 *   atoms: nothing changes for a negative control, a denied tool, a guard that denies or blocks, or a row
 *   whose skills and helpers may use no writing tool; otherwise nothing is deleted. Recorded in
 *   `metadata.estate.outcome`.
 *
 * `focus` lists atoms to put first: the run order (`run-order.txt`) lists the complete specs of rows naming
 * a focus atom, then those of guards, gates and invariants, then the rest.
 */

export const ESTATE_REPORT_FILE = 'estate-generate-report.json';
export const ESTATE_ORDER_FILE = 'run-order.txt';
/** Tools that can change a workspace; a unit allowed none of them leaves the workspace as it was. */
export const WRITING_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
]);
/** Kinds whose complete specs come right after the focus atoms in the run order. */
export const PRIORITY_KINDS: readonly string[] = ['guard', 'gate', 'invariant'];
export const ESTATE_COMPLETE_DIR = 'specs';
export const ESTATE_INCOMPLETE_DIR = 'incomplete';
export const ESTATE_SEEDER = 'estate';
export const ESTATE_DEFAULT_SEED = 1;
/** The custom checks the replay runner registers. */
export const REPLAY_CUSTOM_CHECKS: readonly string[] = [
  'grounded_values',
  'hazard_recovery',
  'max_words',
  'no_delete_under',
  'ordered',
  'permission',
  'some_call',
];

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
  setting: 'none',
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
  /** Code-written asks and outcomes read from the atoms where the bank has none. Default true. */
  fallback?: boolean;
  /** Atom ids whose complete specs come first in the run order. */
  focus?: readonly string[];
  /**
   * A judge runs the judged criteria: a model-named predicate no code checks becomes a gating criterion
   * written from the atom's own words, the spec tagged `judged`. Default true; false leaves it a gap.
   */
  judge?: boolean;
};

export type Totals = { rows: number; specs: number; complete: number; incomplete: number };

export type EstateReport = {
  generator: 'driftbench estate generate';
  map: { path: string; runtime: string; hash: string; atoms: number };
  plan: { path: string; rows: number; approved: number; proposed: number; struck: number };
  phrases: { path: string; situations: number; phrases: number; workspaces: number };
  sessions: { path: string; sessions: number } | null;
  options: { seed: number; checks: string[]; fallback: boolean; judge: boolean };
  summary: { specs: number; blocks: number; complete: number; incomplete: number; judged: number };
  /** Where the asks and outcomes of the complete specs come from. */
  sources: {
    asks: { bank: number; code: number; session: number; none: number };
    outcomes: Record<string, number>;
    /** Complete specs whose Then holds a criterion judged from a domain predicate's own words. */
    judged: number;
  };
  /** The focus atoms: how many complete specs name each; those with none are listed apart. */
  focus: {
    atoms: number;
    complete: number;
    perAtom: Array<{ atom: string; complete: number; incomplete: number; markers: string[] }>;
  } | null;
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
  atoms: string[];
  ask: AskSource;
  outcome: string;
  judged: string[];
  session?: string;
  expect?: 'pass' | 'fail';
};

/** Where a spec's ask comes from: an approved phrase, code, a recorded session, or no ask (static). */
export type AskSource = 'bank' | 'code' | 'session' | 'none';

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
  fallback: boolean;
  /** Skill names, for a misroute ask that names the wrong skill. */
  units: string[];
};

type Built = {
  id: string;
  spec: Record<string, unknown>;
  gaps: Gap[];
  blocks: number;
  judged: number;
  ask: AskSource;
  outcome: string;
  /** Atoms of the spec judged by a criterion written from their words, since no code checks them. */
  judgedAtoms: string[];
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
    fallback: options.fallback ?? true,
    judge: options.judge ?? true,
    units: [
      ...new Set(
        input.map.atoms
          .filter((atom) => atom.kind === 'skill')
          .map((atom) => atom.fields?.name)
          .filter((name): name is string => typeof name === 'string'),
      ),
    ].sort(),
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
    // A static row with a check the static runner knows is a static test, not a spec.
    const head = ctx.atoms.get(row.atomIds[0] ?? '');
    const check = head && STATIC_TEST_TYPES.has(row.testType) ? staticCheckOf(row, head) : undefined;
    if (head && check !== undefined && typeof check !== 'string') {
      const id = uniqueId(specId(row.id), used);
      const test: StaticTest = {
        id,
        planRow: row.id,
        testType: row.testType as StaticTest['testType'],
        atom: head.id,
        title: head.title,
        check,
        mapHash: ctx.map.hash,
      };
      const path = `${STATIC_DIR}/${row.testType}/${id}.json`;
      files.push({ path, text: formatJson(test) });
      records.push({
        id,
        path,
        row: row.id,
        testType: row.testType,
        mode: row.mode,
        complete: true,
        markers: [],
        atoms: row.atomIds,
        ask: 'none',
        outcome: 'static',
        judged: [],
      });
      for (const totals of [totalsType, totalsMode]) {
        totals.specs += 1;
        totals.complete += 1;
      }
      continue;
    }
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
        atoms: row.atomIds,
        ask: built.ask,
        outcome: built.outcome,
        judged: built.judgedAtoms,
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
  const done = records.filter((record) => record.complete);
  const asks = { bank: 0, code: 0, session: 0, none: 0 };
  const outcomes: Record<string, number> = {};
  for (const record of done) {
    asks[record.ask] += 1;
    outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
  }
  const focus = options.focus ? [...new Set(options.focus)] : undefined;
  const order = runOrder(records, ctx.atoms, focus ?? []);
  files.push({ path: ESTATE_ORDER_FILE, text: order.length === 0 ? '' : `${order.join('\n')}\n` });
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
    options: { seed, checks, fallback: ctx.fallback, judge: ctx.judge === true },
    summary: { specs: records.length, blocks, complete, incomplete: records.length - complete, judged },
    sources: {
      asks,
      outcomes: sortedKeys(outcomes),
      judged: done.filter((record) => record.judged.length > 0).length,
    },
    focus: focus
      ? {
          atoms: focus.length,
          complete: done.filter((record) => record.atoms.some((atom) => focus.includes(atom))).length,
          perAtom: focus.map((atom) => {
            const own = records.filter((record) => record.atoms.includes(atom));
            return {
              atom,
              complete: own.filter((record) => record.complete).length,
              incomplete: own.filter((record) => !record.complete).length,
              markers: [
                ...new Set(own.filter((record) => !record.complete).flatMap((record) => record.markers)),
              ].sort(),
            };
          }),
        }
      : null,
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

  // When: the phrase, else an ask written by code from the atoms.
  let phrase: BankPhrase | undefined;
  let phraseIndex: number | undefined;
  let ask: AskSource = use === 'none' ? 'none' : 'bank';
  let askFrom: string | undefined;
  if (use !== 'none') {
    let missing: { marker: Marker; detail: string } | undefined;
    if (!situation) {
      missing = { marker: MARKERS.phrase, detail: `a ${use} situation for ${first.id}` };
    } else if (session) {
      phraseIndex = situation.phrases.findIndex((entry) => entry.text === session.ask);
      phrase = situation.phrases[phraseIndex];
      ask = 'session';
    } else {
      const order = shuffle(
        rngFor(ctx.seed, `estate:${situation.id}`),
        situation.phrases.filter((entry) => entry.approved),
      );
      phrase = order[row.testType === 'twin' ? 1 : 0];
      if (!phrase) {
        missing = {
          marker: row.testType === 'twin' ? MARKERS.secondPhrase : MARKERS.phrase,
          detail: `${situation.id} has ${order.length} approved phrase${order.length === 1 ? '' : 's'}`,
        };
      } else phraseIndex = situation.phrases.indexOf(phrase);
    }
    if (missing && ctx.fallback) {
      const written = codeAsk(use, atoms, ctx.units, row.testType === 'twin', (id) => ctx.atoms.get(id));
      phrase = { text: written.text, lang: written.lang, approved: false };
      phraseIndex = undefined;
      ask = 'code';
      askFrom = written.source;
    } else if (missing) gap(then, missing.marker, first, missing.detail);
  }

  // The outcome the situation declares, else the one the atoms name, else the one read from the atoms.
  let outcome = 'none';
  if (situation?.touches) {
    addWorkspace(then, { ...situation.touches, othersUntouched: true });
    outcome = 'bank';
  }
  // A static test runs no ask: its static marker says what it waits for, nothing else is owed.
  const asks = use !== 'none';
  const named = then.workspace !== undefined || then.ranCode || then.artifacts.length > 0;
  if (outcome === 'none' && named) outcome = 'atoms';
  if (asks && !named && ctx.fallback) {
    outcome = derivedOutcome(row, atoms, then);
  }
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

  // A reply in the language of the ask: the phrase's language, once it is known.
  if (then.langFromAsk && phrase && then.lang === undefined) then.lang = phrase.lang.toUpperCase();

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
    let text = order[0]?.text;
    if (text === undefined && ctx.fallback) {
      text = codeAsk('resume', atoms, ctx.units).text;
      ask = ask === 'bank' ? 'code' : ask;
    }
    if (text === undefined) gap(then, MARKERS.phrase, first, `a resume situation for ${first.id}`);
    blocks.push({
      id: 'resume',
      when: { user: text ?? `[no approved phrase: resume situation for ${first.id}]` },
      given: { vars: { event: 'helper_stopped' } },
      expect: expectOf(then, false),
    });
  }
  // A block left empty by other gaps is already named by them; an empty block with none is its own gap.
  const gapped = then.gaps.length > 0;
  for (const block of blocks) {
    if (asks && !gapped && Object.keys(block.expect as object).length === 0) {
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
    let text = order[0]?.text;
    if (text === undefined && ctx.fallback) {
      text = DEVIATION_ASKS[deviation];
      if (text !== undefined && ask === 'bank') ask = 'code';
    }
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
    tags: [
      'estate',
      `test:${row.testType}`,
      `mode:${row.mode}`,
      ...kinds,
      ...(ask === 'code' ? ['ask:code'] : []),
      ...(then.judged.length > 0 ? ['judged'] : []),
    ],
    target: { adapter: ctx.map.runtime },
    given: { vars, ...(seed ? { world: { workspace: { files: seed.files } } } : {}) },
    ...(usesStages ? { stages: ctx.stages.ids } : {}),
    ...(complete && then.criteria.length > 0 ? { criteria: then.criteria } : {}),
    blocks,
    ...(customOf(then) ? { rules: { custom: customOf(then) } } : {}),
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
        ask,
        ...(askFrom ? { askFrom } : {}),
        outcome,
        ...(then.judged.length > 0 ? { judged: then.judged } : {}),
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
    ask,
    outcome,
    judgedAtoms: [...then.judged],
    ...(session ? { session } : {}),
    ...(expectRun ? { expect: expectRun } : {}),
  };
}

/** `rules.custom` of a spec: the ordered pairs, the some_call entries of the first block, the other checks. */
function customOf(then: ThenParts): Record<string, unknown> | undefined {
  const custom: Record<string, unknown> = {};
  if (then.ordered.length > 0) custom.ordered = { pairs: then.ordered };
  if (then.someCalls.length > 0) {
    custom.some_call = { calls: then.someCalls.map((call) => ({ ...call, block: 0 })) };
  }
  for (const [name, options] of Object.entries(then.custom)) custom[name] = options;
  return Object.keys(custom).length > 0 ? custom : undefined;
}

/** The Then of a block as `expect`. The first block holds the outcome and the judged criteria. */
function expectOf(then: ThenParts, first: boolean): Record<string, unknown> {
  const expect: Record<string, unknown> = {};
  if (first && then.stage !== undefined) expect.stage = then.stage;
  if (then.skills.length > 0) expect.skills = then.skills.map((skill) => ({ ...skill }));
  if (then.guards.length > 0) expect.guards = then.guards.map((guard) => ({ ...guard }));
  if (then.tools.length > 0) expect.tools = then.tools.map((tool) => ({ ...tool }));
  if (then.offeredExclude.length > 0) expect.tools_offered = { exclude: [...then.offeredExclude] };
  if (then.references.length > 0) expect.references = then.references.map((item) => ({ ...item }));
  if (then.subagents.length > 0) expect.subagents = then.subagents.map((item) => ({ ...item }));
  if (first && then.must.length > 0) expect.must = [...then.must];
  if (first && then.mustNot.length > 0) expect.must_not = [...then.mustNot];
  if (first && then.lang !== undefined) expect.lang = then.lang;
  if (first && (then.ranCode || then.maxCommands !== undefined)) {
    expect.execution = {
      ...(then.ranCode ? { ran_code: true } : {}),
      ...(then.maxCommands !== undefined ? { max_commands: then.maxCommands } : {}),
    };
  }
  if (first && then.safetyConfirm.length > 0) expect.safety = { confirm_before: [...then.safetyConfirm] };
  if (first && then.artifacts.length > 0) expect.artifacts = then.artifacts.map((item) => ({ ...item }));
  if (first && then.workspace) {
    const { created, changed, deleted, othersUntouched, noDeletes } = then.workspace;
    expect.workspace = {
      ...(created.length > 0 ? { created: [...created] } : {}),
      ...(changed.length > 0 ? { changed: [...changed] } : {}),
      ...(deleted.length > 0 ? { deleted: [...deleted] } : noDeletes ? { deleted: [] } : {}),
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
    built.ask === 'code'
      ? '# Code wrote it: no approved phrase yet, so code wrote the ask from the atoms (tag ask:code); the Then comes from the atoms of the row.'
      : '# Code wrote it: the ask is an approved phrase of the bank, the Then comes from the atoms of the row.',
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

/**
 * The outcome of a row whose situation and atoms name no path, read from the atoms. Nothing may change
 * when the row is a negative control, a denied tool, a guard that denies or blocks, or when every skill and
 * helper of the row is allowed only tools that cannot write. Otherwise nothing may be deleted: no task of a
 * row asks for a deletion it does not name. Returns the source recorded on the spec.
 */
function derivedOutcome(row: EstatePlanRow, atoms: readonly EstateAtom[], then: ThenParts): string {
  const blocked =
    atoms.some((atom) => atom.kind === 'guard' && atom.evidence.some(denies)) &&
    (row.testType === 'guard_positive' || row.testType === 'guard_hostile');
  const units = atoms.filter(
    (atom) => (atom.kind === 'skill' || atom.kind === 'subagent') && Array.isArray(atom.fields?.tools),
  );
  const readOnly =
    units.length > 0 &&
    units.every((unit) =>
      ((unit.fields?.tools ?? []) as unknown[]).every(
        (tool) => typeof tool === 'string' && !WRITING_TOOLS.has(tool.replace(/\(.*$/, '').trim()),
      ),
    );
  if (NEGATIVE_TESTS.has(row.testType) || row.testType === 'tool_denied' || blocked || readOnly) {
    addWorkspace(then, { created: [], changed: [], deleted: [], othersUntouched: true });
    if (NEGATIVE_TESTS.has(row.testType)) return 'no-change:negative';
    if (row.testType === 'tool_denied') return 'no-change:denied';
    return blocked ? 'no-change:guard' : 'no-change:read-only';
  }
  addWorkspace(then, { created: [], changed: [], deleted: [], othersUntouched: false, noDeletes: true });
  return 'no-delete';
}

function denies(evidence: EstateAtom['evidence'][number]): boolean {
  return evidence.type === 'guard' && /^(deny|block|blocked|denied)$/i.test(evidence.verdict ?? '');
}

/**
 * The complete specs in the order to run them: rows naming a focus atom (in the order of the focus list),
 * then rows naming a guard, a gate or an invariant, then the rest, each group in generation order.
 */
function runOrder(
  records: readonly EstateSpecRecord[],
  atoms: ReadonlyMap<string, EstateAtom>,
  focus: readonly string[],
): string[] {
  const done = records.filter((record) => record.complete && !record.path.startsWith(`${STATIC_DIR}/`));
  const rank = (record: EstateSpecRecord): number => {
    const hit = focus.findIndex((atom) => record.atoms.includes(atom));
    if (hit >= 0) return hit;
    const kinds = record.atoms.map((id) => atoms.get(id)?.kind ?? '');
    const kind = PRIORITY_KINDS.findIndex((candidate) => kinds.includes(candidate));
    return kind >= 0 ? focus.length + kind : focus.length + PRIORITY_KINDS.length;
  };
  return done
    .map((record, index) => ({ record, index, rank: rank(record) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ record }) => record.path);
}

function sortedKeys(table: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
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
  const { asks, outcomes, judged: judgedSpecs } = report.sources;
  lines.push(
    `Asks of the complete specs: ${asks.bank} approved phrases, ${asks.code} written by code, ${asks.session} recorded sessions, ${asks.none} with no ask.`,
    `Judged by a criterion from the rule's own words (no code checks it): ${judgedSpecs} complete specs.`,
    `Outcomes of the complete specs: ${
      Object.entries(outcomes)
        .map(([source, count]) => `${count} ${source}`)
        .join(', ') || 'none'
    }.`,
  );
  if (report.focus) {
    const empty = report.focus.perAtom.filter((entry) => entry.complete === 0);
    lines.push(
      `Focus: ${report.focus.complete} complete specs name one of the ${report.focus.atoms} focus atoms; ${empty.length} focus atom${empty.length === 1 ? ' has' : 's have'} none.`,
    );
    for (const entry of empty) {
      lines.push(
        `  ${entry.atom}: ${entry.incomplete === 0 ? 'no plan row' : `${entry.incomplete} incomplete (${entry.markers.join(', ')})`}`,
      );
    }
  }
  lines.push(
    `Run order: ${ESTATE_ORDER_FILE} lists the complete specs, focus atoms first, then guards, gates and invariants.`,
  );
  const statics = (report.perTestType.invariant?.complete ?? 0) + (report.perTestType.setting?.complete ?? 0);
  if (statics > 0) {
    lines.push(
      `Static tests: ${statics} in ${STATIC_DIR}/ (invariants and settings), run by driftbench estate static on an estate root.`,
    );
  }
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
