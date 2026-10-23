import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_PROFILE,
  type RuntimeProfile,
  registerRuntimeProfile,
  runtimeProfile,
  runtimeProfileNames,
  staticSettingsFiles,
  variablePrefix,
} from '../src/index';

describe('runtime profiles', () => {
  it('registers claude-code as the first profile, with the layout the readers always assumed', () => {
    expect(runtimeProfileNames()[0]).toBe('claude-code');
    const profile = runtimeProfile('claude-code');
    expect(profile).toBe(CLAUDE_CODE_PROFILE);
    expect(profile?.copyFiles).toEqual(['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json']);
    expect(profile && staticSettingsFiles(profile)).toEqual([
      '.claude/settings.json',
      '.claude/settings.local.json',
    ]);
    expect(profile?.loadsItself('./.claude/CLAUDE.md')).toBe(true);
    expect(profile?.loadsItself('NOTCLAUDE.md')).toBe(false);
    expect(runtimeProfile('other')).toBeUndefined();
  });

  it('adds a runtime as data, and refuses a second profile of the same name', () => {
    const other: RuntimeProfile = {
      ...CLAUDE_CODE_PROFILE,
      name: 'profile-test-runtime',
      layout: { ...CLAUDE_CODE_PROFILE.layout, root: '.agent' },
      loadsItself: (path) => path === 'AGENT.md',
    };
    registerRuntimeProfile(other);
    expect(runtimeProfile('profile-test-runtime')?.layout.root).toBe('.agent');
    expect(() => registerRuntimeProfile(other)).toThrow(/already registered/);
  });

  it('declares the second sources of a runtime, and refuses a source that names an unknown type', () => {
    expect(CLAUDE_CODE_PROFILE.sources.user).toEqual({
      option: 'userSkills',
      types: ['skill', 'skill-reference', 'skill-script', 'skill-file'],
      label: '~/.claude/skills',
    });
    const broken: RuntimeProfile = {
      ...CLAUDE_CODE_PROFILE,
      name: 'profile-test-broken-source',
      sources: { shared: { option: 'sharedKit', types: ['skill', 'no-such-type'], label: '~/.kit' } },
    };
    expect(() => registerRuntimeProfile(broken)).toThrow(/unknown type no-such-type/);
    expect(runtimeProfile('profile-test-broken-source')).toBeUndefined();
  });

  it('matches a path behind a variable, loose or with balanced braces', () => {
    const loose = variablePrefix(['CLAUDE_PROJECT_DIR', 'PWD']);
    expect(loose.test('$CLAUDE_PROJECT_DIR/a')).toBe(true);
    expect(loose.test('${PWD}/a')).toBe(true);
    expect(loose.test('${PWD/a')).toBe(true);
    expect(loose.test('$HOME/a')).toBe(false);
    const balanced = variablePrefix(['CLAUDE_PROJECT_DIR'], { balanced: true });
    expect(balanced.test('${CLAUDE_PROJECT_DIR}/a')).toBe(true);
    expect(balanced.test('${CLAUDE_PROJECT_DIR/a')).toBe(false);
  });
});
