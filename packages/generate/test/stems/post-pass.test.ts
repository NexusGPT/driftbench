import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BlockSpec,
  type LoadResult,
  loadSpecs,
  resolveSpecParents,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { STEM_MAP_HEADER, stemMapCsv, stemPass } from '../../src/stems/post-pass';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function spec(raw: Record<string, unknown>): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

/** The specs written back out by the loader, as one would load the folder. */
function writtenOut(specs: readonly Spec[]): Spec[] {
  const results: LoadResult[] = specs.map((entry) => validateSpec(entry, `${entry.id}.yaml`));
  return resolveSpecParents(results, validateSpec).map((result) => {
    if (!result.ok) throw new Error(`${result.path}: ${JSON.stringify(result.errors)}`);
    return result.spec;
  });
}

const content = (blocks: readonly BlockSpec[]) => blocks.map(({ id: _id, ...rest }) => rest);

/** What a spec runs: its blocks without ids, perturbations, end verdict, end state, criteria by name. */
function meaning(entry: Spec) {
  return {
    blocks: content(entry.blocks),
    perturbations: entry.perturbations,
    end: entry.end,
    end_state: entry.end_state,
    criteria: Object.fromEntries((entry.criteria ?? []).map((criterion) => [criterion.name, criterion])),
  };
}

function block(user: string, extra: Record<string, unknown> = {}) {
  return { id: `b-${user}`, user, expect: { must: [user] }, ...extra };
}

describe('the stem post-pass', () => {
  const specs = [
    spec({ id: 'a', blocks: [block('hi'), block('pick'), block('pay')] }),
    spec({ id: 'b', blocks: [block('hi'), block('pick'), block('cancel')] }),
    spec({
      id: 'c',
      blocks: [block('hi'), block('help')],
      perturbations: [{ id: 'aside', class: 'D1_off_topic', inject_at: 1, user: 'weather' }],
    }),
    spec({ id: 'd', channel: 'email', blocks: [block('hi'), block('pick')] }),
    spec({ id: 'e', blocks: [block('hi'), block('pick'), block('pay')], end_state: 'none' }),
  ];
  const pass = stemPass(specs);

  it('writes each shared opening once, and each spec starts from its stem on block 0', () => {
    expect(pass.stems.map((stem) => stem.blocks.map((entry) => [entry.id, entry.parent]))).toEqual([
      [['b-hi', undefined]],
      [['b-pick', `${pass.stems[0]?.id}#b-hi`]],
    ]);
    expect(pass.stems.map((stem) => stem.metadata?.stem)).toEqual([
      { specs: ['a', 'b', 'c', 'e'] },
      { specs: ['a', 'b', 'e'] },
    ]);
    const by = new Map(pass.specs.map((entry) => [entry.id, entry]));
    expect(by.get('a')?.blocks.map((entry) => [entry.id, entry.parent])).toEqual([
      ['b-pay', `${pass.stems[1]?.id}#b-pick`],
    ]);
    expect(by.get('c')?.blocks.map((entry) => entry.parent)).toEqual([`${pass.stems[0]?.id}#b-hi`]);
    // c's perturbation sat before its block 1: it now sits before its block 0.
    expect(by.get('c')?.perturbations?.[0]?.inject_at).toBe(0);
    // d is of another channel and shares nothing.
    expect(by.get('d')).toBe(specs[3]);
    expect(by.get('a')?.metadata?.generated).toEqual({
      parent: { stem: pass.stems[1]?.id, block: 'b-pick', replaced: 2 },
    });
    // Shared: hi by a, b, c, e (4 times, written once), pick by a, b, e (3 times, written once).
    expect(pass.saved).toBe(3 + 2);
  });

  it('keeps every spec meaning what it meant once the loader writes the stems back out', () => {
    const out = writtenOut([...pass.stems, ...pass.specs]);
    for (const original of specs) {
      const back = out.find((entry) => entry.id === original.id) as Spec;
      expect(meaning(back), original.id).toEqual(meaning(original));
    }
  });

  it('maps every block of a spec as generated to its new spec and block', () => {
    expect(pass.rows.filter((row) => row.oldSpec === 'a')).toEqual([
      {
        oldSpec: 'a',
        oldIndex: 0,
        oldBlock: 'b-hi',
        newSpec: pass.stems[0]?.id,
        newBlock: 'b-hi',
        sharedBy: 4,
      },
      {
        oldSpec: 'a',
        oldIndex: 1,
        oldBlock: 'b-pick',
        newSpec: pass.stems[1]?.id,
        newBlock: 'b-pick',
        sharedBy: 3,
      },
      { oldSpec: 'a', oldIndex: 2, oldBlock: 'b-pay', newSpec: 'a', newBlock: 'b-pay', sharedBy: 1 },
    ]);
    expect(pass.rows).toHaveLength(specs.reduce((sum, entry) => sum + entry.blocks.length, 0));
    const csv = stemMapCsv(pass.rows).split('\n');
    expect(csv[0]).toBe(STEM_MAP_HEADER);
    expect(csv[3]).toBe('a,2,b-pay,a,b-pay,1');
  });

  it('never shares a last block, a block at or after a perturbation, or a block whose criteria differ', () => {
    const twins = stemPass([
      spec({ id: 'x', blocks: [block('hi'), block('pick')] }),
      spec({ id: 'y', blocks: [block('hi'), block('pick')] }),
    ]);
    // Both share only hi: pick is the last block of each, which stays its own.
    expect(twins.saved).toBe(1);
    const criteria = (rubric: string) => [{ name: 'polite', rubric }];
    const rubrics = stemPass([
      spec({
        id: 'x',
        criteria: criteria('Polite'),
        blocks: [block('hi', { expect: { must: ['hi'], criteria: ['polite'] } }), block('a')],
      }),
      spec({
        id: 'y',
        criteria: criteria('Very polite'),
        blocks: [block('hi', { expect: { must: ['hi'], criteria: ['polite'] } }), block('b')],
      }),
    ]);
    expect(rubrics.saved).toBe(0);
    expect(rubrics.stems).toEqual([]);
  });

  it('on the generated Acme suite, every spec means what it meant, and the stems save blocks', async () => {
    // The committed suite holds stems; loaded as a folder, every spec is written back out whole, as generated.
    const loaded = await loadSpecs([join(ROOT, 'examples/acme/generated/specs')]);
    expect(loaded.filter((entry) => !entry.ok)).toEqual([]);
    const originals = loaded
      .flatMap((entry) => (entry.ok ? [entry.spec] : []))
      .filter((entry) => !entry.id.startsWith('stem-'));
    const acme = stemPass(originals);
    const out = writtenOut([...acme.stems, ...acme.specs]);
    for (const original of originals) {
      const back = out.find((entry) => entry.id === original.id) as Spec;
      expect(meaning(back), original.id).toEqual(meaning(original));
    }
    expect(acme.saved).toBeGreaterThan(0);
    expect({ specs: originals.length, stems: acme.stems.length, saved: acme.saved }).toMatchInlineSnapshot(`
      {
        "saved": 287,
        "specs": 435,
        "stems": 99,
      }
    `);
  }, 120_000);
});

describe('the stem post-pass and the block links', () => {
  const link = (to: string, at: string | number) => ({
    block: at,
    to: { kind: 'rule', rule: to },
    relation: 'verifies',
    status: 'declared',
    created_by: 'generator',
    at_version: 'v1',
  });
  const linked = (id: string, last: string) =>
    spec({
      id,
      blocks: [block('hi'), block('pick'), block(last)],
      metadata: { links: [link('r1', 'b-hi'), link('r2', 'b-pick'), link('r3', `b-${last}`)] },
    });
  const pass = stemPass([linked('a', 'pay'), linked('b', 'cancel')]);

  it('names a linked block that moved into a stem as the loader writes it out, and keeps the others', () => {
    const child = pass.specs.find((entry) => entry.id === 'a');
    const stem = pass.stems.at(-1)?.id;
    const first = pass.stems[0]?.id;
    expect(((child?.metadata?.links ?? []) as { block: string }[]).map((entry) => entry.block)).toEqual([
      `${first}#b-hi`,
      `${stem}#b-pick`,
      'b-pay',
    ]);
  });

  it('writes out as a spec that holds every linked block', () => {
    const [a] = writtenOut([...pass.stems, ...pass.specs]).filter((entry) => entry.id === 'a');
    const ids = new Set(a?.blocks.map((entry) => entry.id));
    for (const entry of (a?.metadata?.links ?? []) as { block: string }[])
      expect(ids.has(entry.block)).toBe(true);
  });
});
