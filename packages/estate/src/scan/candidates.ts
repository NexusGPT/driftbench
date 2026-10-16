import nlp from 'compromise/two';
import type { Atom } from '../schema';
import type { AtomBuilder } from './code';
import type { ProseChunk, RawEstate } from './reader';
import { readFrontmatter } from './text';

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
  const answeredFiles = new Set(resolved.map((chunk) => chunk.file));
  for (const file of raw.files) {
    if (!['standing', 'memory', 'skill', 'skill_file', 'subagent'].includes(file.kind)) continue;
    if (answeredFiles.has(file.path) && !pendingFiles.has(file.path)) continue;
    const body = readFrontmatter(file.text);
    const lines = file.text.split('\n');
    const visible = normativeLines(lines, body.bodyLine);
    for (const block of visible) {
      // Segment the masked text, retaining original offsets, including soft line wraps.
      for (const segment of proseClauses(block.masked.replace(/\n/g, ' '))) {
        const text = segment.segment.trim();
        if (!text || text.includes('?')) continue;
        const leading = segment.segment.length - segment.segment.trimStart().length;
        const offset = segment.index + leading;
        const quote = block.original.slice(offset, segment.index + segment.segment.trimEnd().length);
        if (!quote.trim()) continue;
        const startLine = block.startLine + countNewlines(block.original.slice(0, offset));
        const endLine = startLine + countNewlines(quote);
        let rule: Rule | undefined;
        try {
          rule = clauseRule(text);
        } catch (cause) {
          raw.notes.push({
            file: file.path,
            message: `Prose candidate skipped at lines ${startLine}-${endLine}: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
          continue;
        }
        if (!rule) continue;
        // A successfully answered model chunk supersedes the cheaper candidate pass for its source span.
        if (
          resolved.some(
            (chunk) => chunk.file === file.path && chunk.startLine <= startLine && endLine <= chunk.endLine,
          )
        )
          continue;
        // A structured or model rule already occupying this passage is more informative.
        if (
          builder
            .atomsOf(file.path)
            .some(
              (atom) =>
                ['instruction', 'gate', 'register'].includes(atom.kind) &&
                atom.provenance.startLine <= endLine &&
                startLine <= atom.provenance.endLine &&
                (atom.kind === 'gate'
                  ? rule.form === 'conditional' || ruleText(atom.provenance.quote) === ruleText(quote)
                  : atom.provenance.quote.includes(quote.trim())),
            )
        )
          continue;
        const helper = raw.subagents.find((agent) => agent.file === file.path);
        const scope = helper ? 'helper' : file.owner ? 'skill' : 'estate';
        const owner = helper?.name ?? file.owner;
        const kind =
          /\b(?:reply|replies|response|responses|answer|answers|sentences?|paragraphs?|words|characters|tone|language|format)\b/i.test(
            rule.subject,
          ) ||
          /^(?:always\s+|never\s+|do\s+not\s+)?(?:answer|reply|respond)\b/i.test(text) ||
          /\bmust\s+(?:not\s+)?(?:answer|reply|respond)\b/i.test(text)
            ? 'register'
            : 'instruction';
        added.push(
          builder.add({
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
              form: rule.form,
            },
          }),
        );
      }
    }
  }
  return added;
}

function countNewlines(text: string): number {
  return text.split('\n').length - 1;
}
const blank = (text: string) => text.replace(/[^\n]/g, ' ');

type Block = { original: string; masked: string; startLine: number };
/** Markdown exclusion is applied to whole files, so a fence or example can cross a model chunk. */
function normativeLines(lines: string[], bodyStart: number): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  let fence: { char: string; length: number } | undefined;
  let comment = false;
  let quotation: string | undefined;
  let excludedLevel: number | undefined;
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
    const heading =
      /^\s{0,3}(#{1,6})\s+(.+)/.exec(line) ??
      (setext ? ['', underline[1]?.startsWith('=') ? '#' : '##', line] : undefined);
    if (setext) i++;

    if (heading) {
      if (excludedLevel !== undefined && (heading[1] ?? '').length <= excludedLevel)
        excludedLevel = undefined;
      if (
        /\b(?:examples?|samples?|quotations?|history|changelog|templates?|fixtures?)\b/i.test(
          heading[2] ?? '',
        )
      )
        excludedLevel = (heading[1] ?? '').length;
      current = undefined;
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
    // Quoted and inline-code payloads cannot supply modalities or verbs.
    line = line.replace(/`+[^`]*`+|(?<!\w)'[^'\n]+'(?!\w)|‘[^’\n]*’/g, blank);
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
    const list = /^\s*(?:[-+*]|\d+[.)])\s/.test(original);
    if (!current || list) {
      current = { original, masked: line, startLine: i + 1 };
      blocks.push(current);
    } else {
      current.original += `\n${original}`;
      current.masked += `\n${line}`;
    }
  }
  return blocks;
}

type Rule = { subject: string; polarity: 'obligation' | 'prohibition'; form: string };
function clauseRule(source: string): Rule | undefined {
  // Parenthetical payloads are opaque to clause grammar, while the original quote remains intact.
  const text = source.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, blank);
  // Fast prefilter for grammatical operators, before the POS parser visits long prose.
  if (!/\b(?:must|never|always|only\s+when|do\s+not|before|at\s+most|every|each)\b/i.test(text)) return;
  if (/\b(?:word|phrase|example|sample|quotation)\b/i.test(text.split(/\b(?:must|never|always)\b/i)[0] ?? ''))
    return;
  const parsed = nlp(text);
  const verbs = (parsed.match('#Verb').out('array') as string[])
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
    .filter(Boolean);
  const hasAct = verbs.length > 0;
  const modal = /^(.*?)\bmust\s+((?:not|never)\s+)?(.+)$/i.exec(text);
  if (
    modal &&
    hasAct &&
    !/\b(?:said|says|wrote|writes|asked|asks|reads|means|word|phrase|example)\b/i.test(modal[1] ?? '')
  ) {
    return {
      subject: (modal[1] ?? '').split(',').at(-1)?.trim() || 'agent',
      polarity: modal[2] ? 'prohibition' : 'obligation',
      form: 'modal',
    };
  }
  const negative = /^(.*?)\b(never|do\s+not)\s+(.+)$/i.exec(text);
  if (
    negative &&
    (hasAct || imperative(negative[3] ?? '')) &&
    ((negative[1] ?? '').trim() === '' ||
      nlp(negative[1] ?? '').has('#Noun') ||
      /^(?:you|we|it)\s*$/i.test(negative[1] ?? ''))
  ) {
    if (nlp(negative[1] ?? '').has('#Verb')) return;
    return { subject: (negative[1] ?? '').trim() || 'agent', polarity: 'prohibition', form: 'negative' };
  }
  const always = /^(.*?)\balways\s+(.+)$/i.exec(text);
  if (always && (hasAct || imperative(always[2] ?? '')) && !nlp(always[1] ?? '').has('#Verb'))
    return { subject: (always[1] ?? '').trim() || 'agent', polarity: 'obligation', form: 'universal' };
  const bound = /^at\s+most\s+(.+)$/i.exec(text);
  if (!bound && /\bat\s+most\b/i.test(text) && parsed.has('^#Verb') && parsed.has('#Value'))
    return {
      subject: parsed.match('#Noun+').first().text() || 'agent',
      polarity: 'obligation',
      form: 'bound',
    };
  if (bound && parsed.has('#Value') && parsed.has('#Noun'))
    return { subject: bound[1] ?? '', polarity: 'obligation', form: 'bound' };
  const quantified = /^(?:every|each)\s+(.+)$/i.exec(text);
  if (quantified && parsed.has('#PresentTense')) {
    const verb = (verbs[0] ?? '').split(/\s+/)[0]?.toLowerCase();
    const token = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].find(
      (entry) => entry[0].toLowerCase() === verb,
    );
    if (!token || token.index <= 0) return;
    const subject = text.slice(0, token.index).replace(/\s+/g, ' ').trim();
    return { subject, polarity: 'obligation', form: 'quantified' };
  }
  const conditional = /^(?:before|only\s+when)\s+(.+?)[,:]\s*(.+)$/i.exec(text);
  if (
    conditional &&
    (nlp(conditional[1] ?? '').has('#Verb') || /^only\s+when/i.test(text)) &&
    (nlp(conditional[2] ?? '').has('^#Verb') || imperative(conditional[2] ?? ''))
  )
    return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
  if (/\bonly\s+when\b/i.test(text) && parsed.has('^#Verb'))
    return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
  return;
}

/** Supply an overt subject/modal to disambiguate a bare imperative, without a verb vocabulary. */
function imperative(text: string): boolean {
  return nlp(`You must ${text}`).has('^#Pronoun #Modal #Verb');
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
