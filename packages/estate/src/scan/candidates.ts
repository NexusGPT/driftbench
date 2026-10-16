import type { Atom } from '../schema';
import { clauseRule, NORMATIVE_HEADING, type Rule, type RuleContext } from './clause-rule';
import type { AtomBuilder } from './code';
import type { ProseChunk, RawEstate } from './reader';
import { lineAt, quoteAtSpan, readFrontmatter } from './text';

/** Conservative English clause proposals. These are evidence for review, never approved rules. */
export function proseCandidates(
  raw: RawEstate,
  builder: AtomBuilder,
  resolved: readonly ProseChunk[] = [],
): Atom[] {
  const added: Atom[] = [];
  const answered = new Set(resolved.map((chunk) => chunk.id));
  const pendingFiles = new Set(
    raw.prose.filter((chunk) => !answered.has(chunk.id)).map((chunk) => chunk.file),
  );
  // Sentences the grammar has already refused, with digits collapsed: boilerplate repeats across a scan.
  const noRule = new Set<string>();
  const answeredByFile = new Map<string, ProseChunk[]>();
  const names = new Set(
    [...raw.skills.map((skill) => skill.name), ...raw.subagents.map((agent) => agent.name)].map((name) =>
      name.toLowerCase(),
    ),
  );
  const manifests = new Set(
    raw.files.filter((file) => MANIFESTS.test(file.path)).map((file) => file.path.replace(/\/[^/]*$/, '')),
  );
  for (const chunk of resolved)
    answeredByFile.set(chunk.file, [...(answeredByFile.get(chunk.file) ?? []), chunk]);
  for (const file of raw.files) {
    if (!['standing', 'memory', 'skill', 'skill_file', 'subagent'].includes(file.kind)) continue;
    // Only prose is read for rules, and never another project's documentation.
    if (file.kind === 'skill_file' && !/\.(?:md|markdown|mdx|txt)$/i.test(file.path)) continue;
    if (isThirdParty(file, manifests)) continue;
    const resolvedHere = answeredByFile.get(file.path) ?? [];
    if (resolvedHere.length > 0 && !pendingFiles.has(file.path)) continue;
    try {
      candidatesOfFile(raw, builder, file, resolvedHere, added, names, noRule);
    } catch (cause) {
      // One unreadable file never costs the rest of the scan; the scan summary counts what was skipped.
      raw.notes.push({
        file: file.path,
        message: `Prose candidate skipped for the whole file: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }
  return added;
}

/** The atoms of one file that may already say what a clause says, found by line span without a rescan. */
class OccupiedLines {
  private readonly sorted: Atom[];
  private readonly reach: number[] = [];
  private readonly mine: Atom[] = [];
  constructor(existing: readonly Atom[], kinds: readonly string[] = ['instruction', 'gate', 'register']) {
    this.sorted = existing
      .filter((atom) => kinds.includes(atom.kind))
      .sort((a, b) => a.provenance.startLine - b.provenance.startLine);
    let reach = 0;
    for (const atom of this.sorted) {
      reach = Math.max(reach, atom.provenance.endLine);
      this.reach.push(reach);
    }
  }
  /** Candidates are added in reading order, so each ends at or after the one before it. */
  record(atom: Atom): void {
    this.mine.push(atom);
  }
  some(startLine: number, endLine: number, test: (atom: Atom) => boolean): boolean {
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.sorted[middle] as Atom).provenance.startLine <= endLine) low = middle + 1;
      else high = middle;
    }
    for (let at = low - 1; at >= 0 && (this.reach[at] as number) >= startLine; at--) {
      const atom = this.sorted[at] as Atom;
      if (atom.provenance.endLine >= startLine && test(atom)) return true;
    }
    for (let at = this.mine.length - 1; at >= 0; at--) {
      const atom = this.mine[at] as Atom;
      if (atom.provenance.endLine < startLine) break;
      if (atom.provenance.startLine <= endLine && test(atom)) return true;
    }
    return false;
  }
}

function candidatesOfFile(
  raw: RawEstate,
  builder: AtomBuilder,
  file: RawEstate['files'][number],
  resolved: readonly ProseChunk[],
  added: Atom[],
  names: ReadonlySet<string>,
  noRule: Set<string>,
): void {
  const body = readFrontmatter(file.text);
  const lines = file.text.split('\n');
  const visible = normativeLines(lines, body.bodyLine);
  const occupied = new OccupiedLines(builder.atomsOf(file.path));
  // A bare instruction ("Read X first.") that code already reads as a reference, script, route or hazard
  // is that atom's own sentence, not a second rule.
  const covered = new OccupiedLines(builder.atomsOf(file.path), [
    'reference',
    'script',
    'route',
    'hazard',
    'gate',
    'instruction',
    'register',
  ]);
  const helper = raw.subagents.find((agent) => agent.file === file.path);
  const scope = helper ? 'helper' : file.owner ? 'skill' : 'estate';
  const owner = helper?.name ?? file.owner;
  for (const block of visible) {
    // Segment the masked text, retaining original offsets, including soft line wraps.
    for (const segment of proseClauses(block.masked.replace(/\n/g, ' '))) {
      const text = segment.segment.trim();
      if (!text || text.includes('?')) continue;
      const leading = segment.segment.length - segment.segment.trimStart().length;
      const offset = segment.index + leading;
      const quote = block.original.slice(offset, segment.index + segment.segment.trimEnd().length);
      if (!quote.trim()) continue;
      // An indexed lookup: counting line breaks from the top of the block makes a long block quadratic.
      const startLine = block.startLine + lineAt(block.original, offset) - 1;
      const endLine = startLine + countNewlines(quote);
      let rule: Rule | undefined;
      try {
        const normative = NORMATIVE_HEADING.test(block.heading);
        const key = `${normative ? 1 : 0}|${text.replace(/\d+/g, '#')}`;
        if (noRule.has(key)) continue;
        rule = clauseRule(text, { names, normative });
        if (!rule) {
          noRule.add(key);
          continue;
        }
        // The map accepts only a quote the extractor's own check finds at its lines (a quote ending in an
        // escaping backslash does not survive that check), so a clause whose quote fails it is not proposed.
        if (rule && !quoteAtSpan(file.text, { file: file.path, startLine, endLine, quote }))
          throw new Error('the quote cannot be found at its lines');
      } catch (cause) {
        raw.notes.push({
          file: file.path,
          message: `Prose candidate skipped at lines ${startLine}-${endLine}: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        continue;
      }
      if (!rule) continue;
      const form = rule.form;
      // A successfully answered model chunk supersedes the cheaper candidate pass for its source span.
      if (resolved.some((chunk) => chunk.startLine <= startLine && endLine <= chunk.endLine)) continue;
      // A structured or model rule already occupying this passage is more informative.
      if (
        (form === 'imperative' ? covered : occupied).some(startLine, endLine, (atom) =>
          form === 'imperative' && !['instruction', 'register', 'gate'].includes(atom.kind)
            ? true
            : atom.kind === 'gate'
              ? form === 'conditional' || ruleText(atom.provenance.quote) === ruleText(quote)
              : atom.provenance.quote.includes(quote.trim()),
        )
      )
        continue;
      const kind =
        /\b(?:reply|replies|response|responses|answer|answers|sentences?|paragraphs?|words|characters|tone|language|format)\b/i.test(
          rule.subject,
        ) ||
        /^(?:always\s+|never\s+|do\s+not\s+)?(?:answer|reply|respond)\b/i.test(text) ||
        /\bmust\s+(?:not\s+)?(?:answer|reply|respond)\b/i.test(text)
          ? 'register'
          : 'instruction';
      const atom = builder.add({
        kind,
        title: quote.trim().replace(/\s+/g, ' '),
        at: { file: file.path, startLine, endLine, quote },
        approved: false,
        evidence: [{ type: 'custom', name: 'prose_candidate', options: { reviewRequired: true } }],
        fields: {
          candidate: true,
          extraction: 'code-found',
          scope,
          ...(owner ? { owner } : {}),
          polarity: rule.polarity,
          subject: rule.subject,
          form,
          // The act's object is a pronoun for an earlier sentence: a reviewer must supply it.
          ...(rule.partial ? { partial: true, confidence: 'low' } : {}),
        },
      });
      occupied.record(atom);
      covered.record(atom);
      added.push(atom);
    }
  }
}

const MANIFESTS =
  /(?:^|\/)(?:package\.json|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|composer\.json|Gemfile|[^/]+\.gemspec)$/;
const VENDOR_FOLDER =
  /(?:^|\/)(?:node_modules|vendor|vendors|vendored|third[_-]?party|3rdparty|site-packages|bower_components)(?:\/|$)/i;
const GENERATED = /@generated|\bdo not edit\b|\bauto-?generated\b|code generated by/i;

/**
 * Documentation that belongs to another project: a vendor folder, a folder that holds its own package
 * manifest below the skill that carries it, or a file that says a tool generated it.
 */
function isThirdParty(file: RawEstate['files'][number], manifests: ReadonlySet<string>): boolean {
  if (VENDOR_FOLDER.test(file.path) || /\.d\.ts$/.test(file.path)) return true;
  if (GENERATED.test(file.text.slice(0, 400))) return true;
  if (file.kind !== 'skill_file') return false;
  const parts = file.path.split('/');
  // Folders strictly between the skill's own folder (.claude/skills/<name>) and the file.
  for (let depth = parts.length - 1; depth > 3; depth--)
    if (manifests.has(parts.slice(0, depth).join('/'))) return true;
  return false;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) count++;
  return count;
}
const blank = (text: string) => text.replace(/[^\n]/g, ' ');

/**
 * The start of a paragraph or list item that is not the document's own rule: marked wrong or bad, a dated
 * entry of a log, or a line spoken by someone in a transcript.
 */
const SKIPPED_BLOCK = new RegExp(
  [
    '^(?:[✗✘❌]|×\\s)',
    '^(?:wrong|bad|incorrect|invalid|anti-?patterns?|counter-?examples?|bad\\s+examples?|wrong\\s+examples?)\\b[^:—–\\n]{0,20}[:—–]',
    '^[\\[(]?(?:\\d{4}-\\d{2}(?:-\\d{2})?|\\d{1,2}/\\d{1,2}/\\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,4}|\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?|v?\\d+\\.\\d+(?:\\.\\d+)?)[)\\]]?\\s*[:—–-]',
    '^(?:user|customer|client|human|assistant|agent|bot|claude|q|a)\\s*:',
  ].join('|'),
  'iu',
);

type Block = { original: string; masked: string; startLine: number; heading: string };
/** Markdown exclusion is applied to whole files, so a fence or example can cross a model chunk. */
function normativeLines(lines: string[], bodyStart: number): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  let fence: { char: string; length: number } | undefined;
  let comment = false;
  let quotation: string | undefined;
  let excludedLevel: number | undefined;
  let heading = '';
  // A paragraph or list item the document marks as wrong, dated, or spoken by someone else is skipped whole.
  let skipping = false;
  for (let i = bodyStart - 1; i < lines.length; i++) {
    const original = lines[i] ?? '';
    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(original)?.[1];
      if (close?.[0] === fence.char && close.length >= fence.length) fence = undefined;
      continue;
    }
    let line = original.replace(/<!--|-->|[\s\S]+?(?=<!--|-->|$)/g, (part) => {
      if (part === '<!--') {
        comment = true;
        return blank(part);
      }
      if (part === '-->') {
        comment = false;
        return blank(part);
      }
      return comment ? blank(part) : part;
    });
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      fence = { char: marker[0] ?? '', length: marker.length };
      current = undefined;
      continue;
    }
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(lines[i + 1] ?? '');
    const setext = line.trim() && underline;
    const headed =
      /^\s{0,3}(#{1,6})\s+(.+)/.exec(line) ??
      (setext ? ['', underline[1]?.startsWith('=') ? '#' : '##', line] : undefined);
    if (setext) i++;

    if (headed) {
      if (excludedLevel !== undefined && (headed[1] ?? '').length <= excludedLevel) excludedLevel = undefined;
      if (
        /\b(?:examples?|samples?|quotations?|history|changelog|templates?|fixtures?|anti-?patterns?|counter-?examples?|wrong|incorrect)\b/i.test(
          headed[2] ?? '',
        )
      )
        excludedLevel = (headed[1] ?? '').length;
      heading = headed[2] ?? '';
      current = undefined;
      skipping = false;
      continue;
    }
    if (
      excludedLevel !== undefined ||
      /^\s*(?:>|```|~~~)/.test(line) ||
      /^(?: {4}|\t)/.test(line) ||
      !line.trim()
    ) {
      current = undefined;
      continue;
    }
    const list = /^\s*(?:[-+*]|\d+[.)])\s/.test(original);
    if (list || !current) skipping = false;
    if (skipping) continue;
    if (SKIPPED_BLOCK.test(original.replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)?[*_]*/, ''))) {
      skipping = true;
      current = undefined;
      continue;
    }
    // A quotation never outlives its paragraph, so one stray quotation mark (5" pipe) cannot hide the file.
    if (!current || list) quotation = undefined;
    // Quoted and inline-code payloads cannot supply modalities or verbs.
    line = line.replace(
      /`+[^`]*`+|(?<!\w)'[^'\n]+'(?!\w)|‘[^’\n]*’|«[^»\n]*»|‹[^›\n]*›|„[^“”\n]*[“”]|「[^」\n]*」|『[^』\n]*』/g,
      blank,
    );
    let unquoted = '';
    for (const char of line) {
      if (quotation) {
        unquoted += ' ';
        if (char === quotation) quotation = undefined;
      } else if (char === '"' || char === '“') {
        quotation = char === '“' ? '”' : '"';
        unquoted += ' ';
      } else unquoted += char;
    }
    line = unquoted;
    if (line.includes('|')) {
      current = undefined;
      continue;
    }
    line = line.replace(
      /\[([^\]]+)\]\([^)]*\)/g,
      (all, label: string) => label + ' '.repeat(all.length - label.length),
    );
    line = line.replace(/[*_]/g, ' ');
    const prefix = /^\s*(?:[-+*]\s+|\d+[.)]\s+)?(?:R#?\d+\s*[:.-]\s*)?/.exec(line)?.[0] ?? '';
    line = ' '.repeat(prefix.length) + line.slice(prefix.length);
    if (!current || list) {
      current = { original, masked: line, startLine: i + 1, heading };
      blocks.push(current);
    } else {
      current.original += `\n${original}`;
      current.masked += `\n${line}`;
    }
  }
  return blocks;
}

function ruleText(text: string): string {
  return text
    .replace(/^\s*[-+*]?\s*(?:\*\*)?R#?\d+[.:]\s*(?:\*\*)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const sentenceSegments = new Intl.Segmenter('en', { granularity: 'sentence' });
function* proseClauses(text: string): Generator<{ segment: string; index: number }> {
  for (const sentence of sentenceSegments.segment(text)) {
    if (sentence.segment.includes('?')) continue;
    for (const clause of sentence.segment.matchAll(/[^;]+/g)) {
      yield { segment: clause[0], index: sentence.index + (clause.index ?? 0) };
    }
  }
}
