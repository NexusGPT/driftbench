import { posix } from 'node:path';
import type { DocumentInfo, DocumentRole } from '../schema';
import type { EstateFile, RawEstate } from './reader';
import { blankFences, readFrontmatter } from './text';

/**
 * The role of a document comes, in this order, from what the estate declares for it (`documents:` in
 * driftbench.estate.yaml), from the label the pointer reader recorded for it (the document-roles set, applied by
 * the scan), or from its structure: repeated value slots make a template, a list of dated entries a history.
 * No word of a folder name, a heading or a line decides a role.
 */
const DATE = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/;
const DATED_ENTRY = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/;
function datedEntry(line: string): boolean {
  return DATED_ENTRY.test(line) && DATE.test(line);
}

/**
 * A counter-example is shown so that it is not followed. A cross mark alone on its line, at the start of a line,
 * a list item or a table cell, opens it: the block that follows is the counter-example. The mark is a symbol, not
 * a word.
 */
const WRONG_MARK = '(?:[✗✘❌]|×)';
/** What may precede a marker at the start of a line: a quote, a list bullet or number, a table cell, bold. */
const LEAD = String.raw`\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(?:\|\s*)?(?:\*\*|__)?`;
/** A line holding only the marker: the counter-example is the block that follows. */
const WRONG_STANDALONE = new RegExp(String.raw`^${LEAD}${WRONG_MARK}(?:\*\*|__)?\s*$`, 'u');

/** Classify before reading declarations. A declared role wins; one incidental date or slot never changes authority. */
/** The reason a file the runtime itself loads as instructions is normative: its place, never a label or a word. */
export const RUNTIME_INSTRUCTIONS = 'loaded by the runtime as instructions';

export function classifyDocument(
  file: Pick<EstateFile, 'path' | 'text'> & { kind?: EstateFile['kind'] },
  _unitFolder?: string,
  declared?: DocumentRole,
): DocumentInfo {
  if (declared !== undefined)
    return { path: file.path, role: declared, reasons: ['declared in driftbench.estate.yaml'] };
  // The standing file, memory, a skill's body and a helper's body are what the runtime gives the agent as its
  // instructions: their role is set by that place, so no label pass asks about them.
  if (file.kind === 'standing' || file.kind === 'memory' || file.kind === 'skill' || file.kind === 'subagent')
    return { path: file.path, role: 'normative', reasons: [RUNTIME_INSTRUCTIONS] };
  const markdown = /\.(?:md|markdown|txt)$/i.test(file.path);
  if (!markdown) return { path: file.path, role: 'normative', reasons: ['runtime structure or executable'] };
  const bodyLine = readFrontmatter(file.text).bodyLine;
  const lines = file.text.split('\n');
  const visible = blankFences(
    lines.map((line, index) => (index < bodyLine - 1 ? '' : line)).join('\n'),
  ).split('\n');

  // A fill-in document can have an arbitrary title. Repeated value slots, rather than variable
  // paths inside directives, establish a template without borrowing authority from its name.
  const content = visible.filter((line) => line.trim() && !/^\s*#/.test(line));
  const slots = visible.filter((line) =>
    /^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:[\w -]+:\s*)?(?:\{\{[^{}]+\}\}|<[a-z][\w.-]*>)\s*$/i.test(line),
  );
  if (slots.length >= 2 && slots.length * 2 >= content.length)
    return { path: file.path, role: 'template', reasons: ['repeated placeholder value slots'] };

  // Repeated date headings establish an entry list whatever the title says.
  const datedEntries = visible.filter(datedEntry).length;
  const firstEntry = visible.findIndex(datedEntry);
  const firstContent = visible.findIndex((line) => line.trim() !== '');
  const beforeEntries = visible
    .slice(0, firstEntry)
    .filter((line, index) => line.trim() && !(index === firstContent && /^#\s+/.test(line)));
  if (datedEntries >= 2 && beforeEntries.length === 0)
    return { path: file.path, role: 'history', reasons: ['document consists of dated entries'] };

  const sections: NonNullable<DocumentInfo['sections']> = [];
  for (let index = bodyLine - 1; index < visible.length; index++) {
    const line = visible[index] ?? '';
    // A cross mark alone on its line opens a counter-example: never suppress neighbouring operational text.
    if (!line.includes(';') && WRONG_STANDALONE.test(line)) {
      const endLine = exampleBlockEnd(lines, index);
      sections.push({ startLine: index + 1, endLine, role: 'example' });
      index = endLine - 1;
    }
  }
  return {
    path: file.path,
    role: 'normative',
    reasons: ['live document; no whole-document navigation structure'],
    ...(sections.length ? { sections } : {}),
  };
}

/** The paragraph or quoted/fenced block belonging to a standalone example introducer. */
function exampleBlockEnd(lines: readonly string[], start: number): number {
  let first = start + 1;
  while (first < lines.length && lines[first]?.trim() === '') first++;
  const opening = lines[first] ?? '';
  if (/^#{1,6}\s/.test(opening)) return start + 1;
  const fence = /^\s*(`{3,}|~{3,})/.exec(opening)?.[1];
  if (fence) {
    const closing = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    for (let index = first + 1; index < lines.length; index++)
      if (closing.test(lines[index] ?? '')) return index + 1;
    return lines.length;
  }
  const quoted = /^\s*>/.test(opening);
  let end = first;
  while (end < lines.length && lines[end]?.trim() && !/^#{1,6}\s/.test(lines[end] ?? '')) {
    if (quoted && !/^\s*>/.test(lines[end] ?? '')) break;
    end++;
  }
  return Math.max(start + 1, end);
}

export function documentInfo(file: EstateFile): DocumentInfo {
  return file.document ?? classifyDocument(file);
}
export function isNormative(file: EstateFile): boolean {
  return documentInfo(file).role === 'normative';
}

/** The live declared unit (skill) whose folder holds a path: the unit that owns the file. */
export function owningUnit(raw: Pick<RawEstate, 'skills'>, path: string): string | undefined {
  const roots = new Set(raw.skills.map((skill) => posix.normalize(skill.folder)));
  let folder = posix.dirname(path);
  while (folder !== posix.dirname(folder)) {
    if (roots.has(folder)) return folder;
    folder = posix.dirname(folder);
  }
  return undefined;
}

const LOADED_BY_PLACE: ReadonlySet<EstateFile['kind']> = new Set([
  'standing',
  'memory',
  'settings',
  'skill',
  'subagent',
  'registry',
]);

/** Records and stores: nothing is expected to load them, so being named by no live document is no defect. */
const UNLOADED_BY_DESIGN: ReadonlySet<DocumentRole> = new Set([
  'changelog',
  'history',
  'journal',
  'archive',
  'fixture',
]);
/**
 * Whether being unnamed or unreachable is expected. A role never hides a defect that a live owner makes:
 * a template or an example exists to be read when a live document sends the reader to it, and any file
 * inside the folder of a live skill is that skill's material, so it stays a finding when nothing names it.
 * A file the runtime loads by its place (standing instructions, memory, settings, a skill or helper
 * definition, the check registry) is never exempt: a document's own role cannot hide it. Only a record or
 * store outside every live unit is exempt.
 */
export function unloadedByDesign(raw: Pick<RawEstate, 'skills'>, file: EstateFile): boolean {
  // The runtime loads these kinds by their place: what a document says about itself cannot exempt them.
  if (LOADED_BY_PLACE.has(file.kind)) return false;
  return UNLOADED_BY_DESIGN.has(documentInfo(file).role) && owningUnit(raw, file.path) === undefined;
}

/** Inclusive line intervals for live text; original text and provenance offsets remain untouched. */
export function normativeRanges(
  file: EstateFile,
  startLine: number,
  endLine: number,
): Array<{ startLine: number; endLine: number }> {
  const info = documentInfo(file);
  if (info.role !== 'normative') return [];
  const ranges: Array<{ startLine: number; endLine: number }> = [];
  let start = startLine;
  for (const section of info.sections ?? []) {
    if (section.endLine < start || section.startLine > endLine) continue;
    if (section.startLine > start) ranges.push({ startLine: start, endLine: section.startLine - 1 });
    start = Math.max(start, section.endLine + 1);
  }
  if (start <= endLine) ranges.push({ startLine: start, endLine });
  return ranges;
}

/** Apply the same authority boundary to readers of any runtime, including supplied raw estates. */
export function normativeEstate(raw: RawEstate): RawEstate {
  const unitOf = (path: string) => owningUnit(raw, path);
  const files = new Map(
    raw.files.map((file) => {
      file.document ??= classifyDocument(file, unitOf(file.path));
      return [file.path, file] as const;
    }),
  );
  const live = (path: string, line?: number) => {
    const file = files.get(path);
    if (!file) return true;
    if (!isNormative(file)) return false;
    return (
      line === undefined ||
      !(documentInfo(file).sections ?? []).some(
        (section) => line >= section.startLine && line <= section.endLine,
      )
    );
  };
  const prose = raw.prose.flatMap((chunk) => {
    const file = files.get(chunk.file);
    if (!file) return [chunk];
    const ranges = normativeRanges(file, chunk.startLine, chunk.endLine);
    if (
      ranges.length === 1 &&
      ranges[0]?.startLine === chunk.startLine &&
      ranges[0].endLine === chunk.endLine
    )
      return [chunk];
    return ranges
      .map((range) => ({
        ...chunk,
        id: `${chunk.id}@${range.startLine}`,
        ...range,
        text: chunk.text
          .split('\n')
          .slice(range.startLine - chunk.startLine, range.endLine - chunk.startLine + 1)
          .join('\n'),
      }))
      .filter((chunk) => chunk.text.trim() !== '');
  });
  return {
    ...raw,
    prose,
    skills: raw.skills.filter((declaration) => live(declaration.file)),
    subagents: raw.subagents.filter((declaration) => live(declaration.file)),
    guards: raw.guards.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    permissions: raw.permissions.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    settings: raw.settings.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    registry: raw.registry.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    steps: raw.steps.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
  };
}
