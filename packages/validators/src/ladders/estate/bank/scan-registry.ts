import { GUARDS_DIR, STANDING } from '../layout';
import { type PlantedRole, plantedHeader } from '../registry-record';
import { anchored, type GuardLine, namesFor, order, rule, writeSettings } from './common';
import { type Family, itemsOf, type Tier } from './frame';
import { fieldIs, PlantedEstate } from './planted';

/**
 * scan.registry: a check registry in one of the shapes estates write, each in its own file beside one guard
 * and one or two labelled standing rules. The oracle: the guard enforces exactly the rules its row names
 * (an `enforces` edge to each), and the guard atom records its row's id. Shapes: markdown tables with the
 * column names in use (guard, script, check, hook, adapter, name, file, command; enforces, rules, gates,
 * covers, rule ids), cells holding labels in several notations or quoted passages, JSON with the keys in
 * use, and YAML.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';
const FAMILY = 'scan.registry';

type Row = {
  id: string;
  guard: string;
  event: string;
  enforces: string[];
  passage?: string;
  verdict: string;
};
type Shape = {
  key: string;
  tier: Tier;
  title: string;
  extension: 'md' | 'json' | 'yaml';
  /** Labels a row needs: one or two rules. */
  rules: 1 | 2;
  /** Enforces by a quoted passage of the rule, not a label. */
  passage?: 'quoted' | 'backticked';
  lines(row: Row): string[];
  /** The row id the guard atom records; undefined when the shape has none and the guard names the row. */
  rowId?: (row: Row) => string;
};

function table(
  guardHeader: string,
  enforcesHeader: string,
  cell: (row: Row) => string,
  guardCell?: (row: Row) => string,
  /** The role of the second column: a shape whose guard is found in the cells gives it none. */
  guardRole: PlantedRole | null = 'guard',
) {
  return (row: Row) => [
    '# Check registry',
    '',
    plantedHeader([
      ['id', 'Id'],
      [guardRole, guardHeader],
      ['event', 'Event'],
      ['enforces', enforcesHeader],
      ['verdict', 'Verdict'],
    ]),
    '|---|---|---|---|---|',
    `| ${row.id} | ${guardCell ? guardCell(row) : row.guard} | ${row.event} | ${cell(row)} | ${row.verdict} |`,
  ];
}
const labels = (row: Row) => row.enforces.join(', ');

const SHAPES: Shape[] = [
  {
    key: 'md-guard-enforces',
    tier: 1,
    title: 'a table with Guard and Enforces columns',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', labels),
  },
  {
    key: 'md-script-rules',
    tier: 1,
    title: 'a table with Script and Rules columns',
    extension: 'md',
    rules: 1,
    lines: table('Script', 'Rules', labels),
  },
  {
    key: 'md-check-enforces',
    tier: 1,
    title: 'a table with Check and Enforces columns',
    extension: 'md',
    rules: 1,
    lines: table('Check', 'Enforces', labels),
  },
  {
    key: 'md-hook-rule',
    tier: 1,
    title: 'a table with Hook and Rule columns',
    extension: 'md',
    rules: 1,
    lines: table('Hook', 'Rule', labels),
  },
  {
    key: 'md-guards-plural',
    tier: 1,
    title: 'a table with a Guards column',
    extension: 'md',
    rules: 1,
    lines: table('Guards', 'Enforces', labels),
  },
  {
    key: 'md-adapter',
    tier: 3,
    title: 'a table naming the guard in an Adapter column',
    extension: 'md',
    rules: 1,
    lines: table('Adapter', 'Enforces', labels),
  },
  {
    key: 'md-name',
    tier: 3,
    title: 'a table naming the guard in a Name column',
    extension: 'md',
    rules: 1,
    lines: table('Name', 'Enforces', labels, undefined, null),
  },
  {
    key: 'md-file',
    tier: 3,
    title: 'a table naming the guard in a File column',
    extension: 'md',
    rules: 1,
    lines: table('File', 'Enforces', labels, undefined, null),
  },
  {
    key: 'md-handler',
    tier: 3,
    title: 'a table naming the guard in a Handler column',
    extension: 'md',
    rules: 1,
    lines: table('Handler', 'Enforces', labels),
  },
  {
    key: 'md-gates',
    tier: 3,
    title: 'a table listing the rules in a Gates column',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Gates', labels),
  },
  {
    key: 'md-covers',
    tier: 3,
    title: 'a table listing the rules in a Covers column',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Covers', labels),
  },
  {
    key: 'md-enforced-rules',
    tier: 3,
    title: 'a table listing the rules in an Enforced rules column',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforced rules', labels),
  },
  {
    key: 'md-rule-ids',
    tier: 3,
    title: 'a table listing the rules in a Rule ids column',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Rule ids', labels),
  },
  {
    key: 'md-bold-headers',
    tier: 3,
    title: 'a table whose headers are in bold',
    extension: 'md',
    rules: 1,
    lines: table('**Guard**', '**Enforces**', labels),
  },
  {
    key: 'md-two-labels-comma',
    tier: 1,
    title: 'a cell with two labels and a comma',
    extension: 'md',
    rules: 2,
    lines: table('Guard', 'Enforces', labels),
  },
  {
    key: 'md-two-labels-and',
    tier: 2,
    title: 'a cell with two labels joined by and',
    extension: 'md',
    rules: 2,
    lines: table('Guard', 'Enforces', (row) => row.enforces.join(' and ')),
  },
  {
    key: 'md-two-labels-slash',
    tier: 2,
    title: 'a cell with two labels joined by a slash',
    extension: 'md',
    rules: 2,
    lines: table('Guard', 'Enforces', (row) => row.enforces.join('/')),
  },
  {
    key: 'md-label-brackets',
    tier: 2,
    title: 'a label in brackets',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', (row) => `[${labels(row)}]`),
  },
  {
    key: 'md-label-lowercase',
    tier: 3,
    title: 'a label written in lower case',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', (row) => labels(row).toLowerCase()),
  },
  {
    key: 'md-label-prefixed',
    tier: 3,
    title: 'a label written as "rule R3"',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', (row) => `rule ${labels(row)}`),
  },
  {
    key: 'md-quoted-passage',
    tier: 2,
    title: 'a quoted passage of the rule',
    extension: 'md',
    rules: 1,
    passage: 'quoted',
    lines: table('Guard', 'Enforces', (row) => `"${row.passage}"`),
  },
  {
    key: 'md-backticked-passage',
    tier: 2,
    title: 'a backticked passage of the rule',
    extension: 'md',
    rules: 1,
    passage: 'backticked',
    lines: table('Guard', 'Enforces', (row) => `\`${row.passage}\``),
  },
  {
    key: 'md-guard-path',
    tier: 1,
    title: 'the guard named by its path',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', labels, (row) => `${GUARDS_DIR}/${row.guard}`),
  },
  {
    key: 'md-guard-backticked',
    tier: 1,
    title: 'the guard name in backticks',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', labels, (row) => `\`${row.guard}\``),
  },
  {
    key: 'md-guard-no-extension',
    tier: 3,
    title: 'the guard named without its extension',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', labels, (row) => row.guard.replace(/\.[a-z]+$/, '')),
  },
  {
    key: 'md-guard-link',
    tier: 3,
    title: 'the guard named by a markdown link',
    extension: 'md',
    rules: 1,
    lines: table('Guard', 'Enforces', labels, (row) => `[${row.guard}](${row.guard})`),
  },
  {
    key: 'md-second-table',
    tier: 2,
    title: 'the row in the second of two tables',
    extension: 'md',
    rules: 1,
    lines: (row) => [
      '# Check registry',
      '',
      plantedHeader([
        ['event', 'Event'],
        [null, 'Meaning'],
      ]),
      '|---|---|',
      '| PreToolUse | before a tool runs |',
      '',
      ...table('Guard', 'Enforces', labels)(row).slice(2),
    ],
  },
  {
    key: 'md-no-id-column',
    tier: 2,
    title: 'a table with no Id column: the guard names the row',
    extension: 'md',
    rules: 1,
    lines: (row) => [
      plantedHeader([
        ['guard', 'Guard'],
        ['enforces', 'Enforces'],
      ]),
      '|---|---|',
      `| ${row.guard} | ${labels(row)} |`,
    ],
    rowId: (row) => row.guard,
  },
  {
    key: 'json-checks',
    tier: 1,
    title: 'a JSON registry under a checks key',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "checks": [',
      `    ${JSON.stringify({ id: row.id, guard: row.guard, enforces: row.enforces })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-array',
    tier: 1,
    title: 'a JSON registry that is a bare array',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '[',
      `  ${JSON.stringify({ id: row.id, script: row.guard, enforces: row.enforces })}`,
      ']',
    ],
  },
  {
    key: 'json-guards-key',
    tier: 3,
    title: 'a JSON registry under a guards key',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "guards": [',
      `    ${JSON.stringify({ id: row.id, guard: row.guard, enforces: row.enforces })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-enforces-string',
    tier: 3,
    title: 'a JSON registry whose enforces is one string',
    extension: 'json',
    rules: 2,
    lines: (row) => [
      '{',
      '  "checks": [',
      `    ${JSON.stringify({ id: row.id, guard: row.guard, enforces: row.enforces.join(', ') })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-enforces-objects',
    tier: 4,
    title: 'a JSON registry whose enforces lists objects with ids',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "checks": [',
      `    ${JSON.stringify({ id: row.id, guard: row.guard, enforces: row.enforces.map((id) => ({ id })) })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-rules-key',
    tier: 3,
    title: 'a JSON registry that lists rules under a rules key',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "checks": [',
      `    ${JSON.stringify({ id: row.id, guard: row.guard, rules: row.enforces })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-hook-key',
    tier: 3,
    title: 'a JSON registry that names the guard under a hook key',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "checks": [',
      `    ${JSON.stringify({ id: row.id, hook: row.guard, enforces: row.enforces })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'json-pretty',
    tier: 2,
    title: 'a pretty-printed JSON registry, the id not first',
    extension: 'json',
    rules: 1,
    lines: (row) => [
      '{',
      '  "checks": [',
      '    {',
      `      "guard": ${JSON.stringify(row.guard)},`,
      `      "id": ${JSON.stringify(row.id)},`,
      `      "enforces": ${JSON.stringify(row.enforces)}`,
      '    }',
      '  ]',
      '}',
    ],
  },
  {
    key: 'yaml',
    tier: 4,
    title: 'a YAML registry',
    extension: 'yaml',
    rules: 1,
    lines: (row) => [
      'checks:',
      `  - id: ${row.id}`,
      `    guard: ${row.guard}`,
      `    enforces: [${row.enforces.join(', ')}]`,
    ],
  },
];

export function registryFamily(): Family {
  const items = itemsOf(
    FAMILY,
    1,
    COMPONENT,
    SHAPES.map(({ key, tier, title }) => ({ key, tier, title: `the guard enforces the rules of ${title}` })),
  );
  return {
    id: FAMILY,
    level: 1,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      const standing = estate.file(STANDING, 'base');
      standing.line('# Planted estate');
      standing.line('');
      const guards: GuardLine[] = [];
      let label = 0;
      SHAPES.forEach((shape, index) => {
        const owner = `${FAMILY}.${shape.key}`;
        const names = namesFor(seed, owner);
        const guard = `${names.skill}.py`;
        const ids: string[] = [];
        const rules: string[] = [];
        const passages: string[] = [];
        for (let n = 0; n < shape.rules; n += 1) {
          label += 1;
          const text = `Never ${names.verb} a ${names.noun} twice in one day, rule ${index}-${n}.`;
          const planted = rule(`${owner}:rule${n}`, text);
          standing.owner = owner;
          standing.line(`- **R${label}.** ${text}`, planted.atoms, planted.prose);
          ids.push(`R${label}`);
          rules.push(`${owner}:rule${n}`);
          passages.push(`${names.verb} a ${names.noun} twice in one day`);
        }
        standing.owner = 'base';
        const row: Row = {
          id: `G${index + 1}`,
          guard,
          event: 'PreToolUse',
          enforces: ids,
          passage: passages[0] as string,
          verdict: 'deny',
        };
        const script = `${GUARDS_DIR}/${guard}`;
        estate.raw(script, '#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n', owner);
        guards.push({
          owner,
          event: 'PreToolUse',
          matcher: 'Bash',
          command: anchored(script, 'python3'),
          atoms: [{ hid: `${owner}:guard`, kind: 'guard', key: guard }],
        });
        const file = `${GUARDS_DIR}/${names.skill}-registry.${shape.extension}`;
        estate.file(file, owner).lines_(shape.lines(row));
        for (const target of rules) estate.edge(owner, `${owner}:guard`, target, 'enforces');
        estate.check(owner, fieldIs(`${owner}:guard`, 'registry', shape.rowId ? shape.rowId(row) : row.id));
      });
      writeSettings(estate, order(seed, FAMILY, guards));
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}
