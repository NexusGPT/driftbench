import { CLAUDE_CODE_PROFILE } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  DEFAULT_RULES,
  type Mention,
  referenceExtractors,
  referenceGraph,
  referenceRulesOf,
  registerReferenceExtractor,
  typeOfFile,
  unregisterReferenceExtractor,
} from '../../src/index';
import { estate } from '../support';

/** An invented estate read with no model. */
async function read(files: Record<string, string>) {
  return new ClaudeCodeReader().read(await estate(files));
}

const SKILL = (body: string[]) =>
  ['---', 'name: crate-sort', 'description: Sorts crates for the shelf team.', '---', '', ...body, ''].join(
    '\n',
  );

describe('the part type of a file decides how it points at other files', () => {
  it('finds the type that locates a file, and the contained type for a file inside a skill', () => {
    const profile = CLAUDE_CODE_PROFILE;
    expect(typeOfFile(profile, 'CLAUDE.md')?.name).toBe('system-prompt');
    expect(typeOfFile(profile, 'pkg/CLAUDE.local.md')?.name).toBe('system-prompt');
    expect(typeOfFile(profile, '.claude/skills/ab/SKILL.md')?.name).toBe('skill');
    expect(typeOfFile(profile, '.claude/skills/ab/references/x.md')?.name).toBe('skill-reference');
    expect(typeOfFile(profile, '.claude/skills/ab/scripts/run.py')?.name).toBe('skill-script');
    expect(typeOfFile(profile, '.claude/memory/notes.md')?.name).toBe('memory');
  });

  it('gives a file of another runtime, or of no type, the default rule', () => {
    const profile = CLAUDE_CODE_PROFILE;
    // AGENTS.md belongs to the codex runtime: this runtime's reader does not read it as its own.
    expect(typeOfFile(profile, 'AGENTS.md')).toBeUndefined();
    expect(typeOfFile(profile, 'notes/plain.md')).toBeUndefined();
    expect(referenceRulesOf(profile, 'notes/plain.md')).toEqual(DEFAULT_RULES);
  });

  it('reads the rules a type declares', () => {
    const rules = referenceRulesOf(CLAUDE_CODE_PROFILE, 'CLAUDE.md').map((rule) => rule.by);
    expect(rules).toEqual(['import', 'path', 'name']);
  });
});

describe('the reference graph', () => {
  it('makes a link with its reader, line and confidence for a path that leads to a file, and a dangling entry for one that does not', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n\nKeep replies short.\n',
      '.claude/skills/crate-sort/SKILL.md': SKILL([
        'Open `references/guide.md` and then open references/loose.md first.',
        'Also see `references/absent.md`.',
      ]),
      '.claude/skills/crate-sort/references/guide.md': '# Guide\n',
      '.claude/skills/crate-sort/references/loose.md': '# Loose\n',
    });
    const graph = referenceGraph(raw);
    const spanLink = graph.links.find((link) => link.to.endsWith('guide.md'));
    expect(spanLink).toMatchObject({
      kind: 'references',
      from: '.claude/skills/crate-sort/SKILL.md',
      provenance: { reader: 'path-syntax', file: '.claude/skills/crate-sort/SKILL.md', line: 6 },
      confidence: 1,
    });
    // A path read from a loose word is inferred, not read from structure: it carries less confidence.
    const looseLink = graph.links.find((link) => link.to.endsWith('loose.md'));
    expect(looseLink?.confidence).toBeLessThan(1);
    expect(graph.dangling.map((entry) => [entry.mention.written, entry.outcome])).toEqual([
      ['references/absent.md', 'missing'],
    ]);
  });

  it('keeps every entry as exactly one of a link or a dangling reference', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n\nSee `docs/guide.md`, `~/notes/mine.md` and `notes/here.md`.\n',
      'notes/here.md': '# Here\n',
    });
    const graph = referenceGraph(raw);
    expect(graph.entries.length).toBeGreaterThan(0);
    for (const entry of graph.entries) expect(Boolean(entry.link)).toBe(entry.outcome === 'resolved');
    expect(graph.links.length + graph.dangling.length).toBe(graph.entries.length);
    expect(graph.dangling.find((entry) => entry.mention.written.startsWith('~'))?.outcome).toBe('external');
  });

  it('reads nothing from a fenced block, a glob or a placeholder', async () => {
    const raw = await read({
      'CLAUDE.md': [
        '# Rules',
        '',
        '```text',
        'Read `notes/gone-a.md` first.',
        '```',
        'Use `notes/*.md` and `out/<date>.md`.',
        '',
      ].join('\n'),
    });
    expect(referenceGraph(raw).entries).toEqual([]);
  });
});

describe('an extractor is registered under the rule of a part type', () => {
  afterEach(() => {
    unregisterReferenceExtractor('test-names');
  });

  it('runs for a file whose type declares the rule, and not for one whose type does not', async () => {
    const seen: string[] = [];
    registerReferenceExtractor({
      id: 'test-names',
      rule: 'name',
      extract({ file }): Mention[] {
        seen.push(file.path);
        return [];
      },
    });
    expect(referenceExtractors('name').map((entry) => entry.id)).toContain('test-names');
    const raw = await read({
      'CLAUDE.md': '# Rules\n\nKeep replies short.\n',
      '.claude/memory/notes.md': '# Notes\n\nPlain notes.\n',
    });
    referenceGraph(raw);
    // system-prompt declares `name`; memory declares only `path`.
    expect(seen).toContain('CLAUDE.md');
    expect(seen).not.toContain('.claude/memory/notes.md');
  });

  it('replaces an extractor registered twice under one id, and can be selected by id', async () => {
    registerReferenceExtractor({ id: 'test-names', rule: 'path', extract: () => [] });
    registerReferenceExtractor({ id: 'test-names', rule: 'name', extract: () => [] });
    expect(referenceExtractors().filter((entry) => entry.id === 'test-names')).toHaveLength(1);
    expect(referenceExtractors('path').some((entry) => entry.id === 'test-names')).toBe(false);
    const raw = await read({
      'CLAUDE.md': '# Rules\n\nSee `notes/here.md`.\n',
      'notes/here.md': '# Here\n',
    });
    expect(referenceGraph(raw, { readers: ['no-such-reader'] }).entries).toEqual([]);
    expect(referenceGraph(raw, { readers: ['path-syntax'] }).entries).toHaveLength(1);
  });
});
