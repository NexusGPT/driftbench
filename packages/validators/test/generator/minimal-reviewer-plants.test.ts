import { describe, expect, it } from 'vitest';
import {
  bankItems,
  removable,
  SeedData,
  sameTestKey,
  unprotectedMembers,
} from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import type { HiddenSpec } from '../../src/ladders/generator/hidden';
import { type BlockRun, type Generation, runAll } from '../../src/ladders/generator/measure';

const fake = () =>
  ({
    generated: async () => ({
      hidden: { channels: ['web', 'messaging'], personas: [{ id: 'one' }, { id: 'two' }] },
    }),
  }) as unknown as SeedData;
const b = (id: string, extra: Partial<BlockRun> = {}) =>
  ({
    key: id,
    spec: id,
    path: 'parcel',
    walk: 'walk-A',
    channel: 'web',
    persona: 'persona:one',
    perturbed: '',
    ...extra,
  }) as BlockRun;
const names = async (data: SeedData, group: BlockRun[]) =>
  (await unprotectedMembers(data, group)).map((b) => b.spec);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

describe('independent item-level planted reducers', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = generated.complete.find((e) => e.spec.id === 'gen-cover-004')!;
  if (!cover) throw Error('missing cover control');
  const channel = generated.hidden.channels.find((c) => c !== cover.spec.channel)!;
  const persona = generated.hidden.personas.find((p) => !cover.spec.tags?.includes(`persona:${p.id}`))!;
  const options = {
    faults: (hidden: HiddenSpec) =>
      faultFamily(
        hidden,
        FAULT_CLASSES.filter((c) => c.id === 'X1.case'),
      ),
    cheaters: [],
    k: 1,
  };
  const copy = (
    id: string,
    otherWorld = false,
    otherChannel = false,
    badChannel = false,
    otherPersona = false,
  ) => {
    const entry = structuredClone(cover);
    entry.spec.id = id;
    if (otherChannel) entry.spec.channel = channel;
    if (badChannel) entry.spec.channel = 'review-undeclared';
    if (otherPersona)
      entry.spec.tags = entry.spec.tags?.map((tag) =>
        tag.startsWith('persona:') ? `persona:${persona.id}` : tag,
      );
    if (otherWorld) {
      const answer = entry.spec.given?.world?.tools?.lookup_record;
      if (!answer) throw Error('missing lookup fixture');
      entry.spec.given = {
        ...entry.spec.given,
        world: {
          tools: {
            lookup_record: {
              result: { ...(answer.result as object), validatorsReviewExtra: 'other-answer' },
            },
          },
        },
      };
    }
    return entry;
  };
  const suite = async (complete: Generation['complete']) => {
    const data = new SeedData(1, options, async () => ({}) as never);
    const mini = { ...generated, complete };
    await data.memoized('generated', async () => mini);
    await data.memoized('runs', async () => runAll(mini, options));
    return data;
  };
  const last = (blocks: BlockRun[], id: string) => {
    const found = blocks.filter((b) => b.spec === id && b.fields.length > 0).at(-1);
    if (!found) throw Error('missing measured last block');
    return found;
  };
  const item = bankItems().find((i) => i.id === 'minimal.X1.case')!;
  it('flags a second removable channel pair on the same path in another tool-answer group', async () => {
    const a = copy('review-A'),
      at = copy('review-A-channel', false, true),
      b = copy('review-B', true),
      bt = copy('review-B-channel', true, true);
    const data = await suite([a, at, b, bt]);
    const runs = await data.runs();
    const first = last(runs.blocks, a.spec.id),
      second = last(runs.blocks, bt.spec.id);
    expect(first.path).toBe(second.path);
    expect(sameTestKey(first)).not.toBe(sameTestKey(second));
    const out = await item.check(data);
    console.log('item cross-group second pair', JSON.stringify(out));
    const candidates = [];
    for (const block of runs.blocks) {
      const canRemove = await removable(data, block);
      candidates.push({
        key: block.key,
        spec: block.spec,
        index: block.index,
        path: block.path,
        channel: block.channel,
        walk: block.walk,
        from: block.from,
        ref: block.reference,
        faults: block.faults,
        canRemove,
        lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
      });
    }
    console.log('cross-group real candidates', JSON.stringify(candidates));
    expect(runs.errors).toEqual([]);
    expect(
      runs.blocks.every((b) => b.reference.every((out) => out === 'pass')),
      'reference controls',
    ).toBe(true);
    expect(
      candidates.some((b) => b.spec === bt.spec.id && b.canRemove),
      'a block in the second channel twin really can be ablated',
    ).toBe(true);
    expect(out.pass, out.detail).toBe(false);
  }, 600000);
  it('flags an otherwise removable copy with an undeclared channel even when its persona is declared', async () => {
    const a = copy('review-base'),
      bad = copy('review-undeclared-channel', false, false, true, true);
    const witness = copy('review-persona-witness', true, false, false, true);
    const data = await suite([a, bad, witness]);
    const runs = await data.runs();
    const candidate = last(runs.blocks, bad.spec.id);
    const out = await item.check(data);
    console.log('item mixed undeclared channel', JSON.stringify(out));
    const candidates = [];
    for (const block of runs.blocks.filter((b) => b.spec === bad.spec.id)) {
      const canRemove = await removable(data, block);
      candidates.push({
        key: block.key,
        index: block.index,
        ref: block.reference,
        canRemove,
        lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
      });
    }
    console.log('mixed undeclared real candidates', JSON.stringify(candidates));
    expect(
      candidates.some((b) => b.canRemove),
      'an actual removable member',
    ).toBe(true);
    expect(out.pass, out.detail).toBe(false);
  }, 600000);
  for (const missing of ['channel', 'persona'] as const)
    it(`flags a removable copy with missing ${missing}, which is not a declared twin value`, async () => {
      const a = copy('review-complete-context'),
        bad = copy('review-missing-' + missing);
      if (missing === 'channel') delete bad.spec.channel;
      else bad.spec.tags = bad.spec.tags?.filter((tag) => !tag.startsWith('persona:'));
      const data = await suite([a, bad]);
      const runs = await data.runs();
      const out = await item.check(data);
      const candidates = [];
      for (const block of runs.blocks.filter((b) => b.spec === bad.spec.id)) {
        const canRemove = await removable(data, block);
        candidates.push({
          key: block.key,
          ref: block.reference,
          channel: block.channel,
          persona: block.persona,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      console.log('missing context actual item', JSON.stringify({ missing, out, candidates }));
      expect(runs.errors).toEqual([]);
      expect(
        runs.blocks.every((b) => b.reference.every((x) => x === 'pass')),
        'reference controls',
      ).toBe(true);
      expect(
        candidates.some((b) => b.canRemove),
        'an actual removable block',
      ).toBe(true);
      expect(out.pass, out.detail).toBe(false);
    }, 600000);

  it('flags an extra exact copy of an existing variant of the first genuine metamorphic family', async () => {
    const families = new Map<string, Generation['complete']>();
    for (const entry of generated.complete) {
      const meta = (entry.spec.metadata?.generated as any)?.metamorphic;
      if (meta?.family) {
        const own = families.get(meta.family) ?? [];
        own.push(entry);
        families.set(meta.family, own);
      }
    }
    let chosen = false;
    for (const members of [...families.values()].filter((m) => m.length >= 2).slice(0, 12)) {
      const extra = structuredClone(members[0]!);
      extra.spec.id = 'review-extra-same-family-variant';
      const data = await suite([...members, extra]);
      const runs = await data.runs();
      if (runs.errors.length || !runs.blocks.every((b) => b.reference.every((x) => x === 'pass'))) continue;
      const out = await item.check(data);
      const candidates = [];
      for (const block of runs.blocks.filter(
        (b) => b.spec === extra.spec.id && Object.values(b.faults).some((x) => x === 'fail'),
      )) {
        const causal = runs.faults.some(
          (f) =>
            block.faults[f.fault.def.id] === 'fail' &&
            f.firstChange[block.spec] !== undefined &&
            block.index >= f.firstChange[block.spec]!,
        );
        if (!causal) continue;
        const canRemove = await removable(data, block);
        candidates.push({
          key: block.key,
          family: block.family,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      if (!candidates.some((b) => b.canRemove)) continue;
      chosen = true;
      console.log(
        'exact duplicated family variant',
        JSON.stringify({
          members: members.map((m) => ({
            id: m.spec.id,
            meta: (m.spec.metadata?.generated as any)?.metamorphic,
          })),
          extra: { id: extra.spec.id, meta: (extra.spec.metadata?.generated as any)?.metamorphic },
          out,
          candidates,
          referenceBlocks: runs.blocks.length,
        }),
      );
      expect(out.pass, out.detail).toBe(false);
      break;
    }
    expect(chosen, 'a reference-correct genuine family with a removable repeated variant').toBe(true);
  }, 600000);
  it('refuses to protect a clone claiming a variant outside its declared family size', async () => {
    const families = new Map<string, Generation['complete']>();
    for (const entry of generated.complete) {
      const meta = (entry.spec.metadata?.generated as any)?.metamorphic;
      if (meta?.family) {
        const own = families.get(meta.family) ?? [];
        own.push(entry);
        families.set(meta.family, own);
      }
    }
    let chosen = false;
    for (const members of [...families.values()].filter((m) => m.length >= 2).slice(0, 12)) {
      const extra = structuredClone(members[0]!);
      extra.spec.id = 'review-extra-forged-variant';
      const meta = (required(extra.spec.metadata?.generated) as any).metamorphic;
      meta.variant = meta.of + 1;
      const data = await suite([...members, extra]);
      const runs = await data.runs();
      if (runs.errors.length || !runs.blocks.every((b) => b.reference.every((x) => x === 'pass'))) continue;
      const out = await item.check(data);
      const candidates = [];
      for (const block of runs.blocks.filter(
        (b) => b.spec === extra.spec.id && Object.values(b.faults).some((x) => x === 'fail'),
      )) {
        const causal = runs.faults.some(
          (f) =>
            block.faults[f.fault.def.id] === 'fail' &&
            f.firstChange[block.spec] !== undefined &&
            block.index >= f.firstChange[block.spec]!,
        );
        if (!causal) continue;
        const canRemove = await removable(data, block);
        candidates.push({
          key: block.key,
          family: block.family,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      if (!candidates.some((b) => b.canRemove)) continue;
      chosen = true;
      console.log(
        'exact duplicated family variant',
        JSON.stringify({
          members: members.map((m) => ({
            id: m.spec.id,
            meta: (m.spec.metadata?.generated as any)?.metamorphic,
          })),
          extra: { id: extra.spec.id, meta: (extra.spec.metadata?.generated as any)?.metamorphic },
          out,
          candidates,
          referenceBlocks: runs.blocks.length,
        }),
      );
      expect(out.pass, out.detail).toBe(false);
      break;
    }
    expect(chosen, 'a reference-correct genuine family with a removable repeated variant').toBe(true);
  }, 600000);
}, 600000);
