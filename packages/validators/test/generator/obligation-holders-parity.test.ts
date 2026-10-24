import { RULINGS, type Rulings, seededRandom, soleHolders } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { obligationHolders, obligationSpecsOf, SeedData } from '../../src/ladders/generator/bank';
import type { BlockRun } from '../../src/ladders/generator/measure';

/**
 * The oracle's declared obligations now come from the shared rulings (`packages/space/src/obligations`). This file
 * keeps the code they replaced, as a test-only copy, and holds the new answer to the old one on a seeded matrix of
 * suites. The matrix is built from the fields the old code read: a block key, its spec, and the spec-level path,
 * walk, channel, persona, family and words, with the injected and perturbed marks of each block.
 */

const HIDDEN = { channels: ['chat', 'voice'], personas: [{ id: 'terse' }, { id: 'chatty' }] };
const AXES = {
  channels: new Set(HIDDEN.channels),
  personas: new Set(HIDDEN.personas.map((entry) => `persona:${entry.id}`)),
};

/** The old `obligationHolders`, verbatim but for the memo key. */
async function legacyObligationHolders(data: SeedData): Promise<{
  blocks: Set<string>;
  specs: Set<string>;
  declared: (block: BlockRun) => boolean;
}> {
  const { hidden } = await data.generated();
  const channels = new Set<string>(hidden.channels);
  const personas = new Set<string>(hidden.personas.map((entry) => `persona:${entry.id}`));
  const declared = (block: BlockRun): boolean =>
    (block.channel === '' || channels.has(block.channel)) &&
    (block.persona === '' || personas.has(block.persona));
  const held = await data.memoized('legacy-obligation-holders', async () => {
    const bySpec = new Map<string, BlockRun[]>();
    for (const block of (await data.runs()).blocks)
      bySpec.set(block.spec, [...(bySpec.get(block.spec) ?? []), block]);
    const carried = new Map<string, Map<string, Set<string>>>();
    const carry = (obligation: string, spec: string, block?: string) => {
      const holders = carried.get(obligation) ?? new Map<string, Set<string>>();
      const keys = holders.get(spec) ?? new Set<string>();
      if (block !== undefined) keys.add(block);
      holders.set(spec, keys);
      carried.set(obligation, holders);
    };
    const heads: BlockRun[] = [];
    const blocks = new Set<string>();
    const specs = new Set<string>();
    for (const [spec, own] of bySpec) {
      const head = own[0] as BlockRun;
      if (!declared(head)) continue;
      heads.push(head);
      if (head.family !== '' && head.variant >= 1 && head.variant <= head.of)
        carry(`family|${head.path}|${head.walk}|${head.words}`, spec);
      for (const block of own) {
        if (block.injected) carry(`inject|${block.path}|${block.deviation ?? 'injection'}`, spec, block.key);
        for (const cls of block.perturbed === '' ? [] : block.perturbed.split(','))
          carry(`perturb|${block.path}|${cls}`, spec, block.key);
      }
    }
    const pairs = new Map<string, Array<[string, string]>>();
    for (const [index, one] of heads.entries())
      for (const two of heads.slice(index + 1)) {
        if (one.path !== two.path || one.walk !== two.walk) continue;
        const axes: string[] = [];
        const sameChannel = one.channel === two.channel;
        const samePersona = one.persona === two.persona;
        if (!sameChannel && samePersona && channels.has(one.channel) && channels.has(two.channel))
          axes.push('channel');
        if (!samePersona && sameChannel && personas.has(one.persona) && personas.has(two.persona))
          axes.push('persona');
        for (const axis of axes) {
          const key = `${one.path}|${axis}`;
          pairs.set(key, [...(pairs.get(key) ?? []), [one.spec, two.spec]]);
        }
      }
    for (const [obligation, holders] of carried) {
      if (holders.size !== 1) continue;
      const [spec, keys] = [...holders][0] as [string, Set<string>];
      if (obligation.startsWith('family|')) specs.add(spec);
      else for (const key of keys) blocks.add(key);
    }
    for (const list of pairs.values())
      for (const spec of new Set(list.flat())) if (list.every((pair) => pair.includes(spec))) specs.add(spec);
    return { blocks, specs };
  });
  return { ...held, declared };
}

const CHANNELS = ['chat', 'voice', 'sms', ''];
const PERSONAS = ['persona:terse', 'persona:chatty', 'persona:other', 'persona:terse,persona:chatty', ''];
const CLASSES = ['D2_goal_shift', 'D3_contradiction', 'D4_loose_confirmation'];

/** One block as the measured runs hold it, with the fields the oracle's holders read. */
function run(fields: Pick<BlockRun, 'key' | 'spec' | 'index'> & Partial<BlockRun>): BlockRun {
  const base = {
    path: 'p1',
    walk: 'w1',
    channel: 'chat',
    persona: 'persona:terse',
    family: '',
    variant: 0,
    of: 0,
    words: 'x',
    injected: false,
    perturbed: '',
  };
  return { ...base, ...fields } as unknown as BlockRun;
}

/** The blocks of a seeded suite. A spec-level field is the same on every block of its spec, as in the runs. */
function suiteFor(seed: number): BlockRun[] {
  const next = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const out: BlockRun[] = [];
  const count = 2 + Math.floor(next() * 7);
  for (let index = 0; index < count; index += 1) {
    const spec = `s${index}`;
    const ranged = next() < 0.3;
    const shared = {
      path: pick(['p1', 'p2']),
      walk: pick(['w1', 'w2', 'w3']),
      channel: pick(CHANNELS),
      persona: pick(PERSONAS),
      words: pick(['x', 'y']),
      ...(ranged ? { family: 'f1', variant: 1 + Math.floor(next() * 3), of: 2 } : {}),
    };
    const length = 1 + Math.floor(next() * 4);
    for (let at = 0; at < length; at += 1) {
      const injected = next() < 0.3;
      const named = injected && next() < 0.8;
      const reachedBy = new Set(next() < 0.5 ? [pick(CLASSES), pick(CLASSES)] : []);
      const entry = run({
        key: `${spec}#b${at}`,
        spec,
        index: at,
        ...shared,
        injected,
        ...(named ? { deviation: pick(CLASSES) } : {}),
        perturbed: [...reachedBy].sort().join(','),
      });
      out.push(entry);
    }
  }
  return out;
}

async function dataFor(blocks: BlockRun[]): Promise<SeedData> {
  const data = new SeedData(1, {}, async () => ({}) as never);
  await data.memoized('generated', async () => ({ hidden: HIDDEN }) as never);
  await data.memoized('runs', async () => ({ blocks, faults: [], errors: [] }) as never);
  return data;
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe('the oracle reads its obligation holders from the shared rulings', () => {
  it('gives the holders the code it replaced gave, on a seeded matrix of suites', async () => {
    let keptBlocks = 0;
    let keptSpecs = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const blocks = suiteFor(seed);
      const data = await dataFor(blocks);
      const now = await obligationHolders(data);
      const before = await legacyObligationHolders(data);
      const actual = { seed, blocks: sorted(now.blocks), specs: sorted(now.specs) };
      const legacy = { seed, blocks: sorted(before.blocks), specs: sorted(before.specs) };
      expect(actual).toEqual(legacy);
      for (const block of blocks) expect(now.declared(block)).toBe(before.declared(block));
      keptBlocks += before.blocks.size;
      keptSpecs += before.specs.size;
    }
    // The matrix reaches both kinds of answer: a comparison of two empty answers would pass for any code.
    expect(keptBlocks).toBeGreaterThan(0);
    expect(keptSpecs).toBeGreaterThan(0);
  });

  it('can tell: the same matrix gives another answer when a ruling changes', async () => {
    const anyHolder: Rulings = {
      ...RULINGS,
      obligations: RULINGS.obligations.map((kind) => {
        return kind.id === 'twin' ? kind : { ...kind, keptWhen: 'any-holder' as const };
      }),
    };
    let differing = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const blocks = suiteFor(seed);
      const before = await legacyObligationHolders(await dataFor(blocks));
      const changed = soleHolders(obligationSpecsOf(blocks), AXES, anyHolder);
      if (sorted(changed.blocks).join() !== sorted(before.blocks).join()) differing += 1;
    }
    expect(differing).toBeGreaterThan(0);
  });
});
