import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  cutLines,
  DEFAULT_CHUNK_CHARACTERS,
  proseInventory,
  proseInventoryLines,
} from '../../src/index';
import { estate, readRaw } from '../support';
import { CASES } from './cases';

describe('skill reference files as prose', () => {
  it('chunks every markdown file beside a skill, like a skill body, and never a script', async () => {
    const raw = await readRaw(CASES);
    const files = raw.prose.filter((chunk) => /\/(references|templates)\//.test(chunk.file));
    expect(files.map((chunk) => [chunk.id, chunk.startLine, chunk.endLine])).toEqual([
      ['.claude/skills/parcel-claims/references/claim-rules.md', 1, 11],
      ['.claude/skills/parcel-claims/references/notes.md', 1, 3],
      ['.claude/skills/parcel-claims/references/supplier-languages.md', 1, 11],
      ['.claude/skills/shipment-tracker/references/notes.md', 1, 3],
    ]);
    expect(raw.prose.some((chunk) => /\.(sh|py)$/.test(chunk.file))).toBe(false);
    expect(DEFAULT_CHUNK_CHARACTERS).toBe(20_000);
    expect(raw.prose.every((chunk) => chunk.text.length <= DEFAULT_CHUNK_CHARACTERS)).toBe(true);
  });

  it('leaves the frontmatter of a reference file out of its chunk', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nUse the guide.\n',
      '.claude/skills/a/guide.md': '---\ntitle: Guide\n---\n\n# Guide\n\nAlways cite the order.\n',
    });
    const raw = await readRaw(root);
    const guide = raw.prose.find((chunk) => chunk.file === '.claude/skills/a/guide.md');
    expect(guide).toMatchObject({ id: '.claude/skills/a/guide.md', startLine: 4, endLine: 7 });
    expect(guide?.text).not.toContain('title:');
  });

  it('cuts a long passage within the budget, before a heading or after a blank line', () => {
    const lines = ['# One', 'aaaa', 'bbbb', '', '# Two', 'cccc', 'dddd', '', 'eeee', 'ffff'];
    // 10 characters a chunk: each line counts its newline.
    expect(cutLines(lines, 20)).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 8 },
      { from: 8, to: 10 },
    ]);
    expect(cutLines(['x'.repeat(50), 'short'], 10)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
    expect(cutLines(['a', 'b', 'c'], 1_000)).toEqual([{ from: 0, to: 3 }]);
  });

  it('gives a split file chunks <path>#n that cover its lines once, each within the budget', async () => {
    const body = Array.from({ length: 30 }, (_, index) =>
      index % 10 === 0 ? `## Part ${index / 10 + 1}` : `- Rule ${index}: keep line ${index} short.`,
    ).join('\n');
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/a/SKILL.md': `---\nname: a\n---\n\n${body}\n`,
      '.claude/skills/a/references/long.md': `${body}\n`,
    });
    const raw = await new ClaudeCodeReader({ chunkCharacters: 400 }).read(root);
    const long = raw.prose.filter((chunk) => chunk.file === '.claude/skills/a/references/long.md');
    expect(long.map((chunk) => chunk.id)).toEqual([
      '.claude/skills/a/references/long.md#1',
      '.claude/skills/a/references/long.md#2',
      '.claude/skills/a/references/long.md#3',
    ]);
    expect(long.map((chunk) => chunk.text.split('\n')[0])).toEqual(['## Part 1', '## Part 2', '## Part 3']);
    expect(long.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
      [1, 10],
      [11, 20],
      [21, 30],
    ]);
    for (const chunk of raw.prose) expect(chunk.text.length).toBeLessThanOrEqual(400);
    const skill = raw.prose.filter((chunk) => chunk.file === '.claude/skills/a/SKILL.md');
    expect(skill.map((chunk) => [chunk.id, chunk.startLine])).toEqual([
      ['.claude/skills/a/SKILL.md#1', 4],
      ['.claude/skills/a/SKILL.md#2', 15],
      ['.claude/skills/a/SKILL.md#3', 25],
    ]);
  });

  it('counts the chunks by source, and lists each unanswered chunk with its size', async () => {
    const raw = await readRaw(CASES);
    const inventory = proseInventory(raw);
    expect(
      Object.fromEntries(Object.entries(inventory.bySource).map(([source, entry]) => [source, entry.chunks])),
    ).toEqual({ standing: 1, memory: 2, skill: 2, reference: 4, subagent: 0, other: 0 });
    expect(inventory.characters).toBe(raw.prose.reduce((sum, chunk) => sum + chunk.text.length, 0));
    const answered = proseInventoryLines(inventory, true);
    expect(answered).toEqual([
      `  Prose: 9 chunks, ${inventory.characters} characters (standing 1, memory 2, skill bodies 2, skill files 4).`,
    ]);
    const unanswered = proseInventoryLines(inventory, false);
    expect(unanswered[1]).toBe(
      `  Unanswered prose chunks (no model call): 9, ${inventory.characters} characters.`,
    );
    expect(unanswered).toContain(
      `    .claude/skills/parcel-claims/references/claim-rules.md  ${
        raw.prose.find((chunk) => chunk.file.endsWith('claim-rules.md'))?.text.length
      } characters`,
    );
    expect(unanswered).toHaveLength(11);
    expect(proseInventoryLines(proseInventory({ ...raw, prose: [] }), false)).toEqual(['  Prose: none.']);
  });
});
