import type { HiddenEstate } from './hidden';

/**
 * Estate mutants: copies of the hidden estate with one atom taken out of the files (not out of the agent), or
 * one rule re-wrapped with its words unchanged. Level 6 rescans each copy, diffs the two maps, and checks
 * that maintenance retires exactly the tests of the atoms that left and touches no test for a re-wrap.
 * Taking a line out takes every atom the line states: a gate line also names its reference.
 */

export type EstateMutant = {
  id: string;
  /** The kind of the atom taken out, or `wording` for a re-wrap. */
  kind: string;
  /** What the mutant does, in words. */
  what: string;
  estate: HiddenEstate;
};

function copy(estate: HiddenEstate): HiddenEstate {
  return structuredClone(estate);
}

/** The estate mutants of a hidden estate, in a fixed order, each from the first skill or helper it applies to. */
export function estateMutants(estate: HiddenEstate): EstateMutant[] {
  const out: EstateMutant[] = [];
  const first = [...estate.skills].sort((a, b) => (a.topic.skill < b.topic.skill ? -1 : 1))[0];
  const last = [...estate.skills].sort((a, b) => (a.topic.skill < b.topic.skill ? 1 : -1))[0];
  const omit = (part: string, kind: string, skill = first) => {
    if (!skill) return;
    const mutant = copy(estate);
    const target = mutant.skills.find((candidate) => candidate.topic.skill === skill.topic.skill);
    target?.omit.push(part);
    out.push({
      id: `${kind}:${skill.topic.skill}:${part}`,
      kind,
      what: `the ${part} line of ${skill.topic.skill} taken out`,
      estate: mutant,
    });
  };
  omit('prohibition', 'instruction');
  omit('gate', 'gate', last);
  omit('lookup', 'reference');
  omit('script', 'script', last);
  omit('register', 'register');
  if (first) {
    const mutant = copy(estate);
    const target = mutant.skills.find((candidate) => candidate.topic.skill === first.topic.skill);
    if (target) target.routed = false;
    out.push({
      id: `route:${first.topic.skill}:table`,
      kind: 'route',
      what: `the routing table row of ${first.topic.skill} taken out`,
      estate: mutant,
    });
  }
  const helper = [...estate.helpers].sort((a, b) => (a.topic.name < b.topic.name ? -1 : 1))[0];
  if (helper) {
    const mutant = copy(estate);
    mutant.helpers = mutant.helpers.filter((candidate) => candidate.topic.name !== helper.topic.name);
    for (const skill of mutant.skills) {
      if (skill.dispatch === helper.topic.name) delete skill.dispatch;
    }
    out.push({
      id: `subagent:${helper.topic.name}`,
      kind: 'subagent',
      what: `the helper ${helper.topic.name} taken out, with the lines that dispatch it`,
      estate: mutant,
    });
  }
  const guard = estate.guards.find((candidate) => candidate.scope === 'estate');
  if (guard) {
    const mutant = copy(estate);
    mutant.guards = mutant.guards.filter((candidate) => candidate.hid !== guard.hid);
    out.push({
      id: `guard:${guard.name}`,
      kind: 'guard',
      what: `the guard ${guard.name} taken out`,
      estate: mutant,
    });
  }
  {
    const mutant = copy(estate);
    mutant.steps = mutant.steps.filter((step) => !step.anytime);
    out.push({
      id: 'stage:anytime',
      kind: 'stage',
      what: 'the anytime step taken out of the step list',
      estate: mutant,
    });
  }
  {
    const mutant = copy(estate);
    mutant.permissions.deny = mutant.permissions.deny.filter((rule) => rule !== 'WebFetch');
    out.push({
      id: 'tool:deny:WebFetch',
      kind: 'tool',
      what: 'the deny rule for WebFetch taken out',
      estate: mutant,
    });
  }
  {
    const mutant = copy(estate);
    mutant.wrap = 'rule:read-before-edit';
    out.push({
      id: 'wording:rule:read-before-edit',
      kind: 'wording',
      what: 'the read-before-edit rule re-wrapped over two lines, its words unchanged',
      estate: mutant,
    });
  }
  return out;
}
