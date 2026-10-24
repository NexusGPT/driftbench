import {
  type Aspect,
  type LinkKind,
  type PartType,
  parseTypesText,
  type TypeSet,
} from '@agent-nexus/driftbench-core';

/**
 * The estate model the outside-estate tests are stated in: PARTS that have aspects, LINKS between them, and
 * a spec of what each check must find written over aspects and links only. No check below names a file, a path
 * or a type; the renderer in roles.ts is the one place that knows a folder layout.
 *
 * The part types of the roles are declared as data (a types document) and read by the real loader, so the
 * aspects the oracle asks about are the aspects the types declare. The expected findings are the rules of the
 * runtime's documented grammar (a shell expands `$HOME` and an unquoted `~`; a permission rule `Tool(argument)`
 * with no argument or a `*` argument lets any value through), written before the product code existed; none is
 * copied from what the product printed.
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
  role-helper:
    root: layout
    locate: agents/*.md
    fields: { name: [frontmatter.name, match] }
    aspects: [delegates, instructs]
    loaded: on-demand
  role-tool-file:
    root: layout
    locate: settings*.json#$.permissions.tools.file
    aspects: [acts]
    loaded: always
  role-tool-shell:
    root: layout
    locate: settings*.json#$.permissions.tools.shell
    aspects: [acts, executes]
    loaded: always
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
  role-rule:
    root: layout
    locate: settings*.json#$.permissions.*[*]
    aspects: [configures]
    loaded: always
  role-mode:
    root: layout
    locate: settings*.json#$.permissions.defaultMode
    aspects: [configures]
    loaded: always
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
export type ModelLink = { from: string; to: string; kind: LinkKind };
export type SkippedInput = { what: string; reason: string };
export type EstateModel = { parts: ModelPart[]; links: ModelLink[]; skipped: SkippedInput[] };

/** The kinds of finding the checks give, named by what they say, not by the code a product prints. */
export type Kind =
  | 'missing-script'
  | 'unanchored-guard'
  | 'stale-rule/instructs'
  | 'stale-rule/delegates'
  | 'read-bypass'
  | 'bypass-mode';

/** A permission rule as the runtime writes it: a tool, and an argument when it has one. */
export function ruleOf(text: string): { tool: string; argument?: string } {
  const match = /^([^(]+)(?:\((.*)\))?$/.exec(text.trim());
  const tool = (match?.[1] ?? text).trim();
  return match?.[2] === undefined ? { tool } : { tool, argument: match[2] };
}

/**
 * True when a rule has free arguments: none at all, or a wildcard anywhere in them. Such a rule allows a program
 * or a tool with arguments the policy does not fix, so what it can reach is not bounded by the rule. A rule whose
 * argument holds no wildcard names exact commands.
 */
export const hasFreeArguments = (argument: string | undefined): boolean =>
  argument === undefined || argument.trim() === '' || argument.includes('*');

/**
 * True when a shell rule lets ANY program run: no argument, or a bare wildcard. Whatever a file rule denies, some
 * program can open it, so the reach-around is certain. A wildcard inside a program-scoped rule (`listing *`) fixes
 * the program, and whether that program opens files is not known: the reach-around is assumed.
 */
export const allowsAnyProgram = (argument: string | undefined): boolean =>
  argument === undefined || argument.trim() === '' || /^\*+$/.test(argument.trim());

/** True when a capability name holds a wildcard: it names a family, not one capability. */
const scopedByStar = (argument: string | undefined) => argument !== undefined && argument.includes('*');

/** How the runtime's tools map to the parts they act on: a file tool only acts; the shell acts and executes. */
export const TOOL_TYPE: Record<string, string> = {
  Read: 'role-tool-file',
  Edit: 'role-tool-file',
  Write: 'role-tool-file',
  Bash: 'role-tool-shell',
};

/** The tools whose rules name a capability, and the type of capability each names. */
export const NAMED_CAPABILITY: Record<string, string> = { Skill: 'role-skill', Agent: 'role-helper' };

export type PolicyRole = { allow?: string[]; deny?: string[]; ask?: string[]; defaultMode?: string };

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

export type ModelInput = {
  skills: readonly string[];
  helpers: readonly string[];
  policy?: PolicyRole;
  guards: readonly GuardFact[];
};

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
  for (const name of input.helpers) add('role-helper', name);
  for (const type of new Set(Object.values(TOOL_TYPE))) add(type, type);

  const effects = ['allow', 'ask', 'deny'] as const;
  for (const effect of effects) {
    for (const text of input.policy?.[effect] ?? []) {
      const { tool, argument } = ruleOf(text);
      const rule = add('role-rule', text, {
        effect,
        tool,
        free: hasFreeArguments(argument),
        anyProgram: allowsAnyProgram(argument),
      });
      const capabilityType = NAMED_CAPABILITY[tool];
      const toolType = TOOL_TYPE[tool];
      if (toolType) {
        const target = parts.find((part) => part.type === toolType);
        if (target) links.push({ from: rule.id, to: target.id, kind: 'configures' });
      }
      if (capabilityType) {
        // A rule names a capability by one plain word; a wildcard, a plugin path or a prefix pattern with
        // a colon names nothing the estate could hold.
        const named = (argument ?? '').replace(/[ :]\*$/, '').trim();
        if (named === '' || scopedByStar(named) || /[:\s]/.test(named)) continue;
        const target = parts.find((part) => part.type === capabilityType && part.name === named);
        if (target) links.push({ from: rule.id, to: target.id, kind: 'configures' });
        else rule.fields.names = named;
      }
    }
  }
  if (input.policy?.defaultMode !== undefined)
    add('role-mode', 'defaultMode', { value: input.policy.defaultMode });

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
 * What the checks must find in a model. Each finding is read from aspects and links:
 *  - a part that `guards` and `references` nothing (its script is absent) where the run could read the base:
 *    a missing script; a guard whose written base the shell does not expand is not anchored.
 *  - a `configures` part, linked by `configures` to no part, that names a capability: a stale rule.
 *  - a `configures` deny whose target only `acts`, while a `configures` allow that lets any value through
 *    targets a part that also `executes`: the deny is reached around.
 *  - a `configures` part that sets the bypass mode.
 */
export function expectedKinds(model: EstateModel): Kind[] {
  return findingsOf(model).map((finding) => finding.kind);
}

export type ModelFinding = {
  kind: Kind;
  /** PROVEN when the finding is read from structure, below it when it rests on an assumption. */
  confidence: number;
  /** The assumption, when there is one. */
  basis?: string;
};

/**
 * The confidence step 1 gives a link read from structure: 1. A link a reader inferred has a lower one (the model
 * says "between 0 and 1" and fixes no other value). Nothing asserts the value below; every assertion compares
 * with PROVEN.
 */
export const PROVEN = 1;

/**
 * The value this oracle gives an inferred reach-around, because a finding needs some number below PROVEN. It is a
 * stand-in with no meaning of its own: the reach-around rests on a wildcard in a program-scoped rule, whose
 * program may or may not open files. No test compares a product value with it.
 */
const INFERRED_STAND_IN = 0.5;

/** The findings with the confidence each carries. */
export function findingsOf(model: EstateModel): ModelFinding[] {
  const out: ModelFinding[] = [];
  const found = {
    push: (...kinds: Kind[]) => {
      for (const kind of kinds) out.push({ kind, confidence: PROVEN });
    },
  };
  const target = (part: ModelPart) =>
    model.links
      .filter((link) => link.from === part.id && link.kind === 'configures')
      .map((link) => model.parts.find((candidate) => candidate.id === link.to))
      .find((candidate): candidate is ModelPart => candidate !== undefined);

  for (const guard of model.parts.filter((part) => part.aspects.includes('guards'))) {
    if (guard.fields.anchored === false) {
      found.push('unanchored-guard', 'missing-script');
      continue;
    }
    if (guard.fields.dangling === true) found.push('missing-script');
  }
  for (const rule of model.parts.filter(
    (part) => part.type === 'role-rule' && part.fields.names !== undefined,
  )) {
    // The aspect of the capability the rule would have named decides the kind: the rule names text the model
    // reads (`instructs`) or a context it starts (`delegates`).
    const capability = NAMED_CAPABILITY[String(rule.fields.tool)];
    if (capability)
      found.push(
        aspectsOf(capability).includes('delegates') ? 'stale-rule/delegates' : 'stale-rule/instructs',
      );
  }
  const reachers = model.parts.filter((part) => {
    const aimed = target(part);
    return part.fields.effect === 'allow' && part.fields.free === true && aimed?.aspects.includes('executes');
  });
  for (const deny of model.parts.filter((part) => part.fields.effect === 'deny')) {
    const aimed = target(deny);
    if (
      aimed &&
      aimed.aspects.includes('acts') &&
      !aimed.aspects.includes('executes') &&
      reachers.length > 0
    ) {
      // Proven when some allow lets any program run; assumed when every allow fixes a program with a wildcard.
      const proven = reachers.some((part) => part.fields.anyProgram === true);
      out.push({
        kind: 'read-bypass',
        confidence: proven ? PROVEN : INFERRED_STAND_IN,
        ...(proven ? {} : { basis: 'wildcard arguments, program capability unknown' }),
      });
    }
  }
  for (const mode of model.parts.filter((part) => part.fields.value === 'bypassPermissions'))
    if (mode.aspects.includes('configures')) found.push('bypass-mode');
  return out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
