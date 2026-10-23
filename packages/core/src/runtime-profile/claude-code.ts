import { parseTypes, type TypeSet } from '../estate-model/part-type';
import { CLAUDE_CODE_MAP_KINDS, CLAUDE_CODE_TYPES } from './claude-code-types';
import { loadsByItself, type RuntimeProfile } from './profile';

const ROOTS = { project: '.', layout: '.claude' } as const;
const SHAPES = ['step-list', 'catalogue', 'check-table'] as const;

/** The built-in types, validated by the same loader as a user's types document. */
function builtInTypes(): TypeSet {
  const parsed = parseTypes(CLAUDE_CODE_TYPES, {
    runtime: 'claude-code',
    roots: ROOTS,
    source: 'profile:claude-code',
    shapes: SHAPES,
  });
  if (!parsed.ok)
    throw new Error(`the claude-code profile's types do not load: ${JSON.stringify(parsed.errors)}`);
  return parsed.set;
}

const TYPES = builtInTypes();

/**
 * Claude Code: `CLAUDE.md` (and `.claude/CLAUDE.md`, `CLAUDE.local.md`) with `@path` imports, memory under
 * `.claude/memory/`, skills under `.claude/skills/<name>/SKILL.md`, helper agents under `.claude/agents/`, and
 * static settings in `.claude/settings.json` and `.claude/settings.local.json`, each a part type of
 * `CLAUDE_CODE_TYPES`. A skill is reached by its route in the standing files, its description, or its name.
 */

export const CLAUDE_CODE_PROFILE: RuntimeProfile = {
  name: 'claude-code',
  roots: ROOTS,
  types: TYPES,
  mapKinds: CLAUDE_CODE_MAP_KINDS,
  shapes: SHAPES,
  sources: {
    user: {
      option: 'userSkills',
      types: ['skill', 'skill-reference', 'skill-script', 'skill-file'],
      label: '~/.claude/skills',
    },
  },
  layout: { root: '.claude', extraFiles: ['.mcp.json'] },
  standing: { rootFiles: ['CLAUDE.md', 'CLAUDE.local.md'], primary: 'CLAUDE.md' },
  settings: [{ kind: 'static', files: ['.claude/settings.json', '.claude/settings.local.json'] }],
  bases: ['.claude', '.claude/skills'],
  routing: ['route-table', 'description', 'name'],
  pathVariables: {
    project: ['CLAUDE_PROJECT_DIR'],
    plugin: ['CLAUDE_PLUGIN_ROOT'],
    working: ['PWD'],
    home: ['HOME'],
  },
  loadsItself: loadsByItself('claude-code', TYPES),
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
  // Files a person keeps out of version control are kept out of the estate too.
  ignoreFiles: ['.gitignore'],
};
