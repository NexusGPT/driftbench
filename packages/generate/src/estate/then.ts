import type { ArtifactExpect, CriterionDef, GuardExpect, SkillExpect, ToolExpect } from '@driftbench/core';
import type { EstateAtom, EstateEvidence } from './inputs';

/**
 * The Then of a plan row, by code: each evidence predicate of the row's atoms becomes an existing check.
 *
 * | Predicate | Check |
 * |---|---|
 * | skill_loaded, skill_not_loaded | `expect.skills` with a count |
 * | guard | `expect.guards` (name, verdict, count) |
 * | tool_called without input, tool_not_called | `expect.tools` with a count (0 forbids the tool) |
 * | ordered | the ordered-pair custom check, `rules.custom.ordered` |
 * | stage_reached | `expect.stage` on the closing stage, and an ordered pair when the stage is not the last |
 * | workspace, artifact | `expect.workspace`, `expect.artifacts` |
 * | text | `expect.must`, `expect.must_not` (the words as literal text), `expect.lang` |
 * | custom on a register atom | a judged criterion whose rubric is the atom's title, not gating |
 *
 * What no existing check can say without changing its meaning is a gap, named by a marker, and the spec
 * that holds it is incomplete:
 * - a tool call with input assertions: the tools check asserts the input on every call of the tool, the
 *   atom asks for one call that matches (`needs-some-call-check`);
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

export type WorkspaceParts = {
  created: string[];
  changed: string[];
  deleted: string[];
  othersUntouched: boolean;
};

export type ThenParts = {
  skills: SkillExpect[];
  guards: GuardExpect[];
  tools: ToolExpect[];
  must: string[];
  mustNot: string[];
  lang?: string;
  artifacts: ArtifactExpect[];
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
    must: [],
    mustNot: [],
    artifacts: [],
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
      else negative(then, atom, evidence);
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
        gap(then, MARKERS.someCall, atom, `one ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: { min: evidence.min ?? 1 } });
      return;
    case 'tool_not_called':
      addTool(then, { label: evidence.label, count: 0 });
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
      if (atom.kind === 'register') {
        if (!then.criteria.some((criterion) => criterion.name === atom.id)) {
          then.criteria.push({ name: atom.id, rubric: atom.title, gating: false, scope: 'block' });
        }
        return;
      }
      gap(then, MARKERS.registered, atom, evidence.name);
      return;
  }
}

function negative(then: ThenParts, atom: EstateAtom, evidence: EstateEvidence): void {
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

/** A word as a pattern that matches it literally. */
export function literal(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}
