import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type JournalRow, loopFolder } from './journal';

export function handoverFile(component: string): string {
  return `${loopFolder(component)}/HANDOVER.md`;
}

export function researchFile(component: string): string {
  return `${loopFolder(component)}/research.md`;
}

/** The sections every handover holds, in order (docs/validators.md section 10.2). */
export const HANDOVER_SECTIONS = [
  'Level per seed',
  'Floor',
  'Open items',
  'Hypotheses tried',
  'Next actions',
  'Pitfalls',
  'How to run',
  'Fixtures',
] as const;

const START = '<!-- level-table:start -->';
const END = '<!-- level-table:end -->';

/** The level table: one row per seed of the last journal row, the level after the iteration. */
export function levelTable(perSeed: readonly { seed: string; after: number }[]): string {
  const rows = perSeed.map((entry) => `| ${entry.seed} | ${entry.after} |`);
  return [START, '| Seed | Level |', '|---|---|', ...rows, END].join('\n');
}

/** A new handover with every section, for a component that has none yet. */
export function handoverTemplate(component: string, floor: number): string {
  return `# Handover: validator ${component}

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by \`driftbench validate ${component} --journal <row.json>\` from the last journal row.

## Level per seed

${levelTable([])}

## Floor

${floor} (validators/floors.json).

## Open items

The items of the first failing level, by id, each with the component it points at.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run \`pnpm driftbench validate ${component} --seeds 1..20 --hidden\` and record the level per seed.
2. Take the first failing level and write one sentence: the component, the cause, the item that proves it.
3. Fix one cause with a test that reproduces the item first.

## Pitfalls

None recorded yet.

## How to run

\`\`\`
pnpm driftbench validate ${component} --seeds 1..20 --hidden
pnpm driftbench validate ${component} --brief
\`\`\`

## Fixtures

Where the validator reads its planted truth: name the files.
`;
}

export function researchTemplate(component: string): string {
  return `# Research: validator ${component}

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.
`;
}

/** The body of a level-two section, or undefined when the heading is absent. */
export function handoverSection(text: string, name: string): string | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** The rows of the level table, or undefined when the markers are absent. */
export function parseLevelTable(text: string): { seed: string; level: number }[] | undefined {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return undefined;
  return text
    .slice(start + START.length, end)
    .split('\n')
    .map((line) => /^\|\s*(\d+|hidden)\s*\|\s*(\d+)\s*\|\s*$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ seed: match[1] as string, level: Number(match[2]) }));
}

/** Rewrites the level table of a handover from a journal row. */
export function setLevelTable(text: string, row: JournalRow): string {
  const table = levelTable(row.perSeed);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${table}${text.slice(end + END.length)}`;
  const heading = '## Level per seed';
  const at = text.indexOf(heading);
  if (at < 0) return `${text.trimEnd()}\n\n${heading}\n\n${table}\n`;
  return `${text.slice(0, at + heading.length)}\n\n${table}${text.slice(at + heading.length)}`;
}

/**
 * The problems of a handover: a missing section, a next-actions section without a numbered action, and a
 * level table that differs from the level per seed of the last journal row (empty when the journal is).
 */
export function checkHandover(text: string, last: JournalRow | undefined): string[] {
  const problems: string[] = [];
  for (const name of HANDOVER_SECTIONS) {
    if (handoverSection(text, name) === undefined) problems.push(`the section "## ${name}" is missing`);
  }
  const actions = handoverSection(text, 'Next actions');
  if (actions !== undefined && !/^\s*\d+\.\s+\S/m.test(actions)) {
    problems.push('"## Next actions" holds no numbered action');
  }
  const table = parseLevelTable(text);
  if (!table) {
    problems.push('the level table markers are missing from "## Level per seed"');
    return problems;
  }
  const shown = table.map((entry) => `${entry.seed}=${entry.level}`).sort();
  const expected = (last?.perSeed ?? []).map((entry) => `${entry.seed}=${entry.after}`).sort();
  if (shown.join(',') !== expected.join(',')) {
    problems.push(
      last
        ? `the level table says ${shown.join(', ') || 'nothing'} but journal iteration ${last.iteration} says ${expected.join(', ')}`
        : `the level table says ${shown.join(', ')} but the journal is empty`,
    );
  }
  return problems;
}

/** Reads a component's handover; undefined when the file is absent. */
export function readHandover(root: string, component: string): string | undefined {
  const path = join(root, handoverFile(component));
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

export function writeHandover(root: string, component: string, text: string): void {
  const path = join(root, handoverFile(component));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
