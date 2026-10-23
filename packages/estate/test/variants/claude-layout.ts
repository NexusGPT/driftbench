import { type CapUnit, capKey, junkKey, type RefUnit, refKey, type Spec, spell, type UnitKey } from './spec';

/**
 * The one file that knows where a Claude Code setup keeps its parts and how its files are written. A spec
 * (spec.ts) names no path; this module places each unit and writes its text. A test that wants another runtime
 * brings another module with the same exports and keeps its expectations.
 */

export type Files = Record<string, string>;

const SKILLS = '.claude/skills';
const fileOf = (stem: string, spelling: RefUnit['stored']) => `${spell(stem, spelling)}.md`;

export type Placed = {
  files: Files;
  /** Where each unit lies on the disk, relative to the root. */
  paths: Map<UnitKey, string>;
};

export function capFolder(cap: CapUnit, base = SKILLS): string {
  return `${base}/${cap.name}`;
}

export function capText(cap: CapUnit, extra: readonly string[] = []): string {
  return [
    '---',
    `name: ${cap.name}`,
    `description: Handle the ${cap.name} chores. Use when the user asks for the ${cap.name} chores.`,
    '---',
    '',
    `# ${cap.name}`,
    '',
    'Always keep the totals in whole cents.',
    '',
    ...cap.links.map((link) => `For the details open \`references/${fileOf(link.ref, link.written)}\`.`),
    ...extra,
    '',
  ].join('\n');
}

export function standingText(spec: Spec): string {
  const rows = spec.caps.map((cap) => `| handle the ${cap.name} chores | \`${cap.name}\` |`);
  return [
    '# Standing',
    '',
    'Keep every answer short.',
    ...(rows.length > 0
      ? ['', '## Routing', '', '| When the user wants to | Load |', '|---|---|', ...rows]
      : []),
    '',
  ].join('\n');
}

/** The files of a spec, the capabilities under `base`, the standing file routing to each of them. */
export function place(spec: Spec, base = SKILLS): Placed {
  const files: Files = { 'CLAUDE.md': standingText(spec) };
  const paths = new Map<UnitKey, string>([['instruction:main', 'CLAUDE.md']]);
  for (const cap of spec.caps) {
    const skill = `${capFolder(cap, base)}/SKILL.md`;
    files[skill] = capText(cap);
    paths.set(capKey(cap), skill);
    for (const ref of cap.refs) {
      const path = `${capFolder(cap, base)}/references/${fileOf(ref.stem, ref.stored)}`;
      files[path] = `# ${ref.stem}\n\nThe ${ref.stem} notes are kept here.\n`;
      paths.set(refKey(cap, ref), path);
    }
  }
  return { files, paths };
}
