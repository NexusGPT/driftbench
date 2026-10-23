import type { TypesDocument } from '../estate-model/part-type';

/**
 * The part types of a Claude Code estate, as data: the layout the Claude Code reader always assumed, written as
 * types. `project` is the estate root and `layout` the `.claude` folder. The order is the order the reader
 * classifies a file in: the first type that locates a file gives its map kind (`CLAUDE_CODE_MAP_KINDS`), so a
 * `CLAUDE.md` inside a skill folder is standing, as it always was. The types after the mapped ones only cover
 * files (and name their aspects): they change no map.
 *
 * `AGENTS.md` and `.codex/agents/` belong to another runtime: Claude Code does not load them by itself, so they
 * cover their files without being read as Claude Code instructions.
 */
export const CLAUDE_CODE_TYPES: TypesDocument = {
  version: 1,
  types: {
    'system-prompt': {
      root: 'project',
      locate: ['**/CLAUDE.md', '**/CLAUDE.local.md'],
      fields: { body: 'text' },
      aspects: ['instructs'],
      loaded: 'always',
      references: ['import(@)', 'path', 'name'],
    },
    setting: {
      root: 'layout',
      locate: ['settings.json', 'settings.local.json'],
      fields: {
        model: '$.model',
        permissions: '$.permissions',
        env: '$.env',
        statusLine: '$.statusLine',
        outputStyle: '$.outputStyle',
      },
      aspects: ['configures'],
      loaded: 'always',
    },
    memory: {
      root: 'layout',
      locate: 'memory/**/*.md',
      fields: { name: 'match', body: 'body' },
      aspects: ['instructs', 'informs'],
      loaded: 'on-demand',
      references: ['path'],
    },
    skill: {
      root: 'layout',
      locate: 'skills/*/',
      entry: 'SKILL.md',
      fields: {
        name: ['frontmatter.name', 'match'],
        description: 'frontmatter.description',
        tools: 'frontmatter.allowed-tools',
        body: 'body',
      },
      contains: ['skill-reference', 'skill-script', 'skill-file'],
      aspects: ['instructs'],
      loaded: 'on-demand',
      references: ['path', 'name'],
    },
    'skill-reference': {
      locate: ['references/**', 'reference/**'],
      aspects: ['informs'],
      loaded: 'by-reference',
      references: ['path'],
    },
    'skill-script': {
      locate: 'scripts/**',
      fields: { name: 'match' },
      aspects: ['executes'],
      loaded: 'by-reference',
    },
    'skill-file': {
      locate: '**',
      aspects: ['informs'],
      loaded: 'by-reference',
      references: ['path'],
    },
    subagent: {
      root: 'layout',
      locate: 'agents/**/*.md',
      fields: {
        name: ['frontmatter.name', 'match'],
        description: 'frontmatter.description',
        model: 'frontmatter.model',
        effort: 'frontmatter.effort',
        tools: 'frontmatter.tools',
        skills: 'frontmatter.skills',
        body: 'body',
      },
      aspects: ['delegates', 'instructs'],
      loaded: 'on-demand',
      references: ['path', 'name'],
    },
    'check-registry': {
      root: 'layout',
      locate: [
        '**/*[Rr][Ee][Gg][Ii][Ss][Tt][Rr][Yy]*.{md,json,yaml,yml}',
        '**/*[Cc][Aa][Tt][Aa][Ll][Oo][Gg]*.{md,json,yaml,yml}',
      ],
      aspects: ['indexes'],
      loaded: 'by-reference',
      references: ['name'],
    },
    'step-list': {
      root: 'layout',
      locate: '**/*.{json,jsonc,yaml,yml}',
      shape: 'step-list',
      aspects: ['indexes'],
      loaded: 'by-reference',
    },
    'check-catalogue': {
      root: 'layout',
      locate: '**/*.json',
      shape: 'catalogue',
      aspects: ['indexes'],
      loaded: 'by-reference',
      references: ['name'],
    },
    'check-table': {
      root: 'layout',
      locate: '**/*.{json,jsonc,yaml,yml}',
      shape: 'check-table',
      aspects: ['indexes'],
      loaded: 'by-reference',
      references: ['name'],
    },
    hook: {
      root: 'layout',
      locate: [
        'settings.json#$.hooks.*[*].hooks[*]',
        'settings.local.json#$.hooks.*[*].hooks[*]',
        'hooks/*.{py,sh,bash,js,mjs,cjs,ts,rb,pl}',
      ],
      fields: { name: 'match', command: '$.command', prompt: '$.prompt', timeout: '$.timeout' },
      aspects: ['guards'],
      loaded: 'on-event',
      references: ['path'],
    },
    command: {
      root: 'layout',
      locate: 'commands/**/*.md',
      fields: { name: 'match', description: 'frontmatter.description', body: 'body' },
      aspects: ['invokes', 'instructs'],
      loaded: 'on-mention',
      references: ['path'],
    },
    'mcp-server': {
      root: 'project',
      locate: '.mcp.json#$.mcpServers.*',
      fields: { command: '$.command', url: '$.url' },
      aspects: ['acts'],
      loaded: 'always',
    },
    script: {
      root: 'layout',
      locate: '**/*.{sh,bash,py,js,mjs,cjs,ts,rb,pl}',
      fields: { name: 'match' },
      aspects: ['executes'],
      loaded: 'by-reference',
    },
    'codex-instructions': {
      root: 'project',
      locate: '**/AGENTS.md',
      runtime: 'codex',
      fields: { body: 'text' },
      aspects: ['instructs'],
      loaded: 'always',
      references: ['path'],
    },
    'codex-agent': {
      root: 'project',
      locate: '.codex/agents/**/*',
      runtime: 'codex',
      fields: { name: 'match' },
      aspects: ['delegates', 'instructs'],
      loaded: 'on-demand',
    },
  },
};

/**
 * The kind today's estate map gives a file of each type. A file takes the kind of the first mapped type, in the
 * order of `CLAUDE_CODE_TYPES`, that locates it; a file no mapped type locates is `other`.
 */
export const CLAUDE_CODE_MAP_KINDS: Readonly<Record<string, string>> = {
  'system-prompt': 'standing',
  setting: 'settings',
  memory: 'memory',
  skill: 'skill',
  'skill-reference': 'skill_file',
  'skill-script': 'skill_file',
  'skill-file': 'skill_file',
  subagent: 'subagent',
  'check-registry': 'registry',
  'step-list': 'step_list',
  'check-catalogue': 'registry',
  'check-table': 'registry',
};
