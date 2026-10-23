import {
  type DeclaredAxes,
  isDeclared,
  type ObligationBlock,
  type ObligationSpec,
  RULINGS,
  type Rulings,
  rulingsHash,
  seededRandom,
  soleHolders,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

/**
 * The obligations of a suite and who holds them (docs/validators.md, section 3, "Same test"). The expected
 * values below are written from that paragraph: a block that injects a class is kept once per path and class; a
 * block that a declared perturbation reaches is kept once per path and perturbed class; a group may hold one twin
 * pair per path and declared axis, and a spec in every pair of an axis is kept; a member of a metamorphic family is
 * kept once per path, walk and words. A holder is kept only when it is the sole holder, whichever spec the suite
 * lists first. A channel or a persona the map does not declare is no axis and holds nothing.
 */

const DECLARED: DeclaredAxes = {
  channels: new Set(['chat', 'voice']),
  personas: new Set(['persona:terse', 'persona:chatty']),
};

type SpecFields = Partial<Omit<ObligationSpec, 'spec' | 'blocks'>>;

function block(key: string, extra: Partial<ObligationBlock> = {}): ObligationBlock {
  return { key, injected: false, perturbed: [], ...extra };
}

/** A block that injects a class. */
const inject = (key: string, deviation = 'D3_contradiction') => block(key, { injected: true, deviation });

/** A block that a declaration of each class reaches. */
const reached = (key: string, ...classes: string[]) => block(key, { perturbed: classes });

function spec(id: string, blocks: ObligationBlock[], extra: SpecFields = {}): ObligationSpec {
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

const sorted = (values: Iterable<string>) => [...values].sort();

describe('probe: a class injected on a path is owed once', () => {
  it('keeps the only spec that injects the class on the path, in every block that injects it', () => {
    const only = spec('a', [block('a0'), inject('a1'), inject('a2')]);
    const held = soleHolders([only, spec('b', [block('b0')])], DECLARED);
    expect(sorted(held.blocks)).toEqual(['a1', 'a2']);
    expect(sorted(held.specs)).toEqual([]);
  });

  it('keeps neither of two specs that inject the same class on the same path', () => {
    const held = soleHolders([spec('a', [inject('a1')]), spec('b', [inject('b1')])], DECLARED);
    expect(sorted(held.blocks)).toEqual([]);
  });

  it('counts another class, and another path, as another obligation', () => {
    const a = spec('a', [inject('a1', 'D3_contradiction')]);
    const b = spec('b', [inject('b1', 'D4_loose_confirmation')]);
    const c = spec('c', [inject('c1', 'D3_contradiction')], { path: 'p2' });
    expect(sorted(soleHolders([a, b, c], DECLARED).blocks)).toEqual(['a1', 'b1', 'c1']);
  });

  it('reads an injection that records no class as one obligation of its own', () => {
    const none = (key: string) => block(key, { injected: true });
    const a = spec('a', [none('a1')]);
    const b = spec('b', [none('b1')]);
    const c = spec('c', [inject('c1')]);
    expect(sorted(soleHolders([a, b, c], DECLARED).blocks)).toEqual(['c1']);
  });

  it('gives the same answer whichever order the suite lists its specs in', () => {
    const a = spec('a', [inject('a1')]);
    const b = spec('b', [inject('b1')]);
    const c = spec('c', [inject('c1', 'D9_out_of_scope')]);
    const forward = soleHolders([a, b, c], DECLARED);
    const backward = soleHolders([c, b, a], DECLARED);
    expect(sorted(forward.blocks)).toEqual(['c1']);
    expect(sorted(backward.blocks)).toEqual(['c1']);
  });
});

describe('perturb: a class declared on a path is owed once, in the blocks the declaration reaches', () => {
  const D4 = 'D4_loose_confirmation';

  it('keeps every block of the only spec that a declaration of the class reaches', () => {
    const a = spec('a', [reached('a0', D4), reached('a1', D4), block('a2')]);
    const held = soleHolders([a, spec('b', [block('b0')])], DECLARED);
    expect(sorted(held.blocks)).toEqual(['a0', 'a1']);
  });

  it('keeps neither of two specs that a declaration of the same class reaches on the same path', () => {
    const held = soleHolders([spec('a', [reached('a0', D4)]), spec('b', [reached('b0', D4)])], DECLARED);
    expect(sorted(held.blocks)).toEqual([]);
  });

  it('counts each class a block is reached by as an obligation', () => {
    const a = spec('a', [reached('a0', D4, 'D2_goal_shift')]);
    const b = spec('b', [reached('b0', D4)]);
    const c = spec('c', [reached('c0', 'D2_goal_shift')], { path: 'p2' });
    // a0 is the only holder of D2_goal_shift on p1; c0 is the only holder on p2; D4 on p1 has two holders.
    expect(sorted(soleHolders([a, b, c], DECLARED).blocks)).toEqual(['a0', 'c0']);
  });
});

describe('family: a metamorphic variant is owed once per path, walk and words', () => {
  const variant = (id: string, extra: SpecFields = {}) =>
    spec(id, [block(`${id}0`)], { family: 'f1', variant: 1, of: 2, walk: 'w', words: 'x', ...extra });

  it('keeps the only variant in range', () => {
    const held = soleHolders([variant('a'), spec('b', [block('b0')])], DECLARED);
    expect(sorted(held.specs)).toEqual(['a']);
    expect(sorted(held.blocks)).toEqual([]);
  });

  it('keeps neither of two variants that say the same words on the same walk', () => {
    const held = soleHolders([variant('a'), variant('b', { variant: 2 })], DECLARED);
    expect(sorted(held.specs)).toEqual([]);
  });

  it('keeps both variants when their words differ', () => {
    const held = soleHolders([variant('a'), variant('b', { variant: 2, words: 'y' })], DECLARED);
    expect(sorted(held.specs)).toEqual(['a', 'b']);
  });

  it('holds nothing for a variant out of range or a spec with no family', () => {
    const early = variant('a', { variant: 0 });
    const late = variant('b', { variant: 3 });
    const none = variant('c', { family: '' });
    expect(sorted(soleHolders([early, late, none], DECLARED).specs)).toEqual([]);
  });
});

describe('twin: one pair per path and declared axis, the spec in every pair is kept', () => {
  const same = { walk: 'w' };
  const base = spec('a', [block('a0')], same);

  it('keeps a written walk and its copy on another declared channel', () => {
    const copy = spec('b', [block('b0')], { ...same, channel: 'voice' });
    expect(sorted(soleHolders([base, copy], DECLARED).specs)).toEqual(['a', 'b']);
  });

  it('keeps a written walk and its copy for another declared persona', () => {
    const copy = spec('b', [block('b0')], { ...same, persona: 'persona:chatty' });
    expect(sorted(soleHolders([base, copy], DECLARED).specs)).toEqual(['a', 'b']);
  });

  it('keeps only the spec shared by two pairs of one axis', () => {
    const one = spec('b', [block('b0')], { ...same, channel: 'voice' });
    const two = spec('c', [block('c0')], { ...same, channel: 'voice' });
    expect(sorted(soleHolders([base, one, two], DECLARED).specs)).toEqual(['a']);
  });

  it('keeps nothing for a copy on a channel the map does not declare', () => {
    const copy = spec('b', [block('b0')], { ...same, channel: 'sms' });
    expect(sorted(soleHolders([base, copy], DECLARED).specs)).toEqual([]);
  });

  it('keeps nothing for a copy that differs in two axes at once', () => {
    const copy = spec('b', [block('b0')], { ...same, channel: 'voice', persona: 'persona:chatty' });
    expect(sorted(soleHolders([base, copy], DECLARED).specs)).toEqual([]);
  });

  it('keeps nothing for two walks that are not the same walk', () => {
    const other = spec('b', [block('b0')], { channel: 'voice' });
    expect(sorted(soleHolders([spec('a', [block('a0')]), other], DECLARED).specs)).toEqual([]);
  });
});

describe('a channel or a persona the map does not declare holds nothing', () => {
  it('does not count an undeclared spec as a holder of a class the declared spec injects', () => {
    const declared = spec('a', [inject('a1')]);
    const undeclared = spec('b', [inject('b1')], { channel: 'sms' });
    expect(sorted(soleHolders([declared, undeclared], DECLARED).blocks)).toEqual(['a1']);
  });

  it('treats an empty channel and an empty persona as declared', () => {
    expect(isDeclared({ channel: '', persona: '' }, DECLARED)).toBe(true);
    expect(isDeclared({ channel: 'chat', persona: 'persona:terse' }, DECLARED)).toBe(true);
    expect(isDeclared({ channel: 'sms', persona: '' }, DECLARED)).toBe(false);
    expect(isDeclared({ channel: '', persona: 'persona:other' }, DECLARED)).toBe(false);
  });
});

describe('the rulings are data: changing one changes the answer', () => {
  const D4 = 'D4_loose_confirmation';
  const same = { walk: 'w' };

  /** The rulings with the perturb kind kept for the given holders. */
  const perturbKept = (keptWhen: 'sole-holder' | 'any-holder'): Rulings => {
    const obligations = RULINGS.obligations.map((kind) => {
      return kind.id === 'perturb' ? { ...kind, keptWhen } : kind;
    });
    return { ...RULINGS, obligations };
  };
  /** The rulings without one kind. */
  const without = (id: string): Rulings => {
    return { ...RULINGS, obligations: RULINGS.obligations.filter((kind) => kind.id !== id) };
  };
  /** The rulings with the twin kind reading the given axes, over declared values only or not. */
  const twinsOf = (axes: Array<'channel' | 'persona'>, onlyDeclared: boolean): Rulings => {
    const obligations = RULINGS.obligations.map((kind) => {
      return kind.id === 'twin' ? { ...kind, axes, onlyDeclared } : kind;
    });
    return { ...RULINGS, obligations };
  };

  it('keeps every holder when a kind is kept for any holder', () => {
    const suite = [spec('a', [reached('a0', D4)]), spec('b', [reached('b0', D4)])];
    expect(sorted(soleHolders(suite, DECLARED).blocks)).toEqual([]);
    const held = soleHolders(suite, DECLARED, perturbKept('any-holder'));
    expect(sorted(held.blocks)).toEqual(['a0', 'b0']);
  });

  it('keeps nothing of a kind the rulings do not list', () => {
    const suite = [spec('a', [reached('a0', D4)])];
    expect(sorted(soleHolders(suite, DECLARED).blocks)).toEqual(['a0']);
    expect(sorted(soleHolders(suite, DECLARED, without('perturb')).blocks)).toEqual([]);
  });

  it('counts a copy with no channel as a twin once the axis no longer needs a declared value', () => {
    const copy = spec('b', [block('b0')], { ...same, channel: '' });
    const suite = [spec('a', [block('a0')], same), copy];
    expect(sorted(soleHolders(suite, DECLARED).specs)).toEqual([]);
    const held = soleHolders(suite, DECLARED, twinsOf(['channel', 'persona'], false));
    expect(sorted(held.specs)).toEqual(['a', 'b']);
  });

  it('counts only the axes the rulings list', () => {
    const copy = spec('b', [block('b0')], { ...same, persona: 'persona:chatty' });
    const suite = [spec('a', [block('a0')], same), copy];
    expect(sorted(soleHolders(suite, DECLARED).specs)).toEqual(['a', 'b']);
    const held = soleHolders(suite, DECLARED, twinsOf(['channel'], true));
    expect(sorted(held.specs)).toEqual([]);
  });

  it('changes the hash with any ruling, and only with a ruling', () => {
    expect(rulingsHash({ ...RULINGS })).toBe(rulingsHash(RULINGS));
    expect(rulingsHash(perturbKept('any-holder'))).not.toBe(rulingsHash(RULINGS));
    expect(rulingsHash(without('twin'))).not.toBe(rulingsHash(RULINGS));
  });
});

/**
 * The same answer by definition, written apart: a block is kept when no other declared spec holds one of the
 * obligations it carries; a spec is kept when no other declared spec holds its family obligation, or when it is
 * in every pair of a path and axis.
 */
function naive(specs: readonly ObligationSpec[], declared: DeclaredAxes) {
  const live = specs.filter((one) => isDeclared(one, declared));
  const injectKey = (one: ObligationSpec, entry: ObligationBlock) =>
    `inject|${one.path}|${entry.deviation ?? 'injection'}`;
  const carries = (one: ObligationSpec) => {
    const found: Array<{ key: string; block: string }> = [];
    for (const entry of one.blocks) {
      if (entry.injected) found.push({ key: injectKey(one, entry), block: entry.key });
      for (const cls of entry.perturbed) {
        found.push({ key: `perturb|${one.path}|${cls}`, block: entry.key });
      }
    }
    return found;
  };
  const familyOf = (one: ObligationSpec) => {
    const ranged = one.family !== '' && one.variant >= 1 && one.variant <= one.of;
    return ranged ? [`family|${one.path}|${one.walk}|${one.words}`] : [];
  };
  const blocks = new Set<string>();
  const kept = new Set<string>();
  for (const one of live) {
    const others = live.filter((other) => other !== one);
    for (const entry of carries(one)) {
      const shared = others.some((other) => carries(other).some((theirs) => theirs.key === entry.key));
      if (!shared) blocks.add(entry.block);
    }
    for (const key of familyOf(one)) {
      if (!others.some((other) => familyOf(other).includes(key))) kept.add(one.spec);
    }
  }
  for (const axis of ['channel', 'persona'] as const) {
    const otherAxis = axis === 'channel' ? 'persona' : 'channel';
    const values = axis === 'channel' ? declared.channels : declared.personas;
    const pairs: Array<[ObligationSpec, ObligationSpec]> = [];
    live.forEach((one, at) => {
      for (const two of live.slice(at + 1)) {
        if (one.path !== two.path || one.walk !== two.walk) continue;
        if (one[axis] === two[axis] || one[otherAxis] !== two[otherAxis]) continue;
        if (values.has(one[axis]) && values.has(two[axis])) pairs.push([one, two]);
      }
    });
    for (const path of new Set(pairs.map(([one]) => one.path))) {
      const here = pairs.filter(([one]) => one.path === path);
      for (const member of new Set(here.flat())) {
        if (here.every((pair) => pair.includes(member))) kept.add(member.spec);
      }
    }
  }
  return { blocks: sorted(blocks), specs: sorted(kept) };
}

describe('a seeded matrix of suites', () => {
  const CHANNELS = ['chat', 'voice', 'sms', ''];
  const PERSONAS = ['persona:terse', 'persona:chatty', 'persona:other', ''];
  const CLASSES = ['D2_goal_shift', 'D3_contradiction', 'D4_loose_confirmation'];

  function suiteFor(seed: number): ObligationSpec[] {
    const next = seededRandom(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const count = 2 + Math.floor(next() * 7);
    return Array.from({ length: count }, (_, index) => {
      const blocks = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, at) => {
        const injected = next() < 0.3;
        const named = injected && next() < 0.8;
        const reachedBy = next() < 0.4 ? [pick(CLASSES)] : [];
        return block(`s${index}b${at}`, {
          injected,
          ...(named ? { deviation: pick(CLASSES) } : {}),
          perturbed: reachedBy,
        });
      });
      const ranged = next() < 0.3;
      return spec(`s${index}`, blocks, {
        path: pick(['p1', 'p2']),
        walk: pick(['w1', 'w2', 'w3']),
        channel: pick(CHANNELS),
        persona: pick(PERSONAS),
        words: pick(['x', 'y']),
        ...(ranged ? { family: 'f1', variant: 1 + Math.floor(next() * 3), of: 2 } : {}),
      });
    });
  }

  /** The suite in another order: a Fisher-Yates shuffle from its own seeded stream. */
  function shuffled<T>(list: readonly T[], seed: number): T[] {
    const next = seededRandom(seed);
    const out = [...list];
    for (let at = out.length - 1; at > 0; at -= 1) {
      const to = Math.floor(next() * (at + 1));
      [out[at], out[to]] = [out[to] as T, out[at] as T];
    }
    return out;
  }

  it('agrees with the definition written apart, whatever order the suite lists its specs in', () => {
    let keptBlocks = 0;
    let keptSpecs = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const suite = suiteFor(seed);
      const expected = naive(suite, DECLARED);
      const held = soleHolders(suite, DECLARED);
      const actual = { seed, blocks: sorted(held.blocks), specs: sorted(held.specs) };
      expect(actual).toEqual({ seed, ...expected });
      const again = soleHolders(shuffled(suite, seed + 1000), DECLARED);
      const reordered = { seed, blocks: sorted(again.blocks), specs: sorted(again.specs) };
      expect(reordered).toEqual({ seed, ...expected });
      keptBlocks += held.blocks.size;
      keptSpecs += held.specs.size;
    }
    // The matrix reaches both kinds of answer: a check over suites that keep nothing would pass for any code.
    expect(keptBlocks).toBeGreaterThan(0);
    expect(keptSpecs).toBeGreaterThan(0);
  });
});
