import type { Aspect, Loaded } from './vocabulary';

/**
 * One part of an agent setup: a file, a folder, or an entry inside a structured file, located by a part type. Its
 * aspects and load time come from its type; its fields are read by the type's field reads.
 */
export type Part = {
  /** `<type>:<path>`, then `#<entry>` for an entry inside a file. Unique within an estate. */
  id: string;
  type: string;
  runtime: string;
  /** The file or folder, relative to the estate root, with `/`. */
  path: string;
  /** For a folder part, the entry file its fields are read from, when the folder holds it. */
  entry?: string;
  /** For an entry inside a structured file, its JSON pointer (`/hooks/PreToolUse/0`). */
  pointer?: string;
  /** What the last `*` of the locating glob matched. */
  match?: string;
  name?: string;
  /** The id of the part whose type contains this part's type, for a part located inside another. */
  parent?: string;
  aspects: Aspect[];
  loaded: Loaded;
  fields: Record<string, unknown>;
};

/** A file under the estate root no type covers, or one a reader left out with the code of why. */
export type ModelCoverage = {
  /** The files the types located, read or not. */
  covered: number;
  /** Files no type covers, root-relative, sorted. */
  unknown: string[];
  /** Files left out on purpose: an ignore glob, a size limit. */
  skipped: Array<{ what: string; reason: string }>;
};
