import { describe, expect, it } from 'vitest';
import { promptChangeManifest } from '../../src/radius/prompt';
import { radiusOf } from '../../src/radius/radius';
import type { Spec } from '../../src/schema/spec';

const anchors = [
  {
    entry: 'relations[0]',
    source: 'acme.txt',
    quote: 'Offer costs $40.',
    changes: [{ kind: 'rule', id: 'states@offer' }],
  },
];
const anchor = anchors[0] as (typeof anchors)[number];
const old = 'Acme policy\nOffer costs $40.\nAlways answer in English.';
const map = (text: string, entries = anchors) =>
  promptChangeManifest(old, text, entries, { from: 'v1', to: 'v2' });
const spec = {
  id: 'acme',
  version: '1',
  kind: 'conversation',
  metadata: { depends: {} },
  blocks: [
    { when: { user: 'price?' }, expect: { stage: 'offer', must: ['40'] } },
    { when: { user: 'hello' }, expect: { stage: 'closing', lang: 'en' } },
  ],
} as Spec;

describe('prompt quote mapping', () => {
  it('maps interior quote edits to its entry and F downstream blocks', () => {
    const result = map(old.replace('$40', '$45'));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ kind: 'rule', id: 'states@offer' });
    expect(result.changes[0]?.note).toContain('relations[0]');
    const report = radiusOf([{ spec, hash: 'h' }], result, { modes: ['T', 'F'] });
    expect(report.specs[0]?.blocks.map((b) => b.state.T)).toEqual(['direct', 'out']);
    expect(report.specs[0]?.blocks.map((b) => b.state.F)).toEqual(['direct', 'forward']);
    expect(map(old.replace('Offer costs $40.', '')).changes[0]?.global).toBe(true);
  });
  it('contains a planted language regression outside the anchor even when the price also changes', () => {
    const result = map(old.replace('$40', '$45').replace('English', 'French'));
    const report = radiusOf([{ spec, hash: 'h' }], result, { modes: ['T'] });
    expect(report.whole).not.toBeNull();
    expect(report.specs[0]?.blocks[1]?.state.T).toBe('direct');
    expect(result.changes[0]?.note).toContain('whole suite');
  });
  it('does not treat a new instruction at an anchor boundary as part of the anchor', () => {
    expect(
      map(old.replace('Offer costs $40.', 'Offer costs $40. Answer in French.')).changes[0]?.global,
    ).toBe(true);
  });
  it('falls back for stale, duplicated, empty, or unmapped anchors', () => {
    for (const quote of ['not present', '']) {
      expect(map(old.replace('$40', '$45'), [{ ...anchor, quote }]).changes[0]?.global).toBe(true);
    }
    expect(
      promptChangeManifest('price price', 'other price', [{ ...anchor, quote: 'price' }], {
        from: 'v1',
        to: 'v2',
      }).changes[0]?.global,
    ).toBe(true);
    expect(map(old.replace('$40', '$45'), [{ ...anchor, changes: [] }]).changes[0]?.global).toBe(true);
  });
  it('keeps a no-change version transition conservative and rejects overlapping anchors', () => {
    expect(map(old).changes[0]?.global).toBe(true);
    expect(
      map(old.replace('$40', '$45'), [
        ...anchors,
        { ...anchor, entry: 'dimensions[0]', changes: [{ kind: 'stage', id: 'offer' }] },
      ]).changes[0]?.global,
    ).toBe(true);
  });
});

it('reruns a planted regression in a separate cell that a price-only radius would carry', async () => {
  const { planRadiusCampaign } = await import('../../src/radius/carry');
  const { planCampaign } = await import('../../src/runner/campaign');
  const { runSpec } = await import('../../src/runner/run');
  const { contentHash } = await import('../../src/spec/hash');
  const { echoAdapter } = await import('../runner/support');
  const { createScriptedDriver } = await import('@agent-nexus/driftbench-users');
  const specs = spec.blocks.map((block, i) => ({
    spec: { ...spec, id: `acme-${i}`, blocks: [block] },
    hash: '',
  }));
  for (const entry of specs) entry.hash = contentHash(entry.spec);
  const target = { adapter: 'echo', variant: 'v1' };
  const adapter = echoAdapter();
  let calls = 0;
  adapter.send = async () => {
    calls++;
    return { text: 'bonjour', segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
  };
  const baseline = await Promise.all(
    specs.map((entry) =>
      runSpec(entry.spec, {
        adapter: echoAdapter(),
        driver: createScriptedDriver(),
        checks: [],
        target,
        mode: 'T',
        repeat: 0,
      }),
    ),
  );
  const cells = planCampaign(specs, [{ ...target, variant: 'v2' }], ['T'], 1).cells;
  const manifest = map(old.replace('$40', '$45').replace('English', 'French'));
  const plan = planRadiusCampaign(
    cells,
    radiusOf(specs, manifest, { modes: ['T'] }),
    manifest,
    { campaignId: 'acme-base', runs: baseline },
    { now: new Date() },
  );
  expect(plan.carried).toEqual([]);
  for (const cell of plan.fresh) {
    const entry = specs.find((entry) => entry.spec.id === cell.specId);
    if (!entry) throw new Error('missing spec');
    const result = await runSpec(entry.spec, {
      adapter,
      driver: createScriptedDriver(),
      target: cell.target,
      mode: 'T',
      repeat: 0,
      checks: [
        {
          name: 'language',
          applies: () => true,
          evaluate: (ctx) => [
            {
              id: 'language.en',
              kind: 'machine',
              name: 'language',
              gating: true,
              outcome: ctx.observed.text === 'bonjour' ? 'fail' : 'pass',
              evidence: 'planted language regression',
            },
          ],
        },
      ],
    });
    expect(result.blocks[0]?.pass).toBe(false);
  }
  expect(calls).toBe(2);
});
