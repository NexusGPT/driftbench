import { posix } from 'node:path';
import {
  coveringType,
  loadsByItself,
  locateFile,
  type ModelCoverage,
  type PartType,
  pathWithin,
  type RuntimeProfile,
  selectJson,
  type TypeSet,
} from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import type { EstateFile, RawEstate } from '../reader';
import { type Located, locateQuote, readFrontmatter } from '../text';
import type { SourceFiles } from './source-files';

/** Supply the common classifier with this reader's own source-relative types, never host defaults. */
export function readerProfile(
  name: string,
  types: TypeSet,
  mapKinds: Readonly<Record<string, string>>,
): RuntimeProfile {
  return {
    name,
    roots: { source: '.' },
    types,
    mapKinds,
    shapes: [],
    coverageRoots: ['source'],
    layout: { root: '.', extraFiles: [] },
    standing: { rootFiles: [], primary: '' },
    settings: [],
    bases: ['.'],
    routing: ['description'],
    pathVariables: { project: [], plugin: [], working: [], home: [] },
    loadsItself: loadsByItself(name, types),
    copyFiles: [],
    configFiles: ['driftbench.estate.yaml'],
    ignore: [],
    ignoreFiles: [],
  };
}

export class CoverageRootError extends Error {
  readonly code = 'unknown-coverage-root';

  constructor(readonly root: string) {
    super(`coverage root ${root} is not declared in the profile roots`);
    this.name = 'CoverageRootError';
  }
}

/**
 * Same counting rules as coverageOf in the Claude Code reader: configuration, large inputs and ignored
 * globs are skipped; types and reached files cover inputs; otherwise counted roots retain unknown files.
 * Resolve every coverage root name before counting, including an empty source; a typo must refuse the read.
 */
export function sourceCoverage(
  profile: RuntimeProfile,
  inventory: SourceFiles,
  options: {
    reached?: ReadonlySet<string>;
    ignored?: readonly string[];
    pruned?: readonly string[];
  } = {},
): ModelCoverage {
  const roots = profile.coverageRoots.map((name) => {
    const folder = profile.roots[name];
    if (!Object.hasOwn(profile.roots, name) || folder === undefined) throw new CoverageRootError(name);
    return folder;
  });
  const config = new Set(profile.configFiles);
  const skipped: ModelCoverage['skipped'] = [];
  const unknown: string[] = [];
  let covered = 0;
  const paths = [...new Set(inventory.files.map((file) => file.path))].sort();
  for (const path of paths) {
    const located = coveringType(profile.types, path) !== undefined || options.reached?.has(path);
    if (config.has(path)) skipped.push({ what: path, reason: 'estate-config' });
    else if (located) covered += 1;
    else if (roots.some((folder) => pathWithin(folder, path) !== undefined)) unknown.push(path);
  }
  const large = inventory.skipped.filter((input) => input.reason.startsWith('size-limit:'));
  for (const path of [...new Set(large.map((input) => input.what))].sort()) {
    skipped.push({ what: path, reason: 'too-large' });
  }
  const pruned = roots.includes('.') ? (options.pruned ?? []) : [];
  const globs = new Set([...(options.ignored ?? []), ...pruned]);
  for (const glob of globs) skipped.push({ what: glob, reason: 'ignored' });
  skipped.push(...inventory.skipped.filter((input) => !input.reason.startsWith('size-limit:')));
  return { covered, unknown, skipped };
}

export function rawEstate(runtime: string, inventory: SourceFiles): RawEstate {
  return {
    runtime,
    labels: { read: 'Read', edit: 'Edit', write: 'Write', shell: 'Shell', dispatch: 'Agent' },
    files: [],
    skills: [],
    subagents: [],
    guards: [],
    permissions: [],
    settings: [],
    registry: [],
    steps: [],
    prose: [],
    notes: inventory.skipped.map(({ what, reason }) => ({ file: what, message: `skipped: ${reason}` })),
    bases: ['.'],
  };
}

/** Read declared fields through the core grammar. Unsupported reads remain explicit omissions. */
export function fieldsOf(type: PartType, file: EstateFile, entry?: unknown): Record<string, unknown> {
  const front = readFrontmatter(file.text);
  const place = locateFile(type, file.path);
  let structured = entry;
  if (structured === undefined && /\.(json|ya?ml)$/.test(file.path)) {
    structured = parseYaml(file.text, { uniqueKeys: true });
  }
  const fields: Record<string, unknown> = {};
  for (const [name, reads] of Object.entries(type.fields)) {
    for (const read of reads) {
      let value: unknown;
      switch (read.from) {
        case 'json':
          value = selectJson(structured, read.path)[0];
          break;
        case 'frontmatter':
          value = selectJson(front.fields, read.path)[0];
          break;
        case 'text':
          value = file.text;
          break;
        case 'body':
          value = file.text
            .split('\n')
            .slice(front.bodyLine - 1)
            .join('\n');
          break;
        case 'file-name':
          value = posix.basename(file.path, posix.extname(file.path));
          break;
        case 'folder-name':
          value = posix.basename(place?.folder ?? posix.dirname(file.path));
          break;
        case 'match':
          value = place?.match;
          break;
        case 'section': {
          const lines = file.text.split('\n');
          const start = lines.findIndex(
            (line) => /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, '').trim() === read.heading,
          );
          if (start < 0) break;
          const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 6;
          const boundary = new RegExp(`^#{1,${level}}\\s`);
          const next = lines.findIndex((line, index) => index > start && boundary.test(line));
          value = lines.slice(start + 1, next < 0 ? undefined : next).join('\n');
          break;
        }
      }
      if (value !== undefined && value !== null && value !== '') {
        fields[name] = value;
        break;
      }
    }
  }
  return fields;
}

export function passage(file: EstateFile, line = 1, end = line): Located {
  const lines = file.text.split('\n');
  const startLine = Math.max(1, Math.min(line, lines.length));
  const endLine = Math.max(startLine, Math.min(end, lines.length));
  return { file: file.path, startLine, endLine, quote: lines.slice(startLine - 1, endLine).join('\n') };
}

export function addProse(raw: RawEstate, file: EstateFile, text: string, nearLine = 1): boolean {
  if (text.trim() === '') return true;
  const at = locateQuote(file.text, text, { nearLine });
  if (!at) return false;
  raw.prose.push({ id: `${file.path}:${at.startLine}:${raw.prose.length}`, file: file.path, ...at, text });
  return true;
}
