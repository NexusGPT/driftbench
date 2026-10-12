import type {
  ArtifactExpect,
  CriterionDef,
  GuardExpect,
  ReferenceExpect,
  SkillExpect,
  SubagentExpect,
  ToolExpect,
} from '@driftbench/core';
import type { EstateAtom, EstateEvidence } from './inputs';
import { literal } from './literal';
import { compilePredicate } from './predicates';

export { literal };

/**
 * The Then of a plan row, by code: each evidence predicate of the row's atoms becomes an existing check.
 *
 * | Predicate | Check |
 * |---|---|
 * | skill_loaded, skill_not_loaded | `expect.skills` with a count |
 * | guard | `expect.guards` (name, verdict, count) |
 * | tool_called without input, tool_not_called | `expect.tools` with a count (0 forbids the tool) |
 * | tool_not_called on a setting that denies the whole tool | also `expect.tools_offered.exclude` |
 * | tool_called Read with a path (equal or contained) | `expect.references`, a glob ending in the path |
 * | tool_called Agent with a helper name | `expect.subagents` with a count |
 * | ordered | the ordered-pair custom check, `rules.custom.ordered` |
 * | stage_reached | `expect.stage` on the closing stage, and an ordered pair when the stage is not the last |
 * | workspace, artifact | `expect.workspace`, `expect.artifacts` |
 * | text | `expect.must`, `expect.must_not` (the words as literal text), `expect.lang` |
 * | tool_called with any other input, when `some_call` is registered | `rules.custom.some_call` |
 * | custom grounded_values, hazard_recovery, permission (allow, declared, deny) | the registered check |
 * | custom with a name `predicates.ts` compiles | must, must_not, lang, safety, execution |
 * | custom on a register atom | a judged criterion whose rubric is the atom's title, not gating |
 *
 * What no existing check can say without changing its meaning is a gap, named by a marker, and the spec
 * that holds it is incomplete:
 * - a tool call with other input assertions: the tools check asserts the input on every call of the tool,
 *   the atom asks for one call that matches (`needs-some-call-check`);
 * - a custom predicate no registered check runs (`needs-registered-check`);
 * - an ordered pair whose ends are not a tool label, a skill or a stage, or are the same label
 *   (`needs-ordered-anchor`);
 * - a stage that can be reached at any time, or a step list with no single closing stage
 *   (`needs-stage-reach-check`);
 * - a static property of the estate files (`needs-static-runner`);
 * - in a negative control, a predicate with no inverse (`needs-negation`).
 */

export const MARKERS = {
  phrase: 'needs-approved-phrase',
  secondPhrase: 'needs-second-phrase',
  someCall: 'needs-some-call-check',
  registered: 'needs-registered-check',
  anchor: 'needs-ordered-anchor',
  stageReach: 'needs-stage-reach-check',
  static: 'needs-static-runner',
  negation: 'needs-negation',
  outcome: 'needs-workspace-outcome',
  session: 'needs-recorded-session',
  guardTiming: 'needs-guard-timing',
  guardMessage: 'needs-guard-message-check',
  deviation: 'needs-deviation-phrase',
  noThen: 'needs-derivable-then',
} as const;
export type Marker = (typeof MARKERS)[keyof typeof MARKERS];
export const MARKER_NAMES: ReadonlySet<string> = new Set(Object.values(MARKERS));

export type Gap = { marker: Marker; atom: string; detail: string };

export type OrderedPair = { before: string; after: string };

export type SomeCall = { label: string; input: Record<string, unknown>; count: 0 | { min: number } };

export type WorkspaceParts = {
  created: string[];
  changed: string[];
  deleted: string[];
  othersUntouched: boolean;
  /** True when nothing may be deleted: `deleted: []`, the change no task of the row asks for. */
  noDeletes?: boolean;
};

export type ThenParts = {
  skills: SkillExpect[];
  guards: GuardExpect[];
  tools: ToolExpect[];
  /** Tools a setting denies whole: the runtime must not offer them. */
  offeredExclude: string[];
  must: string[];
  mustNot: string[];
  lang?: string;
  artifacts: ArtifactExpect[];
  references: ReferenceExpect[];
  subagents: SubagentExpect[];
  /** Calls `rules.custom.some_call` asks for: one call of a tool whose input matches, or none. */
  someCalls: SomeCall[];
  /** Options of the registered custom checks other than ordered and some_call, by name. */
  custom: Record<string, Record<string, unknown>>;
  /** Operation classes `expect.safety.confirm_before` names. */
  safetyConfirm: string[];
  /** `expect.execution.max_commands`. */
  maxCommands?: number;
  /** True when the reply must be in the language of the ask (`expect.lang`, set from the phrase). */
  langFromAsk?: boolean;
  workspace?: WorkspaceParts;
  stage?: string;
  ranCode: boolean;
  ordered: OrderedPair[];
  criteria: CriterionDef[];
  gaps: Gap[];
};

/** The step list of the estate, read from its stage atoms. */
export type StageModel = {
  /** Stage ids in map order. */
  ids: string[];
  anytime: ReadonlySet<string>;
  /** The one closing stage (no next, not anytime), when there is exactly one. */
  closing?: string;
  /** The immediate dominator of each stage reached from the start: the stage every path passes last. */
  idom: ReadonlyMap<string, string>;
};

export type ThenContext = {
  stages: StageModel;
  /** Skill names of the estate, so an ordered end can name a skill load. */
  skills: ReadonlySet<string>;
  /** Custom checks the runner registers, by name. The replay runner registers `ordered`. */
  customChecks: ReadonlySet<string>;
};

export type Polarity = 'positive' | 'negative';

const ARTIFACT_KINDS = new Set(['xlsx', 'docx', 'pptx', 'pdf', 'csv', 'json', 'text', 'code']);
const TOOL_LABEL = /^[A-Z][A-Za-z0-9_]*$/;

export function emptyThen(): ThenParts {
  return {
    skills: [],
    guards: [],
    tools: [],
    offeredExclude: [],
    must: [],
    mustNot: [],
    artifacts: [],
    references: [],
    subagents: [],
    someCalls: [],
    custom: {},
    safetyConfirm: [],
    ranCode: false,
    ordered: [],
    criteria: [],
    gaps: [],
  };
}

/** The Then of a set of atoms. A negative Then is the negative control: the act does not happen. */
export function thenOf(atoms: readonly EstateAtom[], polarity: Polarity, ctx: ThenContext): ThenParts {
  const then = emptyThen();
  for (const atom of atoms) {
    for (const evidence of atom.evidence) {
      if (polarity === 'positive') positive(then, atom, evidence, ctx);
      else negative(then, atom, evidence, ctx);
    }
    if (polarity === 'positive' && atom.kind === 'script') then.ranCode = true;
  }
  return then;
}

function positive(then: ThenParts, atom: EstateAtom, evidence: EstateEvidence, ctx: ThenContext): void {
  switch (evidence.type) {
    case 'skill_loaded':
      addSkill(then, { name: evidence.name, count: { min: evidence.min ?? 1 } });
      return;
    case 'skill_not_loaded':
      addSkill(then, { name: evidence.name, count: 0 });
      return;
    case 'guard':
      addGuard(then, {
        name: evidence.name,
        ...(evidence.verdict === undefined ? {} : { verdict: evidence.verdict }),
        count: { min: evidence.min ?? 1 },
      });
      return;
    case 'tool_called':
      if (hasInput(evidence.input)) {
        if (someCall(then, evidence.label, evidence.input, evidence.min ?? 1)) return;
        if (ctx.customChecks.has('some_call')) {
          addSomeCall(then, {
            label: evidence.label,
            input: evidence.input,
            count: { min: evidence.min ?? 1 },
          });
          return;
        }
        gap(then, MARKERS.someCall, atom, `one ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: { min: evidence.min ?? 1 } });
      return;
    case 'tool_not_called':
      addTool(then, { label: evidence.label, count: 0 });
      // A setting that denies the whole tool takes it off the offered list: the deny shows without a call.
      if (atom.kind === 'tool' && atom.fields?.effect === 'deny' && atom.fields.rule === evidence.label) {
        addUnique(then.offeredExclude, evidence.label);
      }
      return;
    case 'ordered': {
      const pair = anchorPair(evidence.before, evidence.after, ctx);
      if (typeof pair === 'string') gap(then, MARKERS.anchor, atom, pair);
      else addPair(then, pair);
      return;
    }
    case 'stage_reached':
      reachStage(then, atom, evidence.name, ctx.stages);
      return;
    case 'workspace':
      addWorkspace(then, {
        created: evidence.created ?? [],
        changed: evidence.changed ?? [],
        deleted: evidence.deleted ?? [],
        othersUntouched: evidence.othersUntouched === true,
      });
      return;
    case 'artifact':
      then.artifacts.push({
        path: evidence.path,
        ...(evidence.kind !== undefined && ARTIFACT_KINDS.has(evidence.kind)
          ? { kind: evidence.kind as NonNullable<ArtifactExpect['kind']> }
          : {}),
      });
      return;
    case 'text':
      for (const word of evidence.must ?? []) addUnique(then.must, literal(word));
      for (const word of evidence.mustNot ?? []) addUnique(then.mustNot, literal(word));
      if (evidence.lang !== undefined) then.lang = evidence.lang.toUpperCase();
      return;
    case 'static':
      gap(then, MARKERS.static, atom, evidence.check);
      return;
    case 'custom':
      if (ctx.customChecks.has(evidence.name)) {
        // A registered ordered check with its own options: its pairs, anchored like any ordered predicate.
        if (evidence.name === 'ordered') {
          for (const raw of pairsOf(evidence.options)) {
            const pair = anchorPair(raw.before, raw.after, ctx);
            if (typeof pair === 'string') gap(then, MARKERS.anchor, atom, pair);
            else addPair(then, pair);
          }
          return;
        }
      }
      if (evidence.name === 'hazard_recovery' && ctx.customChecks.has('hazard_recovery')) {
        then.custom.hazard_recovery = {
          ...(evidence.options ?? {}),
          ...(pathsOf(atom).length > 0 ? { reread: pathsOf(atom) } : {}),
          block: 0,
        };
        return;
      }
      if (evidence.name === 'grounded_values' && ctx.customChecks.has('grounded_values')) {
        then.custom.grounded_values = { ...(evidence.options ?? {}), block: 0 };
        return;
      }
      if (evidence.name === 'permission' && ctx.customChecks.has('permission')) {
        const effect = evidence.options?.effect;
        const rule = evidence.options?.rule;
        if (typeof rule === 'string' && (effect === 'allow' || effect === 'declared' || effect === 'deny')) {
          const known = (then.custom.permission?.rules ?? []) as unknown[];
          then.custom.permission = { rules: [...known, { effect, rule }], block: 0 };
          return;
        }
        gap(
          then,
          MARKERS.registered,
          atom,
          `permission ${String(effect)}: the trace does not show the prompt`,
        );
        return;
      }
      {
        const compiled = compilePredicate(evidence.name, evidence.options);
        if (compiled && (!compiled.someCalls || ctx.customChecks.has('some_call'))) {
          for (const pattern of compiled.must ?? []) addUnique(then.must, pattern);
          for (const pattern of compiled.mustNot ?? []) addUnique(then.mustNot, pattern);
          for (const call of compiled.someCalls ?? []) addSomeCall(then, call);
          for (const kind of compiled.safetyConfirm ?? []) addUnique(then.safetyConfirm, kind);
          if (compiled.maxCommands !== undefined) then.maxCommands = compiled.maxCommands;
          if (compiled.langFromAsk) then.langFromAsk = true;
          if (atom.kind === 'register') addCriterion(then, atom);
          return;
        }
      }
      if (atom.kind === 'register') {
        addCriterion(then, atom);
        return;
      }
      gap(then, MARKERS.registered, atom, evidence.name);
      return;
  }
}

function negative(then: ThenParts, atom: EstateAtom, evidence: EstateEvidence, ctx: ThenContext): void {
  switch (evidence.type) {
    case 'skill_loaded':
      addSkill(then, { name: evidence.name, count: 0 });
      return;
    case 'guard':
      addGuard(then, {
        name: evidence.name,
        ...(evidence.verdict === undefined ? {} : { verdict: evidence.verdict }),
        count: 0,
      });
      return;
    case 'tool_called':
      if (hasInput(evidence.input)) {
        if (someCall(then, evidence.label, evidence.input, 0)) return;
        if (ctx.customChecks.has('some_call')) {
          addSomeCall(then, { label: evidence.label, input: evidence.input, count: 0 });
          return;
        }
        gap(then, MARKERS.someCall, atom, `no ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: 0 });
      return;
    case 'text':
      if ((evidence.must ?? []).length === 0) {
        gap(then, MARKERS.negation, atom, 'a text predicate with no required words');
        return;
      }
      for (const word of evidence.must ?? []) addUnique(then.mustNot, literal(word));
      return;
    case 'custom':
      if (
        compilePredicate(evidence.name, evidence.options) !== undefined ||
        evidence.name === 'hazard_recovery' ||
        evidence.name === 'grounded_values' ||
        evidence.name === 'permission'
      ) {
        gap(then, MARKERS.negation, atom, `${evidence.name} has no negative control`);
        return;
      }
      gap(then, MARKERS.registered, atom, evidence.name);
      return;
    case 'static':
      gap(then, MARKERS.static, atom, evidence.check);
      return;
    default:
      gap(then, MARKERS.negation, atom, `${evidence.type} has no negative control`);
  }
}

/**
 * An ordered pair in the names the ordered check reads: a tool label as is, `skill:<name>`, `stage:<name>`.
 * A string says why the pair cannot be anchored.
 */
export function anchorPair(before: string, after: string, ctx: ThenContext): OrderedPair | string {
  const a = anchor(before, ctx);
  const b = anchor(after, ctx);
  if (a === undefined || b === undefined) {
    const which = [a === undefined ? before : undefined, b === undefined ? after : undefined].filter(
      (name): name is string => name !== undefined,
    );
    return `${before} before ${after}: ${which.map((name) => `"${name}"`).join(' and ')} is no tool label, skill or stage`;
  }
  if (a === b)
    return `${before} before ${after}: both ends are ${a}, so the pair cannot tell the two acts apart`;
  return { before: a, after: b };
}

function anchor(name: string, ctx: ThenContext): string | undefined {
  if (ctx.stages.ids.includes(name)) return `stage:${name}`;
  if (ctx.skills.has(name)) return `skill:${name}`;
  if (TOOL_LABEL.test(name)) return name;
  return undefined;
}

/**
 * A stage is reached when the closing stage is the last stage of the block and the stage comes before it.
 * The closing stage itself is reached when it is the last one.
 */
export function reachStage(
  then: ThenParts,
  atom: EstateAtom | string,
  name: string,
  stages: StageModel,
): void {
  if (stages.anytime.has(name)) {
    gap(then, MARKERS.stageReach, atom, `${name} may come at any step, so no order shows it was reached`);
    return;
  }
  if (stages.closing === undefined) {
    gap(then, MARKERS.stageReach, atom, `the step list has no single closing stage to anchor ${name} on`);
    return;
  }
  then.stage = stages.closing;
  if (name !== stages.closing) addPair(then, { before: `stage:${name}`, after: `stage:${stages.closing}` });
}

/** The step list from the stage atoms: ids, anytime steps, the closing stage and immediate dominators. */
export function stageModel(atoms: readonly EstateAtom[]): StageModel {
  const stages = atoms
    .filter((atom) => atom.kind === 'stage')
    .map((atom) => {
      const fields = atom.fields ?? {};
      const id = typeof fields.id === 'string' ? fields.id : undefined;
      const next = Array.isArray(fields.next)
        ? fields.next.filter((item): item is string => typeof item === 'string')
        : [];
      return { id, next, anytime: fields.anytime === true };
    })
    .filter((stage): stage is { id: string; next: string[]; anytime: boolean } => stage.id !== undefined);
  const ids = stages.map((stage) => stage.id);
  const anytime = new Set(stages.filter((stage) => stage.anytime).map((stage) => stage.id));
  const flow = stages.filter((stage) => !stage.anytime);
  const closings = flow.filter((stage) => stage.next.length === 0).map((stage) => stage.id);
  const targets = new Set(flow.flatMap((stage) => stage.next));
  const starts = flow.filter((stage) => !targets.has(stage.id)).map((stage) => stage.id);
  const idom = new Map<string, string>();
  if (starts.length === 1) {
    const next = new Map(flow.map((stage) => [stage.id, stage.next]));
    for (const stage of flow) {
      if (stage.id === starts[0]) continue;
      const dominators = flow
        .map((candidate) => candidate.id)
        .filter(
          (candidate) => candidate !== stage.id && dominates(candidate, stage.id, starts[0] as string, next),
        );
      // The immediate dominator is the dominator every other dominator dominates.
      const immediate = dominators.find((candidate) =>
        dominators.every(
          (other) => other === candidate || dominates(other, candidate, starts[0] as string, next),
        ),
      );
      if (immediate !== undefined) idom.set(stage.id, immediate);
    }
  }
  return {
    ids,
    anytime,
    ...(closings.length === 1 ? { closing: closings[0] as string } : {}),
    idom,
  };
}

/** Whether every path from the start to `target` passes `by`: `target` is out of reach once `by` is removed. */
function dominates(by: string, target: string, start: string, next: ReadonlyMap<string, string[]>): boolean {
  if (by === start) return true;
  const seen = new Set<string>([by]);
  const queue = [start];
  seen.add(start);
  while (queue.length > 0) {
    const at = queue.shift() as string;
    if (at === target) return false;
    for (const to of next.get(at) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return true;
}

function addCriterion(then: ThenParts, atom: EstateAtom): void {
  if (!then.criteria.some((criterion) => criterion.name === atom.id)) {
    then.criteria.push({ name: atom.id, rubric: atom.title, gating: false, scope: 'block' });
  }
}

function addSomeCall(then: ThenParts, call: SomeCall): void {
  if (!then.someCalls.some((known) => same(known, call))) then.someCalls.push(call);
}

/** Paths an atom's passage names: in backticks, or a word with a slash or a file extension. */
export function pathsOf(atom: EstateAtom): string[] {
  const quote = atom.provenance?.quote ?? '';
  const found: string[] = [];
  for (const match of quote.matchAll(
    /`([^`\s]+)`|(?:^|\s)((?:[\w.-]+\/)*[\w-]+\.(?:md|json|ya?ml|txt|csv))\b/g,
  )) {
    const path = (match[1] ?? match[2] ?? '').replace(/[.,;:]+$/, '');
    if (path !== '' && (path.includes('/') || /\.[a-z]{2,4}$/i.test(path)) && !found.includes(path))
      found.push(path);
  }
  return found;
}

export function addPair(then: ThenParts, pair: OrderedPair): void {
  if (!then.ordered.some((known) => known.before === pair.before && known.after === pair.after)) {
    then.ordered.push(pair);
  }
}

export function addWorkspace(then: ThenParts, parts: WorkspaceParts): void {
  const into = then.workspace ?? { created: [], changed: [], deleted: [], othersUntouched: false };
  for (const path of parts.created) addUnique(into.created, path);
  for (const path of parts.changed) addUnique(into.changed, path);
  for (const path of parts.deleted) addUnique(into.deleted, path);
  into.othersUntouched = into.othersUntouched || parts.othersUntouched;
  if (parts.noDeletes === true) into.noDeletes = true;
  then.workspace = into;
}

export function gap(then: ThenParts, marker: Marker, atom: EstateAtom | string, detail: string): void {
  const id = typeof atom === 'string' ? atom : atom.id;
  if (!then.gaps.some((known) => known.marker === marker && known.atom === id && known.detail === detail)) {
    then.gaps.push({ marker, atom: id, detail });
  }
}

function addSkill(then: ThenParts, skill: SkillExpect): void {
  if (!then.skills.some((known) => known.name === skill.name && same(known.count, skill.count))) {
    then.skills.push(skill);
  }
}

function addGuard(then: ThenParts, guard: GuardExpect): void {
  if (
    !then.guards.some(
      (known) =>
        known.name === guard.name && known.verdict === guard.verdict && same(known.count, guard.count),
    )
  ) {
    then.guards.push(guard);
  }
}

function addTool(then: ThenParts, tool: ToolExpect): void {
  if (!then.tools.some((known) => known.label === tool.label && same(known.count, tool.count))) {
    then.tools.push(tool);
  }
}

function addUnique(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

/**
 * A tool call with input that an existing check can say for one matching call: a Read of a path (the
 * references check counts reads of a file matching a glob) or an Agent dispatch of a named helper (the
 * subagents check counts dispatches by name). False when the input is anything else.
 */
function someCall(then: ThenParts, label: string, input: Record<string, unknown>, min: number): boolean {
  const keys = Object.keys(input);
  if (keys.length !== 1) return false;
  const key = keys[0] as string;
  const value = textOf(input[key]);
  if (value === undefined || value.trim() === '') return false;
  const count = min === 0 ? 0 : { min };
  if (label === 'Read' && (key === 'file_path' || key === 'path' || key === 'notebook_path')) {
    const path = `**/${value.replace(/^\.?\/+/, '')}`;
    if (!then.references.some((known) => known.path === path && same(known.count, count))) {
      then.references.push({ path, count });
    }
    return true;
  }
  if (label === 'Agent' && (key === 'subagent_type' || key === 'name')) {
    if (!then.subagents.some((known) => known.name === value && same(known.count, count))) {
      then.subagents.push({ name: value, count });
    }
    return true;
  }
  return false;
}

/** The text an input assertion pins: a plain string, `{ equals }` or `{ contains }`. */
function textOf(assertion: unknown): string | undefined {
  if (typeof assertion === 'string') return assertion;
  if (typeof assertion !== 'object' || assertion === null) return undefined;
  const entries = Object.entries(assertion as Record<string, unknown>);
  if (entries.length !== 1) return undefined;
  const [kind, value] = entries[0] as [string, unknown];
  return (kind === 'equals' || kind === 'contains') && typeof value === 'string' ? value : undefined;
}

function hasInput(input: Record<string, unknown> | undefined): input is Record<string, unknown> {
  return input !== undefined && Object.keys(input).length > 0;
}

function pairsOf(options: Record<string, unknown> | undefined): Array<{ before: string; after: string }> {
  const list = Array.isArray(options?.pairs) ? options.pairs : [options];
  return list.filter(
    (entry): entry is { before: string; after: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).before === 'string' &&
      typeof (entry as Record<string, unknown>).after === 'string',
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}
