/** One plan row to its task specs: the situation it uses, its expectation, its derived outcome and its id. */

import type { CriterionDef } from '@agent-nexus/driftbench-core';
import { type BlockOrigin, type RuleRef, writeBlocks } from '../blocks/writer';
import { DEVIATION_EXPECTED } from '../seed/deviation';
import { rngFor, shuffle } from '../seed/random';
import { codeAsk, DEVIATION_ASKS } from './asks';
import {
  type AskSource,
  type Built,
  type Context,
  ESTATE_SEEDER,
  MODIFYING_TOOLS,
  NEGATIVE_TESTS,
  READING_TOOLS,
  SITUATION_OF,
  WRITING_TOOLS,
} from './generate-types';
import type {
  BankPhrase,
  EstateAtom,
  EstatePlanRow,
  PhraseBank,
  SessionEntry,
  Situation,
  SituationUse,
} from './inputs';
import {
  addPair,
  addWorkspace,
  gap,
  MARKERS,
  type Marker,
  type StageModel,
  type ThenParts,
  thenOf,
} from './then';

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
export function buildRow(row: EstatePlanRow, ctx: Context, used: Set<string>): Built[] {
  const atoms = row.atomIds.map((id) => ctx.atoms.get(id) as EstateAtom);
  const use = useOf(row);
  const situation = use === 'none' ? undefined : findSituation(ctx.bank, use, row);
  // The k positive asks of a route (`route_positive.<route>.<n>`) each take their own phrasing.
  const nth = row.testType === 'route_positive' ? /\.(\d+)$/.exec(row.id)?.[1] : undefined;
  const variant = nth !== undefined && Number(nth) > 1 ? Number(nth) - 1 : undefined;
  if (row.mode !== 'replay') return [build(row, atoms, ctx, used, situation, undefined, false, variant)];
  const sessions = situation
    ? (ctx.sessions?.sessions ?? []).filter((session) => session.situation === situation.id)
    : [];
  if (sessions.length === 0) return [build(row, atoms, ctx, used, situation, undefined, true)];
  return sessions.map((session) => build(row, atoms, ctx, used, situation, session));
}

export function build(
  row: EstatePlanRow,
  atoms: readonly EstateAtom[],
  ctx: Context,
  used: Set<string>,
  situation: Situation | undefined,
  session?: SessionEntry,
  noSession = false,
  variant?: number,
): Built {
  const use = useOf(row);
  const polarity = NEGATIVE_TESTS.has(row.testType) ? 'negative' : 'positive';
  const own = row.testType === 'contract_alone' ? atoms.filter((atom) => atom.kind !== 'subagent') : atoms;
  const then = thenOf(own, polarity, { ...ctx, live: row.mode === 'live' });
  const first = atoms[0] as EstateAtom;

  // Test types that add to or change what the atoms say.
  if (row.testType === 'stage_order' || row.testType === 'stage_skip') {
    for (const atom of atoms) stageOrder(then, atom, ctx.stages);
  }
  if (row.testType === 'guard_hostile') {
    // A malformed payload: the guard answers with some verdict instead of failing.
    then.guards = then.guards.map(({ verdict: _verdict, ...guard }) => ({ ...guard, count: { min: 1 } }));
  }
  // The guard answered in time, and said why it blocked in words that keep the estate's output rules: read
  // from the hook output the runtime reports (the guard record's stdout, stderr, exit code and outcome).
  const guardName = typeof first.fields?.name === 'string' ? first.fields.name : undefined;
  if (row.testType === 'guard_speed') {
    if (guardName && ctx.customChecks.has('guard_finished')) {
      then.guards = then.guards.map(({ verdict: _verdict, ...guard }) => ({ ...guard, count: { min: 1 } }));
      then.custom.guard_finished = { name: guardName, block: 0 };
    } else gap(then, MARKERS.guardTiming, first, 'the runner registers no guard_finished check');
  }
  if (row.testType === 'guard_register') {
    if (guardName && ctx.customChecks.has('guard_message')) {
      then.custom.guard_message = {
        name: guardName,
        ...(ctx.outputRules.length > 0 ? { mustNot: [...ctx.outputRules] } : {}),
        block: 0,
      };
    } else gap(then, MARKERS.guardMessage, first, 'the runner registers no guard_message check');
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
      phrase =
        variant !== undefined && order.length > 0
          ? order[variant % order.length]
          : order[row.testType === 'twin' ? 1 : 0];
      if (!phrase) {
        missing = {
          marker: row.testType === 'twin' ? MARKERS.secondPhrase : MARKERS.phrase,
          detail: `${situation.id} has ${order.length} approved phrase${order.length === 1 ? '' : 's'}`,
        };
      } else phraseIndex = situation.phrases.indexOf(phrase);
    }
    if (missing && ctx.fallback) {
      const written = codeAsk(
        use,
        atoms,
        ctx.units,
        row.testType === 'twin',
        (id) => ctx.atoms.get(id),
        variant,
      );
      if (written.text === undefined) {
        // Never a nonsense ask: the row waits for an approved phrase, under its own gap.
        gap(then, MARKERS.askable, first, written.refused ?? 'the atom gives no task');
      } else {
        phrase = { text: written.text, lang: written.lang, approved: false };
        phraseIndex = undefined;
        ask = 'code';
        askFrom = written.source;
      }
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
  const blocks: Array<Record<string, unknown> & { id: string }> = [
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

  // The block writer writes the blocks and their links: the row's atoms, the row and its cell, the session.
  const version = ctx.map.hash.slice(0, 12);
  // A negative control exercises its rules: it checks they do not act outside their trigger.
  const rules = atoms.map((atom) => ({
    ...ruleOf(atom),
    ...(polarity === 'negative' ? { relation: 'exercises' as const } : {}),
  }));
  const planRow = row.variantOf ?? row.id;
  // The prompt sections that hold the atoms' quotes, when the estate has prompts with a section registry.
  const sections = atoms.flatMap((atom) =>
    atom.provenance?.file !== undefined && ctx.sections
      ? ctx.sections
          .locate(atom.provenance.file, atom.provenance.quote)
          .map((ref) => ({ ...ref, ...(polarity === 'negative' ? { relation: 'exercises' as const } : {}) }))
      : [],
  );
  const written = writeBlocks(
    blocks.map((block, index) => {
      const origin: BlockOrigin = {
        rules,
        ...(sections.length > 0 ? { sections } : {}),
        row: { id: planRow, values: row.cell },
        ...(session && index === 0 ? { turn: { conversation: session.name, turn: session.from_block } } : {}),
      };
      return { block, origin };
    }),
    version,
    ctx.sections ? { sectionReach: ctx.sections.reaching } : {},
  );

  const usesStages = blocks.some((block) => (block.expect as Record<string, unknown>).stage !== undefined);
  const kinds = [...new Set(atoms.map((atom) => `kind:${atom.kind}`))];
  const expectRun = session
    ? session.violates.some((atom) => row.atomIds.includes(atom))
      ? 'fail'
      : 'pass'
    : undefined;
  const spec: Record<string, unknown> = {
    id,
    version,
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
    blocks: written.blocks,
    ...(customOf(then) ? { rules: { custom: customOf(then) } } : {}),
    ...(declaredOperations(then) ? { operations: declaredOperations(then) } : {}),
    ...(perturbation ? { perturbations: [perturbation] } : {}),
    metadata: {
      estate: {
        atoms: row.atomIds,
        planRow,
        ...(variant !== undefined ? { focusVariant: variant } : {}),
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
      links: written.links,
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

/**
 * An atom as the rule a block tests: its id, and the ledger id of the unit it was read from when the pointer
 * reader built it (`fields.unit` of an atom whose `fields.extraction` is `pointer`).
 */
export function ruleOf(atom: EstateAtom): RuleRef {
  const fields = atom.fields ?? {};
  const ledger = fields.extraction === 'pointer' && typeof fields.unit === 'string' ? fields.unit : undefined;
  return { rule: atom.id, ...(ledger !== undefined ? { ledger } : {}) };
}

/**
 * The `operations` of a spec that checks hazard recovery: the runtime's own tools that are ordinary work, by their
 * exact labels (`READING_TOOLS` read, `MODIFYING_TOOLS` modify). Bash is read by its commands, and a tool not in
 * either list stays unnamed, so the check calls it unknown instead of guessing.
 */
function declaredOperations(then: ThenParts): Record<string, 'read' | 'modify'> | undefined {
  if (then.custom.hazard_recovery === undefined) return undefined;
  const operations: Record<string, 'read' | 'modify'> = {};
  for (const label of [...READING_TOOLS].sort()) operations[label] = 'read';
  for (const label of [...MODIFYING_TOOLS].sort()) operations[label] = 'modify';
  return operations;
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

/** A spec id from a plan row id: the characters a spec id allows, a session name after a dot. */
export function specId(rowId: string, session?: string): string {
  const clean = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  const base = `estate.${clean(rowId)}`;
  return session === undefined ? base : `${base}.${clean(session)}`;
}

export function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${id}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}
