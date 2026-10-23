import { type PolicyModel, type RuntimeProfile, runtimeProfile } from '@agent-nexus/driftbench-core';
import type { PermissionDecl, RawEstate } from '../scan/reader';

/**
 * The static checks of the permission rules, read from the structured rules of the settings and the profile's
 * permission model. A check never names a tool: it asks what a tool does (its aspects) and what a rule names.
 *
 *   PERMISSION_UNKNOWN_SKILL   a rule names a part of the estate that instructs (a skill) and none is held
 *   PERMISSION_UNKNOWN_HELPER  the same for a part that delegates (a helper): information, since the runtime has
 *                              helpers of its own that no estate file declares
 *   PERMISSION_READ_BYPASS     a deny on a tool that only acts (a file tool), and an allow on a tool that also
 *                              executes (the shell) with free arguments: a command opens the file itself
 *   PERMISSION_BYPASS_MODE     the default mode is one in which no allow rule decides anything
 */

export type PermissionCode =
  | 'PERMISSION_UNKNOWN_SKILL'
  | 'PERMISSION_UNKNOWN_HELPER'
  | 'PERMISSION_READ_BYPASS'
  | 'PERMISSION_BYPASS_MODE';

/** The confidence of a finding read from structure, the value step 1 gives a link read from structure. */
export const PROVEN_CONFIDENCE = 1;

/**
 * The confidence of a reach-around that rests on an assumption: an allow fixes a program with a wildcard and the
 * program's capability is not known, so whether it opens the denied file is not proven. It is only a value below
 * PROVEN_CONFIDENCE; nothing reads its size, and a reader compares with PROVEN_CONFIDENCE.
 */
export const ASSUMED_CONFIDENCE = 0.5;

export type PermissionFinding = {
  code: PermissionCode;
  subject: string;
  message: string;
  confidence?: number;
  /** What the finding assumes, when its confidence is below PROVEN_CONFIDENCE. */
  basis?: string;
};

/** What a run read for each check, for its coverage. */
export type PermissionReads = Record<PermissionCode, number>;

export const PERMISSION_CODES: readonly PermissionCode[] = [
  'PERMISSION_UNKNOWN_SKILL',
  'PERMISSION_UNKNOWN_HELPER',
  'PERMISSION_READ_BYPASS',
  'PERMISSION_BYPASS_MODE',
];

const where = (rule: PermissionDecl) => `${rule.at.file}:${rule.at.startLine}`;

/** True when a rule's argument fixes nothing: none at all, or only wildcards. */
const anyArgument = (argument: string | undefined) => argument === undefined || /^\s*\**\s*$/.test(argument);

/** True when a rule's argument holds a wildcard, or none: what it reaches is not bounded by the rule. */
const freeArguments = (argument: string | undefined) =>
  anyArgument(argument) || (argument ?? '').includes('*');

/** The program a rule's argument fixes: its first word, up to a space or a colon. */
const programOf = (argument: string | undefined) => /^\s*([^\s:*]+)/.exec(argument ?? '')?.[1];

/**
 * The single plain name a rule's argument gives, or undefined when it names no one part: empty, a wildcard, a
 * prefix pattern (`name *`, `name:*`), or a name behind a colon or a space (a part of another package).
 */
function nameOf(argument: string | undefined): string | undefined {
  const name = (argument ?? '').replace(/[ :]\*$/, '').trim();
  return name === '' || /[*:\s]/.test(name) ? undefined : name;
}

/** The names the estate holds for the map kind a part type maps to. */
function heldNames(raw: RawEstate, profile: RuntimeProfile, type: string): Set<string> | undefined {
  const kind = profile.mapKinds[type];
  if (kind === 'skill')
    return new Set(raw.skills.flatMap((skill) => [skill.name, skill.folder.split('/').pop() ?? '']));
  if (kind === 'subagent') return new Set(raw.subagents.map((helper) => helper.name));
  return undefined;
}

export function permissionFindings(raw: RawEstate): {
  findings: PermissionFinding[];
  reads: PermissionReads;
} {
  const reads: PermissionReads = {
    PERMISSION_UNKNOWN_SKILL: 0,
    PERMISSION_UNKNOWN_HELPER: 0,
    PERMISSION_READ_BYPASS: 0,
    PERMISSION_BYPASS_MODE: 0,
  };
  const findings: PermissionFinding[] = [];
  const policy: PolicyModel | undefined = runtimeProfile(raw.runtime)?.policy;
  const profile = runtimeProfile(raw.runtime);
  if (policy === undefined || profile === undefined) return { findings, reads };

  for (const rule of raw.permissions) {
    const tool = policy.tools[rule.tool];
    if (tool?.names === undefined) continue;
    const held = heldNames(raw, profile, tool.names);
    const name = nameOf(rule.pattern);
    if (held === undefined || name === undefined) continue;
    const delegates = tool.aspects.includes('delegates');
    const code: PermissionCode = delegates ? 'PERMISSION_UNKNOWN_HELPER' : 'PERMISSION_UNKNOWN_SKILL';
    reads[code]++;
    if (held.has(name)) continue;
    findings.push({
      code,
      subject: rule.rule,
      message: `${where(rule)} ${rule.effect}s ${rule.rule}, but the estate holds no ${delegates ? 'helper' : 'skill'} named ${name}`,
    });
  }

  // A deny on a tool that only acts is reached around by an allow on a tool that also executes, when the allow
  // leaves its arguments free. Any program may run under a bare allow: the reach-around is proven. Under a
  // program-scoped allow with a wildcard it rests on the program opening files, which is not known unless the
  // estate's configuration declares it.
  const acting = (rule: PermissionDecl) => {
    const aspects = policy.tools[rule.tool]?.aspects ?? [];
    return aspects.includes('acts') && !aspects.includes('executes');
  };
  const running = (rule: PermissionDecl) => (policy.tools[rule.tool]?.aspects ?? []).includes('executes');
  const reachers = raw.permissions.filter(
    (rule) => rule.effect === 'allow' && running(rule) && freeArguments(rule.pattern),
  );
  const open = reachers.filter((rule) => {
    const program = anyArgument(rule.pattern) ? undefined : programOf(rule.pattern);
    return program === undefined || raw.programs?.[program]?.opensFiles !== false;
  });
  const proven = open.filter(
    (rule) => anyArgument(rule.pattern) || raw.programs?.[programOf(rule.pattern) ?? '']?.opensFiles === true,
  );
  const denies = raw.permissions.filter((rule) => rule.effect === 'deny' && acting(rule));
  reads.PERMISSION_READ_BYPASS = denies.length;
  const [first] = open;
  if (first !== undefined) {
    const certain = proven.length > 0;
    const by = certain ? proven[0] : first;
    for (const rule of denies) {
      findings.push({
        code: 'PERMISSION_READ_BYPASS',
        subject: rule.rule,
        message: certain
          ? `${where(rule)} denies ${rule.rule}, but ${where(by as PermissionDecl)} allows ${(by as PermissionDecl).rule}, which opens the file itself`
          : `${where(rule)} denies ${rule.rule}; ${where(first)} allows ${first.rule}, which may open the file if that program opens files (assumed: wildcard arguments, program capability unknown; declare it under programs: in the configuration file to settle it)`,
        confidence: certain ? PROVEN_CONFIDENCE : ASSUMED_CONFIDENCE,
        ...(certain ? {} : { basis: 'wildcard arguments, program capability unknown' }),
      });
    }
  }

  const mode = raw.settings.find((setting) => setting.key === policy.mode.setting);
  if (mode !== undefined) reads.PERMISSION_BYPASS_MODE = 1;
  if (mode?.value !== undefined && policy.mode.unchecked.includes(mode.value)) {
    const denyCount = raw.permissions.filter((rule) => rule.effect === 'deny').length;
    findings.push({
      code: 'PERMISSION_BYPASS_MODE',
      subject: policy.mode.setting,
      message: `${mode.at.file}:${mode.at.startLine} sets the default mode to ${mode.value}: no allow rule decides anything in it. Still guarding: ${denyCount} deny ${denyCount === 1 ? 'rule' : 'rules'} and ${raw.guards.length} ${raw.guards.length === 1 ? 'hook' : 'hooks'} with the guards aspect`,
    });
  }
  return { findings, reads };
}
