import {
  chunkLines,
  directiveHead,
  gateClauses,
  guardName,
  maskLine,
  registryRowOf,
  toolBase,
  unmask,
} from '../scan/code';
import type { EstateFile, RawEstate } from '../scan/reader';
import { labelOfLine, linesOf, plain } from '../scan/text';
import type { Atom, Edge } from '../schema';

/**
 * The estate graph: the edges of the design between atoms. A node is an atom id; an event a guard runs on
 * is a node of its own, named `event.<name>`, since no file states an event as an atom.
 *
 *   route      a route atom to the skill or helper it loads
 *   reference  a skill or helper to a file its body names (a reference atom)
 *   script     a skill to a script it ships
 *   dispatch   a skill or helper to a helper its body names
 *   enforces   a guard to a rule it checks
 *   event      a guard to the event it runs on
 *   allows     a skill or helper to a tool or skill it may use
 *   next       a stage to the stage that follows it
 *   cites      a rule to a rule its words name by label
 *
 * How `enforces` is decided, by code, in this order (the method is recorded on the guard atom):
 *   1. registry: a check registry row names the guard's script and lists rule labels (R5) or quoted
 *      passages; a rule is enforced when its line carries the label or its quote holds the passage.
 *   2. id: the guard's own source says `Enforces: R3, R5` (or `enforces R3`), or cites a rule as `R#3`
 *      anywhere in its text; same label match (a rule labelled `R#3` has the label R3).
 *   3. quote: a string in the guard's source of at least 16 characters equals a rule's quote, or one holds
 *      the other, compared without markup, case or final punctuation.
 * Only instruction, gate and register atoms are enforced. `enforcement` on each rule lists its guards.
 */

export const EVENT_PREFIX = 'event.';
const RULE_KINDS = new Set(['instruction', 'gate', 'register']);
const MIN_LITERAL = 16;

export type EnforceMethod = 'registry' | 'id' | 'quote';

export type Graph = {
  edges: Edge[];
  /** For each guard atom, the rules it enforces and how that was decided. */
  enforces: Map<string, Array<{ atom: string; by: EnforceMethod }>>;
};

/** The label a rule carries (R5), read from the line its quote starts on. */
export function labelOf(atom: Atom, files: ReadonlyMap<string, EstateFile>): string | undefined {
  const text = files.get(atom.provenance.file)?.text;
  if (text === undefined) return undefined;
  return labelOfLine(text.split('\n')[atom.provenance.startLine - 1] ?? '');
}

export function buildGraph(atoms: readonly Atom[], raw: RawEstate): Graph {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const edges: Edge[] = [];
  const add = (from: string, to: string, kind: Edge['kind']) => {
    if (from !== to) edges.push({ from, to, kind });
  };
  const byKind = (kind: Atom['kind']) => atoms.filter((atom) => atom.kind === kind);
  const unitOfName = new Map<string, Atom>();
  for (const atom of [...byKind('skill'), ...byKind('subagent')]) {
    const name = atom.fields?.name;
    if (typeof name === 'string') unitOfName.set(`${atom.kind}:${name}`, atom);
  }
  /** The skill or helper whose file an atom sits in. */
  const unitOfFile = new Map<string, Atom>();
  for (const atom of [...byKind('skill'), ...byKind('subagent')]) unitOfFile.set(atom.provenance.file, atom);

  for (const route of byKind('route')) {
    const target = unitOfName.get(`${route.fields?.targetKind}:${route.fields?.target}`);
    if (target) add(route.id, target.id, 'route');
  }

  // References can themselves name references. Follow those explicit reads for each unit, rather
  // than assigning all files in a skill folder to it: an unread sibling remains unowned, and a shared
  // guide retains every unit that reads it. A per-unit visited set bounds cycles in reference files.
  const referencesByFile = new Map<string, Atom[]>();
  for (const reference of byKind('reference')) {
    const file = reference.provenance.file;
    const references = referencesByFile.get(file) ?? [];
    references.push(reference);
    referencesByFile.set(file, references);
  }
  for (const unit of unitOfFile.values()) {
    const pending = [unit.provenance.file];
    const visited = new Set<string>();
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (visited.has(file)) continue;
      visited.add(file);
      for (const reference of referencesByFile.get(file) ?? []) {
        add(unit.id, reference.id, 'reference');
        const target = reference.fields?.path;
        if (typeof target === 'string' && files.has(target)) pending.push(target);
      }
    }
  }

  for (const script of byKind('script')) {
    const unit = unitOfName.get(`skill:${script.fields?.skill}`);
    if (unit) add(unit.id, script.id, 'script');
  }

  const helpers = byKind('subagent');
  for (const chunk of raw.prose) {
    const unit = unitOfFile.get(chunk.file);
    if (!unit) continue;
    const visible = chunkLines(chunk, files.get(chunk.file))
      .map((line) => line.text)
      .join('\n');
    for (const helper of helpers) {
      const name = String(helper.fields?.name ?? '');
      if (dispatchesHelper(visible, name)) add(unit.id, helper.id, 'dispatch');
    }
  }

  const tools = byKind('tool');
  const toolOf = (name: string): Atom | undefined =>
    tools.find(
      (tool) =>
        tool.fields?.tool === name && tool.fields?.pattern === undefined && tool.fields?.effect !== 'deny',
    ) ?? tools.find((tool) => tool.fields?.tool === name);
  for (const unit of [...byKind('skill'), ...byKind('subagent')]) {
    const declared = Array.isArray(unit.fields?.tools) ? (unit.fields.tools as string[]) : [];
    for (const name of new Set(declared.map(toolBase))) {
      const tool = toolOf(name);
      if (tool) add(unit.id, tool.id, 'allows');
    }
    const skills = Array.isArray(unit.fields?.skills) ? (unit.fields.skills as string[]) : [];
    for (const name of skills) {
      const skill = unitOfName.get(`skill:${name}`);
      if (skill) add(unit.id, skill.id, 'allows');
    }
  }

  const stages = byKind('stage');
  for (const stage of stages) {
    const next = Array.isArray(stage.fields?.next) ? (stage.fields.next as string[]) : [];
    for (const id of next) {
      const target = stages.find((candidate) => candidate.fields?.id === id);
      if (target) add(stage.id, target.id, 'next');
    }
  }

  const rules = atoms.filter((atom) => RULE_KINDS.has(atom.kind));
  const labels = new Map(rules.map((rule) => [rule.id, labelOf(rule, files)]));
  const withLabel = (label: string) =>
    rules.filter((rule) => labels.get(rule.id) === label.replace('#', '').toUpperCase());
  for (const rule of rules) {
    const own = labels.get(rule.id);
    const quote = rule.provenance.quote;
    for (const match of quote.matchAll(/\b([A-Z]{1,3})#?(\d{1,3})\b/g)) {
      const label = `${match[1]}${match[2]}`;
      if (label === own) continue;
      if (!match[0].includes('#') && designates(quote.slice(0, match.index))) continue;
      for (const cited of withLabel(label)) add(rule.id, cited.id, 'cites');
    }
  }

  const enforces = new Map<string, Array<{ atom: string; by: EnforceMethod }>>();
  for (const guard of byKind('guard')) {
    const found: Array<{ atom: string; by: EnforceMethod }> = [];
    const take = (atom: Atom, by: EnforceMethod) => {
      if (!found.some((entry) => entry.atom === atom.id)) found.push({ atom: atom.id, by });
    };
    add(guard.id, `${EVENT_PREFIX}${guard.fields?.event}`, 'event');
    const decl = raw.guards.find((candidate) => guardName(candidate) === guard.fields?.name);
    const row = decl ? registryRowOf(decl, raw.registry) : undefined;
    for (const entry of row?.enforces ?? []) {
      if ('id' in entry) for (const rule of withLabel(entry.id)) take(rule, 'registry');
      else for (const rule of rules) if (holds(rule.provenance.quote, entry.quote)) take(rule, 'registry');
    }
    const script = typeof guard.fields?.script === 'string' ? files.get(guard.fields.script) : undefined;
    if (script) {
      for (const label of [...declaredLabels(script.text), ...citedLabels(script.text)]) {
        for (const rule of withLabel(label)) take(rule, 'id');
      }
      for (const literal of literals(script.text)) {
        for (const rule of rules) if (repeats(rule.provenance.quote, literal)) take(rule, 'quote');
      }
    }
    for (const entry of found) add(guard.id, entry.atom, 'enforces');
    enforces.set(guard.id, found);
  }

  return { edges: sortEdges(edges), enforces };
}

/** True when two passages say the same words, or one holds the other, compared without markup. */
function holds(quote: string, passage: string): boolean {
  const a = plain(quote);
  const b = plain(passage);
  if (b.length < MIN_LITERAL || a.length < MIN_LITERAL) return a === b && a !== '';
  return a.includes(b) || b.includes(a);
}

/** A clause that sets when a rule applies: from its lead word to the next comma, colon or semicolon. */
const CONDITION = /\b(?:when|whenever|if|unless|once|after|before|until|while|as soon as|in case)\b[^,:;]*/g;

/**
 * Whether a string of a guard's source repeats a rule. A registry row declares what it enforces, so any
 * passage it quotes counts (`holds`); a string in the source is only circumstantial, so a part of the rule
 * counts only when it reaches past the rule's condition. A message that quotes the condition alone ("the user
 * asks to stop" of "When the user asks to stop, stop all work") repeats when the rule applies, not the rule.
 */
function repeats(quote: string, literal: string): boolean {
  if (!holds(quote, literal)) return false;
  const rule = plain(quote);
  const part = plain(literal);
  const at = rule.indexOf(part);
  if (part.length >= rule.length || at < 0) return true;
  for (const condition of rule.matchAll(CONDITION)) {
    const start = condition.index ?? 0;
    if (at >= start && at + part.length <= start + condition[0].length) return false;
  }
  return true;
}

/** Function words, pronouns, modals and adverbs: a word before a label that never heads a noun phrase. */
const LEAD =
  /^(?:a|an|the|this|that|these|those|each|every|any|some|no|its|their|our|your|my|his|her|as|per|under|see|cf|and|or|nor|but|of|to|with|by|from|in|on|at|for|than|like|unlike|after|before|until|when|if|unless|also|then|still|only|just|first|now|again|please|always|never|not|do|does|did|you|we|they|it|he|she|i|can|could|may|might|must|shall|should|will|would|is|are|was|were|be|been)$/i;
/** Words after which a noun phrase opens: determiners, and prepositions other than the infinitive "to". */
const NOUN_OPENER =
  /^(?:a|an|the|this|that|these|those|each|every|any|some|no|its|their|our|your|my|his|her|of|with|by|from|in|on|at|for|into|onto|under|per)$/i;
/** Nouns that name a rule: "rule R5" cites R5. */
const RULE_NOUN =
  /^(?:rules?|gates?|instructions?|principles?|guidelines?|polic(?:y|ies)|requirements?|constraints?)$/i;

/**
 * Whether a bare label (no `#`) names some other thing than a rule: it follows a noun it designates, as in
 * "tax form R1", "the room B2" or "Keep Form R1". The word before the label is that noun when it is a content
 * word (no function word, no verb ending in -s, -ed or -ing, no rule noun) and the word before it opens a noun
 * phrase: a determiner, a preposition ("on form R5") or another content word. After a pronoun, a modal, an
 * adverb, a conjunction or "to" the word is a verb, so "you must follow R1", "always obey R1", "Obey R1" and
 * "as R1 asks" cite R1.
 */
function designates(before: string): boolean {
  const tail = before.replace(/[*_`]/g, '').trimEnd();
  const word = /(?:^|\s)([A-Za-z]+)$/.exec(tail)?.[1];
  if (!word || tail.length === before.replace(/[*_`]/g, '').length || LEAD.test(word) || RULE_NOUN.test(word))
    return false;
  if (/(?:[^s]s|ed|ing)$/i.test(word)) return false;
  const rest = tail.slice(0, tail.length - word.length);
  const previous = /([A-Za-z]+)\s+$/.exec(rest)?.[1];
  if (!previous) return false;
  if (NOUN_OPENER.test(previous)) return true;
  return !LEAD.test(previous) && !/ly$/i.test(previous);
}

/** Labels a guard source declares: `Enforces: R3, R5` in a comment or a docstring. */
export function declaredLabels(text: string): string[] {
  const found: string[] = [];
  for (const line of linesOf(text)) {
    const match = /\benforces?\b\s*:?\s*([A-Z]{1,3}#?\d{1,3}(?:\s*(?:,|and)\s*[A-Z]{1,3}#?\d{1,3})*)/i.exec(
      line.raw,
    );
    if (!match?.[1]) continue;
    for (const label of match[1].matchAll(/[A-Z]{1,3}#?\d{1,3}/gi))
      found.push(label[0].replace('#', '').toUpperCase());
  }
  return found;
}

/** Rule ids a guard source cites in the `R#23` form, anywhere in its text, as labels (`R23`). */
export function citedLabels(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\b([A-Z]{1,3})#(\d{1,3})\b/gi)].map((match) =>
        `${match[1]}${match[2]}`.toUpperCase(),
      ),
    ),
  ];
}

/** String literals of a source, at least 16 characters long. */
export function literals(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\\n]|\\.){16,})"|'((?:[^'\\\n]|\\.){16,})'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) found.push(value);
  }
  return found;
}

/** Dispatch shares the gate clause boundaries and negation scope. A plain name needs a verb head. */
function dispatchesHelper(text: string, name: string): boolean {
  if (name === '') return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g');
  for (const line of text.split('\n')) {
    const masked = maskLine(line);
    for (const clause of gateClauses(masked.text)) {
      // Reopen code spans, but keep quoted examples opaque.
      const visible = unmask(clause, masked.spans).replace(/"[^"\n]+"|“[^”\n]+”/g, '');
      for (const match of visible.matchAll(mention)) {
        const before =
          visible
            .slice(0, match.index)
            .replace(/[`*]/g, '')
            .split(/\?|\b(?:but|until|instead)\b/i)
            .at(-1) ?? '';
        const act =
          /\b(?:dispatch|call|invoke|spawn|launch|ask|use|have|let|(?:delegate|hand|send)(?:\s+(?:it|the\s+\w+))?(?:\s+(?:off|over))?(?:\s+to)?)\s+(?:(?:the|to|helper|agent|subagent|named)\s+)*$/i.exec(
            before,
          );
        if (!directiveHead(before)) continue;
        if (act && (!/^use\b/i.test(act[0]) || line.includes(`\`${name}\``))) {
          const head = before.slice(0, act.index).trim();
          // A verb starts an imperative, or follows a modal, infinitive or directive lead-in.
          // A determiner+noun ("a call report") and historical declarative heads do neither.
          const main = head.split(/[,:]/).at(-1)?.trim() ?? '';
          if (
            main === '' ||
            /(?:\b(?:please|kindly|always|then|now)|\b(?:must|should|shall|can|could|may|will)|\b(?:remember|sure|essential)\s+to|\b(?:need|have)\s+to|\b[a-z]+ly|\byou)\s*$/i.test(
              main,
            )
          )
            return true;
        }
      }
    }
  }
  return false;
}

export function sortEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const unique: Edge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return unique.sort((a, b) => compare(a.from, b.from) || compare(a.kind, b.kind) || compare(a.to, b.to));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
