import type { ArtifactKind, ArtifactReader, ArtifactReaderRegistry } from '@agent-nexus/driftbench-core';
import { csvReader } from './csv';
import { docxReader } from './docx';
import { jsonReader } from './json';
import { pdfReader } from './pdf';
import { codeReader, textReader } from './plain';
import { pptxReader } from './pptx';
import { xlsxReader } from './xlsx';

/** The kind each file extension opens as, when a spec names no kind. */
const EXTENSIONS: Readonly<Record<ArtifactKind, readonly string[]>> = {
  xlsx: ['xlsx', 'xlsm'],
  docx: ['docx'],
  pptx: ['pptx'],
  pdf: ['pdf'],
  csv: ['csv', 'tsv'],
  json: ['json'],
  text: ['txt', 'text', 'md', 'markdown', 'rst', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml'],
  code: (
    'ts tsx mts cts js jsx mjs cjs py rb go rs java kt kts swift c h cc cpp cxx hpp cs php sh bash zsh ps1 ' +
    'sql r scala lua pl dart ex exs erl hs clj vue svelte html htm css scss less'
  ).split(' '),
};

/** File names without an extension that hold code. */
const CODE_NAMES = new Set(['dockerfile', 'makefile', 'justfile', 'gemfile', 'rakefile', 'procfile']);

/** The kind a path opens as, from its extension (case ignored), or undefined when none fits. */
export function kindForPath(path: string): ArtifactKind | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (CODE_NAMES.has(name)) return 'code';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1);
  for (const [kind, extensions] of Object.entries(EXTENSIONS) as [ArtifactKind, readonly string[]][]) {
    if (extensions.includes(extension)) return kind;
  }
  return undefined;
}

/** A registry over the given readers; a later reader of the same kind replaces an earlier one. */
export function createRegistry(readers: readonly ArtifactReader[]): ArtifactReaderRegistry {
  const byKind = new Map<ArtifactKind, ArtifactReader>(readers.map((reader) => [reader.kind, reader]));
  return {
    get: (kind) => byKind.get(kind),
    forPath: (path) => {
      const kind = kindForPath(path);
      return kind === undefined ? undefined : byKind.get(kind);
    },
  };
}

/** Every reader this package ships, one per kind. */
export const READERS = [
  xlsxReader,
  docxReader,
  pptxReader,
  pdfReader,
  csvReader,
  jsonReader,
  textReader,
  codeReader,
] as const;

/** The default registry: one reader per artifact kind, picked by kind or by file extension. */
export function defaultReaders(): ArtifactReaderRegistry {
  return createRegistry(READERS);
}
