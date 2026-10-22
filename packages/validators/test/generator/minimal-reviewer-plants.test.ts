import { canonicalGiven, validateSpec } from '@agent-nexus/driftbench-core';
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
import { type BlockRun, type Generation, runAll, wordsOf } from '../../src/ladders/generator/measure';

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
          words: block.words,
          walk: block.walk,
          variant: block.variant,
          of: block.of,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      if (!candidates.some((b) => b.canRemove)) continue;
      chosen = true;
      console.log(
        'duplicate variant evidence',
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
  it('does not treat an explicitly empty block Given as a new metamorphic wording', async () => {
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
      extra.spec.id = 'review-extra-empty-given';
      const blank = extra.spec.blocks.find((block) => block.given === undefined);
      if (!blank) continue;
      blank.given = {};
      for (let at = 0; at < extra.spec.blocks.length; at++)
        expect(canonicalGiven(extra.spec, at)).toEqual(canonicalGiven(members[0]!.spec, at));
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
          words: block.words,
          walk: block.walk,
          variant: block.variant,
          of: block.of,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      if (!candidates.some((b) => b.canRemove)) continue;
      chosen = true;
      console.log(
        'duplicate variant evidence',
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
      const meta = (extra.spec.metadata as any).generated.metamorphic;
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
          words: block.words,
          walk: block.walk,
          variant: block.variant,
          of: block.of,
          canRemove,
          lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
        });
      }
      if (!candidates.some((b) => b.canRemove)) continue;
      chosen = true;
      console.log(
        'duplicate variant evidence',
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
  it('keeps no-op state representation and turn whitespace out of the words key', () => {
    const source = generated.complete.find((e) => (e.spec.metadata?.generated as any)?.metamorphic)!;
    const base = wordsOf(source.spec);
    const copy = structuredClone(source.spec);
    for (const block of copy.blocks) {
      if (!block.given) block.given = {};
      if (block.when && 'user' in block.when)
        block.when = { ...block.when, user: '  ' + block.when.user.replace(/ /g, '   ') + ' \n' };
    }
    expect(validateSpec(copy).ok).toBe(true);
    expect(wordsOf(copy)).toBe(base);
  });
  it('preserves real turn and effective Given-state changes in the words key', () => {
    const source = generated.complete.find((e) => (e.spec.metadata?.generated as any)?.metamorphic)!;
    const base = wordsOf(source.spec);
    const turn = structuredClone(source.spec);
    turn.blocks[0]!.when = { user: 'A different fictional request.' };
    expect(wordsOf(turn)).not.toBe(base);
    const given = structuredClone(source.spec);
    given.blocks[0]!.given = { ...given.blocks[0]!.given, ledger: { review_fact: 'a real new fact' } };
    expect(wordsOf(given)).not.toBe(base);
  });
  it('keeps distinct prefix messages as distinct declared metamorphic content', async () => {
    const source = generated.complete.find((e) => (e.spec.metadata?.generated as any)?.metamorphic)!;
    const make = (id: string, variant: number, text: string) => {
      const e = structuredClone(source);
      e.spec.id = id;
      const meta = (e.spec.metadata as any).generated.metamorphic;
      meta.variant = variant;
      meta.of = 2;
      e.spec.blocks[0]!.given = { ...e.spec.blocks[0]!.given, prefix: [{ role: 'user', content: text }] };
      return e;
    };
    const a = make('review-prefix-one', 1, 'The parcel request arrived before noon.');
    const b = make('review-prefix-two', 2, 'The parcel request arrived after lunch.');
    expect(validateSpec(a.spec).ok).toBe(true);
    expect(validateSpec(b.spec).ok).toBe(true);
    expect(canonicalGiven(a.spec, 0).prefix).not.toEqual(canonicalGiven(b.spec, 0).prefix);
    expect(canonicalGiven(a.spec, 0).state).toEqual(canonicalGiven(b.spec, 0).state);
    const data = await suite([a, b]);
    const runs = await data.runs();
    expect(runs.errors).toEqual([]);
    expect(runs.blocks.every((block) => block.reference.every((x) => x === 'pass'))).toBe(true);
    const out = await item.check(data);
    const candidates = [];
    for (const block of runs.blocks.filter((x) => x.spec === b.spec.id)) {
      const canRemove = await removable(data, block);
      candidates.push({
        key: block.key,
        words: block.words,
        walk: block.walk,
        variant: block.variant,
        of: block.of,
        canRemove,
        lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
      });
    }
    console.log(
      'distinct prefix actual item',
      JSON.stringify({
        aWords: wordsOf(a.spec),
        bWords: wordsOf(b.spec),
        aPrefix: canonicalGiven(a.spec, 0).prefix,
        bPrefix: canonicalGiven(b.spec, 0).prefix,
        out,
        candidates,
        referenceBlocks: runs.blocks.length,
      }),
    );
    expect(wordsOf(a.spec), 'different effective prefix messages are real Given content').not.toBe(
      wordsOf(b.spec),
    );
    expect(out.pass, out.detail).toBe(true);
  }, 600000);

  it.each(['empty-world', 'repeated-world'] as const)(
    'rejects a clone whose own Given adds a no-op %s',
    async (kind) => {
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
        const original = members[0]!;
        const extra = structuredClone(original);
        extra.spec.id = 'review-extra-' + kind;
        const at = extra.spec.blocks.findIndex((b) => b.given === undefined);
        if (at < 0) continue;
        const tools = canonicalGiven(original.spec, at).state.world.tools;
        if (kind === 'repeated-world' && tools === undefined) continue;
        extra.spec.blocks[at]!.given =
          kind === 'empty-world' ? { world: {} } : { world: { tools: structuredClone(tools!) } };
        expect(validateSpec(extra.spec).ok).toBe(true);
        for (let index = 0; index < extra.spec.blocks.length; index++)
          expect(canonicalGiven(extra.spec, index)).toEqual(canonicalGiven(original.spec, index));
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
            words: block.words,
            walk: block.walk,
            variant: block.variant,
            of: block.of,
            canRemove,
            lost: await data.memoized(`minimality:lost:${block.key}`, async () => ['not-reached']),
          });
        }
        if (!candidates.some((b) => b.canRemove)) continue;
        chosen = true;
        console.log(
          'no-op own Given clone',
          JSON.stringify({
            kind,
            changedAt: at,
            originalWords: wordsOf(original.spec),
            extraWords: wordsOf(extra.spec),
            ownGiven: extra.spec.blocks[at]!.given,
            originalMeta: (original.spec.metadata as any).generated.metamorphic,
            extraMeta: (extra.spec.metadata as any).generated.metamorphic,
            out,
            candidates,
            referenceBlocks: runs.blocks.length,
          }),
        );
        expect(out.pass, out.detail).toBe(false);
        break;
      }
      expect(chosen, 'a valid reference-correct genuine family and a removable causal clone').toBe(true);
    },
    600000,
  );
}, 600000);
