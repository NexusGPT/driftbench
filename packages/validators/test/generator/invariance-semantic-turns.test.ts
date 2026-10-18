import { execFileSync } from 'node:child_process';
import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { blockOutcome, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import type { SeedData } from '../../src/ladders/generator/bank';
import { BASE_PATHS, heldFixed, pathOf, researchItems } from '../../src/ladders/generator/bank2';
import { createFollower } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, generation, runContext } from '../../src/ladders/generator/measure';
import { hiddenSeed } from '../../src/seeds';

const derived = hiddenSeed(process.cwd(), (root) =>
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const seeds = [...Array.from({ length: 20 }, (_, i) => i + 1), derived.seed];
const items = researchItems();
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing invariance fixture');
  return value;
}

// Auditor reproducer: a clean pair remains while a renamed, otherwise identical turn has a wrong Then.
function specimen(
  path: string,
  id: string,
  persona: string,
  channel = 'web',
  blockId = 'inspect-record',
): LoadedSpec {
  const parsed = validateSpec({
    id,
    title: `Path ${path} of cobalt: inspect a record`,
    kind: 'conversation',
    channel,
    tags: [`persona:${persona}`],
    blocks: [{ id: blockId, when: { user: 'Show the cobalt record' }, expect: { must: ['state: active'] } }],
    metadata: { generated: { cell: { 'audit_read.in.record': 'cobalt', 'audit_read.out.state': 'active' } } },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return { spec: parsed.spec, ok: true, warnings: [], path: `${id}.yaml`, hash: contentHash(parsed.spec) };
}
async function verdict(path: string, axis: string, complete: LoadedSpec[], seed = 1) {
  const data = { generated: async () => ({ hidden: hiddenSpec(seed), complete }) } as SeedData;
  return required(items.find((item) => item.id === `invariance.${path}.${axis}`)).check(data);
}
function pair(path: string, axis: string) {
  return [
    specimen(path, 'a', 'novice'),
    specimen(path, 'b', axis === 'persona' ? 'expert' : 'novice', axis === 'channel' ? 'messaging' : 'web'),
  ];
}

describe('invariance pairs use the stimulus, never arbitrary block ids', () => {
  for (const path of BASE_PATHS)
    for (const axis of ['persona', 'channel']) {
      it(`${path} ${axis}: renamed same-turn wrong Then fails alongside a clean pair`, async () => {
        const clean = [
          ...pair(path, axis),
          specimen(
            path,
            'c',
            axis === 'persona' ? 'auditor' : 'novice',
            axis === 'channel' ? 'email' : 'web',
            'inspect-alt',
          ),
        ];
        expect((await verdict(path, axis, clean)).pass).toBe(true);
        const fault = structuredClone(clean);
        required(required(fault[2]).spec.blocks[0]).expect = { must: ['state: suspended'] };
        expect((await verdict(path, axis, fault)).pass).toBe(false);
        expect((await verdict(path, axis, clean)).pass).toBe(true);
      });
      it(`${path} ${axis}: renamed pair alone still supplies required pair evidence`, async () => {
        const clean = pair(path, axis);
        required(required(clean[1]).spec.blocks[0]).id = 'arbitrary-label';
        expect((await verdict(path, axis, clean)).pass).toBe(true);
      });
      it(`${path} ${axis}: reused ids do not pair different stimuli or actual facts`, async () => {
        const clean = pair(path, axis);
        const other = specimen(path, 'c', 'auditor');
        required(other.spec.blocks[0]).when = { user: 'Show the amber record' };
        required(other.spec.blocks[0]).expect = { must: ['state: suspended'] };
        expect((await verdict(path, axis, [...clean, other])).pass).toBe(true);
        required(other.spec.blocks[0]).when = { user: 'Show the cobalt record' };
        other.spec.given = { world: { tools: { audit_read: { result: { state: 'suspended' } } } } };
        expect((await verdict(path, axis, [...clean, other])).pass).toBe(true);
      });
    }
  for (const seed of seeds)
    it(`seed ${seed}: approved persona wording and renamed blocks cannot hide a wrong expectation`, async () => {
      const hidden = hiddenSpec(seed);
      const personas = hidden.phrases.filter((phrase) => phrase.intent.kind === 'persona');
      const clean = pair(BASE_PATHS[0], 'persona');
      for (const [index, entry] of clean.entries()) {
        required(entry.spec.blocks[0]).when = { user: required(personas[index]).text };
        required(entry.spec.blocks[0]).id = `opaque-${index}-${seed}`;
      }
      expect((await verdict(BASE_PATHS[0], 'persona', clean, seed)).pass).toBe(true);
      required(required(clean[1]).spec.blocks[0]).expect = { must: ['state: suspended'] };
      expect((await verdict(BASE_PATHS[0], 'persona', clean, seed)).pass).toBe(false);
    });
});

describe('semantic turn keys preserve every non-context stimulus', () => {
  const hidden = hiddenSpec(1);
  const key = (entry: LoadedSpec) => heldFixed(entry.spec, hidden);
  it('a wrong expected stage cannot split a pair', async () => {
    const clean = pair(BASE_PATHS[0], 'persona');
    required(required(clean[0]).spec.blocks[0]).expect = { stage: hidden.start };
    required(required(clean[1]).spec.blocks[0]).expect = { stage: hidden.final };
    expect(key(required(clean[0]))).toBe(key(required(clean[1])));
    expect((await verdict(BASE_PATHS[0], 'persona', clean)).pass).toBe(false);
  });
  it('stage transitions are read from approved phrases, in order, with slot bindings intact', () => {
    const transitions = hidden.phrases.filter((phrase) => phrase.intent.kind === 'transition');
    const first = required(transitions[0]);
    const second = required(
      transitions.find((phrase) => JSON.stringify(phrase.intent) !== JSON.stringify(first.intent)),
    );
    const make = (texts: string[]) => {
      const entry = specimen(BASE_PATHS[0], 'a', 'novice');
      entry.spec.blocks = texts.map((text, index) => ({
        id: `same-${index}`,
        when: { user: text },
        expect: { stage: hidden.final },
      }));
      return entry;
    };
    const fill = (text: string, value: string) => text.replace(/\{[a-z][a-z0-9_]*\}/g, value);
    const forward = make([fill(first.text, 'cobalt'), fill(second.text, 'cobalt')]);
    const reversed = make([fill(second.text, 'cobalt'), fill(first.text, 'cobalt')]);
    expect(key(forward)).not.toBe(key(reversed));
    const slotted = required(transitions.find((phrase) => phrase.text.includes('{')));
    expect(key(make([fill(slotted.text, 'cobalt')]))).not.toBe(key(make([fill(slotted.text, 'amber')])));
    const custom = structuredClone(hidden);
    const paraphrase = { ...first, text: `Alternative wording: ${first.text}` };
    custom.phrases.push(paraphrase);
    expect(heldFixed(make([fill(first.text, 'cobalt')]).spec, custom)).toBe(
      heldFixed(make([fill(paraphrase.text, 'cobalt')]).spec, custom),
    );
  });
  it('burst boundaries and message order are part of the stimulus', () => {
    const left = specimen(BASE_PATHS[0], 'a', 'novice');
    const right = structuredClone(left);
    required(left.spec.blocks[0]).when = { burst: ['first', 'second'] };
    required(right.spec.blocks[0]).when = { user: 'first\nsecond' };
    expect(key(left)).not.toBe(key(right));
    required(right.spec.blocks[0]).when = { burst: ['second', 'first'] };
    expect(key(left)).not.toBe(key(right));
  });
  it('Given facts compare canonically; a changed prefix or per-turn world still separates turns', () => {
    const left = specimen(BASE_PATHS[0], 'a', 'novice');
    const right = structuredClone(left);
    left.spec.given = { ledger: { state: 'active', record: 'cobalt' } };
    right.spec.given = { ledger: { record: 'cobalt', state: 'active' } };
    expect(key(left)).toBe(key(right));
    required(right.spec.blocks[0]).given = { prefix: [{ role: 'user', content: 'prior turn' }] };
    expect(key(left)).not.toBe(key(right));
    required(right.spec.blocks[0]).given = {
      world: { workspace: { files: { 'data.txt': 'different facts' } } },
    };
    expect(key(left)).not.toBe(key(right));
  });
  it('unknown text containing a persona label is never stripped or guessed equivalent', () => {
    const left = specimen(BASE_PATHS[0], 'a', 'novice');
    const right = structuredClone(left);
    required(left.spec.blocks[0]).when = { user: 'Delete novice records' };
    required(right.spec.blocks[0]).when = { user: 'Delete expert records' };
    expect(key(left)).not.toBe(key(right));
  });
});

describe('planted true pairs on fresh maps beyond the visible seeds', () => {
  for (const seed of [1009, 2027, 4093, 8191])
    for (const path of BASE_PATHS)
      for (const axis of ['persona', 'channel']) {
        it(`seed ${seed} ${path} ${axis}: reference passes; wrong Then fails despite a clean pair and opaque ids`, async () => {
          const hidden = hiddenSpec(seed);
          const phrases = hidden.phrases.filter((phrase) => phrase.intent.kind === 'persona');
          const clean = [
            specimen(path, 'a', 'novice'),
            specimen(
              path,
              'b',
              axis === 'persona' ? 'expert' : 'novice',
              axis === 'channel' ? 'messaging' : 'web',
            ),
            specimen(
              path,
              'c',
              axis === 'persona' ? 'auditor' : 'novice',
              axis === 'channel' ? 'email' : 'web',
            ),
          ];
          for (const [index, entry] of clean.entries()) {
            const phrase = required(phrases[axis === 'persona' ? index % phrases.length : 0]);
            required(entry.spec.blocks[0]).id = `label-${seed}-${index}`;
            required(entry.spec.blocks[0]).when = { user: phrase.text };
            required(entry.spec.blocks[0]).expect = { stage: hidden.start, must: ['Welcome'] };
            const run = await runOnce(
              entry.spec,
              followerAdapter(createFollower(hidden)),
              seed,
              runContext(),
            );
            expect(blockOutcome(run, 0)).toBe('pass');
          }
          expect((await verdict(path, axis, clean, seed)).pass).toBe(true);
          const fault = structuredClone(clean);
          required(required(fault[2]).spec.blocks[0]).expect = { stage: hidden.final, must: ['Farewell'] };
          expect((await verdict(path, axis, fault, seed)).pass).toBe(false);
          expect((await verdict(path, axis, clean, seed)).pass).toBe(true);
        });
      }
});

describe('fresh generated walks retain invariance fault detection', () => {
  for (const seed of [1009, 2027, 4093, 8191])
    it(`seed ${seed}: real generated walks reject a renamed wrong Then on every path and axis`, async () => {
      const generated = await generation(seed);
      for (const path of BASE_PATHS) {
        const original = required(
          generated.complete.find(
            ({ spec }) =>
              pathOf(spec) === path && !spec.blocks.some((block) => block.when && 'injection' in block.when),
          ),
        );
        const reference = await runOnce(
          original.spec,
          followerAdapter(createFollower(generated.hidden)),
          seed,
          runContext(),
        );
        for (let index = 0; index < original.spec.blocks.length; index += 1)
          expect(blockOutcome(reference, index)).toBe('pass');
        for (const axis of ['persona', 'channel']) {
          const clean = [0, 1, 2].map((variant) => {
            const entry = structuredClone(original);
            entry.spec.id = `walk-${variant}`;
            entry.spec.tags = [
              ...(entry.spec.tags ?? []).filter((tag) => !tag.startsWith('persona:')),
              `persona:${axis === 'persona' ? variant : 0}`,
            ];
            entry.spec.channel = axis === 'channel' ? `channel-${variant}` : 'web';
            for (const [index, block] of entry.spec.blocks.entries()) block.id = `opaque-${variant}-${index}`;
            return entry;
          });
          expect((await verdict(path, axis, clean, seed)).pass).toBe(true);
          const fault = structuredClone(clean);
          required(required(fault[2]).spec.blocks.at(-1)).expect = { must: ['a planted wrong expectation'] };
          expect((await verdict(path, axis, fault, seed)).pass).toBe(false);
          expect((await verdict(path, axis, clean, seed)).pass).toBe(true);
        }
      }
    }, 300_000);
});
