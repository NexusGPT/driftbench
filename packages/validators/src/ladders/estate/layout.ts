/**
 * The runtime layout of a rendered estate: where the standing instructions, skills, helpers, settings,
 * guards, step list and check registry live, and how a guard command finds its script from the project
 * folder. This file, the renderer and the rule follower's transcript are the validator's one adapter: the
 * layout and the session format of the runtime the estate scanner's reader knows. The rest of the validator
 * names no runtime.
 */

/** The runtime the rendered estate is laid out for, by the name the scanner takes. */
export const RUNTIME = 'claude-code';
export const STANDING = 'CLAUDE.md';
export const ROOT = '.claude';
export const SETTINGS = `${ROOT}/settings.json`;
export const STEPS = `${ROOT}/steps.json`;
export const MEMORY = `${ROOT}/memory/MEMORY.md`;
export const GUARDS_DIR = `${ROOT}/guards`;
export const REGISTRY_MD = `${ROOT}/guards/CHECK-REGISTRY.md`;
export const REGISTRY_JSON = `${ROOT}/guards/check-registry.json`;
/** The anchor a guard command uses to find its script from the project folder, quoted and bare. */
export const ANCHOR = '"$CLAUDE_PROJECT_DIR"';
export const ANCHOR_BARE = '$CLAUDE_PROJECT_DIR';

/** A file of a skill, from the root: `relative` is as the skill's body names it. */
export function skillFile(skill: string, relative: string): string {
  return `${ROOT}/skills/${skill}/${relative}`;
}

export function helperFile(name: string): string {
  return `${ROOT}/agents/${name}.md`;
}

export function guardFile(name: string): string {
  return `${ROOT}/guards/${name}`;
}
