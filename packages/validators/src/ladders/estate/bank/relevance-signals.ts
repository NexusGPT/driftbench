import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';

/**
 * What an atom's own text and typed evidence show about the situations it can act on, for plan.relevance.
 *
 * The kind of an atom decides most of it (a stale tracker acts on stages). But a kind alone is a poor judge of
 * four situations, because the estate's text says what an atom does:
 *
 * - helper activity (a dead helper, helpers running): a helper, a route to one, any atom whose words name helpers
 *   or a dispatch ("check which helpers are still running"), and any atom whose evidence is a call of the Agent
 *   tool, or that reaches one: an instruction that dispatches a helper, a skill that does, and
 *   the routes to that skill;
 * - a tool call (a tool failure): an atom whose evidence is a call of a tool or an order between tool calls (a
 *   script run, a read before an edit), or that reaches one;
 * - output to a person (a language switch of the deviation or of the owner): an atom whose words tell a user,
 *   owner, customer or supplier something: a step "Tell the user what changed" is such, a step "Write a tracker
 *   note" is not;
 * - a confirmation (a loose confirmation): an atom whose words condition on a confirmation, approval or
 *   agreement: a skill "Close a repair ticket once the repair is confirmed" and its routes.
 *
 * An atom with none of these signals, of a kind the situation does not list, stays excluded.
 */

export type Signal = 'helper-activity' | 'tool-call' | 'output-to-person' | 'confirmation';

const TOOLS = new Set(
  'Agent Bash Edit Glob Grep MultiEdit NotebookEdit Read Skill Task WebFetch WebSearch Write'.split(' '),
);

const OUTPUT_VERB =
  /\b(tell|tells|report|reports|reply|replies|answer|answers|say|says|show|shows|explain|explains|summari[sz]e[sd]?|message|messages|notify|notifies|email|emails|write to|send|sends)\b/i;
const PERSON =
  /\b(user|users|owner|customer|customers|supplier|suppliers|client|clients|team|reader|requester)\b/i;
const HELPER_WORDS = /\b(helpers?|sub-?agents?|dispatch(?:es|ed|ing)?)\b/i;
const CONFIRMATION =
  /\b(confirm|confirms|confirmed|confirmation|approve|approves|approved|approval|agree|agrees|agreed|agreement|go[- ]ahead|sign[- ]?off|acknowledge[sd]?)\b/i;

function textOf(atom: Atom): string {
  const description = typeof atom.fields?.description === 'string' ? atom.fields.description : '';
  return [atom.title, atom.provenance.quote, atom.situation ?? '', description].join(' ');
}

/** The atoms an atom reaches: the unit a route points at, what a skill's files state, and what it dispatches. */
function reach(atom: Atom, map: EstateMap): Atom[] {
  const byId = new Map(map.atoms.map((entry) => [entry.id, entry]));
  const seen = new Set<string>([atom.id]);
  const out: Atom[] = [];
  const queue = [atom];
  while (queue.length > 0) {
    const current = queue.shift() as Atom;
    const next: Atom[] = [];
    for (const edge of map.edges) {
      if (edge.from !== current.id || (edge.kind !== 'route' && edge.kind !== 'dispatch')) continue;
      const target = byId.get(edge.to);
      if (target) next.push(target);
    }
    const folder = /^(.*\/skills\/[^/]+)\/SKILL\.md$/.exec(current.provenance.file)?.[1];
    if (current.kind === 'skill' && folder) {
      next.push(...map.atoms.filter((entry) => entry.provenance.file.startsWith(`${folder}/`)));
    }
    for (const found of next) {
      if (seen.has(found.id)) continue;
      seen.add(found.id);
      out.push(found);
      queue.push(found);
    }
  }
  return out;
}

const calls = (atom: Atom, label?: string): boolean =>
  atom.evidence.some((item) => item.type === 'tool_called' && (label === undefined || item.label === label));

const orderedTools = (atom: Atom): boolean =>
  atom.evidence.some((item) => item.type === 'ordered' && (TOOLS.has(item.before) || TOOLS.has(item.after)));

function own(signal: Signal, atom: Atom): boolean {
  switch (signal) {
    case 'helper-activity':
      return atom.kind === 'subagent' || calls(atom, 'Agent') || HELPER_WORDS.test(textOf(atom));
    case 'tool-call':
      return calls(atom) || orderedTools(atom);
    case 'output-to-person': {
      const text = textOf(atom);
      return OUTPUT_VERB.test(text) && PERSON.test(text);
    }
    case 'confirmation':
      return CONFIRMATION.test(textOf(atom));
  }
}

/** Whether the atom's own text and evidence, or what it reaches, show it can act on the signal's situation. */
export function showsSignal(signal: Signal, atom: Atom, map: EstateMap): boolean {
  if (own(signal, atom)) return true;
  // Reach carries activity (a helper dispatched, a tool called) to the skill and the routes that lead there. A
  // route also carries the condition of the unit it opens: a skill that closes a ticket once the repair is
  // confirmed is reached only under that confirmation. A statement to a person stays with the atom that makes it.
  if (
    (signal === 'helper-activity' || signal === 'tool-call') &&
    (atom.kind === 'skill' || atom.kind === 'route')
  ) {
    return reach(atom, map).some((found) => own(signal, found));
  }
  if (signal === 'confirmation' && atom.kind === 'route') {
    const opened = new Set(
      map.edges.filter((edge) => edge.from === atom.id && edge.kind === 'route').map((edge) => edge.to),
    );
    return map.atoms.some((found) => opened.has(found.id) && own(signal, found));
  }
  return false;
}
