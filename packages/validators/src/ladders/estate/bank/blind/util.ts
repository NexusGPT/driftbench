import { helperFile, STANDING, skillFile } from '../../layout';
import { BASE, type Check, type FileWriter, type Hint, type PlantedEstate, planting } from '../planted';

/**
 * Pieces shared by the blind families. A blind item plants its files under the base owner, so the judge
 * never counts an atom it did not ask about as extra, and states what it needs as checks on the scan: an
 * atom of a kind on a line, a finding of the lint, an edge. The decoy items own their lines instead and
 * expect nothing from them.
 */

export const READER = 'packages/estate/src/scan/claude-code.ts';
export const CODE = 'packages/estate/src/scan/code.ts';
export const LINT = 'packages/estate/src/lint/lint.ts';

export type Kind = string;

/**
 * An atom of the kind sits on the line of the file. A gate, reference or hazard is read through the pointer
 * reader, so the check also plants the atom for the planted-truth labeller: a hazard names its id (`key`), a gate
 * waits for an Edit unless the item says another tool.
 */
export function atomAt(kind: Kind, file: string, line: number, key?: string, tool?: string): Check {
  const check: Check = (scan) => {
    const found = scan.map.atoms.filter(
      (atom) => atom.kind === kind && atom.provenance.file === file && atom.provenance.startLine === line,
    );
    return found.length === 0 ? `no ${kind} atom at ${file}:${line}` : undefined;
  };
  if (kind !== 'gate' && kind !== 'reference' && kind !== 'hazard') return check;
  return planting(check, {
    kind,
    file,
    line,
    ...(key !== undefined ? { key } : {}),
    ...(kind === 'gate' ? { tool: tool ?? 'Edit' } : {}),
  });
}

/** No atom of the kind sits on any of the lines of the file. */
export function noAtomOn(kind: Kind, file: string, lines: readonly number[]): Check {
  return (scan) => {
    const hit = scan.map.atoms.find(
      (atom) =>
        atom.kind === kind && atom.provenance.file === file && lines.includes(atom.provenance.startLine),
    );
    return hit ? `a ${kind} atom ${hit.id} at ${file}:${hit.provenance.startLine}, none planted` : undefined;
  };
}

/** The file holds exactly this many atoms of the kind. */
export function atomsIn(kind: Kind, file: string, count: number): Check {
  return (scan) => {
    const found = scan.map.atoms.filter((atom) => atom.kind === kind && atom.provenance.file === file);
    return found.length === count ? undefined : `${found.length} ${kind} atoms in ${file}, expected ${count}`;
  };
}

/** A skill atom (or a subagent atom) with the name exists. */
export function unitNamed(kind: 'skill' | 'subagent', name: string): Check {
  return (scan) =>
    scan.map.atoms.some((atom) => atom.kind === kind && atom.fields?.name === name)
      ? undefined
      : `no ${kind} atom named ${name}`;
}

/** The lint holds a finding of the code whose subject or message holds the needle. */
export function lintHas(code: string, needle: string): Check {
  return (scan) =>
    scan.lint.findings.some(
      (finding) => finding.code === code && `${finding.subject} ${finding.message}`.includes(needle),
    )
      ? undefined
      : `no ${code} finding about ${needle}`;
}

/** The lint holds no finding of the code whose subject or message holds the needle. */
export function lintLacks(code: string, needle: string): Check {
  return (scan) => {
    const hit = scan.lint.findings.find(
      (finding) => finding.code === code && `${finding.subject} ${finding.message}`.includes(needle),
    );
    return hit ? `a ${code} finding about ${needle}: ${hit.message}` : undefined;
  };
}

/** The lint holds no finding at all of the code. */
export function lintNone(code: string): Check {
  return (scan) => {
    const hit = scan.lint.findings.find((finding) => finding.code === code);
    return hit ? `a ${code} finding: ${hit.message}` : undefined;
  };
}

/** The lint holds this many findings of the code. */
export function lintCount(code: string, count: number): Check {
  return (scan) => {
    const found = scan.lint.findings.filter((finding) => finding.code === code);
    return found.length === count
      ? undefined
      : `${found.length} ${code} findings (${found.map((f) => f.subject).join(', ')}), expected ${count}`;
  };
}

/** An edge of the kind runs from an atom at one place to an atom at another. */
export function edgeBetween(
  kind: string,
  from: { kind: Kind; file: string; line?: number },
  to: { kind: Kind; file?: string; line?: number; name?: string } | { event: string },
): Check {
  const check: Check = (scan) => {
    const atoms = scan.map.atoms;
    const starts = atoms.filter(
      (atom) =>
        atom.kind === from.kind &&
        atom.provenance.file === from.file &&
        (from.line === undefined || atom.provenance.startLine === from.line),
    );
    const ends = (id: string): boolean => {
      if ('event' in to) return id === `event.${to.event}`;
      const atom = scan.atomOf.get(id);
      if (!atom || atom.kind !== to.kind) return false;
      if (to.file !== undefined && atom.provenance.file !== to.file) return false;
      if (to.line !== undefined && atom.provenance.startLine !== to.line) return false;
      if (to.name !== undefined && atom.fields?.name !== to.name) return false;
      return true;
    };
    const ids = new Set(starts.map((atom) => atom.id));
    return scan.map.edges.some((edge) => edge.kind === kind && ids.has(edge.from) && ends(edge.to))
      ? undefined
      : `no ${kind} edge from ${from.kind} at ${from.file}${from.line ? `:${from.line}` : ''}`;
  };
  // A route to a skill from a row is read through the pointer reader: plant the row for the labeller.
  const row = kind === 'route' && from.kind === 'route' && from.line !== undefined;
  if (row && 'name' in to && to.kind === 'skill') {
    return planting(check, { kind: 'route', file: from.file, line: from.line as number, key: to.name });
  }
  return check;
}

/** No edge of the kind leaves an atom of the file. */
export function noEdgeFrom(kind: string, file: string): Check {
  return (scan) => {
    const ids = new Set(
      scan.map.atoms.filter((atom) => atom.provenance.file === file).map((atom) => atom.id),
    );
    return scan.map.edges.some((edge) => edge.kind === kind && ids.has(edge.from))
      ? `a ${kind} edge leaves ${file}`
      : undefined;
  };
}

/** A body line, or a line with the atom the planted-truth labeller must find on it. */
export type Body = string | { text: string; hint: Omit<Hint, 'file' | 'line'> };

/** A body line that names a reference file. */
export function naming(text: string): Body {
  return { text, hint: { kind: 'reference' } };
}

/** A body line that hands work to a helper. */
export function handing(helper: string | readonly string[], text: string): Body {
  const helpers = typeof helper === 'string' ? [helper] : helper;
  return {
    text,
    hint: {
      kind: 'instruction',
      prose: {
        kind: 'instruction',
        title: `Dispatch ${helpers.join(' and ')}`,
        quote: text,
        evidence: helpers.map((name) => ({
          type: 'tool_called' as const,
          label: 'Agent',
          input: { subagent_type: name },
        })),
      },
    },
  };
}

/** Writes the body lines of a file; returns the line of each. */
function writeBody(estate: PlantedEstate, writer: FileWriter, body: readonly Body[]): number[] {
  return body.map((entry) => {
    const line = writer.line(typeof entry === 'string' ? entry : entry.text);
    if (typeof entry !== 'string') estate.hint({ ...entry.hint, file: writer.path, line });
    return line;
  });
}

/** The standing file as a free writer: a title first. */
export function standingFree(estate: PlantedEstate): FileWriter {
  const writer = estate.file(STANDING, BASE);
  if (writer.lines.length === 0) {
    writer.line('# Planted estate');
    writer.line('');
  }
  return writer;
}

/** A skill file written free: frontmatter, a title, then the body lines. Returns the line of each body line. */
export function freeSkill(
  estate: PlantedEstate,
  name: string,
  description: string,
  body: readonly Body[],
  options: { folder?: string; extraFront?: readonly string[] } = {},
): { path: string; lines: number[]; nameLine: number; descriptionLine: number } {
  const path = skillFile(options.folder ?? name, 'SKILL.md');
  const writer = estate.file(path, BASE);
  writer.line('---');
  const nameLine = writer.line(`name: ${name}`);
  const descriptionLine = writer.line(`description: ${description}`);
  writer.line('allowed-tools: Read, Edit, Bash');
  for (const extra of options.extraFront ?? []) writer.line(extra);
  writer.line('---');
  writer.line('');
  writer.line(`# ${name}`);
  writer.line('');
  const lines = writeBody(estate, writer, body);
  return { path, lines, nameLine, descriptionLine };
}

/** A helper file written free; returns the line of each body line. */
export function freeHelper(
  estate: PlantedEstate,
  name: string,
  body: readonly Body[],
): { path: string; lines: number[] } {
  const path = helperFile(name);
  const writer = estate.file(path, BASE);
  writer.lines_(['---', `name: ${name}`, 'description: Checks harbour records.', 'tools: Read', '---', '']);
  const lines = writeBody(estate, writer, body);
  return { path, lines };
}

const PLACES = ['ferry', 'bakery', 'library', 'harbour', 'orchard', 'lighthouse', 'kiln', 'market'] as const;
const THINGS = ['timetable', 'loaf', 'catalogue', 'mooring', 'crate', 'lantern', 'glaze', 'stall'] as const;

/** Two fictional words for the item on the seed, stable for the pair. */
export function theme(seed: number, owner: string): { place: string; thing: string } {
  let hash = seed * 2654435761;
  for (const char of owner) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return {
    place: PLACES[hash % PLACES.length] as string,
    thing: THINGS[Math.floor(hash / 8) % THINGS.length] as string,
  };
}

/** A short unique tag for the item, so two names never collide across the items of a family. */
export function tag(owner: string): string {
  let hash = 0x811c9dc5;
  for (const char of owner) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(36);
}
