import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ClaudeCodeReader, readFrontmatter, scanEstate, tolerantFields } from '../../src/index';
import { estate, FIXTURE, NOW } from '../support';

const STRICT = [
  '---',
  'name: tidy',
  'description: Tidy the inbox. Use when the user asks.',
  '---',
  '',
  '# Tidy',
  '',
];

const COMPACT = [
  '---',
  'name: claims',
  'description: File a claim. Use when: a parcel arrived broken.',
  'tools: Read, Bash',
  'model: opus',
  'hooks:',
  '  Stop:',
  '    - hooks:',
  '        - type: command',
  '          command: "$CLAUDE_PROJECT_DIR/.claude/hooks/claims.sh"',
  'skills:',
  '  - shipment-tracker',
  'note: "kept: as written"',
  '---',
  '',
  '# Claims',
  '',
];

describe('frontmatter the strict parser refuses', () => {
  it('reads a strict block with the parser, and a compact one field by field', () => {
    const strict = readFrontmatter(STRICT.join('\n'));
    expect(strict.fields).toEqual({ name: 'tidy', description: 'Tidy the inbox. Use when the user asks.' });
    expect(strict.tolerated).toBeUndefined();
    expect(strict.error).toBeUndefined();

    expect(() => parseYaml(COMPACT.slice(1, 13).join('\n'))).toThrow(/Nested mappings are not allowed/);
    const compact = readFrontmatter(COMPACT.join('\n'));
    expect(compact.error).toBeUndefined();
    expect(compact.tolerated).toMatch(
      /^Nested mappings are not allowed in compact mappings at line 2, column 14/,
    );
    expect(compact.fields).toEqual({
      name: 'claims',
      description: 'File a claim. Use when: a parcel arrived broken.',
      tools: 'Read, Bash',
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/claims.sh' }] }],
      },
      skills: ['shipment-tracker'],
      note: 'kept: as written',
    });
    expect(compact.bodyLine).toBe(15);
  });

  it('keeps a refused value over several lines as its text, and gives up only on a block with no key', () => {
    expect(tolerantFields(['summary: one: two', '  three: four: five', 'name: x'])).toEqual({
      summary: 'one: two\nthree: four: five',
      name: 'x',
    });
    expect(tolerantFields(['- a', '- b'])).toBeUndefined();
    const none = readFrontmatter(['---', '- a: b: c', '---', 'body'].join('\n'));
    expect(none.fields).toEqual({});
    expect(none.error).toMatch(/Nested mappings/);
  });

  it('lands the structured fields of a compact skill and helper in the map', async () => {
    const helper = [
      '---',
      'name: claims-helper',
      'description: Checks a claim. Use when: a claim is drafted.',
      'tools: Read, Grep',
      'model: sonnet',
      '---',
      '',
      'Check the claim.',
      '',
    ].join('\n');
    const root = await estate({
      'CLAUDE.md': '# Rules\n\n| When | Use |\n|---|---|\n| a claim | `claims` |\n',
      '.claude/skills/claims/SKILL.md': COMPACT.join('\n'),
      '.claude/hooks/claims.sh': '#!/bin/sh\nexit 0\n',
      '.claude/agents/claims-helper.md': helper,
    });
    const { raw, map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.notes.map((note) => note.file)).toEqual([
      '.claude/agents/claims-helper.md',
      '.claude/skills/claims/SKILL.md',
    ]);
    expect(raw.notes[0]?.message).toMatch(/^frontmatter read field by field \(the YAML parser said: Nested/);
    expect(raw.guards.map((guard) => [guard.event, guard.script, guard.scope])).toEqual([
      ['Stop', '.claude/hooks/claims.sh', 'claims'],
    ]);
    const skill = map.atoms.find((atom) => atom.kind === 'skill');
    expect(skill?.fields).toMatchObject({
      name: 'claims',
      description: 'File a claim. Use when: a parcel arrived broken.',
    });
    const helperAtom = map.atoms.find((atom) => atom.kind === 'subagent');
    expect(helperAtom?.fields).toMatchObject({
      name: 'claims-helper',
      tools: ['Read', 'Grep'],
      model: 'sonnet',
    });
    const routes = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'description');
    expect(routes.map((route) => route.situation)).toEqual([
      'File a claim. Use when: a parcel arrived broken.',
      'Checks a claim. Use when: a claim is drafted.',
    ]);
  });

  it('reads the fixture skill whose description holds a colon', async () => {
    const text = await readFile(join(FIXTURE, '.claude/skills/parcel-claims/SKILL.md'), 'utf8');
    expect(readFrontmatter(text).tolerated).toBeDefined();
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    const skill = raw.skills.find((candidate) => candidate.name === 'parcel-claims');
    expect(skill?.description?.value).toBe(
      'File a damage claim with a carrier for a parcel that arrived broken. Use when: the user reports a damaged or missing parcel.',
    );
    expect(skill?.tools.map((tool) => tool.value)).toEqual(['Read', 'Bash(./scripts/track.sh *)']);
  });
});
