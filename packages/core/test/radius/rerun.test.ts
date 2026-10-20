import { describe, expect, it } from 'vitest';
import { blockRerun } from '../../src/radius/links';
import { rerunMarks } from '../../src/radius/rerun';
import { type SectionRegistry, sectionsFromHeadings } from '../../src/radius/sections';
import { sectionSelection, unitSelection } from '../../src/radius/select';
import { RerunMarks } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';

// An invented prompt of two sections and a suite of one conversation with three blocks.
const made = sectionsFromHeadings(
  '# Shop bot\n\n## Greeting\nSay hello.\n\n## Refunds\nRefund within 30 days.\n',
  {
    promptId: 'shop',
    version: 'v1',
  },
);
if (!made.ok) throw new Error(made.errors.join('\n'));
const registry: SectionRegistry = {
  ...made.registry,
  sections: made.registry.sections.map((section) => ({ ...section, scope: 'local' as const })),
};
const id = (title: string) => registry.sections.find((section) => section.title === title)?.id as string;

const spec = (metadata: Record<string, unknown>): Spec =>
  ({
    id: 'chat',
    kind: 'conversation',
    blocks: [
      { id: 'a', when: { user: '.' } },
      { id: 'b', when: { user: '.' } },
      { id: 'c', when: { user: '.' } },
    ],
    metadata: {
      links: [
        {
          block: 'a',
          to: { kind: 'prompt_section', prompt: 'shop', section: id('Greeting') },
          status: 'declared',
        },
        {
          block: 'b',
          to: { kind: 'prompt_section', prompt: 'shop', section: id('Refunds') },
          status: 'declared',
        },
        {
          block: 'c',
          to: { kind: 'prompt_section', prompt: 'shop', section: id('Refunds') },
          status: 'declared',
        },
      ],
      ...metadata,
    },
  }) as Spec;

const change = (section: string) => ({
  from: 'v1',
  to: 'v2',
  changes: [{ kind: 'prompt_section', id: `shop#${section}` }],
});
const chosen = (metadata: Record<string, unknown>, section: string) =>
  sectionSelection([{ hash: 'h', spec: spec(metadata) }], change(section), [
    registry,
  ]).specs[0]?.blocks.filter((block) => block.state !== 'out');

describe('the blocks that always rerun', () => {
  it('reads the marks of a block by id or by index, and ignores a malformed list', () => {
    const marked = spec({
      rerun: [
        { block: 'b', reason: 'fails_at_baseline' },
        { block: 2, reason: 'fragile' },
      ],
    });
    expect(blockRerun(marked, 1).map((mark) => mark.reason)).toEqual(['fails_at_baseline']);
    expect(blockRerun(marked, 2).map((mark) => mark.reason)).toEqual(['fragile']);
    expect(blockRerun(marked, 0)).toEqual([]);
    expect(blockRerun(spec({ rerun: [{ block: 'b', reason: 'because' }] }), 1)).toEqual([]);
    expect(RerunMarks.safeParse([{ block: 'b', reason: 'fragile', extra: 1 }]).success).toBe(false);
  });

  it('selects a marked block on a change its links do not reach, and says why', () => {
    // Without a mark, a change to Greeting selects a, and the forward closure selects b and c.
    expect(chosen({}, id('Greeting'))?.map((block) => block.id)).toEqual(['a', 'b', 'c']);
    // A change to Refunds selects b (declared) and c; a is out until it is marked.
    expect(chosen({}, id('Refunds'))?.map((block) => block.id)).toEqual(['b', 'c']);
    const marked = chosen({ rerun: [{ block: 'a', reason: 'fails_at_baseline' }] }, id('Refunds'));
    expect(marked?.map((block) => [block.id, block.state, block.why])).toEqual([
      ['a', 'direct', ['rerun:fails_at_baseline']],
      ['b', 'direct', ['link:shop#refunds (declared)']],
      ['c', 'direct', ['link:shop#refunds (declared)']],
    ]);
  });

  it('marks nothing on a change that names no section of the registry', () => {
    const marked = { rerun: [{ block: 'a', reason: 'fragile' }] };
    const report = sectionSelection([{ hash: 'h', spec: spec(marked) }], change('nosuch'), [registry]);
    expect(report.all).toMatch(/is in no registry/);
    expect(report.specs[0]?.blocks.every((block) => block.why[0]?.startsWith('all:'))).toBe(true);
  });
});

describe('the procedures that mark a block', () => {
  const baseline = {
    a: [false, false, false, false],
    b: [true, true, true, true],
    c: [true, false],
    d: [true, false, false],
  };

  it('marks a block that fails in at least half of the unmutated repeats (R1)', () => {
    const marks = rerunMarks({ baseline, mutants: [] });
    expect(marks).toEqual([
      { block: 'b', reason: 'fails_at_baseline', evidence: { failed: 4, repeats: 4 } },
      { block: 'c', reason: 'fails_at_baseline', evidence: { failed: 1, repeats: 2 } },
    ]);
  });

  it('marks a block that flipped under two mutants the links did not select it for (R2)', () => {
    const mutants = [
      { id: 'm1', flipped: ['a', 'd'], selected: ['d'] },
      { id: 'm2', flipped: ['a', 'd'], selected: [] },
      { id: 'm3', flipped: ['a'], selected: ['a'] },
    ];
    const marks = rerunMarks({ baseline, mutants });
    // a: two unselected flips. d: one unselected flip, one selected. b, c: red at baseline already.
    expect(marks.filter((mark) => mark.reason === 'fragile')).toEqual([
      { block: 'a', reason: 'fragile', evidence: { mutants: 2, of: 3 } },
    ]);
    expect(
      rerunMarks({ baseline, mutants, minMutants: 1 })
        .filter((mark) => mark.reason === 'fragile')
        .map((mark) => mark.block),
    ).toEqual(['a', 'd']);
  });

  it('gives a red block one mark, leaves out the blocks it is told to, and does not depend on the order', () => {
    const mutants = [
      { id: 'm1', flipped: ['b', 'a'], selected: [] },
      { id: 'm2', flipped: ['b', 'a'], selected: [] },
    ];
    const marks = rerunMarks({ baseline, mutants, excluded: new Set(['c']) });
    expect(marks.map((mark) => [mark.block, mark.reason])).toEqual([
      ['b', 'fails_at_baseline'],
      ['a', 'fragile'],
    ]);
    const reversed = rerunMarks({ baseline, mutants: [...mutants].reverse(), excluded: new Set(['c']) });
    expect(reversed.map((mark) => mark.block)).toEqual(['b', 'a']);
  });
});

describe('the unit selection reads the marks too', () => {
  const unitSpec = (metadata: Record<string, unknown>): Spec =>
    ({
      id: 'chat',
      kind: 'conversation',
      blocks: [
        { id: 'a', when: { user: '.' } },
        { id: 'b', when: { user: '.' } },
        { id: 'c', when: { user: '.' } },
      ],
      metadata: {
        links: [
          { block: 'a', to: { kind: 'estate_unit', unit: 'u1' }, status: 'declared' },
          { block: 'b', to: { kind: 'estate_unit', unit: 'u2' }, status: 'declared' },
          { block: 'c', to: { kind: 'estate_unit', unit: 'u2' }, status: 'declared' },
        ],
        ...metadata,
      },
    }) as Spec;
  const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'unit', id: 'u2' }] };
  const run = (metadata: Record<string, unknown>) =>
    unitSelection([{ hash: 'h', spec: unitSpec(metadata) }], manifest).specs[0]?.blocks.map((block) => [
      block.id,
      block.state,
      block.why,
    ]);

  it('selects a marked block on a change to a unit it has no link to, and says why', () => {
    expect(run({})).toEqual([
      ['a', 'out', []],
      ['b', 'direct', ['link:unit:u2 (declared)']],
      ['c', 'direct', ['link:unit:u2 (declared)']],
    ]);
    expect(run({ rerun: [{ block: 'a', reason: 'fragile' }] })).toEqual([
      ['a', 'direct', ['rerun:fragile']],
      ['b', 'direct', ['link:unit:u2 (declared)']],
      ['c', 'direct', ['link:unit:u2 (declared)']],
    ]);
  });

  it('marks nothing when no unit changed', () => {
    const none = unitSelection(
      [{ hash: 'h', spec: unitSpec({ rerun: [{ block: 'a', reason: 'fragile' }] }) }],
      { from: 'v1', to: 'v2', changes: [] },
    );
    expect(none.specs[0]?.blocks.every((block) => block.state === 'out')).toBe(true);
  });
});
