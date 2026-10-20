import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  diffEstateMaps,
  type EstateTest,
  estateImpact,
  loadEstateTests,
  renderImpact,
  retirementReason,
  writeRetirements,
} from '../../src/index';
import { estate } from '../support';
import { atom, estateMap } from './support';

/** A valid spec that covers the given atoms. */
function spec(id: string, atoms: string[], extra = ''): string {
  return [
    `# The test of ${atoms.join(', ')}. Fictional.`,
    `id: ${id}`,
    'kind: task',
    `title: Test ${id}`,
    'target: { adapter: claude-code }',
    'metadata:',
    `  estate: { atoms: [${atoms.join(', ')}] }`,
    ...(extra === '' ? [] : [extra]),
    'blocks:',
    '  - user: Reconcile the invoice of the week.',
    '    expect:',
    '      skills:',
    '        - { name: invoice-reconcile, count: { min: 1 } }',
    '',
  ].join('\n');
}

const before = estateMap([
  atom('a.keep', 'Keep the ledger.', { line: 3 }),
  atom('a.wrap', 'Never send a draft without a yes.', { line: 4 }),
  atom('a.late', 'A shipment is late after two days.', { line: 5 }),
  atom('a.gone', 'Ask at most one question.', { line: 6 }),
  atom('a.gone2', 'Keep replies short.', { line: 7 }),
  atom('a.restate', 'Restated rule.', { line: 8 }),
  atom('a.moved', 'Moved rule.', { line: 9 }),
]);
const after = estateMap([
  atom('a.keep', 'Keep the ledger.', { line: 3 }),
  atom('a.wrap', 'Never send a draft\n  without a yes.', { line: 4, endLine: 5 }),
  atom('a.late', 'A shipment is late after one day.', { line: 6 }),
  atom('a.restate', 'Restated rule.', { line: 8, evidence: [{ type: 'text', must: ['new'] }] }),
  atom('a.moved', 'Moved rule.', { line: 12 }),
  atom('a.added', 'Before closing a month: Read the table.', { line: 10, kind: 'gate' }),
  atom('a.added2', 'Name the finance lead.', { line: 11 }),
]);
const diff = diffEstateMaps(before, after);

function test(id: string, atoms: string[], retired?: string): EstateTest {
  return { id, path: `/tests/${id}.yaml`, file: `${id}.yaml`, atoms, ...(retired ? { retired } : {}) };
}

describe('estateImpact', () => {
  const tests = [
    test('t-keep', ['a.keep']),
    test('t-wrap', ['a.wrap']),
    test('t-late', ['a.late', 'a.keep']),
    test('t-gone', ['a.gone', 'a.gone2']),
    test('t-part', ['a.gone', 'a.keep']),
    test('t-restate', ['a.restate']),
    test('t-moved', ['a.moved']),
    test('t-added2', ['a.added2']),
    test('t-old', ['a.gone'], 'atom a.gone removed'),
  ];
  const report = estateImpact(diff, tests, { others: 2 });

  it('lists every test to regenerate with the reason per atom', () => {
    expect(report.regenerate).toEqual([
      { test: 't-late', file: 't-late.yaml', atoms: [{ atom: 'a.late', why: 'semantic' }] },
      { test: 't-part', file: 't-part.yaml', atoms: [{ atom: 'a.gone', why: 'removed' }] },
      { test: 't-restate', file: 't-restate.yaml', atoms: [{ atom: 'a.restate', why: 'restated' }] },
    ]);
  });

  it('touches no test of an atom whose quote changed in white space only', () => {
    expect(report.regenerate.some((entry) => entry.test === 't-wrap')).toBe(false);
    expect(report.retire.some((entry) => entry.test === 't-wrap')).toBe(false);
    expect(report.reapprove.some((entry) => entry.atom === 'a.wrap')).toBe(false);
  });

  it('still regenerates the tests of an atom respaced and restated at once', () => {
    const restated = estateMap([
      atom('a.wrap', 'Never send a draft\n  without a yes.', {
        line: 4,
        endLine: 5,
        evidence: [{ type: 'text', must: ['yes'] }],
      }),
    ]);
    const once = estateImpact(
      diffEstateMaps(estateMap([atom('a.wrap', 'Never send a draft without a yes.', { line: 4 })]), restated),
      [test('t-wrap', ['a.wrap'])],
    );
    expect(once.regenerate).toEqual([
      { test: 't-wrap', file: 't-wrap.yaml', atoms: [{ atom: 'a.wrap', why: 'restated' }] },
    ]);
  });

  it('sends only a semantic change back for approval, with its tests', () => {
    expect(report.reapprove).toEqual([
      {
        atom: 'a.late',
        kind: 'instruction',
        title: 'a.late',
        quote: 'A shipment is late after one day.',
        tests: ['t-late'],
      },
    ]);
  });

  it('retires a test whose atoms are all removed, with the reason, and counts an earlier retirement', () => {
    expect(report.retire).toEqual([
      {
        test: 't-gone',
        file: 't-gone.yaml',
        atoms: ['a.gone', 'a.gone2'],
        reason: 'atom a.gone removed; atom a.gone2 removed',
        state: 'to_write',
      },
      {
        test: 't-old',
        file: 't-old.yaml',
        atoms: ['a.gone'],
        reason: 'atom a.gone removed',
        state: 'already',
      },
    ]);
    expect(retirementReason(['x'])).toBe('atom x removed');
  });

  it('lists an added atom no live test covers as new, and not one a test already names', () => {
    expect(report.new).toEqual([
      { atom: 'a.added', kind: 'gate', title: 'a.added', file: 'CLAUDE.md', line: 10 },
    ]);
  });

  it('leaves a moved atom and an unchanged one alone', () => {
    // t-keep, t-moved, t-added2 and the respaced t-wrap.
    expect(report.unaffected).toEqual({ moved: 1, tests: 4 });
    expect(report.tests).toEqual({ live: 8, retired: 1, other: 2 });
    const touched = [
      ...report.regenerate.map((entry) => entry.test),
      ...report.retire.map((entry) => entry.test),
    ];
    expect(touched).not.toContain('t-moved');
    expect(touched).not.toContain('t-keep');
    expect(touched).not.toContain('t-wrap');
  });

  it('asks a person for the re-approval and the new atom, and for nothing else', () => {
    expect(report.needsPerson).toEqual([
      're-approve a.late: its meaning changed; 1 test waits',
      'approve the tests of the new atom a.added: no test covers it yet',
    ]);
    const quiet = estateImpact(
      diffEstateMaps(
        estateMap([atom('a.wrap', 'One  two.', { line: 1 }), atom('a.moved', 'Same.', { line: 2 })]),
        estateMap([atom('a.wrap', 'One two.', { line: 1 }), atom('a.moved', 'Same.', { line: 3 })]),
      ),
      [test('t-wrap', ['a.wrap'])],
    );
    expect(quiet.needsPerson).toEqual([]);
    expect(quiet.regenerate).toHaveLength(0);
    expect(renderImpact(quiet)).toContain('Nothing needs a person.');
  });

  it('prints each list for a person', () => {
    const text = renderImpact(report);
    expect(text).toContain('Regenerate 3, re-approve 1, retire 2, new 1; 4 tests untouched, 1 atom moved');
    expect(text).toContain('  t-late (t-late.yaml): a.late semantic');
    expect(text).toContain('  a.late (instruction): A shipment is late after one day.\n      tests: t-late');
    expect(text).toContain(
      '  t-gone (t-gone.yaml): retired: atom a.gone removed; atom a.gone2 removed [to write with --write]',
    );
    expect(text).toContain('Needs a person: 2.');
  });
});

describe('loadEstateTests and writeRetirements', () => {
  it('indexes the specs by their atoms, counts the others and writes the retirement into the spec', async () => {
    const root = await estate({
      'tests/gone.yaml': spec('t-gone', ['a.gone', 'a.gone2']),
      'tests/late.yaml': spec('t-late', ['a.late']),
      'tests/plain.yaml': spec('t-plain', ['a.keep']).replace(/metadata:\n {2}estate: .*\n/, ''),
    });
    const dir = join(root, 'tests');
    const loaded = await loadEstateTests(dir);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    expect(loaded.others).toBe(1);
    expect(loaded.tests.map((entry) => [entry.id, entry.file, entry.atoms])).toEqual([
      ['t-gone', 'gone.yaml', ['a.gone', 'a.gone2']],
      ['t-late', 'late.yaml', ['a.late']],
    ]);

    const report = estateImpact(diff, loaded.tests);
    const writes = await writeRetirements(report, loaded.tests);
    expect(writes).toEqual([{ file: 'gone.yaml', ok: true }]);
    expect(report.retire[0]?.state).toBe('written');
    const text = await readFile(join(dir, 'gone.yaml'), 'utf8');
    expect(text).toContain('# The test of a.gone, a.gone2. Fictional.');
    expect(text).toContain('  retired: atom a.gone removed; atom a.gone2 removed');
    const reloaded = await loadSpecFile(join(dir, 'gone.yaml'));
    expect(reloaded.ok && reloaded.spec.metadata?.retired).toBe('atom a.gone removed; atom a.gone2 removed');
    expect(await readFile(join(dir, 'late.yaml'), 'utf8')).toBe(spec('t-late', ['a.late']));

    const again = await loadEstateTests(dir);
    if (!again.ok) throw new Error('reload failed');
    const second = estateImpact(diff, again.tests);
    expect(second.retire.map((entry) => entry.state)).toEqual(['already']);
    expect(second.tests.retired).toBe(1);
    expect(await writeRetirements(second, again.tests)).toEqual([]);
  });

  it('refuses a folder with an invalid spec, a bad estate key or no folder at all', async () => {
    const root = await estate({
      'tests/broken.yaml': 'id: x\n',
      'tests/bad-meta.yaml': spec('t-bad', ['a.keep']).replace(
        'estate: { atoms: [a.keep] }',
        'estate: { atoms: [] }',
      ),
      'tests/bad-retired.yaml': spec('t-ret', ['a.keep'], '  retired: 3'),
    });
    const loaded = await loadEstateTests(join(root, 'tests'));
    expect(loaded.ok).toBe(false);
    const errors = loaded.ok ? [] : loaded.errors;
    expect(errors.some((line) => line.startsWith('broken.yaml: '))).toBe(true);
    expect(errors).toContain('bad-meta.yaml: metadata.estate needs atoms, a list of atom ids');
    expect(errors).toContain('bad-retired.yaml: metadata.retired is the retirement reason, a string');
    const missing = await loadEstateTests(join(root, 'nowhere'));
    expect(missing.ok).toBe(false);
  });
});
