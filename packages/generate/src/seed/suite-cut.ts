import { type PerturbationSpec, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import {
  addEventCodes,
  NONE,
  type ObligationSpec,
  obligationSpecOf,
  placeSpec,
  type StageBook,
  SuiteIndex,
  stageBookOf,
} from '@agent-nexus/driftbench-space';
import { Allocation } from './allocation';
import type { SpecDraft } from './assemble';
import type { PreparedMap } from './map';
import { failsAtEnd, type TerminalSubsumption } from './minimal';

/** A spec of the suite and, when a draft made it, the draft: only a draft can be cut. */
export type SuiteItem = { spec: Spec; draft?: SpecDraft };

/** What one spec holds for the suite that the shared index does not carry: what a cut of another spec may rely on. */
type Holdings = {
  /** The local (strict) key of every block, by position. */
  keys: string[];
  /** The id of every block, by position. */
  ids: string[];
  texts: Set<string>;
  codes: Array<Set<number>>;
  pairs: Set<string>;
  /** `path|channel and persona` the spec is written for. */
  context: string;
  /** The data values whose concrete boundary value the spec records: a boundary spec is the one that carries them. */
  concretes: string[];
  row?: string;
  family?: string;
};

/** One shape a walk can take: the blocks and declarations it keeps, and the spec they make. */
type Shape = { blocks: SpecDraft['blocks']; perturbations: PerturbationSpec[] | undefined; spec: Spec };

export type SuiteCutOptions = {
  /** The allocation is not a reason to keep a block: the rounds that follow top the strata up. */
  ignoreAllocation?: boolean;
};

/**
 * The tails of a suite, cut with the whole suite in view. The first pass (`TerminalSubsumption.reduce`) cuts a
 * walk as it is written, so it sees only the walks written before it: a block that a later, longer walk passes
 * through stays at the end of the earlier one. This pass looks at every walk with every other walk as it now
 * stands, in the order of their ids, and cuts the tail of a walk whenever the first pass would have cut it had the
 * others been written first.
 *
 * What the suite owes is the shared ruling (`RULINGS`, `SuiteIndex.lostBy` in packages/space): a class probed once per
 * path, a declared perturbation once per path and class (a declaration goes with its block when another walk of the
 * path declares the class), a metamorphic family cut as one unit, one pair of twins per path and context axis, one
 * walk ending on a given test, a walk dropped only once cut to one block. What the ruling does not carry stays here
 * and is checked beside it: the block is the same test as a block another walk says (the local key, stricter than the
 * shared one), every message, tuple and ordered pair of moves it holds is held by another walk, a t-wise row, the
 * stages and classes stay no further from balance, the recoveries still build and the walk does not end on a tool
 * failure or a restated request. It never touches the pair of twins the invariance items read, a walk with an end
 * state, or a task. It goes on until no walk can be cut.
 *
 * The result is a function of the set of walks, not of the order they were written in: the walks are visited in the
 * order of their ids, and each cut is checked against the walks as they stand at that moment.
 */
export class SuiteCut {
  private readonly index: SuiteIndex;
  private readonly book: StageBook;
  private readonly keys = new Map<string, Map<string, string>>();
  private readonly said = new Map<string, number>();
  private readonly held: Uint32Array[];
  private readonly pairs = new Map<string, number>();
  private readonly contexts = new Map<string, number>();
  private readonly concretes = new Map<string, number>();
  private readonly rows = new Map<string, number>();
  private readonly allocation: Allocation;
  private readonly holdings = new Map<string, Holdings>();
  private readonly current = new Map<string, Spec>();
  private readonly prepared: PreparedMap;
  private pins = new Set<string>();
  /** Units that no later change of the suite can let go further: every check but two asks what the rest of the suite still holds, and the rest only shrinks. */
  private readonly done = new Set<SpecDraft[]>();
  private readonly securedAxes = new Map<string, Set<string>>();
  /** Called with the walk, its length and the reason when the cut of a tail stops. For diagnosis and tests. */
  onStop?: (id: string, length: number, reason: string) => void;

  constructor(
    prepared: PreparedMap,
    private readonly minimal: TerminalSubsumption,
    private readonly options: SuiteCutOptions = {},
  ) {
    this.prepared = prepared;
    this.held = minimal.projections.map((projection) => new Uint32Array(projection.size));
    this.allocation = new Allocation(prepared);
    const values = (kind: string, prefix: string): Set<string> =>
      new Set(
        prepared.space.dimensions
          .filter((dimension) => dimension.kind === kind)
          .flatMap((dimension) => dimension.values.map((value) => value.id))
          .filter((id) => id !== NONE)
          .map((id) => `${prefix}${id}`),
      );
    this.index = new SuiteIndex({ channels: values('channel', ''), personas: values('persona', 'persona:') });
    this.book = new Map();
  }

  private pathOf(spec: Spec): string {
    return (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
  }

  private holdingsOf(spec: Spec): Holdings {
    const m = this.minimal;
    const path = this.pathOf(spec);
    const placement = placeSpec(m.space, spec);
    const codes = m.projections.map((projection) => {
      const set = new Set<number>();
      for (const event of placement.events) addEventCodes(projection, event, set);
      return new Set([...set].filter((code) => projection.allowed[code] === 1));
    });
    const generated = spec.metadata?.generated as
      | { seeder?: string; metamorphic?: { family?: string } }
      | undefined;
    return {
      keys: spec.blocks.map((_, index) => m.key(spec, index)),
      ids: spec.blocks.map((block) => block.id ?? ''),
      texts: new Set(spec.blocks.flatMap((block) => m.textsOf(block))),
      codes,
      pairs: new Set(m.pairsOf(spec)),
      context: `${path}|${m.contextOf(spec)}`,
      concretes: Object.keys(
        (spec.metadata?.generated as { concrete?: Record<string, unknown> } | undefined)?.concrete ?? {},
      ),
      ...(generated?.seeder === 'twise' ? { row: m.twiseRow(spec) } : {}),
      ...(generated?.metamorphic?.family === undefined ? {} : { family: generated.metamorphic.family }),
    };
  }

  private count<K>(map: Map<K, number>, key: K, delta: number): void {
    const next = (map.get(key) ?? 0) + delta;
    if (next > 0) map.set(key, next);
    else map.delete(key);
  }

  /** Puts a spec into the local counts (delta 1) or takes it out (delta -1). The shared index is moved by the caller. */
  private apply(spec: Spec, held: Holdings, delta: 1 | -1): void {
    held.keys.forEach((key, index) => {
      const holders = this.keys.get(key) ?? new Map<string, string>();
      if (delta === 1) {
        if (!holders.has(spec.id)) holders.set(spec.id, held.ids[index] ?? '');
        this.keys.set(key, holders);
      } else {
        holders.delete(spec.id);
        if (holders.size === 0) this.keys.delete(key);
      }
    });
    for (const text of held.texts) this.count(this.said, text, delta);
    held.codes.forEach((codes, index) => {
      const marks = this.held[index];
      if (marks) for (const code of codes) marks[code] = (marks[code] ?? 0) + delta;
    });
    for (const pair of held.pairs) this.count(this.pairs, pair, delta);
    this.count(this.contexts, held.context, delta);
    for (const value of held.concretes) this.count(this.concretes, value, delta);
    if (held.row !== undefined) this.count(this.rows, held.row, delta);
  }

  private shared(spec: Spec, broken?: readonly string[]): ObligationSpec {
    const one = obligationSpecOf(spec, this.book);
    return broken !== undefined && broken.length > 0 ? { ...one, broken } : one;
  }

  /**
   * The twins a path keeps whole: per path and context axis, one pair of walks that say the same and differ in that
   * axis alone, holding the same data values (the pair the invariance items read), else the first pair that says the
   * same. Any other twin is a repeat of the pair.
   */
  private pinned(items: readonly SuiteItem[]): Set<string> {
    const m = this.minimal;
    const pinned = new Set<string>();
    const contextIds = new Set(
      this.prepared.space.dimensions
        .filter((dimension) => dimension.kind === 'channel' || dimension.kind === 'persona')
        .map((dimension) => dimension.id),
    );
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const valuesOf = (spec: Spec): string => {
      const cell = (spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell ?? {};
      return JSON.stringify(
        Object.entries(cell)
          .filter(([key]) => !contextIds.has(key))
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    };
    // The variants of a metamorphic family are the contrast the invariance items read: their pair is the one a path keeps
    // on an axis, before any other copy of the walk.
    const first = [...items].sort((a, b) => {
      const family = (item: SuiteItem) => (item.draft?.metamorphic === undefined ? 1 : 0);
      return family(a) - family(b) || (a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0);
    });
    for (const strict of [true, false]) {
      const walks = new Map<string, Array<{ id: string; context: [unknown, unknown] }>>();
      for (const { spec } of first) {
        const path = this.pathOf(spec);
        const key = strict ? `${m.walkKey(spec)}|${valuesOf(spec)}` : m.walkKey(spec);
        const context = JSON.parse(m.contextOf(spec)) as [unknown, unknown];
        const earlier = walks.get(key) ?? [];
        for (const axis of ['channel', 'persona'] as const) {
          const at = axis === 'channel' ? 0 : 1;
          const twin = earlier.find((other) => !same(other.context[at], context[at]));
          if (!twin || this.securedAxes.get(path)?.has(axis) === true) continue;
          const set = this.securedAxes.get(path) ?? new Set<string>();
          set.add(axis);
          this.securedAxes.set(path, set);
          pinned.add(spec.id);
          pinned.add(twin.id);
        }
        earlier.push({ id: spec.id, context });
        walks.set(key, earlier);
      }
    }
    return pinned;
  }

  /**
   * Cuts the tails of the walks of `items` and returns the drafts it changed. A changed draft holds its shorter
   * blocks and its record of the blocks cut; the caller renders it again. A draft marked `dropped` is no longer
   * part of the suite.
   */
  reduce(items: readonly SuiteItem[]): SpecDraft[] {
    const ordered = [...items].sort((a, b) => (a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0));
    const stages = stageBookOf(ordered.map((item) => item.spec));
    for (const [key, value] of stages) this.book.set(key, value);
    for (const { spec, draft } of ordered) {
      this.current.set(spec.id, spec);
      const held = this.holdingsOf(spec);
      this.holdings.set(spec.id, held);
      this.apply(spec, held, 1);
      this.index.add(this.shared(spec));
      if (draft) this.allocation.countDraft(draft, 1);
      else this.allocation.observeSpec(spec);
    }
    this.pins = this.pinned(ordered);
    // A walk is a unit; the variants of a metamorphic family are one unit, led by the first.
    const units: SpecDraft[][] = [];
    const families = new Map<string, SpecDraft[]>();
    for (const { draft } of ordered) {
      if (!draft) continue;
      const family = draft.metamorphic?.family;
      if (family === undefined) {
        units.push([draft]);
        continue;
      }
      const unit = families.get(family) ?? [];
      if (unit.length === 0) units.push(unit);
      unit.push(draft);
      families.set(family, unit);
    }
    for (const unit of units)
      unit.sort((a, b) => (a.metamorphic?.variant ?? 0) - (b.metamorphic?.variant ?? 0));
    const changed = new Set<SpecDraft>();
    // Repeats of whole walks first, then the tails, until none can be cut; the highest id first in both, so the walk
    // with the lowest id is the one that stays whole (the lowest id keeps the end, as the ruling says). Each pass changes what the others hold: round again until
    // neither changes anything.
    let progress = true;
    while (progress) {
      progress = false;
      for (const unit of [...units].reverse()) if (this.dropUnit(unit, changed)) progress = true;
      let cutting = true;
      while (cutting) {
        cutting = false;
        for (const unit of [...units].reverse())
          if (!this.done.has(unit) && this.cutUnit(unit, changed)) {
            cutting = true;
            progress = true;
          }
      }
    }
    this.repoint(ordered);
    return [...changed];
  }

  private shapeOf(draft: SpecDraft): Shape {
    return {
      blocks: draft.blocks,
      perturbations: draft.perturbations,
      spec: this.current.get(draft.id) as Spec,
    };
  }

  /** Cuts the tail of one unit as far as the suite allows. Returns whether anything changed. */
  private cutUnit(unit: SpecDraft[], changed: Set<SpecDraft>): boolean {
    const lead = unit[0] as SpecDraft;
    if (unit.some((draft) => draft.dropped !== undefined || !this.current.has(draft.id))) return false;
    // A family is cut only when every variant of it is in the suite.
    if (lead.metamorphic !== undefined && unit.length !== lead.metamorphic.of) return false;
    const start = unit.map((draft) => this.shapeOf(draft));
    const first = start[0] as Shape;
    if (
      unit.some((draft) => this.pins.has(draft.id)) ||
      start.some(
        (shape) =>
          shape.spec.kind !== 'conversation' ||
          shape.spec.end_state !== undefined ||
          shape.spec.blocks.length !== first.spec.blocks.length,
      )
    )
      return false;
    const keys = (this.holdings.get(lead.id) as Holdings).keys;
    // The last block of a walk can go only where another walk says the same test: look before touching the counts.
    const lastKey = keys[keys.length - 1] as string;
    const holders = this.keys.get(lastKey);
    const others = [...(holders?.keys() ?? [])].some((id) => !unit.some((draft) => draft.id === id));
    if (keys.length < 2 || !others) return false;
    for (const draft of unit) {
      this.apply(this.current.get(draft.id) as Spec, this.holdings.get(draft.id) as Holdings, -1);
      this.allocation.countDraft(draft, -1);
    }
    // Only a change of the other walks' ends or of the balance can let a stopped unit go further.
    let retry = false;
    const stop = (reason: string, length: number) => {
      if (reason === 'ends-takeback' || reason === 'allocation') retry = true;
      this.onStop?.(lead.id, length, reason);
    };
    // A state is a shape of every member; `ends` says it ends on a test another walk already ends on (the lowest id
    // keeps it), so the cut may go deeper but may not stop there.
    const states: Array<{ shapes: Shape[]; ends: boolean }> = [{ shapes: start, ends: false }];
    let shapes = start;
    while ((shapes[0] as Shape).spec.blocks.length > 1) {
      const length = (shapes[0] as Shape).spec.blocks.length;
      const last = length - 1;
      if (!this.keys.has(keys[last] as string)) {
        stop('new-key', length);
        break;
      }
      if (lead.variesAt !== undefined && last <= lead.variesAt) {
        stop('family-varies', length);
        break;
      }
      const next = this.shorten(unit, shapes, last, (reason) => stop(reason, length));
      if (!next) break;
      const currents = shapes.map((shape) => ({ blocks: shape.blocks, perturbations: shape.perturbations }));
      if (
        !this.options.ignoreAllocation &&
        this.allocation.imbalanceWithAll(next.shapes) > this.allocation.imbalanceWithAll(currents)
      ) {
        stop('allocation', length);
        break;
      }
      if (unit.length > 1 && lead.variesAt !== undefined && !this.stillDiffer(next.shapes, last)) {
        stop('family-degenerate', length);
        break;
      }
      states.push({ shapes: next.shapes, ends: next.ends });
      shapes = next.shapes;
    }
    const chosen = [...states].reverse().find((state) => !state.ends) as (typeof states)[number];
    if (!retry) this.done.add(unit);
    const deepest = states[states.length - 1] as (typeof states)[number];
    if (chosen !== deepest) stop('ends-takeback', (deepest.shapes[0] as Shape).spec.blocks.length);
    let did = false;
    unit.forEach((draft, index) => {
      const shape = chosen.shapes[index] as Shape;
      if (chosen === states[0]) {
        // Nothing was cut: the walk goes back into the counts as it was.
        this.apply(shape.spec, this.holdings.get(draft.id) as Holdings, 1);
        this.allocation.countDraft(draft, 1);
        return;
      }
      const before = draft.blocks;
      const cut = before.slice(shape.blocks.length);
      const declared = (draft.perturbations?.length ?? 0) !== (shape.perturbations?.length ?? 0);
      if (cut.length > 0) {
        cut.forEach((block, offset) => {
          draft.cutKeys = { ...draft.cutKeys, [block.id]: keys[shape.blocks.length + offset] as string };
        });
        draft.reducedEnds = {
          from_blocks: draft.reducedEnds?.from_blocks ?? before.length + (draft.reducedMiddle?.length ?? 0),
          to_blocks: shape.blocks.length,
          duplicates: [
            ...cut.map((block) => ({ block: block.id, duplicate_of: { spec: '', block: '' } })),
            ...(draft.reducedEnds?.duplicates ?? []),
          ],
        };
      }
      if (cut.length > 0 || declared) {
        draft.blocks = shape.blocks;
        draft.perturbations = shape.perturbations;
        changed.add(draft);
        did = true;
      }
      this.current.set(draft.id, shape.spec);
      const next = this.holdingsOf(shape.spec);
      this.holdings.set(draft.id, next);
      this.apply(shape.spec, next, 1);
      this.index.add(this.shared(shape.spec));
      this.allocation.countDraft(draft, 1);
    });
    return did;
  }

  /**
   * A walk whose every block, tuple, message and context another walk holds, and which the shared ruling lets go, is
   * a repeat of a whole spec. The ruling lets a spec go only once it is cut to one block. A metamorphic variant is
   * never dropped alone: a family is two variants at least.
   */
  private dropUnit(unit: SpecDraft[], changed: Set<SpecDraft>): boolean {
    const lead = unit[0] as SpecDraft;
    // A family is at least two variants: its variants stay, or all of them go.
    if (lead.metamorphic !== undefined) return false;
    const draft = lead;
    if (draft.dropped !== undefined || !this.current.has(draft.id) || this.pins.has(draft.id)) return false;
    const shape = this.shapeOf(draft);
    if (shape.spec.kind !== 'conversation' || shape.spec.end_state !== undefined) return false;
    if (shape.spec.blocks.length !== 1) return false;
    const held = this.holdings.get(draft.id) as Holdings;
    this.apply(shape.spec, held, -1);
    this.allocation.countDraft(draft, -1);
    const verdict = this.index.lostBy([{ spec: draft.id }]);
    if (verdict.ok && held.keys.every((key) => this.keys.has(key)) && this.droppable(shape, held)) {
      held.keys.forEach((key, at) => {
        draft.cutKeys = { ...draft.cutKeys, [draft.blocks[at]?.id ?? '']: key };
      });
      draft.dropped = { duplicate_of: { spec: '', block: '' } };
      this.current.delete(draft.id);
      this.holdings.delete(draft.id);
      this.index.remove(draft.id);
      changed.add(draft);
      return true;
    }
    this.apply(shape.spec, held, 1);
    this.allocation.countDraft(draft, 1);
    return false;
  }

  /**
   * The unit with the last block cut off every member, or undefined when the suite owes something that block holds.
   * A declaration a perturbation makes at or after the block goes with it; the ruling lets it go when another walk
   * of the path declares the same class.
   */
  private shorten(
    unit: SpecDraft[],
    shapes: Shape[],
    last: number,
    stop: (reason: string) => void,
  ): { shapes: Shape[]; ends: boolean } | undefined {
    const m = this.minimal;
    const next: Shape[] = [];
    const changes: Array<{ spec: string; after: ObligationSpec }> = [];
    for (const [at, shape] of shapes.entries()) {
      const id = (unit[at] as SpecDraft).id;
      const kept = (shape.spec.perturbations ?? []).filter((entry) => entry.inject_at < last);
      const cut = m.cut(shape.spec, last);
      const { perturbations: _gone, ...bare } = cut;
      const parsed = validateSpec(kept.length > 0 ? { ...bare, perturbations: kept } : bare);
      if (!parsed.ok) {
        stop('invalid');
        return undefined;
      }
      const broken: string[] = [];
      if (failsAtEnd(parsed.spec)) broken.push('toolFailureLast');
      if (parsed.spec.blocks[last - 1]?.id?.endsWith('-restated')) broken.push('restatedLast');
      if (!m.recoveriesHold(parsed.spec)) broken.push('driverBuildable');
      if (broken.length > 0) {
        stop(
          broken[0] === 'driverBuildable'
            ? 'recovery-or-end'
            : broken[0] === 'restatedLast'
              ? 'restated'
              : 'recovery-or-end',
        );
        return undefined;
      }
      if (!m.textsOf(shape.spec.blocks[last]).every((text) => this.said.has(text))) {
        stop('phrase');
        return undefined;
      }
      if (!this.tuplesHold(shape.spec, parsed.spec)) {
        stop('tuples');
        return undefined;
      }
      if (!this.pairsHold(shape.spec, parsed.spec)) {
        stop('pairs');
        return undefined;
      }
      if (!this.rowHolds((unit[at] as SpecDraft).seeder, shape.spec, parsed.spec)) {
        stop('obligations');
        return undefined;
      }
      next.push({
        blocks: shape.blocks.slice(0, last),
        perturbations:
          kept.length > 0 ? shape.perturbations?.filter((entry) => entry.inject_at < last) : undefined,
        spec: parsed.spec,
      });
      changes.push({ spec: id, after: this.shared(parsed.spec) });
    }
    const verdict = this.index.lostBy(changes);
    const conflicts = verdict.refused.filter((entry) => entry.startsWith('oneWalkPerEnd:'));
    const other = verdict.refused.filter((entry) => !entry.startsWith('oneWalkPerEnd:'));
    if (verdict.lost.length > 0 || other.length > 0) {
      stop(verdict.lost.length > 0 ? `lost:${verdict.lost[0]?.split('|')[0]}` : `refused:${other[0]}`);
      return undefined;
    }
    // A cut that leaves a walk ending on a test another walk ends on (the lowest id keeps it) may go deeper, not stop
    // there. The walk the cut makes the second to end is cut in its turn, when its id comes.
    return { shapes: next, ends: conflicts.length > 0 || verdict.takeBack.length > 0 };
  }

  /** The variants of a family still say different things in the blocks they keep. */
  private stillDiffer(shapes: Shape[], last: number): boolean {
    const words = shapes.map((shape) =>
      JSON.stringify(shape.spec.blocks.slice(0, last).map((block) => this.minimal.textsOf(block))),
    );
    return new Set(words).size === shapes.length;
  }

  /** A walk is a repeat of a whole spec when everything it says and places is held by another. */
  private droppable(shape: Shape, held: Holdings): boolean {
    if (!this.contexts.has(held.context)) return false;
    for (const value of held.concretes) if (!this.concretes.has(value)) return false;
    for (const text of held.texts) if (!this.said.has(text)) return false;
    if (held.row !== undefined && !this.rows.has(held.row)) return false;
    for (const pair of held.pairs) if (!this.pairs.has(pair)) return false;
    if (!held.codes.every((codes, index) => [...codes].every((code) => (this.held[index]?.[code] ?? 0) > 0)))
      return false;
    return (
      this.options.ignoreAllocation === true ||
      this.allocation.imbalanceWithAll([]) <=
        this.allocation.imbalanceWithAll([{ blocks: shape.blocks, perturbations: shape.perturbations }])
    );
  }

  /** Every tuple the longer walk places is placed by the reduced walk or by another walk of the suite. */
  private tuplesHold(before: Spec, after: Spec): boolean {
    const m = this.minimal;
    const previous = placeSpec(m.space, before);
    const reduced = placeSpec(m.space, after);
    return m.projections.every((projection, index) => {
      const oldCodes = new Set<number>();
      const newCodes = new Set<number>();
      for (const event of previous.events) addEventCodes(projection, event, oldCodes);
      for (const event of reduced.events) addEventCodes(projection, event, newCodes);
      return [...oldCodes].every(
        (code) => projection.allowed[code] !== 1 || newCodes.has(code) || (this.held[index]?.[code] ?? 0) > 0,
      );
    });
  }

  private pairsHold(before: Spec, after: Spec): boolean {
    const kept = new Set(this.minimal.pairsOf(after));
    return this.minimal.pairsOf(before).every((pair) => kept.has(pair) || this.pairs.has(pair));
  }

  /** A t-wise spec stands for its row (its cell and the class of its first injected block): the items read t-wise specs alone. */
  private rowHolds(seeder: string | undefined, before: Spec, after: Spec): boolean {
    if (seeder !== 'twise') return true;
    const m = this.minimal;
    return m.twiseRow(before) === m.twiseRow(after) || this.rows.has(m.twiseRow(before));
  }

  /** Every cut block names, as its witness, a block the final suite still holds. */
  private repoint(items: readonly SuiteItem[]): void {
    const retained = (witness: { spec: string; block: string }) => {
      const spec = this.current.get(witness.spec);
      return spec?.blocks.some((block) => block.id === witness.block) === true;
    };
    const holder = (
      key: string,
      self: string,
    ): { spec: string; block: string; family?: string } | undefined => {
      const all = [...(this.keys.get(key) ?? [])]
        .filter(([id]) => id !== self)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      const pick = all.find(([id]) => this.holdings.get(id)?.family !== undefined) ?? all[0];
      if (!pick) return undefined;
      const family = this.holdings.get(pick[0])?.family;
      return { spec: pick[0], block: pick[1], ...(family === undefined ? {} : { family }) };
    };
    for (const { draft } of items) {
      if (!draft) continue;
      const cutKeys = draft.cutKeys ?? {};
      if (draft.dropped) {
        const key = Object.values(cutKeys)[0];
        const next = key === undefined ? undefined : holder(key, draft.id);
        if (next) draft.dropped = { duplicate_of: { spec: next.spec, block: next.block } };
        continue;
      }
      for (const entry of draft.reducedEnds?.duplicates ?? []) {
        if (entry.duplicate_of.spec !== '' && retained(entry.duplicate_of)) continue;
        const key = cutKeys[entry.block];
        const next = key === undefined ? undefined : holder(key, draft.id);
        if (next) entry.duplicate_of = next;
      }
      for (const entry of draft.reducedMiddle ?? []) {
        if (retained(entry.duplicate_of)) continue;
        const key = cutKeys[entry.block];
        const next = key === undefined ? undefined : holder(key, draft.id);
        if (next) entry.duplicate_of = { spec: next.spec, block: next.block };
      }
    }
  }
}
