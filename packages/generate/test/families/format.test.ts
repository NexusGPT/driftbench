import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { compileFile, formulaPattern } from '../../src/families/compile';
import { alternatives, broken, drawKnobs, FamilyError, meets } from '../../src/families/knobs';
import { loadFamily, pendingReview, reviewStatus } from '../../src/families/load';
import { renderFiles, renderInstruction, unapprovedPhrases } from '../../src/families/render';
import { applyCorner, chooseCorners, generateTable, generateTables } from '../../src/families/tables';
import { rngFor } from '../../src/seed/random';
import { ACME_FAMILY, issuesOf, load, TOY_FAMILY, TOY_ORACLE, writeFamily } from './support';

describe('the family file', () => {
  it('loads the Acme price-sheet family with its oracle and the hashes of both files', async () => {
    const result = await loadFamily(ACME_FAMILY);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.issues)).toBe(true);
    if (!result.ok) return;
    const { family, familySha256, oracleSha256 } = result.loaded;
    expect(family.id).toBe('acme-price-sheet');
    expect(Object.keys(family.knobs).sort()).toEqual([
      'categories',
      'column_order',
      'language',
      'line_endings',
      'plans',
      'planted',
      'readme_name',
      'seed_format',
      'start',
      'summary',
      'wording',
      'workbook',
      'yearly',
    ]);
    const classes = Object.fromEntries(
      Object.entries(family.knobs).map(([name, knob]) => [name, knob.class]),
    );
    expect(classes).toMatchObject({
      plans: 'difficulty',
      categories: 'difficulty',
      seed_format: 'structure',
      start: 'structure',
      wording: 'style',
    });
    expect(familySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(oracleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(unapprovedPhrases(family)).toEqual([]);
  });

  it('accepts a family folder or the family file itself', async () => {
    const dir = await writeFamily();
    expect((await loadFamily(dir)).ok).toBe(true);
    expect((await loadFamily(join(dir, 'family.yaml'))).ok).toBe(true);
  });

  it('refuses a reader check the reader of that kind does not answer, and names the ones it does', async () => {
    const issues = await issuesOf(
      TOY_FAMILY.replace('csv: [header, rows, cells]', 'csv: [header, rows, sheets]'),
    );
    expect(issues).toEqual([
      expect.stringMatching(
        /^checks\.csv: sheets is not a check of the csv reader; it answers header, rows, cells/,
      ),
    ]);
  });

  it('refuses names that do not exist: a knob, a phrase, a column, a value a knob never holds', async () => {
    const issues = await issuesOf(
      TOY_FAMILY.replace('phrases: [ask.a, ask.b]', 'phrases: [ask.a, ask.z]')
        .replace(
          'when: { format: csv }\n    csv: { table: items, columns: [item, group, size, qty]',
          'when: { format: xml }\n    csv: { table: items, columns: [item, group, colour, qty]',
        )
        .replace('require: { eol: lf }', 'require: { endings: lf }'),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no phrase ask.z'),
        expect.stringContaining('the knob format never holds "xml"'),
        expect.stringContaining('the table items has no column colour'),
        expect.stringContaining('no knob endings'),
      ]),
    );
  });

  it('refuses a block that fixes what the oracle decides, and a condition on the first block', async () => {
    const issues = await issuesOf(
      TOY_FAMILY.replace(
        'execution: { ran_code: true }',
        'execution: { ran_code: true }\n      workspace: { created: [] }',
      ).replace(
        '  - id: total\n    stage: total',
        '  - id: total\n    when: { format: csv }\n    stage: total',
      ),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'blocks.0.expect.workspace: the oracle decides workspace; the family may not fix it',
      ]),
    );
  });

  it('refuses a wording knob that is not a style knob, and a corner pattern with no group', async () => {
    const issues = await issuesOf(
      TOY_FAMILY.replace('wording: { class: style', 'wording: { class: structure').replace(
        "match: '^(\\d+) kg$'",
        () => "match: '^\\d+ kg$'",
      ),
    );
    expect(issues).toEqual([
      'wording_knob: the wording knob wording must be a style knob',
      'corners.kinds.3.unit_change.rules.0: the pattern needs a group around the number',
    ]);
  });

  it('refuses a range knob whose min is larger than its max', async () => {
    const issues = await issuesOf(TOY_FAMILY.replace('min: 2, max: 6', 'min: 7, max: 6'));
    expect(issues.join('\n')).toMatch(/^knobs\.rows/);
  });

  it('refuses a family whose oracle is missing or exports no expected function', async () => {
    expect(await issuesOf(TOY_FAMILY.replace('oracle: oracle.mjs', 'oracle: missing.mjs'))).toEqual([
      expect.stringMatching(/^oracle: cannot read the oracle missing\.mjs/),
    ]);
    expect(await issuesOf(TOY_FAMILY, 'export const nothing = 1;\n')).toEqual([
      'oracle: oracle.mjs exports no function expected(input)',
    ]);
  });
});

describe('the review a person signs once per family', () => {
  it('is missing, then pending, then signed, then stale when the oracle changes', async () => {
    const dir = await writeFamily();
    const loaded = await load(dir);
    expect((await reviewStatus(loaded)).state).toBe('missing');

    const pending = pendingReview(loaded);
    await writeFile(join(dir, 'review.yaml'), stringify(pending));
    expect((await reviewStatus(loaded)).state).toBe('pending');

    await writeFile(
      join(dir, 'review.yaml'),
      stringify({ ...pending, signed_by: 'A. Reviewer', signed_on: '2026-10-11' }),
    );
    expect((await reviewStatus(loaded)).state).toBe('signed');

    await writeFile(join(dir, 'oracle.mjs'), `${TOY_ORACLE}\n// changed\n`);
    const status = await reviewStatus(await load(dir));
    expect(status).toMatchObject({ state: 'stale', changed: ['the oracle'] });
  });

  it('is invalid when it names another family or misses a field', async () => {
    const dir = await writeFamily();
    const loaded = await load(dir);
    await writeFile(join(dir, 'review.yaml'), stringify({ ...pendingReview(loaded), family: 'other' }));
    expect(await reviewStatus(loaded)).toMatchObject({
      state: 'invalid',
      message: 'the review is of the family other, not toy-totals',
    });
    await writeFile(join(dir, 'review.yaml'), 'family: toy-totals\n');
    expect((await reviewStatus(loaded)).state).toBe('invalid');
  });
});

describe('knobs and constraints', () => {
  it('draws the same knobs from the same seed, and every draw keeps every constraint', async () => {
    const { family } = await load(await writeFamily());
    expect(drawKnobs(family, rngFor(7, 'knobs'))).toEqual(drawKnobs(family, rngFor(7, 'knobs')));
    for (let seed = 0; seed < 300; seed += 1) {
      const knobs = drawKnobs(family, rngFor(seed, 'knobs'));
      expect(broken(knobs, family.constraints)).toEqual([]);
      expect(Number(knobs.groups)).toBeLessThanOrEqual(Number(knobs.rows));
      if (knobs.format === 'json') expect(knobs.eol).toBe('lf');
    }
  });

  it('names the constraints a draw breaks, and offers only alternatives that keep them', async () => {
    const { family } = await load(await writeFamily());
    const knobs = {
      rows: 2,
      groups: 2,
      format: 'json',
      planted: 'without',
      wording: 'a',
      order: 'catalog',
      eol: 'lf',
    };
    expect(broken(knobs, family.constraints)).toEqual([]);
    expect(broken({ ...knobs, rows: 1, eol: 'crlf' }, family.constraints)).toEqual([
      'a-row-per-group',
      'json-lf',
    ]);
    expect(alternatives(family, knobs, 'eol')).toEqual([]);
    expect(alternatives(family, { ...knobs, format: 'csv' }, 'eol')).toEqual(['crlf']);
    expect(meets(knobs, { format: ['csv', 'json'] })).toBe(true);
    expect(meets(knobs, { format: 'csv' })).toBe(false);
  });

  it('says when no draw meets the constraints', async () => {
    const { family } = await load(
      await writeFamily(TOY_FAMILY.replace("op: '<=', right: rows", "op: '>', right: 9")),
    );
    expect(() => drawKnobs(family, rngFor(1, 'knobs'))).toThrow(FamilyError);
  });
});

describe('the seed grammar', () => {
  it('generates the same table from the same seed; every picked group holds a row; seq counts per group', async () => {
    const { family } = await load(await writeFamily());
    const knobs = { rows: 6, groups: 2 };
    const table = generateTable('items', family.tables.items as never, 11, knobs);
    expect(generateTable('items', family.tables.items as never, 11, knobs)).toEqual(table);
    expect(table.rows).toHaveLength(6);
    expect(new Set(table.rows.map((row) => row.group))).toEqual(new Set(['red', 'blue']));
    for (const group of ['red', 'blue']) {
      const items = table.rows.filter((row) => row.group === group).map((row) => row.item);
      const title = group === 'red' ? 'Red' : 'Blue';
      expect(items).toEqual(items.map((_, index) => `Item ${title} ${index + 1}`));
    }
    for (const row of table.rows) {
      expect(row.group === 'red' ? ['10 kg', '20 kg'] : ['5 kg', 'small']).toContain(row.size);
      expect(row.qty).toBeGreaterThanOrEqual(1);
      expect(row.qty).toBeLessThanOrEqual(9);
    }
    expect(() => generateTable('items', family.tables.items as never, 11, { rows: 1, groups: 2 })).toThrow(
      /needs 2 distinct values on 1 rows/,
    );
  });

  it('applies each corner case and stays inside the contract', async () => {
    const { family } = await load(await writeFamily());
    const tables = {
      items: {
        rows: [
          { item: 'Item Red 1', group: 'red', size: '10 kg', qty: 3 },
          { item: 'Item Blue 1', group: 'blue', size: 'small', qty: 4 },
        ],
        columnShift: 0,
      },
    };
    const kind = (id: string) => family.corners.kinds.find((entry) => entry.id === id) as never;

    const emptied = applyCorner(tables, kind('empty-size'), 3)?.items?.rows ?? [];
    expect(emptied.filter((row) => row.size === '')).toHaveLength(1);
    expect(emptied.map((row) => row.item)).toEqual(['Item Red 1', 'Item Blue 1']);

    const twice = applyCorner(tables, kind('twice'), 3)?.items?.rows ?? [];
    expect(twice).toHaveLength(3);
    const at = twice.findIndex((row, index) => index > 0 && row.item === twice[index - 1]?.item);
    expect(at).toBeGreaterThan(0);

    expect(applyCorner(tables, kind('rotated'), 3)?.items?.columnShift).toBe(1);
    expect(applyCorner(tables, kind('grams'), 3)?.items?.rows.map((row) => row.size)).toEqual([
      '10000 g',
      'small',
    ]);

    const noUnits = {
      items: { rows: [{ item: 'Item Blue 1', group: 'blue', size: 'small', qty: 1 }], columnShift: 0 },
    };
    expect(applyCorner(noUnits, kind('grams'), 3)).toBeUndefined();
    expect(chooseCorners(family, noUnits, 3).map((corner) => corner.id)).not.toContain('grams');
    // The input tables are never changed.
    expect(tables.items.rows[0]).toEqual({ item: 'Item Red 1', group: 'red', size: '10 kg', qty: 3 });
  });

  it('renders CSV with quotes, CR LF and shuffled or rotated columns; JSON keeps numbers; text from a phrase', async () => {
    const loaded = await load(await writeFamily());
    const tables = {
      items: { rows: [{ item: 'Item, "Red" 1', group: 'red', size: '10 kg', qty: 3 }], columnShift: 0 },
    };
    const base = {
      rows: 2,
      groups: 1,
      format: 'csv',
      planted: 'without',
      wording: 'a',
      order: 'catalog',
      eol: 'lf',
    };

    const csv = renderFiles(loaded, tables, base, 5).text;
    expect(csv['items.csv']).toBe('item,group,size,qty\n"Item, ""Red"" 1",red,10 kg,3\n');
    expect(csv['README.txt']).toBe('items.csv lists the items.\n');

    const crlf = renderFiles(loaded, tables, { ...base, eol: 'crlf' }, 5).text['items.csv'];
    expect(crlf).toBe('item,group,size,qty\r\n"Item, ""Red"" 1",red,10 kg,3\r\n');

    const shuffled = renderFiles(loaded, tables, { ...base, order: 'shuffled' }, 5).text['items.csv'] ?? '';
    expect(shuffled.split('\n')[0]).not.toBe('item,group,size,qty');
    expect(shuffled.split('\n')[0]?.split(',').sort()).toEqual(['group', 'item', 'qty', 'size']);

    const rotated = renderFiles(loaded, { items: { ...tables.items, columnShift: 1 } }, base, 5).text[
      'items.csv'
    ];
    expect(rotated?.split('\n')[0]).toBe('group,size,qty,item');

    const json = renderFiles(loaded, tables, { ...base, format: 'json' }, 5).text['items.json'] ?? '';
    expect(JSON.parse(json)).toEqual({
      items: [{ item: 'Item, "Red" 1', group: 'red', size: '10 kg', qty: 3 }],
    });
  });

  it('copies an existing file: text stays text, a workbook stays bytes', async () => {
    const workbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0xff]);
    const family = TOY_FAMILY.replace(
      '  - path: README.txt\n',
      '  - path: base.xlsx\n    copy: { from: fixture.xlsx }\n  - path: notes.txt\n    copy: { from: fixture.txt }\n  - path: README.txt\n',
    );
    const loaded = await load(
      await writeFamily(family, TOY_ORACLE, { 'fixture.xlsx': workbook, 'fixture.txt': 'plain text\n' }),
    );
    const tables = generateTables(loaded.family, 1, { rows: 2, groups: 1 });
    const files = renderFiles(
      loaded,
      tables,
      { rows: 2, groups: 1, format: 'csv', planted: 'without', wording: 'a', order: 'catalog', eol: 'lf' },
      1,
    );
    expect(files.text['notes.txt']).toBe('plain text\n');
    expect([...(files.binary['base.xlsx'] ?? [])]).toEqual([...workbook]);
    expect(await issuesOf(family)).toEqual([
      'files.2.copy.from: no file fixture.xlsx beside the family file',
      'files.3.copy.from: no file fixture.txt beside the family file',
    ]);
  });

  it('writes each instruction from the approved phrase the wording knob picks, and refuses an unapproved one', async () => {
    const loaded = await load(await writeFamily());
    const block = loaded.family.blocks[0] as never;
    const knobs = { format: 'csv', wording: 'b' };
    expect(renderInstruction(loaded.family, block, knobs, { items_file: 'items.csv' })).toBe(
      'Write out/totals.csv: the total qty per group of items.csv, groups in the order they first appear.',
    );
    expect(() => renderInstruction(loaded.family, block, knobs, {})).toThrow(
      /uses \{items_file\}, which no knob, file or oracle slot fills/,
    );

    const unapproved = await load(
      await writeFamily(TOY_FAMILY.replace('id: ask.b, approved: true', 'id: ask.b, approved: false')),
    );
    expect(unapprovedPhrases(unapproved.family)).toEqual(['ask.b']);
    expect(() =>
      renderInstruction(unapproved.family, unapproved.family.blocks[0] as never, knobs, { items_file: 'x' }),
    ).toThrow('the phrase ask.b is not approved');
  });
});

describe('the checks the oracle outcome compiles to', () => {
  it('matches a formula as written, with spaces around its operators', () => {
    const pattern = new RegExp(formulaPattern('=C2*12'));
    expect(pattern.test('=C2*12')).toBe(true);
    expect(pattern.test('=C2 * 12')).toBe(true);
    expect(pattern.test('=C3*12')).toBe(false);
    expect(formulaPattern('=SUM(B2:B4)/2')).toBe('^=SUM\\(B2:B4\\)\\s*/\\s*2$');
  });

  it('matches one multiplication or one addition with its operands in either order, nothing else', () => {
    const times = new RegExp(formulaPattern('=C2*12'));
    for (const written of ['=12*C2', '=12 * C2', '=C2*12']) expect(times.test(written), written).toBe(true);
    for (const written of ['=12*C3', '=13*C2', '=C2*13', '=12+C2', '=C2*12*12', '=12*C2*12', '=C2', '180'])
      expect(times.test(written), written).toBe(false);
    const plus = new RegExp(formulaPattern('=B2+C2'));
    expect(plus.test('=C2 + B2')).toBe(true);
    expect(plus.test('=C2*B2')).toBe(false);
    // A subtraction or a division is not commutative, and a formula of two operations keeps its order.
    expect(new RegExp(formulaPattern('=C2-12')).test('=12-C2')).toBe(false);
    expect(new RegExp(formulaPattern('=C2/12')).test('=12/C2')).toBe(false);
    expect(new RegExp(formulaPattern('=C2*12+1')).test('=1+C2*12')).toBe(false);
  });

  it('swaps only two operands that are each a cell reference or a number; any other formula keeps its order', () => {
    // A comparison or a power inside an operand makes a formula of two operations: no swap.
    const comparison = new RegExp(formulaPattern('=C2=12+1'));
    expect(comparison.test('=C2=12+1')).toBe(true);
    expect(comparison.test('=1+C2=12')).toBe(false);
    const power = new RegExp(formulaPattern('=C2^2+1'));
    expect(power.test('=C2^2+1')).toBe(true);
    expect(power.test('=1+C2^2')).toBe(false);
    for (const formula of ['=SUM(C2)*12', '=$C2*12', '=C2*-12', '=C2&12+1', '=C2*12%', '=C2>1*2'])
      expect(formulaPattern(formula), formula).not.toContain('(?:');
    // A decimal constant is a number operand, its dot taken literally.
    const decimal = new RegExp(formulaPattern('=C2*1.5'));
    expect(decimal.test('=1.5*C2')).toBe(true);
    expect(decimal.test('=1x5*C2')).toBe(false);
  });

  it('lets the committed price-sheet instance i04 take =12*C<row> for its yearly formula, on its own row only', async () => {
    const formulas: Array<{ cell: string; regex: string }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const formula = (node as { formula?: { cell: string; regex: string } }).formula;
        if (formula) formulas.push(formula);
        else Object.values(node).forEach(walk);
      }
    };
    walk(parse(await readFile(join(ACME_FAMILY, 'instances/i04/base.yaml'), 'utf8')));
    expect(formulas.length).toBeGreaterThan(0);
    for (const { cell, regex } of formulas) {
      const row = cell.slice(1);
      const pattern = new RegExp(regex);
      expect(pattern.test(`=12*C${row}`), `${cell} ${regex}`).toBe(true);
      expect(pattern.test(`=C${row} * 12`), `${cell} ${regex}`).toBe(true);
      expect(pattern.test(`=12*C${Number(row) + 1}`), `${cell} ${regex}`).toBe(false);
      expect(pattern.test(`=13*C${row}`), `${cell} ${regex}`).toBe(false);
    }
  });

  it('checks a formula column by its formula on every row, the other columns by their values', () => {
    const artifact = compileFile(
      {
        path: 'out/book.xlsx',
        kind: 'xlsx',
        sheets: [
          {
            name: 'Mobile',
            header: ['Plan', 'Monthly', 'Yearly'],
            rows: [
              ['A', 10, 120],
              ['B', null, 0],
            ],
            formulas: { C: '=B{row}*12' },
          },
        ],
      },
      { xlsx: ['sheets', 'header', 'rows', 'cells', 'formula', 'no_error_cells'] },
    );
    expect(artifact.checks).toEqual([
      { sheets: ['Mobile'] },
      { header: { sheet: 'Mobile', row: 1, values: ['Plan', 'Monthly', 'Yearly'] } },
      { rows: { sheet: 'Mobile', count: 2 } },
      { cells: { sheet: 'Mobile', column: 'A', from_row: 2, values: ['A', 'B'] } },
      { cells: { sheet: 'Mobile', column: 'B', from_row: 2, values: [10, ''] } },
      { formula: { sheet: 'Mobile', cell: 'C2', regex: '^=(?:B2\\s*\\*\\s*12|12\\s*\\*\\s*B2)$' } },
      { formula: { sheet: 'Mobile', cell: 'C3', regex: '^=(?:B3\\s*\\*\\s*12|12\\s*\\*\\s*B3)$' } },
      { no_error_cells: true },
    ]);
  });

  it('emits only the checks the family names for the kind', () => {
    const artifact = compileFile(
      { path: 'out/t.csv', kind: 'csv', header: ['group', 'total'], rows: [['red', 3]] },
      { csv: ['rows'], xlsx: ['sheets'] },
    );
    expect(artifact.checks).toEqual([{ rows: { count: 1 } }]);
    expect(
      compileFile({ path: 'n.txt', kind: 'text', contains: ['done'] }, { text: ['contains'] }).checks,
    ).toEqual([{ contains: ['done'] }]);
    expect(
      compileFile({ path: 'v.json', kind: 'json', value: { total: 3 } }, { json: ['subset'] }).checks,
    ).toEqual([{ subset: { total: 3 } }]);
  });
});

describe('the Acme family as written', () => {
  it('keeps its approved phrases free of the words the reference reads as another request', async () => {
    const text = await readFile(join(ACME_FAMILY, 'family.yaml'), 'utf8');
    const { family } = await load(ACME_FAMILY);
    for (const block of family.blocks) {
      for (const part of block.parts) {
        for (const id of part.phrases) {
          const phrase = family.phrases.find((entry) => entry.id === id)?.text ?? '';
          if (block.id === 'build') expect(phrase).not.toMatch(/\bsummary\b/i);
          if (block.id === 'summary') expect(phrase).toMatch(/\bsummary\b/i);
        }
      }
    }
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
