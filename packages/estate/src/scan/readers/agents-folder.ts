import type { TypesDocument } from '@agent-nexus/driftbench-core';
import { type SourceFiles, type SourceReaderOptions, readSourceFiles } from './source-files';

/** Shared definitions are source-relative; the source root may be .agents, dot_agents, or any mapped folder. */
export const AGENTS_FOLDER_TYPES: TypesDocument = {
  version: 1,
  types: {
    instruction: {
      root: 'source',
      locate: ['AGENTS.md', 'instructions/**/*.md'],
      fields: { body: 'text' },
      aspects: ['instructs'],
      loaded: 'always',
      references: ['import(@)', 'path'],
    },
    skill: {
      root: 'source',
      locate: 'skills/*/',
      entry: 'SKILL.md',
      fields: {
        name: ['frontmatter.name', 'match'],
        description: 'frontmatter.description',
        body: 'body',
      },
      contains: ['skill-reference'],
      aspects: ['instructs'],
      loaded: 'on-demand',
      references: ['path'],
    },
    'skill-reference': {
      locate: 'references/**',
      fields: { body: 'text' },
      aspects: ['informs'],
      loaded: 'by-reference',
      references: ['path'],
    },
    helper: {
      root: 'source',
      locate: ['helpers/**/*.md', 'agents/**/*.md'],
      fields: {
        name: ['frontmatter.name', 'file-name'],
        description: 'frontmatter.description',
        body: 'body',
      },
      aspects: ['delegates', 'instructs'],
      loaded: 'on-demand',
      references: ['path'],
    },
    guard: {
      root: 'source',
      locate: 'guards/*.{json,yaml,yml}',
      fields: { name: '$.name', event: '$.event', script: '$.script', target: '$.target' },
      aspects: ['guards'],
      loaded: 'on-event',
      references: ['path'],
    },
    script: {
      root: 'source',
      locate: 'scripts/**/*.{py,sh,bash,js,mjs,cjs,ts}',
      fields: { name: 'file-name', body: 'text' },
      aspects: ['executes'],
      loaded: 'by-reference',
    },
  },
};

/** Syntax selectors consumed by the canonical link stage. No prose keywords determine a link. */
export const AGENTS_FOLDER_LINK_SELECTORS = [
  { types: ['instruction'], kind: 'includes', syntax: 'line-import', prefix: '@' },
  {
    types: ['instruction', 'skill', 'skill-reference', 'helper'],
    kind: 'references',
    syntax: 'markdown-link',
  },
  { types: ['guard'], kind: 'references', syntax: 'field-path', field: 'script', base: 'source' },
  { types: ['guard'], kind: 'guards', syntax: 'field-path', field: 'target', base: 'source' },
] as const;

/** The setup parser supplies the resolved source and every explicitly mapped root. */
export function readAgentsFolderSource(
  root: string,
  options: SourceReaderOptions = {},
): Promise<SourceFiles> {
  return readSourceFiles(root, options);
}
