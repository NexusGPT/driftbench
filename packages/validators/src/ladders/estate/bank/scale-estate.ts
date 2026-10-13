import { rngFor } from '@agent-nexus/driftbench-generate';
import { STANDING, skillFile } from '../layout';

/**
 * A scale estate: as many skills as it takes to plant `size` atoms, each skill a routing row, a description,
 * a lookup reference, a gate with its reference and a named script (seven atoms), plus the two invariants of
 * the standing file and the three tools the skills declare (no settings allow them). Names come from the seed. `drop` takes the lookup line out of that many skills, for the
 * maintenance stage.
 */

export const ATOMS_PER_SKILL = 7;

export function scaleEstate(
  size: number,
  seed: number,
  options: { drop?: number } = {},
): { files: Record<string, string>; atoms: number } {
  const rng = rngFor(seed, 'bank-scale');
  const skills = Math.max(1, Math.ceil((size - 5) / ATOMS_PER_SKILL));
  const files: Record<string, string> = {};
  const rows: string[] = [];
  const nouns = ['crate', 'parcel', 'ledger', 'roster', 'permit', 'tariff', 'voucher', 'badge'];
  let atoms = 2 + 3;
  for (let index = 0; index < skills; index += 1) {
    const noun = nouns[Math.floor(rng() * nouns.length)] as string;
    const name = `${noun}-task-${index}`;
    rows.push(`| handle ${noun} task ${index} | \`${name}\` |`);
    const dropped = index < (options.drop ?? 0);
    files[skillFile(name, 'SKILL.md')] = [
      '---',
      `name: ${name}`,
      `description: Handle ${noun} task ${index}. Use when the user asks for ${noun} task ${index}.`,
      'allowed-tools: Read, Edit, Bash',
      '---',
      '',
      `# ${name}`,
      '',
      ...(dropped ? [] : [`1. When the case is new, open \`references/lookup-${index}.md\` first.`]),
      `2. Read \`references/rules-${index}.md\` before you change any record.`,
      `3. Run \`python3 scripts/run-${index}.py RECORD\` and show the summary.`,
      '',
    ].join('\n');
    if (!dropped) files[skillFile(name, `references/lookup-${index}.md`)] = '# Lookup\n';
    files[skillFile(name, `references/rules-${index}.md`)] = '# Rules\n';
    files[skillFile(name, `scripts/run-${index}.py`)] = '#!/usr/bin/env python3\n"""Runs the task."""\n';
    atoms += dropped ? ATOMS_PER_SKILL - 1 : ATOMS_PER_SKILL;
  }
  files[STANDING] = [
    '# Scale estate',
    '',
    '| When the user wants to | Load |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n');
  return { files, atoms };
}
