import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
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
  row?: string;
  family?: string;
};

/**
 * The tails of a suite, cut with the whole suite in view. The first pass (`TerminalSubsumption.reduce`) cuts a
 * walk as it is written, so it sees only the walks written before it: a block that a later, longer walk passes
 * through stays at the end of the earlier one. This pass looks at every walk with every other walk as it now
 * stands, in the order of their ids, and cuts the tail of a walk whenever the first pass would have cut it had the
 * others been written first. It checks what the first pass checks, each against the suite without the walk being
 * cut: the block is the same test as a block another walk says, every message and tuple and ordered pair of moves
 * and class probe the tail holds is held by another walk, the stages and classes stay no further from balance, the
 * recoveries still build, and the walk does not end on the block another walk ends on. A walk it never cuts is the
 * pair of twins a path keeps per context axis, a metamorphic variant, a walk with an end state, and a task.
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
  private readonly rows = new Map<string, number>();
  private readonly allocation: Allocation;
  private readonly holdings = new Map<string, Holdings>();

  constructor(
    prepared: PreparedMap,
    private readonly minimal: TerminalSubsumption,
  ) {
    this.held = minimal.projections.map((projection) => new Uint32Array(projection.size));
    this.allocation = new Allocation(prepared);
  }

  private holdingsOf(spec: Spec): Holdings {
    const m = this.minimal;
    const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
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
    if (held.row !== undefined) this.count(this.rows, held.row, delta);
  }

  /** The twins a path keeps whole: per path and context axis, the first walk that has a twin and that twin. */
  private pinned(items: readonly SuiteItem[]): Set<string> {
    const m = this.minimal;
    const pinned = new Set<string>();
    const walks = new Map<string, Array<{ id: string; context: [unknown, unknown] }>>();
    const secured = new Map<string, Set<string>>();
    for (const { spec } of items) {
      const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
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
   * blocks and its record of the blocks cut; the caller renders it again.
   */
  reduce(items: readonly SuiteItem[]): SpecDraft[] {
    const m = this.minimal;
    const ordered = [...items].sort((a, b) => (a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0));
    const current = new Map<string, Spec>(ordered.map(({ spec }) => [spec.id, spec]));
    for (const { spec, draft } of ordered) {
      const held = this.holdingsOf(spec);
      this.holdings.set(spec.id, held);
      this.apply(spec, held, 1);
      if (draft) this.allocation.countDraft(draft, 1);
      else this.allocation.observeSpec(spec);
    }
    const pinned = this.pinned(ordered);
    const changed: SpecDraft[] = [];
    for (const { draft } of ordered) {
      if (!draft) continue;
      let spec = current.get(draft.id) as Spec;
      if (
        pinned.has(spec.id) ||
        spec.kind !== 'conversation' ||
        spec.end_state !== undefined ||
        draft.metamorphic !== undefined ||
        spec.blocks.length < 2
      )
        continue;
      const held = this.holdings.get(spec.id) as Holdings;
      this.apply(spec, held, -1);
      this.allocation.countDraft(draft, -1);
      const before = draft.blocks;
      const states = [{ blocks: draft.blocks, spec }];
      while (spec.blocks.length > 1) {
        const last = spec.blocks.length - 1;
        const key = held.keys[last] as string;
        if (!this.keys.has(key)) break;
        if (spec.blocks[last - 1]?.id?.endsWith('-restated')) break;
        if (spec.perturbations?.some((entry) => entry.inject_at >= last)) break;
        const reduced = validateSpec(m.cut(spec, last));
        if (!reduced.ok || !m.recoveriesHold(reduced.spec) || failsAtEnd(reduced.spec)) break;
        if (!m.textsOf(spec.blocks[last]).every((text) => this.said.has(text))) break;
        if (!this.tuplesHold(spec, reduced.spec) || !this.pairsHold(spec, reduced.spec)) break;
        if (!this.obligationsHold(draft.seeder, spec, reduced.spec)) break;
        const shorter = { blocks: draft.blocks.slice(0, last), perturbations: draft.perturbations };
        if (this.allocation.imbalanceWith(shorter) > this.allocation.imbalanceWith(draft)) break;
        draft.blocks = shorter.blocks;
        spec = reduced.spec;
        states.push({ blocks: draft.blocks, spec });
      }
      const settled = [...states]
        .reverse()
        .find(
          (state) =>
            state.spec.blocks.length === 1 ||
            !this.otherEnds(spec.id, held.keys[state.spec.blocks.length - 1] as string),
        );
      const chosen = settled ?? (states[0] as (typeof states)[number]);
      draft.blocks = chosen.blocks;
      spec = chosen.spec;
      current.set(spec.id, spec);
      const cut = before.slice(draft.blocks.length);
      if (cut.length > 0) {
        cut.forEach((block, offset) => {
          draft.cutKeys = { ...draft.cutKeys, [block.id]: held.keys[draft.blocks.length + offset] as string };
        });
        draft.reducedEnds = {
          from_blocks: draft.reducedEnds?.from_blocks ?? before.length + (draft.reducedMiddle?.length ?? 0),
          to_blocks: draft.blocks.length,
          duplicates: [
            ...cut.map((block) => ({ block: block.id, duplicate_of: { spec: '', block: '' } })),
            ...(draft.reducedEnds?.duplicates ?? []),
          ],
        };
        changed.push(draft);
      }
      const next = this.holdingsOf(spec);
      this.holdings.set(spec.id, next);
      this.apply(spec, next, 1);
      this.allocation.countDraft(draft, 1);
    }
    this.repoint(ordered, current);
    return changed;
  }

  private otherEnds(self: string, key: string): boolean {
    return [...(this.ends.get(key) ?? [])].some((id) => id !== self);
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
    const path = (before.metadata?.generated as { path?: string } | undefined)?.path ?? '';
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
  private repoint(items: readonly SuiteItem[], current: Map<string, Spec>): void {
    const retained = (witness: { spec: string; block: string }) => {
      const spec = current.get(witness.spec);
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
      const keys = draft.cutKeys ?? {};
      for (const entry of draft.reducedEnds?.duplicates ?? []) {
        if (entry.duplicate_of.spec !== '' && retained(entry.duplicate_of)) continue;
        const key = keys[entry.block];
        const next = key === undefined ? undefined : holder(key, draft.id);
        if (next) entry.duplicate_of = next;
      }
      for (const entry of draft.reducedMiddle ?? []) {
        if (retained(entry.duplicate_of)) continue;
        const key = keys[entry.block];
        const next = key === undefined ? undefined : holder(key, draft.id);
        if (next) entry.duplicate_of = { spec: next.spec, block: next.block };
      }
    }
  }
}
