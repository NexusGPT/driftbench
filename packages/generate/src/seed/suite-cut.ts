import { type PerturbationSpec, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { addEventCodes, placeSpec } from '@agent-nexus/driftbench-space';
import { Allocation } from './allocation';
import type { SpecDraft } from './assemble';
import type { PreparedMap } from './map';
import { failsAtEnd, type TerminalSubsumption } from './minimal';

/** A spec of the suite and, when a draft made it, the draft: only a draft can be cut. */
export type SuiteItem = { spec: Spec; draft?: SpecDraft };

/** What one spec holds for the suite: the things another spec's cut may rely on it for. */
type Holdings = {
  /** The key of every block, by position. */
  keys: string[];
  /** The id of every block, by position. */
  ids: string[];
  texts: Set<string>;
  codes: Array<Set<number>>;
  pairs: Set<string>;
  probes: Set<string>;
  /** `path|class` of every perturbation the spec declares. */
  perturbs: Set<string>;
  /** `path|channel and persona` the spec is written for. */
  context: string;
  row?: string;
  family?: string;
};

/** One shape a walk can take: the blocks and declarations it keeps, and the spec they make. */
type Shape = { blocks: SpecDraft['blocks']; perturbations: PerturbationSpec[] | undefined; spec: Spec };

/**
 * The tails of a suite, cut with the whole suite in view. The first pass (`TerminalSubsumption.reduce`) cuts a
 * walk as it is written, so it sees only the walks written before it: a block that a later, longer walk passes
 * through stays at the end of the earlier one. This pass looks at every walk with every other walk as it now
 * stands, in the order of their ids, and cuts the tail of a walk whenever the first pass would have cut it had the
 * others been written first. It checks what the first pass checks, each against the suite without the walk being
 * cut: the block is the same test as a block another walk says, every message and tuple and ordered pair of moves
 * and class probe the tail holds is held by another walk, the stages and classes stay no further from balance, the
 * recoveries still build, and the walk does not end on the block another walk ends on. Where the first pass keeps a
 * block because a declared perturbation reaches it, this pass cuts it with its declaration when another walk of the
 * path declares the same class (the declaration is then held elsewhere). A metamorphic family is cut as one unit,
 * and only where its variants still differ in what they say. A walk cut to one block that another walk says, with
 * every message, tuple and context held elsewhere, is dropped. It never cuts the pair of twins a path keeps per
 * context axis, a walk with an end state, or a task. It goes on until no walk can be cut.
 *
 * The result is a function of the set of walks, not of the order they were written in: the walks are visited in the
 * order of their ids, and each cut is checked against the walks as they stand at that moment.
 */
export class SuiteCut {
  private readonly keys = new Map<string, Map<string, string>>();
  private readonly ends = new Map<string, Set<string>>();
  private readonly said = new Map<string, number>();
  private readonly held: Uint32Array[];
  private readonly pairs = new Map<string, number>();
  private readonly probed = new Map<string, number>();
  private readonly perturbed = new Map<string, number>();
  private readonly contexts = new Map<string, number>();
  private readonly rows = new Map<string, number>();
  private readonly allocation: Allocation;
  private readonly holdings = new Map<string, Holdings>();
  private readonly current = new Map<string, Spec>();
  private pins = new Set<string>();
  /** Called with the walk, its length and the reason when the cut of a tail stops. For diagnosis and tests. */
  onStop?: (id: string, length: number, reason: string) => void;

  constructor(
    prepared: PreparedMap,
    private readonly minimal: TerminalSubsumption,
    private readonly options: { ignoreAllocation?: boolean } = {},
  ) {
    this.held = minimal.projections.map((projection) => new Uint32Array(projection.size));
    this.allocation = new Allocation(prepared);
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
      probes: new Set(
        spec.blocks.flatMap((block) =>
          'injection' in block.when ? [`${path}|${block.when.injection.class}`] : [],
        ),
      ),
      perturbs: new Set((spec.perturbations ?? []).map((entry) => `${path}|${entry.class}`)),
      context: `${path}|${m.contextOf(spec)}`,
      ...(generated?.seeder === 'twise' ? { row: m.twiseRow(spec) } : {}),
      ...(generated?.metamorphic?.family === undefined ? {} : { family: generated.metamorphic.family }),
    };
  }

  private count<K>(map: Map<K, number>, key: K, delta: number): void {
    const next = (map.get(key) ?? 0) + delta;
    if (next > 0) map.set(key, next);
    else map.delete(key);
  }

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
    const end = held.keys.at(-1);
    if (end !== undefined) {
      const enders = this.ends.get(end) ?? new Set<string>();
      if (delta === 1) enders.add(spec.id);
      else enders.delete(spec.id);
      if (enders.size === 0) this.ends.delete(end);
      else this.ends.set(end, enders);
    }
    for (const text of held.texts) this.count(this.said, text, delta);
    held.codes.forEach((codes, index) => {
      const marks = this.held[index];
      if (marks) for (const code of codes) marks[code] = (marks[code] ?? 0) + delta;
    });
    for (const pair of held.pairs) this.count(this.pairs, pair, delta);
    for (const probe of held.probes) this.count(this.probed, probe, delta);
    for (const perturb of held.perturbs) this.count(this.perturbed, perturb, delta);
    this.count(this.contexts, held.context, delta);
    if (held.row !== undefined) this.count(this.rows, held.row, delta);
  }

  /** The twins a path keeps whole: per path and context axis, the first walk that has a twin and that twin. */
  private pinned(items: readonly SuiteItem[]): Set<string> {
    const m = this.minimal;
    const pinned = new Set<string>();
    const walks = new Map<string, Array<{ id: string; context: [unknown, unknown] }>>();
    const secured = new Map<string, Set<string>>();
    for (const { spec } of items) {
      const path = this.pathOf(spec);
      const key = m.walkKey(spec);
      const context = JSON.parse(m.contextOf(spec)) as [unknown, unknown];
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const earlier = walks.get(key) ?? [];
      const done = secured.get(path) ?? new Set<string>();
      for (const axis of ['channel', 'persona'] as const) {
        const at = axis === 'channel' ? 0 : 1;
        const twin = earlier.find((other) => !same(other.context[at], context[at]));
        if (!twin || done.has(axis)) continue;
        done.add(axis);
        pinned.add(spec.id);
        pinned.add(twin.id);
      }
      secured.set(path, done);
      earlier.push({ id: spec.id, context });
      walks.set(key, earlier);
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
    for (const { spec, draft } of ordered) {
      this.current.set(spec.id, spec);
      const held = this.holdingsOf(spec);
      this.holdings.set(spec.id, held);
      this.apply(spec, held, 1);
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
    // Repeats of whole walks first, the highest id first, so the walk with the lowest id is the one that stays; then
    // the tails, in id order, until none can be cut. Each pass changes what the others hold: round again until
    // neither changes anything.
    let progress = true;
    while (progress) {
      progress = false;
      for (const unit of [...units].reverse()) if (this.dropUnit(unit, changed)) progress = true;
      let cutting = true;
      while (cutting) {
        cutting = false;
        for (const unit of units)
          if (this.cutUnit(unit, changed)) {
            cutting = true;
            progress = true;
          }
      }
    }
    this.repoint(ordered);
    return [...changed];
  }

  private otherEnds(key: string): boolean {
    return (this.ends.get(key)?.size ?? 0) > 0;
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
    const start = unit.map((draft) => this.shapeOf(draft));
    const first = start[0] as Shape;
    // A family is cut only when every variant of it is in the suite.
    if (lead.metamorphic !== undefined && unit.length !== lead.metamorphic.of) return false;
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
    const path = this.pathOf(first.spec);
    const keys = (this.holdings.get(lead.id) as Holdings).keys;
    for (const draft of unit) {
      this.apply(this.current.get(draft.id) as Spec, this.holdings.get(draft.id) as Holdings, -1);
      this.allocation.countDraft(draft, -1);
    }
    const stop = (reason: string, length: number) => this.onStop?.(lead.id, length, reason);
    const states: Shape[][] = [start];
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
      if ((shapes[0] as Shape).spec.blocks[last - 1]?.id?.endsWith('-restated')) {
        stop('restated', length);
        break;
      }
      const next = this.shorten(shapes, last, path, (reason) => stop(reason, length));
      if (!next) break;
      const currents = shapes.map((shape) => ({ blocks: shape.blocks, perturbations: shape.perturbations }));
      if (
        !this.options.ignoreAllocation &&
        this.allocation.imbalanceWithAll(next) > this.allocation.imbalanceWithAll(currents)
      ) {
        stop('allocation', length);
        break;
      }
      if (!this.obligationsHold(lead.seeder, (shapes[0] as Shape).spec, (next[0] as Shape).spec)) {
        stop('obligations', length);
        break;
      }
      if (unit.length > 1 && !this.stillDiffer(next, last)) {
        stop('family-degenerate', length);
        break;
      }
      states.push(next);
      shapes = next;
    }
    const settled = [...states]
      .reverse()
      .find(
        (state) =>
          (state[0] as Shape).spec.blocks.length === 1 ||
          !this.otherEnds(keys[(state[0] as Shape).spec.blocks.length - 1] as string),
      );
    const chosen = settled ?? (states[0] as Shape[]);
    const deepest = states[states.length - 1] as Shape[];
    if (chosen !== deepest) stop('ends-takeback', (deepest[0] as Shape).spec.blocks.length);
    let did = false;
    unit.forEach((draft, index) => {
      const shape = chosen[index] as Shape;
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
      this.allocation.countDraft(draft, 1);
    });
    return did;
  }

  /**
   * A walk whose every block, tuple, message, probe, declaration and context another walk holds is a repeat of a
   * whole spec. The variants of a family that say different things are not repeats of each other; the twins of a
   * context family (the same words in another channel or persona) are, one at a time, while another walk holds what
   * the twin was written for.
   */
  private dropUnit(unit: SpecDraft[], changed: Set<SpecDraft>): boolean {
    const lead = unit[0] as SpecDraft;
    // A family is never dropped: its variants are the contrast the invariance items read, whether they differ in words,
    // in the persona or in the channel.
    if (lead.metamorphic !== undefined || this.pins.has(lead.id)) return false;
    let did = false;
    for (const draft of [...unit].reverse()) {
      if (draft.dropped !== undefined || !this.current.has(draft.id) || this.pins.has(draft.id)) continue;
      const shape = this.shapeOf(draft);
      if (shape.spec.kind !== 'conversation' || shape.spec.end_state !== undefined) continue;
      const held = this.holdings.get(draft.id) as Holdings;
      this.apply(shape.spec, held, -1);
      this.allocation.countDraft(draft, -1);
      if (held.keys.every((key) => this.keys.has(key)) && this.droppable(shape, held)) {
        held.keys.forEach((key, at) => {
          draft.cutKeys = { ...draft.cutKeys, [draft.blocks[at]?.id ?? '']: key };
        });
        draft.dropped = { duplicate_of: { spec: '', block: '' } };
        this.current.delete(draft.id);
        this.holdings.delete(draft.id);
        changed.add(draft);
        did = true;
      } else {
        this.apply(shape.spec, held, 1);
        this.allocation.countDraft(draft, 1);
      }
    }
    return did;
  }

  /**
   * The unit with the last block cut off every member, or undefined when the suite owes something that block holds.
   * A declaration a perturbation makes at or after the block goes with it, when another walk of the path declares
   * the same class.
   */
  private shorten(
    shapes: Shape[],
    last: number,
    path: string,
    stop: (reason: string) => void,
  ): Shape[] | undefined {
    const m = this.minimal;
    const next: Shape[] = [];
    for (const shape of shapes) {
      const declared = (shape.spec.perturbations ?? []).filter((entry) => entry.inject_at >= last);
      for (const entry of declared) {
        if (!this.perturbed.has(`${path}|${entry.class}`)) {
          stop('perturbation');
          return undefined;
        }
      }
      const kept = (shape.spec.perturbations ?? []).filter((entry) => entry.inject_at < last);
      const cut = m.cut(shape.spec, last);
      const { perturbations: _gone, ...bare } = cut;
      const parsed = validateSpec(kept.length > 0 ? { ...bare, perturbations: kept } : bare);
      if (!parsed.ok || !m.recoveriesHold(parsed.spec) || failsAtEnd(parsed.spec)) {
        stop('recovery-or-end');
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
      next.push({
        blocks: shape.blocks.slice(0, last),
        perturbations:
          kept.length > 0 ? shape.perturbations?.filter((entry) => entry.inject_at < last) : undefined,
        spec: parsed.spec,
      });
    }
    return next;
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
    for (const text of held.texts) if (!this.said.has(text)) return false;
    for (const probe of held.probes) if (!this.probed.has(probe)) return false;
    for (const perturb of held.perturbs) if (!this.perturbed.has(perturb)) return false;
    if (held.row !== undefined && !this.rows.has(held.row)) return false;
    for (const pair of held.pairs) if (!this.pairs.has(pair)) return false;
    if (!held.codes.every((codes, index) => [...codes].every((code) => (this.held[index]?.[code] ?? 0) > 0)))
      return false;
    return (
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

  private obligationsHold(seeder: string | undefined, before: Spec, after: Spec): boolean {
    const m = this.minimal;
    const path = this.pathOf(before);
    const probes = (spec: Spec) =>
      new Set(
        spec.blocks.flatMap((block) =>
          'injection' in block.when ? [`${path}|${block.when.injection.class}`] : [],
        ),
      );
    const kept = probes(after);
    for (const probe of probes(before)) if (!kept.has(probe) && !this.probed.has(probe)) return false;
    if (seeder !== 'twise') return true;
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
