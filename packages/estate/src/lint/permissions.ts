import type { PermissionDecl, RawEstate } from '../scan/reader';

/** One permission finding, before lint gives it a code's place in the list. */
export type PermissionFinding = {
  code:
    | 'PERMISSION_UNKNOWN_SKILL'
    | 'PERMISSION_UNKNOWN_HELPER'
    | 'PERMISSION_READ_BYPASS'
    | 'PERMISSION_BYPASS_MODE';
  subject: string;
  message: string;
};

/** The file tools whose deny rules a shell command goes around. */
const FILE_TOOLS = ['Read', 'Edit', 'Write'] as const;

const where = (rule: PermissionDecl) => `${rule.at.file}:${rule.at.startLine}`;

/** A rule with free arguments: bare, or with a wildcard in its pattern. It lets any value through. */
const free = (rule: PermissionDecl) => rule.pattern === undefined || rule.pattern.includes('*');

/**
 * The name a `Skill(...)` or `Agent(...)` rule gives, or undefined when the pattern is a wildcard or a plugin
 * name the estate cannot hold: `name`, `name *` and `name:*` give `name`.
 */
function targetOf(rule: PermissionDecl): string | undefined {
  const name = (rule.pattern ?? '').replace(/[ :]\*$/, '').trim();
  return name === '' || /[*:\s]/.test(name) ? undefined : name;
}

/**
 * Static checks of the permission rules, read from the settings' structured rules and values:
 *
 *   PERMISSION_UNKNOWN_SKILL   a `Skill(...)` rule names a skill the estate does not hold
 *   PERMISSION_UNKNOWN_HELPER  an `Agent(...)` rule names a helper the estate does not declare (information: the
 *                              runtime has helpers of its own that no estate file declares)
 *   PERMISSION_READ_BYPASS     a Read, Edit or Write deny, and an allowed shell rule with free arguments: a shell
 *                              command reaches the path the deny protects
 *   PERMISSION_BYPASS_MODE     the default mode is `bypassPermissions` and an allow rule lets any value through
 */
export function permissionFindings(raw: RawEstate): PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  const skills = new Set(raw.skills.flatMap((skill) => [skill.name, skill.folder.split('/').pop() ?? '']));
  const helpers = new Set(raw.subagents.map((helper) => helper.name));
  const layer =
    raw.userLayer === undefined ? 'the user-level layer is not read' : 'the user-level layer was read too';
  for (const rule of raw.permissions) {
    const name = targetOf(rule);
    if (name === undefined) continue;
    if (rule.tool === 'Skill' && !skills.has(name)) {
      findings.push({
        code: 'PERMISSION_UNKNOWN_SKILL',
        subject: rule.rule,
        message: `${where(rule)} ${rule.effect}s ${rule.rule}, but no skill of the estate is named ${name} (${layer})`,
      });
    }
    if ((rule.tool === raw.labels.dispatch || rule.tool === 'Task') && !helpers.has(name)) {
      findings.push({
        code: 'PERMISSION_UNKNOWN_HELPER',
        subject: rule.rule,
        message: `${where(rule)} ${rule.effect}s ${rule.rule}, but no helper of the estate is named ${name}`,
      });
    }
  }

  const reachers = raw.permissions.filter(
    (rule) => rule.effect === 'allow' && rule.tool === raw.labels.shell && free(rule),
  );
  const denied = raw.permissions.filter(
    (rule) => rule.effect === 'deny' && FILE_TOOLS.some((tool) => tool === rule.tool),
  );
  const [first] = reachers;
  if (first !== undefined) {
    for (const rule of denied) {
      findings.push({
        code: 'PERMISSION_READ_BYPASS',
        subject: rule.rule,
        message: `${where(rule)} denies ${rule.rule}, but ${where(first)} allows ${first.rule}${reachers.length > 1 ? ` and ${reachers.length - 1} more shell rule${reachers.length > 2 ? 's' : ''}` : ''} with free arguments: a shell command reaches the path`,
      });
    }
  }

  const mode = raw.settings.find((setting) => setting.key === 'permissions.defaultMode');
  const broad = raw.permissions.filter((rule) => rule.effect === 'allow' && free(rule));
  if (mode?.value === 'bypassPermissions' && broad.length > 0) {
    const skipped = raw.settings.find((setting) => setting.key === 'skipDangerousModePermissionPrompt');
    findings.push({
      code: 'PERMISSION_BYPASS_MODE',
      subject: 'permissions.defaultMode',
      message: `${mode.at.file}:${mode.at.startLine} sets the default mode to bypassPermissions, and ${broad.length} allow rule${broad.length === 1 ? '' : 's'} let any value through${skipped?.value === 'true' ? '; the dangerous-mode prompt is skipped' : ''}`,
    });
  }
  return findings;
}
