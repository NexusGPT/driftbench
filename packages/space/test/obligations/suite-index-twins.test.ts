import { type ObligationSpec, seededRandom } from '@agent-nexus/driftbench-space';
import { describe, expect, it, vi } from 'vitest';
import { block, cut, DECLARED, spec, suite } from './support';

/**
 * The twin obligation of a path and axis is held while one pair is left. A pair is two specs of one walk that differ in
 * one axis alone, so a change reaches only the walks it leaves and the walks it joins. The index keeps the pairs it
 * holds and reads only those walks (docs/validators.md, section 3, "Same test").
 */

const seen = vi.hoisted(() => ({ sizes: [] as number[] }));

vi.mock('../../src/obligations/holders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/obligations/holders')>();
  return {
    ...actual,
    twinPairs: (...args: Parameters<typeof actual.twinPairs>) => {
      seen.sizes.push(args[0].length);
      return actual.twinPairs(...args);
    },
  };
});

/** `paths` paths of `walks` walks of one spec each, and in the first path one more spec on another channel. */
function crowd(paths: number, walks: number): ObligationSpec[] {
  const out: ObligationSpec[] = [];
  for (let p = 0; p < paths; p += 1) {
    for (let w = 0; w < walks; w += 1) {
      const id = `s-${p}-${w}`;
      out.push(spec(id, [block(`${id}a`), block(`${id}b`)], { path: `p${p}`, walk: `w${w}` }));
    }
  }
  out.push(spec('twin', [block('twina'), block('twinb')], { path: 'p0', walk: 'w0', channel: 'voice' }));
  return out;
}

describe('the twin check reads the walk of a changed spec, not its path', () => {
  const specs = crowd(3, 200);
  const index = suite(specs);
  const first = specs[0] as ObligationSpec;

  it('searches pairs among the specs of one walk when a twin is dropped', () => {
    seen.sizes.length = 0;
    const verdict = index.lostBy([{ spec: 'twin' }]);
    expect(verdict.lost).toEqual(['twin|p0|channel']);
    expect(seen.sizes.length).toBeGreaterThan(0);
    expect(Math.max(...seen.sizes)).toBeLessThanOrEqual(2);
  });

  it('searches pairs among the specs of the walks it leaves and joins when a walk changes', () => {
    seen.sizes.length = 0;
    const moved = cut(first, first.blocks, { walk: 'w9' });
    expect(index.lostBy([{ spec: first.spec, after: moved }]).lost).toEqual(['twin|p0|channel']);
    expect(seen.sizes.length).toBeGreaterThan(0);
    expect(Math.max(...seen.sizes)).toBeLessThanOrEqual(2);
  });

  it('searches nothing when the cut leaves its path, walk, channel and persona as they were', () => {
    seen.sizes.length = 0;
    const shorter = cut(first, first.blocks.slice(0, 1));
    expect(index.lostBy([{ spec: first.spec, after: shorter }]).lost).toEqual([]);
    expect(seen.sizes).toEqual([]);
  });

  it('searches nothing for a spec no map declares', () => {
    const lonely = spec('lonely', [block('l0'), block('l1')], { path: 'p0', walk: 'w0', channel: 'sms' });
    const small = suite([...specs, lonely]);
    seen.sizes.length = 0;
    expect(small.lostBy([{ spec: 'lonely' }]).lost).toEqual([]);
    expect(seen.sizes).toEqual([]);
  });
});

const declaredChannel = (one: ObligationSpec) => one.channel === '' || DECLARED.channels.has(one.channel);
const declaredPersona = (one: ObligationSpec) => one.persona === '' || DECLARED.personas.has(one.persona);

/** The pairs of a list by the definition, written apart: one walk of one path, one axis apart, both values declared. */
function pairCounts(list: readonly ObligationSpec[]): Map<string, number> {
  const out = new Map<string, number>();
  const heads = list.filter((one) => declaredChannel(one) && declaredPersona(one));
  for (const [at, one] of heads.entries()) {
    for (const two of heads.slice(at + 1)) {
      if (one.path !== two.path || one.walk !== two.walk) continue;
      const channels = one.channel !== two.channel && one.persona === two.persona;
      const personas = one.persona !== two.persona && one.channel === two.channel;
      const bothChannels = DECLARED.channels.has(one.channel) && DECLARED.channels.has(two.channel);
      const bothPersonas = DECLARED.personas.has(one.persona) && DECLARED.personas.has(two.persona);
      if (channels && bothChannels) out.set(`${one.path}|channel`, (out.get(`${one.path}|channel`) ?? 0) + 1);
      if (personas && bothPersonas) out.set(`${one.path}|persona`, (out.get(`${one.path}|persona`) ?? 0) + 1);
    }
  }
  return out;
}

/** The twin keys a change set loses by the whole-suite search: pairs before and pairs after, every path and axis. */
function reference(all: readonly ObligationSpec[], changes: ReadonlyMap<string, ObligationSpec | undefined>) {
  const afters = [...changes.values()].filter((one): one is ObligationSpec => one !== undefined);
  const after = [...all.filter((one) => !changes.has(one.spec)), ...afters];
  const was = pairCounts(all);
  const will = pairCounts(after);
  const lost: string[] = [];
  for (const [key, count] of was) {
    if (count > 0 && (will.get(key) ?? 0) === 0) lost.push(`twin|${key}`);
  }
  return lost.sort();
}

describe('a seeded matrix of suites and changes', () => {
  const CHANNELS = ['chat', 'voice', 'sms', ''];
  const PERSONAS = ['persona:terse', 'persona:chatty', 'persona:other', ''];

  function suiteFor(seed: number): ObligationSpec[] {
    const next = seededRandom(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const count = 3 + Math.floor(next() * 10);
    return Array.from({ length: count }, (_, at) => {
      return spec(`s${at}`, [block(`s${at}a`), block(`s${at}b`)], {
        path: pick(['p1', 'p2']),
        walk: pick(['w1', 'w2']),
        channel: pick(CHANNELS),
        persona: pick(PERSONAS),
      });
    });
  }

  /** What a cut could do to a spec: drop it, shorten it, or change one fact the twin relation reads. */
  function changeOf(one: ObligationSpec, next: () => number): ObligationSpec | undefined {
    const roll = Math.floor(next() * 6);
    const half = next() < 0.5;
    if (roll === 0) return undefined;
    if (roll === 1) return cut(one, one.blocks.slice(0, 1));
    if (roll === 2) return cut(one, one.blocks, { walk: half ? 'w1' : 'w2' });
    if (roll === 3) return cut(one, one.blocks, { channel: half ? 'chat' : 'voice' });
    if (roll === 4) return cut(one, one.blocks, { persona: half ? 'persona:terse' : 'persona:chatty' });
    return cut(one, one.blocks, { path: half ? 'p1' : 'p2' });
  }

  it('finds the twin keys a change set loses as the whole-suite search does', () => {
    let lostSome = 0;
    let lostNone = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const specs = suiteFor(seed);
      const next = seededRandom(seed + 7000);
      const picked = new Set<number>();
      const wanted = 1 + Math.floor(next() * 3);
      while (picked.size < wanted) picked.add(Math.floor(next() * specs.length));
      const changes = new Map<string, ObligationSpec | undefined>();
      for (const at of picked) {
        const one = specs[at] as ObligationSpec;
        changes.set(one.spec, changeOf(one, next));
      }
      const asked = [...changes].map(([id, after]) => (after ? { spec: id, after } : { spec: id }));
      const twins = suite(specs).lostBy(asked).lost.filter((key) => key.startsWith('twin|'));
      expect({ seed, twins }).toEqual({ seed, twins: reference(specs, changes) });
      if (twins.length > 0) lostSome += 1;
      else lostNone += 1;
    }
    // The matrix reaches both answers: a check that only ever sees one would pass for any code.
    expect(lostSome).toBeGreaterThan(0);
    expect(lostNone).toBeGreaterThan(0);
  });

  it('keeps the pairs it holds as specs come, go and change, so a rebuilt index answers alike', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const specs = suiteFor(seed);
      const next = seededRandom(seed + 9000);
      const live = new Map(specs.map((one) => [one.spec, one]));
      const index = suite(specs);
      for (let step = 0; step < 12; step += 1) {
        const ids = [...live.keys()];
        const id = ids[Math.floor(next() * ids.length)] as string;
        const current = live.get(id) as ObligationSpec;
        const roll = next();
        if (roll < 0.25 && ids.length > 2) {
          index.remove(id);
          live.delete(id);
        } else if (roll < 0.5) {
          const changed = changeOf(current, next) ?? current;
          index.add(changed);
          live.set(id, changed);
        } else {
          const fresh = spec(`n${seed}-${step}`, [block(`n${step}a`), block(`n${step}b`)], {
            path: next() < 0.5 ? 'p1' : 'p2',
            walk: next() < 0.5 ? 'w1' : 'w2',
            channel: CHANNELS[Math.floor(next() * 3)] as string,
            persona: PERSONAS[Math.floor(next() * 3)] as string,
          });
          index.add(fresh);
          live.set(fresh.spec, fresh);
        }
      }
      const rebuilt = suite([...live.values()]);
      for (const id of live.keys()) {
        const held = index.lostBy([{ spec: id }]);
        expect({ seed, id, held }).toEqual({ seed, id, held: rebuilt.lostBy([{ spec: id }]) });
      }
    }
  });
});
