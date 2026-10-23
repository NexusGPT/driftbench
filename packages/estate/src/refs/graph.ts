import type { Link } from '@agent-nexus/driftbench-core';
import { CLAUDE_CODE_PROFILE, runtimeProfile } from '@agent-nexus/driftbench-core';
import { AtomBuilder, chunkLines } from '../scan/code';
import { normativeEstate } from '../scan/document-roles';
import type { RawEstate } from '../scan/reader';
import { documentFileType } from '../scan/reference-role';
import { type Mention, referenceExtractors, registerReferenceExtractor } from './extractor';
import { PATH_EXTRACTOR } from './path-extractor';
import { referenceRulesOf } from './rules';

// The extractors the package ships. A registration with the same id replaces the earlier one.
registerReferenceExtractor(PATH_EXTRACTOR);

/**
 * The reference graph of an estate: what every file of prose points at, resolved against the estate. Extractors
 * (one per rule of a part type) read the mentions; the graph resolves each as the named-path resolution of the scan
 * does (the naming file's folder, the root, the profile's bases, the aliases, the unique ending) and keeps it as a
 * link to a file of the estate, or as a dangling reference that says why it leads nowhere.
 *
 * Link ids are the root-relative paths of the files: the reader does not locate parts yet.
 */

export type ReferenceOutcome = 'resolved' | 'missing' | 'external' | 'ambiguous';

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
};

export type ReferenceGraph = {
  entries: ReferenceEntry[];
  links: Link[];
  /** The mentions that lead to no file of the estate: missing, outside the estate or ambiguous. */
  dangling: ReferenceEntry[];
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
  const entries: ReferenceEntry[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.prose) {
    const file = files.get(chunk.file);
    if (!file) continue;
    const rules = referenceRulesOf(profile, file.path);
    const lines = chunkLines(chunk, file);
    for (const extractor of referenceExtractors()) {
      if (options.readers && !options.readers.includes(extractor.id)) continue;
      if (!rules.some((rule) => rule.by === extractor.rule)) continue;
      for (const mention of extractor.extract({ file, lines, rules, profile })) {
        const key = `${extractor.id}\0${file.path}\0${mention.line}\0${mention.written}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = resolveMention(builder, file.path, mention);
        if (entry) entries.push(entry);
      }
    }
  }
  return {
    entries,
    links: entries.flatMap((entry) => (entry.link ? [entry.link] : [])),
    dangling: entries.filter((entry) => entry.outcome !== 'resolved'),
  };
}

/**
 * Resolves one mention. A mention that leads to a file of the estate is a link. One that leads nowhere is dangling
 * only when it is certain enough to be a finding: an import, a name with a prose or script file type, or a path
 * written outside the estate. A loose bare name that several files could be, a name with no separator that resolves
 * nowhere, and a path the estate ignores are left out: they say nothing sure.
 */
function resolveMention(builder: AtomBuilder, from: string, mention: Mention): ReferenceEntry | undefined {
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
  if (target.ignored || target.unresolved) return undefined;
  if (target.candidates !== undefined) {
    if (mention.bare) return undefined;
    return { ...base, outcome: 'ambiguous', candidates: target.candidates };
  }
  if (!mention.import && !documentFileType(mention.written)) return undefined;
  return { ...base, outcome: 'missing' };
}
