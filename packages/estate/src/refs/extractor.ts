import type { LinkKind, ReferenceRule, RuntimeProfile } from '@agent-nexus/driftbench-core';
import type { MarkdownView } from '../scan/markdown-view';
import type { EstateFile } from '../scan/reader';

/**
 * The reference seam. A part type says HOW its parts point at other parts (`references`: `path`, `import(<prefix>)`,
 * `name`, docs/estate-model.md). An extractor is the reader of one such rule: it reads the text of a file and gives
 * the mentions the rule finds, by syntax alone. The graph resolves each mention against the estate and makes a typed
 * link or a dangling reference. A model adds meaning to this graph (which mention is an instruction to read the file);
 * it never reads a path.
 *
 * Adding a way of pointing is one extractor registered under its rule, never a change to the scan, the lint or a
 * reader.
 */

/** A passage of a file an extractor reads: one non-blank line with the fenced blocks blanked, and the line as written. */
export type ExtractLine = { line: number; text: string; quote: string };

export type ExtractInput = {
  file: EstateFile;
  lines: readonly ExtractLine[];
  /** The rules the file's part type declares, in the order it declares them. */
  rules: readonly ReferenceRule[];
  /** The file read as CommonMark reads it (text, code, definitions): for the rules that read prose, not lines. */
  view?: MarkdownView;
  /** The first and last line of the chunk the extractor is asked about; the whole file when absent. */
  from?: number;
  to?: number;
  profile: RuntimeProfile;
};

/** A place the text of a file points at, as written, before it is resolved. */
export type Mention = {
  /** The id of the extractor that read it. */
  reader: string;
  /** How the source points at the target. */
  kind: LinkKind;
  /** The path as written, normalised by the syntax that wrote it (`./` kept, anchors and queries dropped). */
  written: string;
  line: number;
  /** The line as written in the file. */
  quote: string;
  /** The notation that wrote it: `code-span`, `link`, `quoted`, `wiki`, `angle`, `bold`, `loose`, `import`. */
  syntax: string;
  /** Written as a loose word, not quoted, linked or backticked: a name no separator or file type makes certain. */
  bare: boolean;
  /** 1 for a path read from structure; lower for one a reader had to infer. Becomes the link's confidence. */
  confidence: number;
  /** An import: the runtime loads the file by itself, so the agent reads nothing. */
  import: boolean;
  /**
   * For a module import: the files the specifier can lead to, root-relative, by the rules of the language of the
   * file, the first that exists winning. The extractor reads the specifier and the language, never the estate.
   */
  candidates?: ModuleCandidate[];
  /** A module import that may be a name inside a module and not a module (`from m import name`): left out if it leads nowhere. */
  optional?: boolean;
};

/** A file a module specifier can lead to, and the files that run with it (a package's `__init__`). */
export type ModuleCandidate = { path: string; companions?: string[] };

export type ReferenceExtractor = {
  /** Unique id, kept in the provenance of every link it makes. */
  id: string;
  /** The rule of a part type it reads. */
  rule: ReferenceRule['by'];
  extract(input: ExtractInput): Mention[];
};

const EXTRACTORS: ReferenceExtractor[] = [];

/** Adds an extractor, or replaces the one with the same id. */
export function registerReferenceExtractor(extractor: ReferenceExtractor): void {
  const at = EXTRACTORS.findIndex((entry) => entry.id === extractor.id);
  if (at >= 0) EXTRACTORS[at] = extractor;
  else EXTRACTORS.push(extractor);
}

/** Removes an extractor by id; true when one was registered. */
export function unregisterReferenceExtractor(id: string): boolean {
  const at = EXTRACTORS.findIndex((entry) => entry.id === id);
  if (at < 0) return false;
  EXTRACTORS.splice(at, 1);
  return true;
}

/** The extractors of a rule, in the order they were registered. */
export function referenceExtractors(rule?: ReferenceRule['by']): readonly ReferenceExtractor[] {
  return rule === undefined ? EXTRACTORS : EXTRACTORS.filter((entry) => entry.rule === rule);
}
