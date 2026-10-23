import { posix } from 'node:path';
import type { Link, ReferenceRule } from '@agent-nexus/driftbench-core';
import { CLAUDE_CODE_PROFILE, runtimeProfile } from '@agent-nexus/driftbench-core';
import { AtomBuilder, chunkLines, isExternal } from '../scan/code';
import { normativeEstate } from '../scan/document-roles';
import type { ProseChunk, RawEstate } from '../scan/reader';
import { documentFileType, pathReference } from '../scan/reference-role';
import { type Mention, referenceExtractors, registerReferenceExtractor } from './extractor';
import { IMPORT_EXTRACTOR } from './import-extractor';
import { PATH_EXTRACTOR } from './path-extractor';
import { referenceRulesOf } from './rules';

// The extractors the package ships. A registration with the same id replaces the earlier one.
registerReferenceExtractor(PATH_EXTRACTOR);
registerReferenceExtractor(IMPORT_EXTRACTOR);

/**
 * The reference graph of an estate: what every file of prose points at, resolved against the estate. Extractors
 * (one per rule of a part type) read the mentions; the graph resolves each as the named-path resolution of the scan
 * does (the naming file's folder, the root, the profile's bases, the aliases, the unique ending) and keeps it as a
 * link to a file of the estate, or as a dangling reference that says why it leads nowhere.
 *
 * Link ids are the root-relative paths of the files: the reader does not locate parts yet.
 */

/**
 * What a mention leads to: a file of the estate (`resolved`), no file (`missing`), a place outside the estate
 * (`external`), several files (`ambiguous`), or no file of the estate with too little evidence that a file was meant
 * for a finding (`unresolved`: kept, and listed by the check as skipped with its reason, never dropped).
 */
export type ReferenceOutcome = 'resolved' | 'missing' | 'external' | 'ambiguous' | 'unresolved';

/** Why a path leads to no file and is no finding: it has no file type, or it names a folder the estate does not hold. */
export const PATH_NOT_IN_ESTATE = 'path-not-in-estate';

export type ReferenceEntry = {
  mention: Mention;
  /** The file the mention was read in. */
  from: string;
  outcome: ReferenceOutcome;
  /** The file it leads to, or where it was looked for. */
  path: string;
  /** Present exactly when the outcome is `resolved`. */
  link?: Link;
  /** How the resolution found the file when not by the written place: `alias` or `suffix`. */
  resolvedBy?: 'alias' | 'suffix';
  /** A bare name with a file type that resolves beside its source: a concrete place, not a loose word. */
  concrete: boolean;
  candidates?: string[];
  /** For an `unresolved` entry: the code of why the check could not judge it. */
  reason?: string;
};

export type ReferenceGraph = {
  entries: ReferenceEntry[];
  links: Link[];
  /** The mentions that lead to no file of the estate: missing, outside the estate or ambiguous. */
  dangling: ReferenceEntry[];
  /** The mentions kept apart, no finding: too little evidence that a file was meant. The check lists them as skipped. */
  unresolved: ReferenceEntry[];
};

export type ReferenceGraphOptions = {
  /** Only the entries of these extractors (default: all registered). */
  readers?: readonly string[];
};

/** The reference graph of the prose a reader loaded, over the extractors registered for each file's rules. */
export function referenceGraph(raw: RawEstate, options: ReferenceGraphOptions = {}): ReferenceGraph {
  raw = normativeEstate(raw);
  const profile = runtimeProfile(raw.runtime) ?? CLAUDE_CODE_PROFILE;
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const builder = new AtomBuilder(files);
  builder.configure(raw);
  const places = new Places(raw);
  const entries: ReferenceEntry[] = [];
  const seen = new Set<string>();
  // A file that is included becomes part of its includer: it can include in turn, by the same rule. The rules an
  // included file takes from its includer are found as the includes are, until no file takes a new one.
  const inherited = new Map<string, ReferenceRule[]>();
  const chunksOf = new Map<string, ProseChunk[]>();
  for (const chunk of raw.prose) chunksOf.set(chunk.file, [...(chunksOf.get(chunk.file) ?? []), chunk]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [path, chunks] of chunksOf) {
      const file = files.get(path);
      if (!file) continue;
      const rules = [...referenceRulesOf(profile, path), ...(inherited.get(path) ?? [])];
      for (const chunk of chunks) {
        const lines = chunkLines(chunk, file);
        for (const extractor of referenceExtractors()) {
          if (options.readers && !options.readers.includes(extractor.id)) continue;
          if (!rules.some((rule) => rule.by === extractor.rule)) continue;
          for (const mention of extractor.extract({ file, lines, rules, profile })) {
            const key = `${extractor.id}\0${path}\0${mention.line}\0${mention.written}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = resolveMention(builder, places, files, path, mention);
            if (!entry) continue;
            entries.push(entry);
            if (entry.link?.kind === 'includes') {
              const taken = inherited.get(entry.link.to) ?? [];
              const own = referenceRulesOf(profile, entry.link.to);
              const fresh = rules.filter(
                (rule) =>
                  rule.by === 'import' &&
                  ![...taken, ...own].some((known) => known.by === 'import' && known.prefix === rule.prefix),
              );
              if (fresh.length > 0) {
                inherited.set(entry.link.to, [...taken, ...fresh]);
                changed = true;
              }
            }
          }
        }
      }
    }
  }
  return {
    entries,
    links: entries.flatMap((entry) => (entry.link ? [entry.link] : [])),
    dangling: entries.filter((entry) => entry.outcome !== 'resolved' && entry.outcome !== 'unresolved'),
    unresolved: entries.filter((entry) => entry.outcome === 'unresolved'),
  };
}

/** True when the written path ends in a file extension. */
const hasExtension = (written: string) => /\.[A-Za-z0-9]+$/.test(written);

/**
 * The folders of the estate and the places a written path is looked for from: the folder of the naming file, the
 * root, and the profile's base folders. A folder is one that holds a file the reader loaded, or one a named path
 * led to on disk (`raw.folders`).
 */
class Places {
  private readonly folders = new Set<string>();
  private readonly bases: readonly string[];
  private readonly externals: readonly string[];
  constructor(raw: RawEstate) {
    this.externals = raw.externals ?? [];
    for (const folder of raw.folders ?? []) this.folders.add(posix.normalize(folder));
    for (const file of raw.files)
      for (let at = posix.dirname(file.path); at !== '.' && at !== '/'; at = posix.dirname(at))
        this.folders.add(at);
    this.bases = raw.bases ?? [];
  }
  /** True when the path lies in a folder outside the estate, or is one the reader denied (`raw.externals`). */
  external(path: string): boolean {
    return isExternal(path, this.externals);
  }
  private from(file: string): string[] {
    return [posix.dirname(file), '.', ...this.bases];
  }
  /** True when the written path leads to a folder of the estate: a link to a folder reads no file. */
  namesFolder(file: string, written: string): boolean {
    return this.from(file).some((place) => this.folders.has(posix.normalize(posix.join(place, written))));
  }
  /**
   * True when the path is sure to be a place of this estate: it is written as a relative path (`./`, `../`), or its
   * first folder is one the estate holds. A pair such as `yes/no` or `owner/repo` has no such folder.
   */
  certain(file: string, written: string): boolean {
    if (/^\.{1,2}\//.test(written)) return true;
    const first = written.split('/')[0] ?? '';
    return (
      first !== '' &&
      this.from(file).some((place) => this.folders.has(posix.normalize(posix.join(place, first))))
    );
  }
}

/**
 * Resolves one mention. A mention that leads to a file of the estate is a link. One that leads nowhere is a finding
 * only when it is certain enough: a name with a prose or script file type, a link destination, a path whose first
 * folder the estate holds, or a path written outside the estate. A delimited path with too little evidence (no file
 * type, no such folder) is kept as `unresolved`, so the check lists it as skipped. A loose bare name that several
 * files could be, a loose bare word that resolves nowhere, and a path the estate ignores are left out: they say
 * nothing sure.
 */
function resolveMention(
  builder: AtomBuilder,
  places: Places,
  files: ReadonlyMap<string, unknown>,
  from: string,
  mention: Mention,
): ReferenceEntry | undefined {
  if (mention.import) return resolveImport(files, places, from, mention);
  const target = builder.resolve(mention.written, from, mention.bare);
  if (target.exists && target.path === from) return undefined;
  const base = { mention, from, path: target.path, concrete: target.concrete };
  const via = target.via === 'alias' || target.via === 'suffix' ? { resolvedBy: target.via } : {};
  if (target.exists)
    return {
      ...base,
      ...via,
      outcome: 'resolved',
      link: {
        from,
        to: target.path,
        kind: mention.kind,
        provenance: { reader: mention.reader, file: from, line: mention.line },
        confidence: mention.confidence,
      },
    };
  if (target.via === 'external') return { ...base, outcome: 'external' };
  if (target.ignored) return undefined;
  const extensionless = !mention.import && !hasExtension(mention.written);
  if (extensionless) {
    // A loose word, or a path to a folder, asks the reader to read no file.
    if (mention.bare || places.namesFolder(from, mention.written)) return undefined;
    if (target.candidates !== undefined)
      return { ...base, outcome: 'ambiguous', candidates: target.candidates };
    if (mention.syntax === 'link' || places.certain(from, mention.written))
      return { ...base, concrete: true, outcome: 'missing' };
    return { ...base, outcome: 'unresolved', reason: PATH_NOT_IN_ESTATE };
  }
  if (target.unresolved) return undefined;
  if (target.candidates !== undefined) {
    if (mention.bare) return undefined;
    return { ...base, outcome: 'ambiguous', candidates: target.candidates };
  }
  if (!mention.import && !documentFileType(mention.written))
    return mention.bare ? undefined : { ...base, outcome: 'unresolved', reason: PATH_NOT_IN_ESTATE };
  return { ...base, outcome: 'missing' };
}

/**
 * Resolves an import: the path is read from the folder of the file that holds it, and from nowhere else. A path
 * written outside the estate (`~/`, `/`, or `..` past the root), and a path the reader denied because it leads out
 * of the estate (`raw.externals`), is external. A file that imports itself resolves to itself: a cycle is no missing
 * file. A path that leads to no file is
 * missing only when it is a path by its syntax (a folder separator or a file type): a lone word after the prefix is
 * a name, not a file, and says nothing sure.
 */
function resolveImport(
  files: ReadonlyMap<string, unknown>,
  places: Places,
  from: string,
  mention: Mention,
): ReferenceEntry | undefined {
  const base = { mention, from, concrete: true };
  if (isExternal(mention.written)) return { ...base, path: mention.written, outcome: 'external' };
  const path = posix.normalize(posix.join(posix.dirname(from), mention.written.replace(/^\.\//, '')));
  if (path === '..' || path.startsWith('../')) return { ...base, path, outcome: 'external' };
  // A path the reader denied (a link that leads out of the estate) was recorded as external: it is not missing.
  if (!files.has(path) && places.external(path)) return { ...base, path, outcome: 'external' };
  // A file may import itself, or a file that imports it back: a cycle ends, it is no missing file.
  if (files.has(path))
    return {
      ...base,
      path,
      outcome: 'resolved',
      link: {
        from,
        to: path,
        kind: mention.kind,
        provenance: { reader: mention.reader, file: from, line: mention.line },
        confidence: mention.confidence,
      },
    };
  if (!pathReference(mention.written)) return undefined;
  return { ...base, path, outcome: 'missing' };
}
