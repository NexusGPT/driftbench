import { type Aspect, type PartType, parseTypesText, type TypeSet } from '@agent-nexus/driftbench-core';

/**
 * The estate model the outside-estate tests are stated in: PARTS that have aspects, LINKS between them, and a
 * spec of what each check must find written over aspects and links only. No check below names a file, a path or a
 * type; the renderer in roles.ts is the one place that knows a folder layout.
 *
 * The part types of the roles are declared as data (a types document) and read by the real loader, so the aspects
 * the oracle asks about are the aspects the types declare. The expected findings are the rules of the runtime's
 * documented grammar (a shell expands `$HOME` and an unquoted `~`, and neither inside single quotes), written
 * before the product code existed; none is copied from what the product printed.
 */

/** The part types of the roles, as a types document. The globs are those of the renderer's layout. */
export const ROLE_TYPES = `
version: 1
types:
  role-skill:
    root: layout
    locate: skills/*/
    entry: SKILL.md
    fields: { name: [frontmatter.name, match] }
    aspects: [instructs]
    loaded: on-mention
  role-guard:
    root: layout
    locate: settings*.json#$.hooks.*[*].hooks[*]
    fields: { command: $.command }
    aspects: [guards]
    loaded: on-event
  role-script:
    root: layout
    locate: '**/*.py'
    aspects: [executes]
    loaded: by-reference
`;

const roots = { layout: '.claude' } as const;
const parsed = parseTypesText(ROLE_TYPES, { runtime: 'claude-code', roots, source: 'outside tests' });
if (!parsed.ok)
  throw new Error(`the role types do not load: ${parsed.errors.map((e) => e.message).join('; ')}`);
export const roleTypes: TypeSet = parsed.set;

/** The aspects the types declare for a role type. */
export function aspectsOf(type: string): readonly Aspect[] {
  const found: PartType | undefined = roleTypes.types.find((candidate) => candidate.name === type);
  if (!found) throw new Error(`no role type named ${type}`);
  return found.aspects;
}

export type ModelPart = {
  id: string;
  type: string;
  aspects: readonly Aspect[];
  name: string;
  fields: Record<string, string | boolean>;
};
export type ModelLink = { from: string; to: string; kind: 'references' };
export type SkippedInput = { what: string; reason: string };
export type EstateModel = { parts: ModelPart[]; links: ModelLink[]; skipped: SkippedInput[] };

/** The kinds of finding the checks give, named by what they say, not by the code a product prints. */
export type Kind = 'missing-script' | 'unanchored-guard';

/** What the roles say about a guard whose script a base points at. */
export type GuardFact = {
  /** Whether the shell expands the written base to a folder. A quoted `~` does not. */
  expands: boolean;
  /** Where the base points, when the run can read it. */
  readable: boolean;
  /** Whether the script is in the folder the base points at. */
  present: boolean;
  /** Why the run cannot read the base, when it cannot. */
  unreadable?: string;
};

export type ModelInput = { skills: readonly string[]; guards: readonly GuardFact[] };

/** Builds the parts and links the roles describe. */
export function modelOf(input: ModelInput): EstateModel {
  const parts: ModelPart[] = [];
  const links: ModelLink[] = [];
  const skipped: SkippedInput[] = [];
  const add = (type: string, name: string, fields: ModelPart['fields'] = {}): ModelPart => {
    const part = { id: `${type}:${name}:${parts.length}`, type, aspects: aspectsOf(type), name, fields };
    parts.push(part);
    return part;
  };
  for (const name of input.skills) add('role-skill', name);
  input.guards.forEach((fact, index) => {
    const guard = add('role-guard', `guard-${index}`, { anchored: fact.expands });
    if (!fact.expands) return;
    if (!fact.readable) {
      skipped.push({ what: guard.name, reason: fact.unreadable ?? 'base not readable' });
      return;
    }
    if (fact.present) {
      const script = add('role-script', `script-${index}`);
      links.push({ from: guard.id, to: script.id, kind: 'references' });
    } else guard.fields.dangling = true;
  });
  return { parts, links, skipped };
}

/**
 * What the checks must find in a model, read from aspects and links:
 *  - a part that `guards` whose written base the shell does not expand is not anchored, and its script is a path
 *    from the working folder, which is not there;
 *  - a part that `guards` and `references` nothing, where the run could read the base, has a script that is missing.
 * A guard whose base the run cannot read is skipped: it gives nothing.
 */
export function expectedKinds(model: EstateModel): Kind[] {
  const found: Kind[] = [];
  for (const guard of model.parts.filter((part) => part.aspects.includes('guards'))) {
    if (guard.fields.anchored === false) {
      found.push('unanchored-guard', 'missing-script');
      continue;
    }
    if (guard.fields.dangling === true) found.push('missing-script');
  }
  return found.sort();
}
