import type { RuntimeProfile } from './profile';

/** The file name Claude Code loads as standing instructions wherever it lies. */
const STANDING_NAME = /^CLAUDE(?:\.local)?\.md$/;

/**
 * Claude Code: `CLAUDE.md` (and `.claude/CLAUDE.md`, `CLAUDE.local.md`) with `@path` imports, memory under
 * `.claude/memory/`, skills under `.claude/skills/<name>/SKILL.md`, helper agents under `.claude/agents/`, and
 * static settings in `.claude/settings.json` and `.claude/settings.local.json`. A skill is reached by its route
 * in the standing files, its description, or its name.
 */
export const CLAUDE_CODE_PROFILE: RuntimeProfile = {
  name: 'claude-code',
  layout: {
    root: '.claude',
    memory: 'memory',
    skills: 'skills',
    helpers: 'agents',
    skillEntry: 'SKILL.md',
    extraFiles: ['.mcp.json'],
  },
  standing: {
    files: ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'],
    rootFiles: ['CLAUDE.md', 'CLAUDE.local.md'],
    primary: 'CLAUDE.md',
    nestedName: STANDING_NAME,
    importPrefix: '@',
  },
  settings: [{ kind: 'static', files: ['.claude/settings.json', '.claude/settings.local.json'] }],
  bases: ['.claude', '.claude/skills'],
  routing: ['route-table', 'description', 'name'],
  pathVariables: {
    project: ['CLAUDE_PROJECT_DIR'],
    plugin: ['CLAUDE_PLUGIN_ROOT'],
    working: ['PWD'],
    home: ['HOME'],
  },
  loadsItself: (path) => /(^|\/)CLAUDE(\.local)?\.md$/.test(path.replace(/^\.?\/+/, '')),
  copyFiles: ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'],
  configFiles: ['driftbench.estate.yaml', '.claude/driftbench.estate.yaml'],
  ignore: [
    '.git',
    'node_modules',
    '__pycache__',
    '*.log',
    'tests/fixtures',
    'hooks/**/tests',
    'hooks/**/test',
    '.trash',
    'skills/synced',
    // Files an operating system or an editor leaves beside the estate's own.
    '.DS_Store',
    'Thumbs.db',
    '*.swp',
    '*~',
    '.idea',
  ],
  ignoreFiles: [],
};
