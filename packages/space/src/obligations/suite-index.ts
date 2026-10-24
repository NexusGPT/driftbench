import {
  type DeclaredAxes,
  type Held,
  heldKeys,
  isDeclared,
  type ObligationSpec,
  type SoleHolders,
  soleHolders,
  type TwinKind,
  twinAxes,
  twinGroup,
  twinKind,
  twinPairs,
} from './holders';
import { type ObligationKind, RULINGS, type Rulings, type ValidityRule } from './rulings';

/**
 * A suite of specs as an index, and the question a cut asks of it: which obligations would the suite no longer hold
 * (see `RULINGS`). The index is plain data in and plain data out. It counts who holds each key, so a question costs
 * what the change touches, and the answer does not depend on the order the specs were added in.
 */

/** One spec of the suite changed. `after` is its new shape, and absent when the spec is dropped from the suite. */
export type SuiteChange = { spec: string; after?: ObligationSpec };

/** What a change set would do to the suite. A dry run: nothing in the index moves until `remove` and `add`. */
export type CutVerdict = {
  /** True when the suite would lose no obligation and no rule is refused. `takeBack` is for the caller to settle. */
  ok: boolean;
  /** The obligation keys the suite would hold no more: `inject|path|class`, `perturb|path|class`, `family|...`, `twin|path|axis`. */
  lost: string[];
  /** The validity rules a changed spec would break, as `rule:spec`. */
  refused: string[];
  /** The unchanged specs that would become the second walk to end on a test: the lowest id keeps it. */
  takeBack: string[];
};

/** A block of the suite that carries a same-test key. */
export type TestBlockRef = { spec: string; block: string; index: number };

type FamilyKind = Extract<ObligationKind, { id: 'family' }>;
type DropWhole = Extract<ValidityRule, { id: 'dropWhole' }>;

/** The validity rules whose breach the caller reports: they need the spec itself and the users package. */
const REPORTED = new Set(['toolFailureLast', 'restatedLast', 'driverBuildable']);

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** True when a change leaves everything the twin relation reads as it was: the path, the walk, the channel, the persona. */
function sameTwin(before: ObligationSpec, after: ObligationSpec, declared: DeclaredAxes): boolean {
  return (
    isDeclared(before, declared) === isDeclared(after, declared) &&
    before.path === after.path &&
    before.walk === after.walk &&
    before.channel === after.channel &&
    before.persona === after.persona
  );
}

/** The same-test key a spec of more than one block ends on. */
function endOf(one: ObligationSpec | undefined): string | undefined {
  if (one === undefined || one.blocks.length < 2) return undefined;
  return one.blocks.at(-1)?.test;
}

function link(map: Map<string, Set<string>>, key: string, id: string): void {
  const ids = map.get(key) ?? new Set<string>();
  ids.add(id);
  map.set(key, ids);
}

function unlink(map: Map<string, Set<string>>, key: string, id: string): void {
  const ids = map.get(key);
  ids?.delete(id);
  if (ids?.size === 0) map.delete(key);
}

export class SuiteIndex {
  readonly declared: DeclaredAxes;
  readonly rulings: Rulings;
  private readonly specs = new Map<string, ObligationSpec>();
  /** The keys each spec holds. */
  private readonly held = new Map<string, Held[]>();
  /** The specs that hold each key. */
  private readonly holdersOf = new Map<string, Set<string>>();
  /** The twin ruling, when the rulings have one. */
  private readonly twin: TwinKind | undefined;
  /** The specs a map declares, by path and walk: twins are of one walk, so a pair is found inside one of these. */
  private readonly walks = new Map<string, Map<string, ObligationSpec>>();
  /** The twin pairs the suite holds, by `<path>|<axis>`. */
  private readonly pairs = new Map<string, number>();
  /** The metamorphic variants in range of each walk, `family|path|walk`. */
  private readonly groups = new Map<string, Set<string>>();
  private readonly groupOf = new Map<string, string>();
  /** The blocks that carry each same-test key, by spec. */
  private readonly tests = new Map<string, Map<string, number[]>>();
  /** The specs of more than one block that end on each same-test key. */
  private readonly ends = new Map<string, Set<string>>();

  constructor(declared: DeclaredAxes, rulings: Rulings = RULINGS) {
    this.declared = declared;
    this.rulings = rulings;
    this.twin = twinKind(rulings);
  }

  get size(): number {
    return this.specs.size;
  }

  get(id: string): ObligationSpec | undefined {
    return this.specs.get(id);
  }

  all(): ObligationSpec[] {
    return [...this.specs.values()];
  }

  /** Adds a spec, or replaces the spec of the same id. */
  add(one: ObligationSpec): void {
    this.remove(one.spec);
    this.specs.set(one.spec, one);
    const held = heldKeys(one, this.declared, this.rulings);
    this.held.set(one.spec, held);
    for (const entry of held) link(this.holdersOf, entry.key, one.spec);
    if (isDeclared(one, this.declared)) this.join(one);
    if (held.some((entry) => entry.kind.id === 'family')) {
      const group = `family|${one.path}|${one.walk}`;
      this.groupOf.set(one.spec, group);
      link(this.groups, group, one.spec);
    }
    for (const [index, entry] of one.blocks.entries()) {
      if (entry.test === undefined) continue;
      const by = this.tests.get(entry.test) ?? new Map<string, number[]>();
      by.set(one.spec, [...(by.get(one.spec) ?? []), index]);
      this.tests.set(entry.test, by);
    }
    const end = endOf(one);
    if (end !== undefined) link(this.ends, end, one.spec);
  }

  /** Removes a spec and returns it. */
  remove(id: string): ObligationSpec | undefined {
    const one = this.specs.get(id);
    if (one === undefined) return undefined;
    this.specs.delete(id);
    for (const entry of this.held.get(id) ?? []) unlink(this.holdersOf, entry.key, id);
    this.held.delete(id);
    if (isDeclared(one, this.declared)) this.leave(one);
    const group = this.groupOf.get(id);
    if (group !== undefined) {
      unlink(this.groups, group, id);
      this.groupOf.delete(id);
    }
    for (const entry of one.blocks) {
      if (entry.test === undefined) continue;
      const by = this.tests.get(entry.test);
      by?.delete(id);
      if (by?.size === 0) this.tests.delete(entry.test);
    }
    const end = endOf(one);
    if (end !== undefined) unlink(this.ends, end, id);
    return one;
  }

  /** The blocks and specs the suite keeps: the answer of the batch function over the specs held. */
  soleHolders(): SoleHolders {
    return soleHolders(this.all(), this.declared, this.rulings);
  }

  /** The blocks that carry a same-test key, ordered by spec id and then by position in the spec. */
  holders(test: string): TestBlockRef[] {
    const by = this.tests.get(test);
    if (by === undefined) return [];
    const out: TestBlockRef[] = [];
    for (const id of [...by.keys()].sort(byId)) {
      const blocks = this.specs.get(id)?.blocks ?? [];
      for (const index of by.get(id) ?? []) out.push({ spec: id, block: blocks[index]?.key ?? '', index });
    }
    return out;
  }

  /** The specs of more than one block whose last block carries a same-test key, ordered by id. */
  endsOn(test: string): string[] {
    return [...(this.ends.get(test) ?? [])].sort(byId);
  }

  /**
   * What a change set would do to the suite. The specs the set names change together: a metamorphic family cut to one
   * new walk, two twins cut alike, a spec dropped. The shape a spec has now is what the index holds for its id.
   */
  lostBy(changes: readonly SuiteChange[]): CutVerdict {
    const changed = new Map<string, SuiteChange>();
    for (const change of changes) {
      if (change.after !== undefined && change.after.spec !== change.spec) {
        throw new RangeError(`The change of ${change.spec} carries the shape of ${change.after.spec}`);
      }
      changed.set(change.spec, change);
    }
    const lost = [...this.keysLost(changed), ...this.twinsLost(changed)];
    const ends = this.endConflicts(changed);
    const refused = [...this.refusals(changed), ...ends.refused];
    return { ok: lost.length === 0 && refused.length === 0, lost, refused, takeBack: ends.takeBack };
  }

  /** The family keys a cut carries to a new walk: the variants of a walk, cut together with their words kept apart. */
  private carried(changed: ReadonlyMap<string, SuiteChange>): Set<string> {
    const out = new Set<string>();
    const family = this.rulings.obligations.find((kind): kind is FamilyKind => kind.id === 'family');
    if (family === undefined || family.cutAs !== 'unit') return out;
    const touched = new Set<string>();
    for (const id of changed.keys()) {
      const group = this.groupOf.get(id);
      if (group !== undefined) touched.add(group);
    }
    for (const group of touched) {
      const members = [...(this.groups.get(group) ?? [])];
      const next: ObligationSpec[] = [];
      for (const id of members) {
        const after = changed.get(id)?.after;
        if (after !== undefined) next.push(after);
      }
      if (next.length !== members.length) continue;
      const walks = new Set(next.map((one) => `${one.path}|${one.walk}`));
      const inRange = next.every((one) => {
        return heldKeys(one, this.declared, this.rulings).some((entry) => entry.kind.id === 'family');
      });
      const wordsBefore = new Set(members.map((id) => this.specs.get(id)?.words));
      const wordsAfter = new Set(next.map((one) => one.words));
      if (walks.size !== 1 || !inRange || wordsAfter.size < wordsBefore.size) continue;
      for (const id of members) {
        for (const entry of this.held.get(id) ?? []) {
          if (entry.kind.id === 'family') out.add(entry.key);
        }
      }
    }
    return out;
  }

  /** True when a spec outside the change set holds the key, or a changed spec still holds it after the change. */
  private heldElsewhere(
    key: string,
    changed: ReadonlyMap<string, SuiteChange>,
    afterKeys: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean {
    for (const other of this.holdersOf.get(key) ?? []) {
      if (!changed.has(other)) return true;
    }
    for (const keys of afterKeys.values()) {
      if (keys.has(key)) return true;
    }
    return false;
  }

  /** The keys of the probe, perturb and family kinds that the change set would leave with no holder. */
  private keysLost(changed: ReadonlyMap<string, SuiteChange>): string[] {
    const carried = this.carried(changed);
    const afterKeys = new Map<string, Set<string>>();
    for (const [id, change] of changed) {
      if (change.after === undefined) continue;
      const keys = heldKeys(change.after, this.declared, this.rulings).map((entry) => entry.key);
      afterKeys.set(id, new Set(keys));
    }
    const lost: string[] = [];
    for (const id of changed.keys()) {
      for (const entry of this.held.get(id) ?? []) {
        if (carried.has(entry.key) || afterKeys.get(id)?.has(entry.key)) continue;
        const sole = entry.kind.keptWhen === 'sole-holder';
        if (sole && this.heldElsewhere(entry.key, changed, afterKeys)) continue;
        if (!lost.includes(entry.key)) lost.push(entry.key);
      }
    }
    return lost;
  }

  /**
   * The twin obligations of a path and axis that the change set would leave with no pair. Only the walks a changed
   * spec leaves or joins are searched, and a spec whose path, walk, channel and persona stay as they were is not.
   */
  private twinsLost(changed: ReadonlyMap<string, SuiteChange>): string[] {
    if (this.twin === undefined) return [];
    const moved = new Set<string>();
    const touched = new Set<string>();
    for (const [id, change] of changed) {
      const before = this.specs.get(id);
      const after = change.after;
      if (before !== undefined && after !== undefined && sameTwin(before, after, this.declared)) continue;
      moved.add(id);
      if (before !== undefined && isDeclared(before, this.declared)) touched.add(twinGroup(before));
      if (after !== undefined && isDeclared(after, this.declared)) touched.add(twinGroup(after));
    }
    const delta = new Map<string, number>();
    for (const walk of touched) {
      const now = [...(this.walks.get(walk)?.values() ?? [])];
      const next = now.filter((one) => !moved.has(one.spec));
      for (const id of moved) {
        const after = changed.get(id)?.after;
        if (after === undefined || !isDeclared(after, this.declared)) continue;
        if (twinGroup(after) === walk) next.push(after);
      }
      for (const [key, list] of twinPairs(now, this.declared, this.rulings)) {
        delta.set(key, (delta.get(key) ?? 0) - list.length);
      }
      for (const [key, list] of twinPairs(next, this.declared, this.rulings)) {
        delta.set(key, (delta.get(key) ?? 0) + list.length);
      }
    }
    const lost: string[] = [];
    for (const [key, change] of delta) {
      const held = this.pairs.get(key) ?? 0;
      if (held > 0 && held + change === 0) lost.push(`twin|${key}`);
    }
    return lost.sort();
  }

  /** A declared spec joins the walk it writes, and pairs with the twins already there. */
  private join(one: ObligationSpec): void {
    const key = twinGroup(one);
    const here = this.walks.get(key) ?? new Map<string, ObligationSpec>();
    for (const other of here.values()) this.count(one, other, 1);
    here.set(one.spec, one);
    this.walks.set(key, here);
  }

  /** A declared spec leaves its walk, and the pairs it made go with it. */
  private leave(one: ObligationSpec): void {
    const key = twinGroup(one);
    const here = this.walks.get(key);
    if (here === undefined) return;
    here.delete(one.spec);
    for (const other of here.values()) this.count(one, other, -1);
    if (here.size === 0) this.walks.delete(key);
  }

  private count(one: ObligationSpec, other: ObligationSpec, step: number): void {
    if (this.twin === undefined) return;
    for (const axis of twinAxes(one, other, this.declared, this.twin)) {
      const key = `${one.path}|${axis}`;
      const held = (this.pairs.get(key) ?? 0) + step;
      if (held === 0) this.pairs.delete(key);
      else this.pairs.set(key, held);
    }
  }

  /** The validity rules that a dropped spec or a changed shape breaks on its own. */
  private refusals(changed: ReadonlyMap<string, SuiteChange>): string[] {
    const refused: string[] = [];
    const drop = this.rulings.validity.find((rule): rule is DropWhole => rule.id === 'dropWhole');
    for (const [id, change] of changed) {
      if (change.after === undefined) {
        const size = this.specs.get(id)?.blocks.length ?? 0;
        if (drop !== undefined && size > drop.maxBlocks) refused.push(`dropWhole:${id}`);
        continue;
      }
      for (const rule of this.rulings.validity) {
        if (REPORTED.has(rule.id) && change.after.broken?.includes(rule.id)) refused.push(`${rule.id}:${id}`);
      }
    }
    return refused;
  }

  /**
   * Exactly one walk ends on a given test, and the lowest id keeps it. A changed spec that would be the second
   * to end on a test is refused; an unchanged one is to be taken back by the caller. A double end that was there
   * before the change is not the change's.
   */
  private endConflicts(changed: ReadonlyMap<string, SuiteChange>): { refused: string[]; takeBack: string[] } {
    const refused: string[] = [];
    const takeBack: string[] = [];
    if (!this.rulings.validity.some((rule) => rule.id === 'oneWalkPerEnd')) return { refused, takeBack };
    const keys = new Set<string>();
    for (const [id, change] of changed) {
      const was = endOf(this.specs.get(id));
      const now = endOf(change.after);
      if (was !== undefined) keys.add(was);
      if (now !== undefined) keys.add(now);
    }
    for (const key of keys) {
      const before = [...(this.ends.get(key) ?? [])].sort(byId);
      const moved: string[] = [];
      for (const change of changed.values()) {
        if (endOf(change.after) === key) moved.push(change.spec);
      }
      const next = [...before.filter((id) => !changed.has(id)), ...moved].sort(byId);
      const double = new Set(before.slice(1));
      for (const id of next.slice(1)) {
        if (double.has(id)) continue;
        if (changed.has(id)) refused.push(`oneWalkPerEnd:${id}`);
        else takeBack.push(id);
      }
    }
    return { refused, takeBack };
  }
}
