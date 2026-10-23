import { RULINGS, rulingsHash, seededRandom, soleHolders } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  BARE,
  block,
  cut,
  DECLARED,
  ending,
  inject,
  lost,
  reached,
  shortened,
  sorted,
  spec,
  suite,
  tested,
  variant,
  walk,
  withKind,
  withoutRule,
} from './support';

/**
 * A suite as an index, and the question a cut asks of it: which obligations would the suite no longer hold
 * (docs/validators.md, section 3, "Same test"). The expected values are written from that paragraph and from the four
 * rules of the settle pass: (a) a perturbation goes with its block when another spec declares the class on the same
 * path; (b) a metamorphic family is cut as a unit; (c) a one-block walk is dropped as a whole spec when every
 * obligation is held elsewhere; (d) exactly one walk ends on a block, and the lowest id keeps it.
 */

const D2 = 'D2_goal_shift';
const D3 = 'D3_contradiction';
const D4 = 'D4_loose_confirmation';
const K_INJECT = 'inject|p1|D3_contradiction';
const K_PERTURB = 'perturb|p1|D4_loose_confirmation';
const K_CHANNEL = 'twin|p1|channel';

describe('lostBy: a class injected on a path is owed once', () => {
  it('names the key a drop of the only injector would lose', () => {
    const index = suite([spec('a', [block('a0'), inject('a1')]), spec('b', [block('b0')])], BARE);
    const verdict = index.lostBy([{ spec: 'a' }]);
    expect(verdict.lost).toEqual([K_INJECT]);
    expect(verdict.ok).toBe(false);
  });

  it('lets a duplicate injector go, and then holds the survivor', () => {
    const index = suite([spec('a', [inject('a1')]), spec('b', [inject('b1')])], BARE);
    expect(lost(index, { spec: 'a' })).toEqual([]);
    index.remove('a');
    expect(lost(index, { spec: 'b' })).toEqual([K_INJECT]);
  });

  it('keeps the key when the cut leaves the injecting block in the spec', () => {
    const a = spec('a', [inject('a0'), block('a1')]);
    const index = suite([a], BARE);
    expect(lost(index, { spec: 'a', after: cut(a, [inject('a0')]) })).toEqual([]);
  });

  it('loses the key when the cut takes the injecting block and no other spec holds it', () => {
    const a = spec('a', [block('a0'), inject('a1')]);
    const index = suite([a], BARE);
    expect(lost(index, { spec: 'a', after: cut(a, [block('a0')]) })).toEqual([K_INJECT]);
  });

  it('counts another class and another path as another obligation', () => {
    const a = spec('a', [inject('a1', D3)]);
    const otherClass = spec('b', [inject('b1', D4)]);
    const otherPath = spec('c', [inject('c1', D3)], { path: 'p2' });
    const index = suite([a, otherClass, otherPath], BARE);
    expect(lost(index, { spec: 'a' })).toEqual([K_INJECT]);
  });

  it('asks nothing of a spec on a channel the map does not declare', () => {
    const undeclared = spec('a', [inject('a1')], { channel: 'sms' });
    const index = suite([undeclared], BARE);
    expect(lost(index, { spec: 'a' })).toEqual([]);
  });
});

describe('lostBy, rule (a): a perturbation goes with its block when another spec declares the class', () => {
  const a = spec('a', [reached('a0', D4), reached('a1', D4)]);
  const dropped = cut(a, [block('a0')]);

  it('lets the declaration go when another spec on the same path and class holds it', () => {
    const index = suite([a, spec('b', [reached('b0', D4)])], BARE);
    expect(lost(index, { spec: 'a', after: dropped })).toEqual([]);
  });

  it('refuses it when no other spec holds the class on the path', () => {
    const index = suite([a, spec('b', [reached('b0', D2)])], BARE);
    expect(lost(index, { spec: 'a', after: dropped })).toEqual([K_PERTURB]);
  });

  it('refuses it when the other spec declares the class on another path', () => {
    const index = suite([a, spec('b', [reached('b0', D4)], { path: 'p2' })], BARE);
    expect(lost(index, { spec: 'a', after: dropped })).toEqual([K_PERTURB]);
  });

  it('lets one of two declarations go, and holds the other once the first is gone', () => {
    const b = spec('b', [reached('b0', D4)]);
    const index = suite([a, b], BARE);
    expect(lost(index, { spec: 'a', after: dropped })).toEqual([]);
    index.add(dropped);
    expect(lost(index, { spec: 'b', after: cut(b, [block('b0')]) })).toEqual([K_PERTURB]);
  });

  it('keeps the declaration when the cut leaves a block it reaches', () => {
    const index = suite([a], BARE);
    expect(lost(index, { spec: 'a', after: cut(a, [reached('a0', D4)]) })).toEqual([]);
  });

  it('is a ruling: kept for any holder, the cut is refused whoever else declares the class', () => {
    const rulings = withKind('perturb', { keptWhen: 'any-holder' }, BARE);
    const index = suite([a, spec('b', [reached('b0', D4)])], rulings);
    expect(lost(index, { spec: 'a', after: dropped })).toEqual([K_PERTURB]);
  });
});

describe('lostBy, rule (b): a metamorphic family is cut as a unit', () => {
  const v1 = variant('v1', 1, 'x');
  const v2 = variant('v2', 2, 'y');
  const bothLost = ['family|p1|w|x', 'family|p1|w|y'];

  it('carries the keys of a family cut together to one new walk with distinct words', () => {
    const index = suite([v1, v2], BARE);
    const first = { spec: 'v1', after: shortened(v1, 'x2') };
    const second = { spec: 'v2', after: shortened(v2, 'y2') };
    expect(lost(index, first, second)).toEqual([]);
  });

  it('refuses a cut of one variant alone: the family is no longer one walk', () => {
    const index = suite([v1, v2], BARE);
    expect(lost(index, { spec: 'v1', after: shortened(v1, 'x2') })).toEqual(['family|p1|w|x']);
  });

  it('refuses a cut that leaves two variants with the same words', () => {
    const index = suite([v1, v2], BARE);
    const first = { spec: 'v1', after: shortened(v1, 'z') };
    const second = { spec: 'v2', after: shortened(v2, 'z') };
    expect(lost(index, first, second)).toEqual(bothLost);
  });

  it('refuses a cut that sends the variants to different walks', () => {
    const index = suite([v1, v2], BARE);
    const first = { spec: 'v1', after: shortened(v1, 'x2', 'w2') };
    const second = { spec: 'v2', after: shortened(v2, 'y2', 'w3') };
    expect(lost(index, first, second)).toEqual(bothLost);
  });

  it('lets a variant go that repeats the words of another variant', () => {
    const index = suite([v1, variant('v2', 2, 'x')], BARE);
    expect(lost(index, { spec: 'v1', after: shortened(v1, 'x2') })).toEqual([]);
  });

  it('is a ruling: cut as a single spec, the same cut of both variants loses both keys', () => {
    const index = suite([v1, v2], withKind('family', { cutAs: 'single' }, BARE));
    const first = { spec: 'v1', after: shortened(v1, 'x2') };
    const second = { spec: 'v2', after: shortened(v2, 'y2') };
    expect(lost(index, first, second)).toEqual(bothLost);
  });

  it('drops a variant only when another holds its words', () => {
    const index = suite([v1, v2], BARE);
    expect(lost(index, { spec: 'v1' })).toEqual(['family|p1|w|x']);
  });
});

describe('lostBy, rule (c): a one-block walk is dropped when every obligation is held elsewhere', () => {
  it('lets a one-block spec that holds nothing go', () => {
    const index = suite([spec('a', [block('a0')]), spec('b', [block('b0')])]);
    const verdict = index.lostBy([{ spec: 'a' }]);
    expect(verdict).toEqual({ ok: true, lost: [], refused: [], takeBack: [] });
  });

  it('refuses a spec of more than one block: it is cut to one block first', () => {
    const index = suite([spec('a', [block('a0'), block('a1')])]);
    expect(index.lostBy([{ spec: 'a' }]).refused).toEqual(['dropWhole:a']);
  });

  it('refuses a one-block spec that is the only holder of an obligation', () => {
    const index = suite([spec('a', [inject('a0')]), spec('b', [block('b0')])]);
    const verdict = index.lostBy([{ spec: 'a' }]);
    expect(verdict.lost).toEqual([K_INJECT]);
    expect(verdict.ok).toBe(false);
  });

  it('lets a one-block spec go that another spec duplicates', () => {
    const index = suite([spec('a', [inject('a0')]), spec('b', [inject('b0')])]);
    expect(index.lostBy([{ spec: 'a' }]).ok).toBe(true);
  });

  it('refuses a drop that takes the last pair of a twin axis', () => {
    const a = spec('a', [block('a0')], { walk: 'w' });
    const b = spec('b', [block('b0')], { walk: 'w', channel: 'voice' });
    const index = suite([a, b]);
    expect(lost(index, { spec: 'a' })).toEqual([K_CHANNEL]);
  });

  it('is a ruling: without the rule a spec of any length may be dropped', () => {
    const index = suite([spec('a', [block('a0'), block('a1')])], withoutRule('dropWhole'));
    expect(index.lostBy([{ spec: 'a' }]).ok).toBe(true);
  });
});

describe('lostBy, rule (d): exactly one walk ends on a block, and the lowest id keeps it', () => {
  it('refuses a cut that ends a higher id on the block a lower id already ends on', () => {
    const b = walk('b', 't1', 't3', 'Y');
    const index = suite([walk('a', 't1', 'K'), b]);
    const verdict = index.lostBy([{ spec: 'b', after: ending(b, 't1', 'K') }]);
    expect(verdict.refused).toEqual(['oneWalkPerEnd:b']);
    expect(verdict.ok).toBe(false);
  });

  it('asks to take back the higher id when a lower id now ends on its block', () => {
    const a = walk('a', 't1', 't2', 'Y');
    const index = suite([a, walk('b', 't1', 'K')]);
    const verdict = index.lostBy([{ spec: 'a', after: ending(a, 't1', 'K') }]);
    expect(verdict.takeBack).toEqual(['b']);
    expect(verdict.refused).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('keeps the lowest id of two specs cut to the same end in one change set', () => {
    const a = walk('a', 't1', 't2', 'Y');
    const b = walk('b', 't1', 't3', 'Z');
    const index = suite([a, b]);
    const first = { spec: 'a', after: ending(a, 't1', 'K') };
    const second = { spec: 'b', after: ending(b, 't1', 'K') };
    const verdict = index.lostBy([first, second]);
    expect(verdict.refused).toEqual(['oneWalkPerEnd:b']);
    expect(verdict.takeBack).toEqual([]);
  });

  it('never conflicts for a walk of one block', () => {
    const b = walk('b', 't1', 't3', 'Y');
    const index = suite([walk('a', 't1', 'K'), b]);
    expect(index.lostBy([{ spec: 'b', after: ending(b, 'K') }]).refused).toEqual([]);
  });

  it('does not refuse a change that leaves an existing double end as it was', () => {
    const b = walk('b', 't1', 't3', 'K');
    const index = suite([walk('a', 't1', 'K'), b]);
    const verdict = index.lostBy([{ spec: 'b', after: ending(b, 't1', 'K') }]);
    expect(verdict.refused).toEqual([]);
    expect(verdict.takeBack).toEqual([]);
  });

  it('lists the specs that end on a test key, more than one block, by id', () => {
    const index = suite([walk('b', 't1', 'K'), walk('a', 't1', 't2', 'K'), walk('c', 'K')]);
    expect(index.endsOn('K')).toEqual(['a', 'b']);
    expect(index.endsOn('nowhere')).toEqual([]);
  });

  it('is a ruling: without the rule two walks may end on one block', () => {
    const b = walk('b', 't1', 't3', 'Y');
    const index = suite([walk('a', 't1', 'K'), b], withoutRule('oneWalkPerEnd'));
    const verdict = index.lostBy([{ spec: 'b', after: ending(b, 't1', 'K') }]);
    expect(verdict.ok).toBe(true);
    expect(verdict.takeBack).toEqual([]);
  });
});

describe('lostBy: the refusals the caller reports', () => {
  const a = spec('a', [block('a0'), block('a1')]);

  it('refuses a cut shape that breaks a rule the rulings list', () => {
    const index = suite([a]);
    for (const rule of ['toolFailureLast', 'restatedLast', 'driverBuildable']) {
      const after = cut(a, [block('a0')], { broken: [rule] });
      expect(index.lostBy([{ spec: 'a', after }]).refused).toEqual([`${rule}:a`]);
    }
  });

  it('ignores a rule the rulings do not list', () => {
    const index = suite([a], withoutRule('driverBuildable'));
    const after = cut(a, [block('a0')], { broken: ['driverBuildable'] });
    expect(index.lostBy([{ spec: 'a', after }]).ok).toBe(true);
  });

  it('does not take a rule that only the interpreter applies from the caller', () => {
    const index = suite([a]);
    const after = cut(a, [block('a0')], { broken: ['dropWhole'] });
    expect(index.lostBy([{ spec: 'a', after }]).refused).toEqual([]);
  });

  it('refuses a change whose after belongs to another spec', () => {
    const index = suite([a]);
    expect(() => index.lostBy([{ spec: 'b', after: a }])).toThrow(RangeError);
  });
});

describe('lostBy: a twin pair on a declared axis is owed once per path', () => {
  const a = spec('a', [block('a0'), block('a1')], { walk: 'w' });
  const b = spec('b', [block('b0'), block('b1')], { walk: 'w', channel: 'voice' });
  const c = spec('c', [block('c0'), block('c1')], { walk: 'w', channel: 'voice' });
  const first = (one: typeof a) => cut(one, [block(`${one.spec}0`)], { walk: 'w2' });

  it('refuses a cut of one twin alone: the pair is gone', () => {
    const index = suite([a, b], BARE);
    expect(lost(index, { spec: 'a', after: first(a) })).toEqual([K_CHANNEL]);
  });

  it('carries the pair when both twins are cut to one new walk', () => {
    const index = suite([a, b], BARE);
    expect(lost(index, { spec: 'a', after: first(a) }, { spec: 'b', after: first(b) })).toEqual([]);
  });

  it('lets one of two partners of the shared spec go, and holds the shared spec', () => {
    const index = suite([a, b, c], BARE);
    expect(lost(index, { spec: 'b', after: first(b) })).toEqual([]);
    expect(lost(index, { spec: 'a', after: first(a) })).toEqual([K_CHANNEL]);
  });

  it('reads the persona axis as well', () => {
    const chatty = spec('d', [block('d0')], { walk: 'w', persona: 'persona:chatty' });
    const index = suite([a, chatty], BARE);
    expect(lost(index, { spec: 'd' })).toEqual(['twin|p1|persona']);
  });

  it('asks nothing of a copy on a channel the map does not declare', () => {
    const copy = spec('e', [block('e0')], { walk: 'w', channel: 'sms' });
    const index = suite([a, copy], BARE);
    expect(lost(index, { spec: 'e' })).toEqual([]);
  });
});

describe('the index answers like the batch function', () => {
  it('holds the test keys of its blocks, ordered by spec id and block', () => {
    const b = spec('b', [tested('b0', 'K'), tested('b1', 'L')]);
    const a = spec('a', [tested('a0', 'L'), tested('a1', 'K'), tested('a2', 'K')]);
    const index = suite([b, a]);
    expect(index.holders('K')).toEqual([
      { spec: 'a', block: 'a1', index: 1 },
      { spec: 'a', block: 'a2', index: 2 },
      { spec: 'b', block: 'b0', index: 0 },
    ]);
    index.remove('a');
    expect(index.holders('K')).toEqual([{ spec: 'b', block: 'b0', index: 0 }]);
    expect(index.holders('nowhere')).toEqual([]);
  });

  it('replaces a spec added twice under one id', () => {
    const index = suite([spec('a', [inject('a1')])], BARE);
    index.add(spec('a', [block('a0')]));
    expect(index.size).toBe(1);
    expect(lost(index, { spec: 'a' })).toEqual([]);
  });

  it('puts the validity rules in the rulings, and in their hash', () => {
    expect(rulingsHash(withoutRule('dropWhole'))).not.toBe(rulingsHash(RULINGS));
    const ids = RULINGS.validity.map((rule) => rule.id);
    expect(ids).toEqual(['toolFailureLast', 'restatedLast', 'driverBuildable', 'oneWalkPerEnd', 'dropWhole']);
  });
});

describe('a seeded matrix of suites', () => {
  const CHANNELS = ['chat', 'voice', 'sms', ''];
  const PERSONAS = ['persona:terse', 'persona:chatty', 'persona:other', ''];
  const CLASSES = [D2, D3, D4];

  function suiteFor(seed: number) {
    const next = seededRandom(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const count = 2 + Math.floor(next() * 7);
    return Array.from({ length: count }, (_, index) => {
      const blocks = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, at) => {
        const injected = next() < 0.3;
        const named = injected && next() < 0.8;
        const reachedBy = next() < 0.4 ? [pick(CLASSES)] : [];
        const deviation = named ? { deviation: pick(CLASSES) } : {};
        return block(`s${index}b${at}`, { injected, ...deviation, perturbed: reachedBy });
      });
      const ranged = next() < 0.3;
      const family = ranged ? { family: 'f1', variant: 1 + Math.floor(next() * 3), of: 2 } : {};
      return spec(`s${index}`, blocks, {
        path: pick(['p1', 'p2']),
        walk: pick(['w1', 'w2', 'w3']),
        channel: pick(CHANNELS),
        persona: pick(PERSONAS),
        words: pick(['x', 'y']),
        ...family,
      });
    });
  }

  it('drops a spec exactly when the batch function keeps it', () => {
    let dropsKept = 0;
    let dropsFree = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const specs = suiteFor(seed);
      const index = suite(specs, BARE);
      const kept = soleHolders(specs, DECLARED, BARE);
      expect(sorted(index.soleHolders().blocks)).toEqual(sorted(kept.blocks));
      expect(sorted(index.soleHolders().specs)).toEqual(sorted(kept.specs));
      for (const one of specs) {
        const heldBlock = one.blocks.some((entry) => kept.blocks.has(entry.key));
        const keeps = kept.specs.has(one.spec) || heldBlock;
        const verdict = { seed, spec: one.spec, loses: lost(index, { spec: one.spec }).length > 0 };
        expect(verdict).toEqual({ seed, spec: one.spec, loses: keeps });
        if (keeps) dropsKept += 1;
        else dropsFree += 1;
      }
    }
    // The matrix reaches both answers: a check that only ever sees one would pass for any code.
    expect(dropsKept).toBeGreaterThan(0);
    expect(dropsFree).toBeGreaterThan(0);
  });

  it('lets the generator cut a last block the oracle does not protect', () => {
    let cuts = 0;
    let refusals = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const specs = suiteFor(seed);
      const index = suite(specs, BARE);
      const kept = soleHolders(specs, DECLARED, BARE);
      for (const one of specs) {
        const last = one.blocks.at(-1);
        if (one.blocks.length < 2 || last === undefined) continue;
        const after = cut(one, one.blocks.slice(0, -1));
        const keys = lost(index, { spec: one.spec, after });
        if (kept.blocks.has(last.key)) {
          if (keys.length > 0) refusals += 1;
          continue;
        }
        expect({ seed, spec: one.spec, keys }).toEqual({ seed, spec: one.spec, keys: [] });
        cuts += 1;
      }
    }
    expect(cuts).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
  });

  it('gives the same verdict whatever order the specs were added in', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const specs = suiteFor(seed);
      const forward = suite(specs, BARE);
      const backward = suite([...specs].reverse(), BARE);
      for (const one of specs) {
        const change = [{ spec: one.spec }];
        expect(backward.lostBy(change)).toEqual(forward.lostBy(change));
      }
    }
  });
});
