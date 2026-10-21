import { STANDING } from '../layout';
import { namesFor, rule } from './common';
import type { Family } from './frame';
import { type Case, caseFamily, helperUnit, standardSkill } from './hostile';
import type { FileWriter, PlantedEstate } from './planted';

/**
 * scan.standing: the forms standing instructions take on real estates, each item an estate of its own. The
 * routing of asks to skills and helpers written as tables in many shapes, as list items and sentences, and
 * standing files in the places a runtime reads them (a subfolder, an import, carriage returns). The oracle:
 * the route atom on the row's line naming the planted skill or helper, or the instruction atom of the planted
 * rule, as the planted estate records them.
 */

const CODE = 'packages/estate/src/scan/code.ts';
const READER = 'packages/estate/src/scan/claude-code.ts';

/** The standing file with a title, then the lines a case writes. */
function standing(estate: PlantedEstate, owner: string): FileWriter {
  const writer = estate.file(STANDING, owner);
  writer.line('# Planted estate');
  writer.line('');
  return writer;
}

/** A routing case: a skill planted, then the standing lines with one row routing an ask to it. */
function routing(
  key: string,
  tier: 1 | 2 | 3 | 4 | 5,
  title: string,
  lines: (skill: string) => { before: string[]; row: string; after?: string[]; ask?: string },
  options: { helper?: boolean; component?: string } = {},
): Case {
  return {
    key,
    tier,
    title,
    component: options.component ?? CODE,
    plant: (e, s, o) => {
      let target: string;
      if (options.helper) {
        target = namesFor(s, `${o}-h`).skill;
        helperUnit(e, o, target);
      } else {
        target = standardSkill(e, s, o).skill;
      }
      const writer = standing(e, o);
      const shape = lines(target);
      writer.lines_(shape.before);
      writer.line(shape.row, [
        {
          hid: `${o}:row`,
          kind: 'route',
          key: target,
          ...(shape.ask !== undefined ? { ask: shape.ask } : {}),
        },
      ]);
      writer.lines_(shape.after ?? []);
    },
  };
}

const TABLE = ['## Routing', '', '| When the user wants to | Load |', '|---|---|'];

const CASES: Case[] = [
  routing('plain-table', 1, 'a routing table with the skill in backticks', (skill) => ({
    before: TABLE,
    row: `| plan a delivery | \`${skill}\` |`,
  })),
  routing('aligned-table', 2, 'a routing table whose separator aligns its columns', (skill) => ({
    before: ['| When the user wants to | Load |', '|:---|:---:|'],
    row: `| plan a delivery | \`${skill}\` |`,
  })),
  routing('three-columns', 1, 'a routing table with a notes column', (skill) => ({
    before: ['| When the user wants to | Load | Notes |', '|---|---|---|'],
    row: `| plan a delivery | \`${skill}\` | weekly |`,
  })),
  routing(
    'helper-row',
    1,
    'a routing row dispatching a helper',
    (helper) => ({
      before: TABLE,
      row: `| check the records | the \`${helper}\` agent |`,
    }),
    { helper: true },
  ),
  routing('bold-header', 2, 'a routing table with a bold header', (skill) => ({
    before: ['| **When the user wants to** | **Load** |', '|---|---|'],
    row: `| plan a delivery | \`${skill}\` |`,
  })),
  routing('code-in-ask', 2, 'a routing row whose ask quotes a command', (skill) => ({
    before: TABLE,
    row: `| run \`make report\` and read it | \`${skill}\` |`,
  })),
  routing('plain-name', 3, 'a routing cell naming the skill without backticks', (skill) => ({
    before: TABLE,
    row: `| plan a delivery | ${skill} |`,
  })),
  routing('bold-name', 3, 'a routing cell naming the skill in bold', (skill) => ({
    before: TABLE,
    row: `| plan a delivery | **${skill}** |`,
  })),
  routing(
    'helper-plain-name',
    3,
    'a routing cell naming a helper without backticks',
    (helper) => ({
      before: TABLE,
      row: `| check the records | the ${helper} agent |`,
    }),
    { helper: true },
  ),
  routing('linked-file', 3, 'a routing cell linking to the skill file', (skill) => ({
    before: TABLE,
    row: `| plan a delivery | [${skill}](.claude/skills/${skill}/SKILL.md) |`,
  })),
  routing('slash-command', 3, 'a routing cell naming the skill as a slash command', (skill) => ({
    before: TABLE,
    row: `| plan a delivery | \`/${skill}\` |`,
  })),
  routing('skill-first', 4, 'a routing table whose first column names the skill', (skill) => ({
    before: ['| Skill | Use when the user wants to |', '|---|---|'],
    row: `| \`${skill}\` | plan a delivery |`,
  })),
  routing('escaped-pipe', 4, 'a routing row whose ask holds an escaped pipe', (skill) => ({
    before: TABLE,
    row: `| plan a delivery \\| a pickup | \`${skill}\` |`,
    ask: 'plan a delivery',
  })),
  routing('no-outer-pipes', 3, 'a routing table written without outer pipes', (skill) => ({
    before: ['When the user wants to | Load', '---|---'],
    row: `plan a delivery | \`${skill}\``,
    ask: 'plan a delivery',
  })),
  routing('indented-table', 3, 'a routing table indented under a list item', (skill) => ({
    before: ['- Routing:', '', '  | When the user wants to | Load |', '  |---|---|'],
    row: `  | plan a delivery | \`${skill}\` |`,
  })),
  routing('list-item', 3, 'routing written as a list item', (skill) => ({
    before: ['## Routing', ''],
    row: `- To plan a delivery: load \`${skill}\`.`,
    ask: 'plan a delivery',
  })),
  routing('sentence', 4, 'routing written as a sentence', (skill) => ({
    before: ['## Routing', ''],
    row: `When the user wants to plan a delivery, load the \`${skill}\` skill.`,
    ask: 'plan a delivery',
  })),
  routing('heading-per-skill', 4, 'routing written as a heading per skill', (skill) => ({
    before: ['## Skills', ''],
    row: `### \`${skill}\``,
    after: ['', 'Use it when the user wants to plan a delivery.'],
    ask: 'Use it when the user wants to plan a delivery.',
  })),
  {
    key: 'crlf-standing',
    tier: 3,
    title: 'a routing table in a standing file with carriage returns',
    component: READER,
    plant: (e, s, o) => {
      const skill = standardSkill(e, s, o).skill;
      e.raw(
        STANDING,
        ['# Planted estate', '', ...TABLE, `| plan a delivery | \`${skill}\` |`, ''].join('\r\n'),
        o,
      );
      e.expect(o, { hid: `${o}:row`, kind: 'route', file: STANDING, line: 7, key: skill });
    },
  },
  {
    key: 'nested-standing',
    tier: 3,
    title: 'a standing file in a subfolder',
    component: READER,
    plant: (e, s, o) => {
      standing(e, o);
      const path = `src/${namesFor(s, o).noun}/CLAUDE.md`;
      const writer = e.file(path, o);
      writer.line('# Folder notes');
      writer.line('');
      const planted = rule(`${o}:rule`, 'Always keep the totals in whole cents.');
      writer.line(planted.text, planted.atoms, planted.prose);
    },
  },
  {
    key: 'imported-standing',
    tier: 4,
    title: 'a file the standing file imports',
    component: READER,
    plant: (e, s, o) => {
      const path = `.claude/docs/${namesFor(s, o).noun}-rules.md`;
      standing(e, o).line(`@${path}`);
      const writer = e.file(path, o);
      writer.line('# Imported rules');
      writer.line('');
      const planted = rule(`${o}:rule`, 'Always keep the totals in whole cents.');
      writer.line(planted.text, planted.atoms, planted.prose);
    },
  },
  {
    key: 'local-standing',
    tier: 1,
    title: 'a rule in the local standing file',
    component: READER,
    plant: (e, _s, o) => {
      standing(e, o);
      const writer = e.file('CLAUDE.local.md', o);
      writer.line('# Local notes');
      writer.line('');
      const planted = rule(`${o}:rule`, 'Always keep the totals in whole cents.');
      writer.line(planted.text, planted.atoms, planted.prose);
    },
  },
];

export function standingFamily(): Family {
  return caseFamily('scan.standing', CODE, CASES, 'the reader reads');
}
