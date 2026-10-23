import { posix } from 'node:path';
import {
  loadsByItself,
  locateFile,
  type PartType,
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
    layout: { root: '.', extraFiles: [] },
    standing: { rootFiles: [], primary: '' },
    settings: [],
    bases: ['.'],
    routing: ['description'],
    pathVariables: { project: [], plugin: [], working: [], home: [] },
    loadsItself: loadsByItself(name, types),
    copyFiles: [],
    configFiles: [],
    ignore: [],
    ignoreFiles: [],
  };
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
