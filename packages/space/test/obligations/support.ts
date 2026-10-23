import {
  type DeclaredAxes,
  type ObligationBlock,
  type ObligationKind,
  type ObligationSpec,
  RULINGS,
  type Rulings,
  type SuiteChange,
  SuiteIndex,
} from '@agent-nexus/driftbench-space';

/** The channels and personas the map declares in these tests. */
export const DECLARED: DeclaredAxes = {
  channels: new Set(['chat', 'voice']),
  personas: new Set(['persona:terse', 'persona:chatty']),
};

export type SpecFields = Partial<Omit<ObligationSpec, 'spec' | 'blocks'>>;

export function block(key: string, extra: Partial<ObligationBlock> = {}): ObligationBlock {
  return { key, injected: false, perturbed: [], ...extra };
}

/** A block that injects a class. */
export function inject(key: string, deviation = 'D3_contradiction'): ObligationBlock {
  return block(key, { injected: true, deviation });
}

/** A block that a declaration of each class reaches. */
export function reached(key: string, ...classes: string[]): ObligationBlock {
  return block(key, { perturbed: classes });
}

/** A block with the same-test key the caller reads. */
export function tested(key: string, test: string): ObligationBlock {
  return block(key, { test });
}

export function spec(id: string, blocks: ObligationBlock[], extra: SpecFields = {}): ObligationSpec {
  return {
    spec: id,
    path: 'p1',
    walk: `walk-${id}`,
    channel: 'chat',
    persona: 'persona:terse',
    family: '',
    variant: 0,
    of: 0,
    words: `words-${id}`,
    blocks,
    ...extra,
  };
}

/** The same spec cut to these blocks, with any field changed. */
export function cut(one: ObligationSpec, blocks: ObligationBlock[], extra: SpecFields = {}): ObligationSpec {
  return { ...one, blocks, ...extra };
}

/** A spec whose blocks carry these same-test keys, in order. */
export function walk(id: string, ...tests: string[]): ObligationSpec {
  const blocks = tests.map((test, at) => tested(`${id}${at}`, test));
  return spec(id, blocks);
}

/** The spec cut to blocks that carry these same-test keys. */
export function ending(one: ObligationSpec, ...tests: string[]): ObligationSpec {
  const blocks = tests.map((test, at) => tested(`${one.spec}${at}`, test));
  return cut(one, blocks);
}

/** A variant of a metamorphic family on one walk: two plain blocks. */
export function variant(id: string, n: number, words: string): ObligationSpec {
  const blocks = [block(`${id}0`), block(`${id}1`)];
  return spec(id, blocks, { family: 'f1', variant: n, of: 2, walk: 'w', words });
}

/** The variant cut to its first block, on a new walk with new words. */
export function shortened(one: ObligationSpec, words: string, onWalk = 'w2'): ObligationSpec {
  return cut(one, [block(`${one.spec}0`)], { walk: onWalk, words });
}

/** The shared rulings without the validity rules: the obligations alone. */
export const BARE: Rulings = { ...RULINGS, validity: [] };

/** The rulings with one obligation kind changed (`undefined` removes it). */
export function withKind(id: string, change?: Record<string, unknown>, from: Rulings = RULINGS): Rulings {
  const obligations = from.obligations.flatMap((kind): ObligationKind[] => {
    if (kind.id !== id) return [kind];
    return change === undefined ? [] : [{ ...kind, ...change } as ObligationKind];
  });
  return { ...from, obligations };
}

/** The rulings without one validity rule. */
export function withoutRule(id: string, from: Rulings = RULINGS): Rulings {
  return { ...from, validity: from.validity.filter((rule) => rule.id !== id) };
}

/** An index holding these specs. */
export function suite(specs: readonly ObligationSpec[], rulings: Rulings = RULINGS): SuiteIndex {
  const index = new SuiteIndex(DECLARED, rulings);
  for (const one of specs) index.add(one);
  return index;
}

/** The keys a change set would lose. */
export function lost(index: SuiteIndex, ...changes: SuiteChange[]): string[] {
  return index.lostBy(changes).lost;
}

export const sorted = (values: Iterable<string>): string[] => [...values].sort();
