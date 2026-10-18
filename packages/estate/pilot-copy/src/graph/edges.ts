import { chunkLines, guardName, positiveMention, registryRowOf, toolBase } from '../scan/code';
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

  for (const reference of byKind('reference')) {
    const unit = unitOfFile.get(reference.provenance.file);
    if (unit) add(unit.id, reference.id, 'reference');
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
      if (name !== '' && positiveMention(visible, `\`${name}\``, ['dispatch', 'call', 'delegate', 'invoke']))
        add(unit.id, helper.id, 'dispatch');
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
  const withLabel = (label: string) => rules.filter((rule) => labels.get(rule.id) === label);
  for (const rule of rules) {
    const own = labels.get(rule.id);
    for (const match of rule.provenance.quote.matchAll(/\b([A-Z]{1,3})#?(\d{1,3})\b/g)) {
      const label = `${match[1]}${match[2]}`;
      if (label === own) continue;
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
        for (const rule of rules) if (holds(rule.provenance.quote, literal)) take(rule, 'quote');
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

/** Labels a guard source declares: `Enforces: R3, R5` in a comment or a docstring. */
export function declaredLabels(text: string): string[] {
  const found: string[] = [];
  for (const line of linesOf(text)) {
    const match = /\b[Ee]nforces?\b\s*:?\s*([A-Z]{1,3}\d{1,3}(?:\s*(?:,|and)\s*[A-Z]{1,3}\d{1,3})*)/.exec(
      line.raw,
    );
    if (!match?.[1]) continue;
    for (const label of match[1].matchAll(/[A-Z]{1,3}\d{1,3}/g)) found.push(label[0]);
  }
  return found;
}

/** Rule ids a guard source cites in the `R#23` form, anywhere in its text, as labels (`R23`). */
export function citedLabels(text: string): string[] {
  return [
    ...new Set([...text.matchAll(/\b([A-Z]{1,3})#(\d{1,3})\b/g)].map((match) => `${match[1]}${match[2]}`)),
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
