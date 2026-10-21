import { ROOT, STANDING, skillFile } from '../../layout';
import type { Family } from '../frame';
import { type Case, caseFamily } from '../hostile';
import { BASE, type Check, type PlantedEstate, planting } from '../planted';
import { CODE, edgeBetween, freeHelper, freeSkill, lintHas, standingFree, tag, theme } from './util';

/**
 * blind.links: what a skill or the standing file names. References with their read-when line, scripts a
 * skill ships, and the rows of a routing table, in the spellings real estates use. Each item plants one
 * form in an estate of its own and asks for the atom, the edge or the finding the docs say it gives.
 */

const SAME_REFS = 'read a file path named in prose as a reference whatever the markup around it';
const SAME_SCRIPTS = 'read a script a skill names whatever interpreter or prefix runs it';
const SAME_ROUTES =
  'read every cell of every routing row, in every standing file, for every skill or helper named';

/** A reference atom sits on the line of the file, its path ends as given, and the file exists or not. */
function refAt(file: string, line: number, ends: string, exists: boolean): Check {
  const check: Check = (scan) => {
    const atoms = scan.map.atoms.filter(
      (atom) =>
        atom.kind === 'reference' && atom.provenance.file === file && atom.provenance.startLine === line,
    );
    if (atoms.length === 0) return `no reference atom at ${file}:${line}`;
    const hit = atoms.find((atom) => String(atom.fields?.path ?? '').endsWith(ends));
    if (!hit)
      return `no reference at ${file}:${line} ends in ${ends}: ${atoms.map((a) => a.fields?.path).join(', ')}`;
    return hit.fields?.exists === exists
      ? undefined
      : `the reference ${ends} has exists ${String(hit.fields?.exists)}`;
  };
  return planting(check, { kind: 'reference', file, line });
}

function scriptAt(file: string, line: number, ends: string): Check {
  return (scan) => {
    const atoms = scan.map.atoms.filter(
      (atom) => atom.kind === 'script' && atom.provenance.file === file && atom.provenance.startLine === line,
    );
    if (atoms.length === 0) return `no script atom at ${file}:${line}`;
    return atoms.some((atom) => String(atom.fields?.path ?? '').endsWith(ends))
      ? undefined
      : `no script at ${file}:${line} ends in ${ends}: ${atoms.map((a) => a.fields?.path).join(', ')}`;
  };
}

function skillName(seed: number, owner: string, word: string): string {
  return `${theme(seed, owner).place}-${word}-${tag(owner)}`;
}

/** A reference case: a skill whose body holds one line naming a file that exists under the skill. */
function reference(
  key: string,
  tier: 1 | 2 | 3 | 4,
  title: string,
  rel: string,
  text: (shown: string) => string,
  options: { exists?: boolean; shown?: string; cause?: string } = {},
): Case {
  return {
    key,
    tier,
    title,
    component: CODE,
    cause: options.cause ?? SAME_REFS,
    plant: (e, s, o) => {
      const name = skillName(s, o, 'desk');
      const exists = options.exists ?? true;
      if (exists) e.raw(skillFile(name, rel), '# Guide\n', BASE);
      const made = freeSkill(e, name, 'Keeps the desk.', [text(options.shown ?? rel)]);
      const line = made.lines[0] as number;
      e.check(o, refAt(made.path, line, rel, exists));
      if (!exists) e.check(o, lintHas('MISSING_REFERENCE', rel));
    },
  };
}

function script(
  key: string,
  tier: 1 | 2 | 3 | 4,
  title: string,
  rel: string,
  text: (rel: string) => string,
): Case {
  return {
    key,
    tier,
    title,
    component: CODE,
    cause: SAME_SCRIPTS,
    plant: (e, s, o) => {
      const name = skillName(s, o, 'tools');
      e.raw(skillFile(name, rel), '#!/bin/sh\nexit 0\n', BASE);
      const made = freeSkill(e, name, 'Runs the tools.', [text(rel)]);
      e.check(o, scriptAt(made.path, made.lines[0] as number, rel));
    },
  };
}

function routeTable(
  writer: ReturnType<typeof standingFree>,
  header = '| When the user wants to | Load |',
): void {
  writer.lines_(['', '## Routing', '', header, '|---|---|']);
}

function pairOfSkills(e: PlantedEstate, seed: number, owner: string, names: readonly string[]): void {
  for (const name of names) {
    const path = skillFile(name, 'SKILL.md');
    e.file(path, BASE).lines_([
      '---',
      `name: ${name}`,
      `description: Handles ${theme(seed, owner).thing} work.`,
      '---',
      '',
      'Body.',
    ]);
  }
}

const CASES: Case[] = [
  reference(
    'ref-sentence',
    1,
    'a file named in a sentence with its read-when',
    'references/guide.md',
    (r) => `Open \`${r}\` when the totals look wrong.`,
  ),
  reference(
    'ref-markdown-link',
    2,
    'a file named as a markdown link',
    'references/guide.md',
    (r) => `See [the guide](${r}) when the totals look wrong.`,
  ),
  reference(
    'ref-link-with-title',
    4,
    'a file named as a markdown link with a title',
    'references/guide.md',
    (r) => `See [the guide](${r} "the guide") when the totals look wrong.`,
  ),
  reference(
    'ref-dot-slash',
    3,
    'a file named with a leading dot and slash',
    'references/guide.md',
    (r) => `Open \`${r}\` when the totals look wrong.`,
    { shown: './references/guide.md' },
  ),
  reference(
    'ref-nested-folder',
    2,
    'a file two folders down',
    'references/prices/summer.md',
    (r) => `Open \`${r}\` when a summer price looks wrong.`,
  ),
  reference(
    'ref-csv',
    3,
    'a data file that is not markdown',
    'references/rates.csv',
    (r) => `Open \`${r}\` when a rate looks wrong.`,
  ),
  reference(
    'ref-in-table-cell',
    3,
    'a file named in a table cell of a skill body',
    'references/guide.md',
    (r) => `| totals look wrong | \`${r}\` |`,
  ),
  reference(
    'ref-missing',
    2,
    'a file that does not exist',
    'references/gone.md',
    (r) => `Open \`${r}\` when the totals look wrong.`,
    { exists: false },
  ),
  reference(
    'ref-missing-link',
    3,
    'a missing file named as a link',
    'references/lost.md',
    (r) => `See [the notes](${r}) when the totals look wrong.`,
    { exists: false },
  ),
  {
    key: 'ref-two-on-a-line',
    tier: 3,
    title: 'two files named on one line',
    component: CODE,
    cause: SAME_REFS,
    plant: (e, s, o) => {
      const name = skillName(s, o, 'pair');
      e.raw(skillFile(name, 'references/a.md'), '# A\n', BASE);
      e.raw(skillFile(name, 'references/b.md'), '# B\n', BASE);
      const made = freeSkill(e, name, 'Keeps the pair.', [
        'Open `references/a.md` then `references/b.md` when in doubt.',
      ]);
      const line = made.lines[0] as number;
      e.check(o, refAt(made.path, line, 'references/a.md', true));
      e.check(o, refAt(made.path, line, 'references/b.md', true));
    },
  },
  {
    key: 'ref-read-when-kept',
    tier: 3,
    title: 'a file with the words that say when to read it',
    component: CODE,
    cause: 'keep the whole line of a reference as its read-when',
    plant: (e, s, o) => {
      const name = skillName(s, o, 'when');
      e.raw(skillFile(name, 'references/guide.md'), '# Guide\n', BASE);
      const made = freeSkill(e, name, 'Keeps the when.', [
        'Open `references/guide.md` when the pastry count is off by a tray.',
      ]);
      const line = made.lines[0] as number;
      e.check(o, refAt(made.path, line, 'references/guide.md', true));
      e.check(o, (scan) => {
        const atom = scan.map.atoms.find(
          (a) => a.kind === 'reference' && a.provenance.startLine === line && a.provenance.file === made.path,
        );
        return String(atom?.fields?.readWhen ?? '').includes('pastry count is off by a tray')
          ? undefined
          : `the read-when is ${JSON.stringify(atom?.fields?.readWhen)}`;
      });
    },
  },
  {
    key: 'ref-from-helper',
    tier: 3,
    title: 'a file named in a helper body',
    component: CODE,
    cause: SAME_REFS,
    plant: (e, s, o) => {
      const path = `${ROOT}/docs/${tag(o)}-rota.md`;
      e.raw(path, '# Rota\n', BASE);
      const made = freeHelper(e, skillName(s, o, 'clerk'), [`Open \`${path}\` when a rota clashes.`]);
      e.check(o, refAt(made.path, made.lines[0] as number, path, true));
    },
  },
  script(
    'script-bash',
    1,
    'a script run with bash',
    'scripts/close.sh',
    (r) => `Run \`bash ${r}\` to close the day.`,
  ),
  script(
    'script-node',
    1,
    'a script run with node and a flag',
    'scripts/check.js',
    (r) => `Run \`node ${r} --fast\` to check the day.`,
  ),
  script(
    'script-direct',
    2,
    'a script run by its own path',
    'scripts/close.sh',
    (r) => `Run \`./${r}\` to close the day.`,
  ),
  script(
    'script-nested',
    3,
    'a script two folders down',
    'scripts/lib/tally.py',
    (r) => `Run \`python3 ${r} ID\` to count.`,
  ),
  script(
    'script-link',
    4,
    'a script named as a markdown link',
    'scripts/close.sh',
    (r) => `Close the day with [the closer](${r}).`,
  ),
  {
    key: 'script-two-on-a-line',
    tier: 3,
    title: 'two scripts named on one line',
    component: CODE,
    cause: SAME_SCRIPTS,
    plant: (e, s, o) => {
      const name = skillName(s, o, 'duo');
      e.raw(skillFile(name, 'scripts/open.sh'), '#!/bin/sh\n', BASE);
      e.raw(skillFile(name, 'scripts/close.sh'), '#!/bin/sh\n', BASE);
      const made = freeSkill(e, name, 'Runs the duo.', [
        'Run `bash scripts/open.sh` first and `bash scripts/close.sh` last.',
      ]);
      const line = made.lines[0] as number;
      e.check(o, scriptAt(made.path, line, 'scripts/open.sh'));
      e.check(o, scriptAt(made.path, line, 'scripts/close.sh'));
    },
  },
  {
    key: 'route-in-dot-claude-standing',
    tier: 2,
    title: 'a routing row in .claude/CLAUDE.md',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      standingFree(e);
      const name = skillName(s, o, 'plan');
      pairOfSkills(e, s, o, [name]);
      const writer = e.file(`${ROOT}/CLAUDE.md`, BASE);
      writer.lines_(['# More', '']);
      routeTable(writer);
      const line = writer.line(`| plan the ${theme(s, o).place} day | \`${name}\` |`);
      e.check(
        o,
        edgeBetween('route', { kind: 'route', file: `${ROOT}/CLAUDE.md`, line }, { kind: 'skill', name }),
      );
    },
  },
  {
    key: 'route-in-local-standing',
    tier: 2,
    title: 'a routing row in CLAUDE.local.md',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      standingFree(e);
      const name = skillName(s, o, 'plan');
      pairOfSkills(e, s, o, [name]);
      const writer = e.file('CLAUDE.local.md', BASE);
      writer.lines_(['# Local', '']);
      routeTable(writer);
      const line = writer.line(`| plan the ${theme(s, o).place} day | \`${name}\` |`);
      e.check(
        o,
        edgeBetween('route', { kind: 'route', file: 'CLAUDE.local.md', line }, { kind: 'skill', name }),
      );
    },
  },
  {
    key: 'route-two-skills-one-row',
    tier: 3,
    title: 'a routing row that names two skills',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const names = [skillName(s, o, 'open'), skillName(s, o, 'close')];
      pairOfSkills(e, s, o, names);
      routeTable(writer);
      const line = writer.line(`| run the ${theme(s, o).place} day | \`${names[0]}\` then \`${names[1]}\` |`);
      for (const name of names) {
        e.check(o, edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name }));
      }
    },
  },
  {
    key: 'route-longer-name-only',
    tier: 4,
    title: 'a routing row that names the longer of two skills whose names overlap',
    component: CODE,
    cause: 'match a skill name in a routing cell as a whole name, not as the start of a longer one',
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const short = skillName(s, o, 'plan');
      const long = `${short}-weekly`;
      pairOfSkills(e, s, o, [short, long]);
      routeTable(writer);
      const line = writer.line(`| plan the week | \`${long}\` |`);
      e.check(
        o,
        edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name: long }),
      );
      e.check(o, (scan) => {
        const wrong = scan.map.atoms.find(
          (a) =>
            a.kind === 'route' &&
            a.provenance.file === STANDING &&
            a.provenance.startLine === line &&
            a.fields?.target === short,
        );
        return wrong ? `the row also routes to ${short}` : undefined;
      });
    },
  },
  {
    key: 'route-skill-and-helper',
    tier: 3,
    title: 'a routing row that names a skill and a helper',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const skill = skillName(s, o, 'tally');
      const helper = skillName(s, o, 'scout');
      pairOfSkills(e, s, o, [skill]);
      freeHelper(e, helper, ['You read.']);
      routeTable(writer);
      const line = writer.line(
        `| count the ${theme(s, o).thing}s | \`${skill}\` and the \`${helper}\` agent |`,
      );
      e.check(
        o,
        edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name: skill }),
      );
      e.check(
        o,
        edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'subagent', name: helper }),
      );
    },
  },
  {
    key: 'route-after-another-table',
    tier: 2,
    title: 'a routing table that follows a table of something else',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const name = skillName(s, o, 'plan');
      pairOfSkills(e, s, o, [name]);
      writer.lines_(['## Opening hours', '', '| Day | Opens |', '|---|---|', '| Monday | 07:00 |', '']);
      routeTable(writer);
      const line = writer.line(`| plan the ${theme(s, o).place} day | \`${name}\` |`);
      e.check(o, edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name }));
    },
  },
  {
    key: 'route-tab-padded-cells',
    tier: 3,
    title: 'a routing row whose cells are padded with tabs',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const name = skillName(s, o, 'plan');
      pairOfSkills(e, s, o, [name]);
      routeTable(writer);
      const line = writer.line(`|\tplan the ${theme(s, o).place} day\t|\t\`${name}\`\t|`);
      e.check(o, edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name }));
    },
  },
  {
    key: 'route-dotted-name',
    tier: 4,
    title: 'a routing row for a skill whose name holds dots',
    component: CODE,
    cause: 'match skill names in routing cells as plain text, never as a pattern',
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const name = `${theme(s, o).place}.v2.${tag(o)}`;
      const near = `${theme(s, o).place}xv2x${tag(o)}`;
      pairOfSkills(e, s, o, [name, near]);
      routeTable(writer);
      const line = writer.line(`| plan the day | \`${name}\` |`);
      e.check(o, edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name }));
      e.check(o, (scan) => {
        const wrong = scan.map.atoms.find(
          (a) =>
            a.kind === 'route' &&
            a.provenance.file === STANDING &&
            a.provenance.startLine === line &&
            a.fields?.target === near,
        );
        return wrong ? `the dotted name matched ${near}` : undefined;
      });
    },
  },
  {
    key: 'route-unicode-ask',
    tier: 3,
    title: 'a routing row whose ask holds accents and an emoji',
    component: CODE,
    cause: SAME_ROUTES,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const name = skillName(s, o, 'plan');
      pairOfSkills(e, s, o, [name]);
      routeTable(writer);
      const line = writer.line(`| préparer la fournée du matin 🥖 | \`${name}\` |`);
      e.check(o, edgeBetween('route', { kind: 'route', file: STANDING, line }, { kind: 'skill', name }));
    },
  },
];

export function linksFamily(): Family {
  return caseFamily('blind.links', CODE, CASES, 'the reader reads');
}
