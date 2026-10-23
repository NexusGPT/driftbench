import { posix } from 'node:path';
import { locateFile, type TypesDocument, typeNamed } from '@agent-nexus/driftbench-core';
import { profileClassifier } from '../profile-classify';
import type { EstateReader, RawEstate } from '../reader';
import { locateQuote, readFrontmatter } from '../text';
import { addProse, fieldsOf, passage, rawEstate, readerProfile } from './raw-support';
import { readerSetupTypes } from './setup-types';
import { readSourceFiles, type SourceFiles, type SourceReaderOptions } from './source-files';

/** Shared definitions are source-relative; the source root may be .agents, dot_agents, or any mapped folder. */
export const AGENTS_FOLDER_TYPES: TypesDocument = {
  version: 1,
  types: {
    instruction: {
      root: 'source',
      locate: ['AGENTS.md', 'instructions/**/*.md'],
      fields: { name: 'file-name', body: 'text' },
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
      contains: ['skill-reference', 'skill-script'],
      aspects: ['instructs'],
      loaded: 'on-demand',
      references: ['path'],
    },
    'skill-reference': {
      locate: 'references/**',
      fields: { name: 'file-name', body: 'text' },
      aspects: ['informs'],
      loaded: 'by-reference',
      references: ['path'],
    },
    'skill-script': {
      locate: 'scripts/**',
      fields: { name: 'file-name', body: 'text' },
      aspects: ['executes'],
      loaded: 'by-reference',
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

/** Immutable source-relative metadata for resolveSetupSources, independent of the host runtime. */
export const AGENTS_FOLDER_SETUP_TYPES = readerSetupTypes('agents-folder', AGENTS_FOLDER_TYPES);

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

/** Existing map file kinds. Core aspect/link projection remains the shared scanner's responsibility. */
export const AGENTS_FOLDER_MAP_KINDS = {
  instruction: 'standing',
  skill: 'skill',
  'skill-reference': 'skill_file',
  'skill-script': 'skill_file',
  helper: 'subagent',
  guard: 'settings',
  script: 'guard_script',
} as const;

export class AgentsFolderReader implements EstateReader {
  readonly runtime = 'agents-folder';
  readonly setupTypes = AGENTS_FOLDER_SETUP_TYPES;

  constructor(private readonly options: SourceReaderOptions = {}) {}

  async listFiles(root: string): Promise<string[]> {
    return (await readAgentsFolderSource(root, this.options)).files.map((file) => file.path);
  }

  async read(root: string): Promise<RawEstate> {
    const inventory = await readAgentsFolderSource(root, this.options);
    const raw = rawEstate(this.runtime, inventory);
    const types = this.options.setupSource?.types ?? this.setupTypes.base;
    if (!types) throw new Error('agents-folder built-ins are missing');
    const inheritedKind = (name: string): string | undefined => {
      const direct = AGENTS_FOLDER_MAP_KINDS[name as keyof typeof AGENTS_FOLDER_MAP_KINDS];
      const parent = typeNamed(types, name)?.extends;
      return direct ?? (parent ? inheritedKind(parent) : undefined);
    };
    const mapKinds = Object.fromEntries(
      types.types.flatMap((type) => {
        const kind = inheritedKind(type.name);
        return kind ? [[type.name, kind]] : [];
      }),
    );
    const classifier = profileClassifier(readerProfile(this.runtime, types, mapKinds), {});
    for (const source of inventory.files) {
      const file = { ...source, ...classifier.classify(source.path, source.text) };
      raw.files.push(file);
      if (file.text.trim() === '') {
        raw.notes.push({ file: file.path, message: 'empty file: nothing to read' });
        continue;
      }
      const type = types.types.find(
        (candidate) => candidate.runtime === this.runtime && locateFile(candidate, file.path) !== undefined,
      );
      if (!type) continue; // Contained files remain in files, including references and script bytes.
      if (!inheritedKind(type.name)) {
        raw.notes.push({ file: file.path, message: `no map kind for ${type.name}` });
        continue;
      }
      try {
        const fields = fieldsOf(type, file);
        const front = readFrontmatter(file.text);
        if (front.error) raw.notes.push({ file: file.path, message: `frontmatter: ${front.error}` });
        const name = typeof fields.name === 'string' ? fields.name : posix.basename(file.path);
        const body = { startLine: front.bodyLine, endLine: file.text.split('\n').length };
        const at = passage(file, 1, Math.max(1, front.endLine ?? 1));
        const descriptionAt =
          typeof fields.description === 'string' ? locateQuote(file.text, fields.description) : undefined;
        const description =
          descriptionAt && typeof fields.description === 'string'
            ? {
                value: fields.description,
                at: { file: file.path, quote: fields.description, ...descriptionAt },
              }
            : undefined;
        if (file.kind === 'skill') {
          raw.skills.push({
            name,
            file: file.path,
            folder: posix.dirname(file.path),
            at,
            fields,
            body,
            tools: [],
            ...(description ? { description } : {}),
          });
        } else if (file.kind === 'subagent' && type.aspects.includes('delegates')) {
          raw.subagents.push({
            name,
            file: file.path,
            at,
            fields,
            body,
            tools: [],
            skills: [],
            ...(description ? { description } : {}),
          });
        } else if (inheritedKind(type.name) === 'settings' && type.aspects.includes('guards')) {
          if (typeof fields.event !== 'string' || typeof fields.script !== 'string') {
            raw.notes.push({ file: file.path, message: 'skipped: guard requires literal event and script' });
          } else {
            const script = posix.normalize(fields.script);
            if (posix.isAbsolute(script) || script === '..' || script.startsWith('../')) {
              raw.notes.push({ file: file.path, message: 'skipped: guard script outside source' });
            } else {
              raw.guards.push({
                event: fields.event,
                command: fields.script,
                script,
                anchored: false,
                scope: 'estate',
                at: passage(file, 1, file.text.split('\n').length),
              });
            }
          }
        }
        if (type.aspects.includes('instructs') && typeof fields.body === 'string') {
          if (!addProse(raw, file, fields.body, front.bodyLine)) {
            raw.notes.push({ file: file.path, message: 'skipped: declared body has no source passage' });
          }
        }
      } catch (cause) {
        raw.notes.push({ file: file.path, message: `skipped: invalid declaration: ${String(cause)}` });
      }
    }
    return raw;
  }
}
