import { describe, expect, it } from 'vitest';
import { importTable, parseSpecText, parseTableMapping, type TableInput } from '../../src/index';

/** Fictional data only: the Acme Telecom sales assistant. */
const CASES: TableInput = {
  label: 'cases.csv',
  rows: [
    ['conversation', 'title', 'question', 'stage', 'must', 'must_not', 'criteria', 'max_calls'],
    [
      'upgrade',
      'A customer upgrades',
      'Hello, I want faster internet.',
      'address',
      'Acme Telecom|address',
      '',
      'polite',
      '0',
    ],
    ['upgrade', '', '88 Summit Avenue, Acmeville', 'offer', 'Acme Air 5G', 'Fiber (300|1000)', '', '1'],
    [null, null, null, null, null, null, null, null],
    [
      'porting',
      'A customer ports a number',
      'Can I keep my number?',
      'details',
      'keep your number',
      '',
      'polite',
      '',
    ],
  ],
};

const MAPPING = `
group_by: conversation
spec:
  id: "acme-import-{conversation}"
  title: "{title}"
  target: { adapter: function, agent: acme-sales }
  stages: [address, offer, details]
  criteria:
    - name: polite
      rubric: The reply is polite.
block:
  user: "{question}"
  expect:
    stage: "{stage}"
    must: { $column: must, $split: "|" }
    must_not: { $column: must_not, $list: true }
    criteria: { $column: criteria, $split: "," }
    tools:
      - label: coverage.check
        count: { max: { $column: max_calls, $as: number } }
`;

function mapping(text = MAPPING) {
  const parsed = parseTableMapping(text);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.mapping;
}

describe('importTable', () => {
  it('maps a group of rows to one spec with one block per row, in row order', () => {
    const result = importTable([CASES], mapping(), 'cases.csv');
    expect(result.errors).toEqual([]);
    expect(result.specs.map((each) => [each.id, each.rows])).toEqual([
      ['acme-import-upgrade', [2, 3]],
      ['acme-import-porting', [5]],
    ]);
    const [upgrade] = result.specs;
    expect(upgrade?.spec).toEqual({
      id: 'acme-import-upgrade',
      title: 'A customer upgrades',
      target: { adapter: 'function', agent: 'acme-sales' },
      stages: ['address', 'offer', 'details'],
      criteria: [{ name: 'polite', rubric: 'The reply is polite.' }],
      blocks: [
        {
          user: 'Hello, I want faster internet.',
          expect: {
            stage: 'address',
            must: ['Acme Telecom', 'address'],
            criteria: ['polite'],
            tools: [{ label: 'coverage.check', count: { max: 0 } }],
          },
        },
        {
          user: '88 Summit Avenue, Acmeville',
          expect: {
            stage: 'offer',
            must: ['Acme Air 5G'],
            must_not: ['Fiber (300|1000)'],
            tools: [{ label: 'coverage.check', count: { max: 1 } }],
          },
        },
      ],
    });
  });

  it('writes YAML the spec loader reads back to the same spec, with the source rows in a comment', () => {
    const [porting] = importTable([CASES], mapping(), 'cases.csv').specs.slice(1);
    if (!porting) throw new Error('no porting spec');
    expect(porting.yaml.startsWith('# Imported from cases.csv, row 5.\n')).toBe(true);
    const loaded = parseSpecText(porting.yaml, 'yaml');
    expect(loaded.ok && loaded.hash).toBe(porting.hash);
    expect(loaded.ok && loaded.spec.blocks[0]?.expect?.tools).toEqual([{ label: 'coverage.check' }]);
  });

  it('writes one opening brace for two in a row, as docs/datasets.md says, and still fills the columns', () => {
    const text = MAPPING.replace('title: "{title}"', 'title: "Brace {{ here, {{literal} and {title}"');
    const result = importTable([CASES], mapping(text), 'cases.csv');
    expect(result.errors).toEqual([]);
    expect(result.specs[0]?.spec.title).toBe('Brace { here, {literal} and A customer upgrades');
  });

  it('makes one spec per row without group_by, with {row} for an id', () => {
    const text = MAPPING.replace('group_by: conversation\n', '').replace('{conversation}', 'row-{row}');
    const result = importTable([CASES], mapping(text), 'cases.csv');
    expect(result.errors).toEqual([]);
    expect(result.specs.map((each) => each.id)).toEqual([
      'acme-import-row-2',
      'acme-import-row-3',
      'acme-import-row-5',
    ]);
  });

  it('reports a row whose spec does not validate, with its row number and the loader error, and keeps the rest', () => {
    const broken: TableInput = {
      label: 'cases.csv',
      rows: [...CASES.rows, ['refund', 'Refund', 'I want a refund', 'nowhere', '', '', '', '']],
    };
    const result = importTable([broken], mapping(), 'cases.csv');
    expect(result.specs).toHaveLength(2);
    expect(result.errors).toEqual([{ rows: [6], message: expect.stringContaining('STAGE_UNKNOWN') }]);
  });

  it('refuses a mapping that names a column the table does not have, listing the columns it has', () => {
    const result = importTable([CASES], mapping(MAPPING.replace('{question}', '{prompt}')), 'cases.csv');
    expect(result.specs).toEqual([]);
    expect(result.errors).toEqual([
      {
        rows: [],
        message:
          'the mapping names column "prompt", which cases.csv does not have; its columns are conversation, title, question, stage, must, must_not, criteria, max_calls',
      },
    ]);
  });

  it('refuses a value that does not convert, and two groups with one id', () => {
    const row = [...(CASES.rows[1] ?? [])];
    row[7] = 'many';
    const result = importTable(
      [{ label: 'cases.csv', rows: [CASES.rows[0] ?? [], row] }],
      mapping(),
      'cases.csv',
    );
    expect(result.errors).toEqual([{ rows: [2], message: 'column max_calls: "many" is not a number' }]);

    const twice = MAPPING.replace('{conversation}', 'same');
    const clash = importTable([CASES], mapping(twice), 'cases.csv');
    expect(clash.errors).toEqual([
      { rows: [5], message: 'spec id acme-import-same is already made from rows 2, 3' },
    ]);
  });

  it('picks the sheet the mapping names and the header row it gives', () => {
    const sheets: TableInput[] = [
      { label: 'Notes', rows: [['nothing here']] },
      { label: 'Cases', rows: [['Acme import, fictional'], ...CASES.rows] },
    ];
    const text = `sheet: Cases\nheader_row: 2\n${MAPPING}`;
    const result = importTable(sheets, mapping(text), 'cases.xlsx');
    expect(result.errors).toEqual([]);
    expect(result.specs.map((each) => each.rows)).toEqual([[3, 4], [6]]);
    const missing = importTable(sheets, mapping(`sheet: Plans\n${MAPPING}`), 'cases.xlsx');
    expect(missing.errors[0]?.message).toBe('cases.xlsx has no sheet "Plans"; its sheets are Notes, Cases');
  });

  it('keeps numbers and booleans of a spreadsheet cell, and reads a text cell as text', () => {
    const sheet: TableInput = {
      label: 'Cases',
      rows: [
        ['id', 'question', 'cost'],
        ['a', 'Hello', 0.02],
      ],
    };
    const text = 'spec:\n  id: "acme-{id}"\nblock:\n  user: "{question}"\n  budget: { cost_usd: "{cost}" }\n';
    const [only] = importTable([sheet], mapping(text), 'cases.xlsx').specs;
    expect(only?.spec.blocks).toEqual([{ user: 'Hello', budget: { cost_usd: 0.02 } }]);
  });
});

describe('parseTableMapping', () => {
  it('refuses a mapping without a spec id or a block stimulus, and unknown keys', () => {
    const parsed = parseTableMapping('spec: { title: x }\nblock: { expect: { must: [a] } }\nsheets: 2\n');
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.errors).toEqual([
      'unknown key: sheets',
      'spec: needs an id, such as id: "my-spec-{row}"',
      'block: needs user, burst or when',
    ]);
  });

  it('refuses a directive with an unknown key or conversion', () => {
    const parsed = parseTableMapping(
      'spec: { id: x }\nblock: { user: "{q}", expect: { must: { $column: m, $sep: "|" }, stage: { $column: s, $as: date } } }\n',
    );
    expect(!parsed.ok && parsed.errors).toEqual([
      'block.expect.must: unknown directive key $sep; a directive takes $column, $split, $list, $as',
      'block.expect.stage: $as takes text, number, boolean or json',
    ]);
  });
});
