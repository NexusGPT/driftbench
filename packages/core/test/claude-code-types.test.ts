import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_PROFILE,
  CLAUDE_CODE_TYPES,
  locateFile,
  parseTypes,
  staticSettingsFiles,
  typeNamed,
} from '../src/index';

const profile = CLAUDE_CODE_PROFILE;

describe('the Claude Code profile as data', () => {
  it('ships the built-in types the model names, loaded by the same strict loader as a user document', () => {
    const names = profile.types.types.map((type) => type.name);
    for (const name of [
      'system-prompt',
      'skill',
      'subagent',
      'hook',
      'setting',
      'command',
      'memory',
      'mcp-server',
      'script',
    ])
      expect(names, name).toContain(name);
    const again = parseTypes(CLAUDE_CODE_TYPES, {
      runtime: profile.name,
      roots: profile.roots,
      shapes: profile.shapes,
    });
    expect(again.ok).toBe(true);
    // A type of another runtime covers its files but is not this runtime's.
    expect(typeNamed(profile.types, 'codex-instructions')?.runtime).toBe('codex');
    expect(typeNamed(profile.types, 'system-prompt')?.runtime).toBe('claude-code');
  });

  it('maps only types it has, each located from a root or inside the type that contains it', () => {
    for (const name of Object.keys(profile.mapKinds)) {
      const type = typeNamed(profile.types, name);
      expect(type, name).toBeDefined();
      const contained = profile.types.types.some((parent) => parent.contains.includes(name));
      expect(type?.folder !== undefined || contained, name).toBe(true);
    }
  });

  it('keeps its fixed places in step with its types: the static settings and the root standing files', () => {
    const setting = typeNamed(profile.types, 'setting');
    if (!setting) throw new Error('no setting type');
    for (const file of staticSettingsFiles(profile)) expect(locateFile(setting, file), file).toBeDefined();
    const standing = profile.types.types.filter((type) => profile.mapKinds[type.name] === 'standing');
    for (const file of profile.standing.rootFiles)
      expect(
        standing.some((type) => locateFile(type, file) !== undefined),
        file,
      ).toBe(true);
  });

  it('locates a skill by its folder and entry, and a contained type only inside it', () => {
    const skill = typeNamed(profile.types, 'skill');
    if (!skill) throw new Error('no skill type');
    expect(locateFile(skill, '.claude/skills/report/SKILL.md')).toEqual({
      match: 'report',
      folder: '.claude/skills/report',
    });
    expect(locateFile(skill, '.claude/skills/SKILL.md')).toBeUndefined();
    expect(locateFile(skill, '.claude/skills/report/notes.md')).toBeUndefined();
    expect(typeNamed(profile.types, 'skill-reference')?.folder).toBeUndefined();
  });

  it('says a file loads by itself exactly as the rule before the types did, on every form of path', () => {
    // The rule of release/next 6f0361e94, packages/adapters/src/claude-code/live/adapter.ts line 188, verbatim.
    const before = (path: string) => /(^|\/)CLAUDE(\.local)?\.md$/.test(path.replace(/^\.?\/+/, ''));
    const paths = [
      'CLAUDE.md',
      './CLAUDE.md',
      '/home/user/project/CLAUDE.md',
      '//CLAUDE.md',
      './.claude/CLAUDE.md',
      '.claude/CLAUDE.local.md',
      'a/b/CLAUDE.local.md',
      'a//CLAUDE.md',
      'a/./CLAUDE.md',
      '../x/CLAUDE.md',
      'a/CLAUDE.md/.',
      'CLAUDE.md/',
      'NOTCLAUDE.md',
      'CLAUDE.md.bak',
      'claude.md',
      'a\\CLAUDE.md',
      '.mcp.json',
      '.claude/settings.json',
      '.claude/memory/notes.md',
      '.claude/skills/report/SKILL.md',
      'AGENTS.md',
      '',
      '.',
    ];
    for (const path of paths) expect(profile.loadsItself(path), path).toBe(before(path));
  });
});
