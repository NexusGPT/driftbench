import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { gateFiles, renderFunnel } from '../../src/gate';
import { candidate, gate, makeSpec, OPTIONS, orderBlock } from './support';

const STAGES = ['start', 'ordered'];

function mixed() {
  return makeSpec({
    id: 'mixed',
    stages: STAGES,
    criteria: [{ name: 'polite', rubric: 'Is the reply polite?' }],
    rules: { forbidden_tools: ['refund.issue'] },
    blocks: [
      { id: 'greet', when: { user: 'hello' }, expect: { stage: 'start', criteria: ['polite'] } },
      orderBlock('order'),
    ],
  });
}

describe('gateFiles', () => {
  it('writes an accepted block whole, and keeps only the When and the criteria of a rejected one', async () => {
    const spec = mixed();
    const result = await gate([spec], { options: { holdoutShare: 0 } });
    expect(result.blocks.map((record) => record.status)).toEqual(['rejected', 'accepted']);
    const files = gateFiles(result, [candidate(spec, 'conversations/mixed.yaml')], {
      source: 'candidates',
      references: ['function:shop'],
      options: { ...OPTIONS, holdoutShare: 0 },
    });
    const written = files.find((file) => file.path === 'specs/conversations/mixed.yaml');
    if (!written) throw new Error('the gated spec was not written');
    expect(written.text.startsWith('# Gated by driftbench gate from conversations/mixed.yaml.')).toBe(true);
    const loaded = parseSpecText(written.text, 'yaml');
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    expect(loaded.spec.blocks[0]).toEqual({
      id: 'greet',
      when: { user: 'hello' },
      expect: { criteria: ['polite'] },
    });
    expect(loaded.spec.blocks[1]).toEqual(orderBlock('order'));
    expect(loaded.spec.rules).toBeUndefined();
    const gateMeta = (loaded.spec.metadata as { gate: { dropped: string[]; blocks: unknown[] } }).gate;
    expect(gateMeta.dropped).toEqual(['greet: stage', 'rules: a block they apply to was rejected']);
    expect(gateMeta.blocks).toHaveLength(2);
  });

  it('writes no spec without an accepted block, and seals holdout specs with their hash', async () => {
    const judged = makeSpec({
      id: 'judged',
      criteria: [{ name: 'polite', rubric: 'Polite?' }],
      blocks: [{ when: { user: 'hello' }, expect: { criteria: ['polite'] } }],
    });
    const order = makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] });
    const result = await gate([judged, order], { options: { holdoutShare: 1 } });
    const files = gateFiles(result, [candidate(judged), candidate(order)], {
      source: 'candidates',
      references: ['function:shop'],
      options: { ...OPTIONS, holdoutShare: 1 },
    });
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
      'gate-report.json',
      'holdout/order.yaml',
      'holdout/seal.json',
      'label-audit.yaml',
      'review.yaml',
    ]);
    const seal = JSON.parse(files.find((file) => file.path === 'holdout/seal.json')?.text ?? '{}');
    expect(seal).toMatchObject({
      sealed: true,
      share: 1,
      specs: [{ id: 'order', path: 'holdout/order.yaml' }],
    });
    expect(seal.specs[0].hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('reports the funnel, every block and the mutation score, and prints them', async () => {
    const order = makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] });
    const result = await gate([order]);
    const files = gateFiles(result, [candidate(order)], {
      source: 'candidates',
      references: ['function:shop'],
      options: OPTIONS,
    });
    const report = JSON.parse(files.find((file) => file.path === 'gate-report.json')?.text ?? '{}');
    expect(report.summary).toMatchObject({ blocks: 1, accepted: 1, gated_specs: 1 });
    expect(report.funnel).toHaveLength(9);
    expect(report.blocks[0]).toMatchObject({ key: 'order#order', status: 'accepted', pass_k: 1 });
    expect(
      report.mutation.by_class.find((entry: { class: string }) => entry.class === 'X1_local'),
    ).toMatchObject({
      killed: 1,
      scored: 1,
    });
    const audit = parse(files.find((file) => file.path === 'label-audit.yaml')?.text ?? '');
    expect(audit.families[0].sample[0]).toMatchObject({ block: 'order#order', label_correct: null });
    const text = renderFunnel(result);
    expect(text).toContain('1. observed');
    expect(text).toContain('9. freshness');
    expect(text).toContain('X1_local: 1/1 killed');
    expect(text).toContain('control: 1 negative control(s), green');
  });
});
