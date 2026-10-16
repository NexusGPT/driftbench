import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, ReferenceIndex, scanEstate } from '../src/index';
import { estate, NOW } from './support';

const definition = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Review fictional parcels.\n---\n${body}\n`;

async function referenceEdges(files: Record<string, string>) {
  const root = await estate(files);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  return {
    map,
    index: new ReferenceIndex(map.atoms),
    units: map.atoms.filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent'),
    references: map.atoms.filter((atom) => atom.kind === 'reference'),
    edges: map.edges
      .filter((edge) => edge.kind === 'reference')
      .map((edge) => ({
        owner: byId.get(edge.from)?.fields?.name,
        from: byId.get(edge.to)?.provenance.file,
        target: byId.get(edge.to)?.fields?.path,
      })),
  };
}

const folder = '.claude/skills/parcels';
const skill = `${folder}/SKILL.md`;
const notes = `${folder}/references/notes.md`;
const more = `${folder}/references/more.md`;

describe('direct citation storage and on-demand reference reach', () => {
  it('reaches both direct and nested references without storing the closure', async () => {
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toEqual(expect.arrayContaining([{ owner: 'parcels', from: skill, target: notes }]));
    expect(result.edges).toHaveLength(1);
    expect(result.index.reachableFrom(result.units[0]?.id ?? '')).toEqual(
      new Set(result.references.map((r) => r.id)),
    );
    expect(result.references.every((r) => r.fields?.owner === (result.units[0]?.id ?? ''))).toBe(true);
  });

  it('reaches estate-owned files through a helper without changing their owner', async () => {
    const helper = '.claude/agents/reviewer.md';
    const result = await referenceEdges({
      [helper]: definition('reviewer', 'Read `review-notes.md`.'),
      'review-notes.md': '# Notes\nRead `review-details.md`.\n',
      'review-details.md': '# Details\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.index.reachableFrom(result.units[0]?.id ?? '')).toEqual(
      new Set(result.references.map((r) => r.id)),
    );
    expect(result.references.find((r) => r.provenance.file === 'review-notes.md')?.fields?.owner).toBe(
      'estate',
    );
  });

  it('retains reachability for every reader of a shared reference', async () => {
    const other = '.claude/skills/labels/SKILL.md';
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [other]: definition('labels', `Read \`${notes}\`.`),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(3);
    expect(result.edges.filter((edge) => edge.from === notes)).toEqual([]);
    expect(result.edges).toHaveLength(2);
    const nested = result.references.find((r) => r.provenance.file === notes);
    if (!nested) throw new Error('missing nested reference');
    for (const unit of result.units) expect(result.index.reachableFrom(unit.id)).toContain(nested.id);
    expect(nested.fields?.owner).toBe(result.units.find((u) => u.fields?.name === 'parcels')?.id);
  });

  it('terminates a reference cycle without duplicate edges', async () => {
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\nRead `notes.md`.\n',
    });
    expect(result.references).toHaveLength(3);
    expect(result.edges).toEqual([{ owner: 'parcels', from: skill, target: notes }]);
    expect(result.index.reachableFrom(result.units[0]?.id ?? '')).toEqual(
      new Set(result.references.map((r) => r.id)),
    );
  });

  it('owns an unread sibling lexically but does not reach it', async () => {
    const sibling = `${folder}/references/unused.md`;
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\n',
      [sibling]: '# Unused\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toEqual([{ owner: 'parcels', from: skill, target: notes }]);
    const siblingReference = result.references.find((r) => r.provenance.file === sibling);
    if (!siblingReference) throw new Error('missing unread sibling reference');
    expect(siblingReference.fields?.owner).toBe(result.units[0]?.id ?? '');
    expect(result.index.reachableFrom(result.units[0]?.id ?? '')).not.toContain(siblingReference.id);
  });
});
