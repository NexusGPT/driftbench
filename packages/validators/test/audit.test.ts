import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendJournal,
  formatHardness,
  type JournalRow,
  JournalRowSchema,
  parseAudit,
  readJournal,
} from '../src/index';
import { hard, journalOf, journalRow, PASSING_AUDIT } from './support';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const TIERS = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 };

/** Builder rows 0 to 10, then blind rows from `from` with the given passing counts. */
function journal(builder: number[], blind: number[], from = 1, causes = 150): JournalRow[] {
  const built = journalOf(builder, 300, TIERS, () => causes);
  const blinded = journalOf([0, ...blind], 300, TIERS, () => causes)
    .slice(1)
    .map((row, index) => ({
      ...(row as object),
      iteration: from + index,
      executor: 'blind',
      result: from + index === 0 ? 'baseline' : 'unchanged',
    }));
  return [...built, ...blinded].map((row) => JournalRowSchema.parse(row));
}

const BUILDER = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];

describe('the executor field of the journal', () => {
  it('counts builder and blind rows on their own, the blind series starting at 0 or 1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-audit-test-'));
    made.push(root);
    expect('row' in appendJournal(root, 'x', journalRow(0))).toBe(true);
    expect('row' in appendJournal(root, 'x', journalRow(1))).toBe(true);
    expect(appendJournal(root, 'x', journalRow(2, { executor: 'blind' }))).toEqual({
      refused: ['iteration must be 0 or 1, the next blind row of the journal, not 2'],
    });
    expect('row' in appendJournal(root, 'x', journalRow(1, { executor: 'blind' }))).toBe(true);
    expect('row' in appendJournal(root, 'x', journalRow(2, { executor: 'builder' }))).toBe(true);
    expect('row' in appendJournal(root, 'x', journalRow(2, { executor: 'blind' }))).toBe(true);
    const { rows, problems } = readJournal(root, 'x');
    expect(problems).toEqual([]);
    expect(rows.map((row) => `${row.executor ?? 'builder'}:${row.iteration}`)).toEqual([
      'builder:0',
      'builder:1',
      'blind:1',
      'builder:2',
      'blind:2',
    ]);
    expect(JSON.stringify(JournalRowSchema.safeParse(journalRow(1, { executor: 'guest' })).success)).toBe(
      'false',
    );
  });
});

describe('the blind pilot in --hardness', () => {
  it('forecasts from the blind pilot and flags a builder pilot more than 1.5 times slower', () => {
    const blind = [32, 34, 36, 38, 40, 42, 44, 46, 48, 50];
    const h = hard(journal(BUILDER, blind));
    expect(h.source).toBe('blind');
    expect(h.pilots.builder.fixedPerIteration).toBe(1);
    expect(h.pilots.blind?.fixedPerIteration).toBe(2);
    expect(h.pilots.blind?.baseline.passing).toBe(30);
    expect(h.fixedPerIteration).toBe(2);
    expect(h.remaining).toBe(250);
    expect(h.forecast).toBe(125);
    expect(h.flags).toEqual([
      "the builder pilot fixed 1 items per iteration, more than 1.5 times slower than the blind pilot's 2",
    ]);
    expect(h.gate.holds).toBe(true);
    const text = formatHardness('banked', h);
    expect(text).toMatch(/Pilot\s+iterations\s+items fixed per iteration\s+score after/);
    expect(text).toMatch(/builder\s+10 of 10\s+1\s+0\.1333/);
    expect(text).toMatch(/blind\s+10 of 10\s+2\s+0\.1667/);
    expect(text).toContain('The forecast, the score and the causes use the blind pilot (section 12.7).');
    expect(text).toContain('Flag: the builder pilot fixed 1 items per iteration, more than 1.5 times slower');
    expect(text).toContain('Score after the blind pilot: 0.1667');
  });

  it('does not flag a builder pilot at most 1.5 times slower, and gates on the blind pilot', () => {
    const blind = [31, 33, 34, 36, 37, 39, 40, 42, 43, 45];
    const h = hard(journal(BUILDER, blind));
    expect(h.pilots.blind?.fixedPerIteration).toBe(1.5);
    expect(h.flags).toEqual([]);
    const fast = hard(journal(BUILDER, [130, 140], 1));
    expect(fast.source).toBe('blind');
    expect(fast.gate.reasons).toContain('the blind pilot holds 2 of 10 iterations');
  });

  it('uses the blind executor own baseline when it records iteration 0', () => {
    const rows = journal(BUILDER, [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40], 0);
    const h = hard(rows);
    expect(h.pilots.blind?.baseline.passing).toBe(20);
    expect(h.pilots.blind?.fixedPerIteration).toBe(2);
  });

  it('reports the iteration 0 of the pilot it measures with, the blind one when it has its own', () => {
    const rows = journal(BUILDER, [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40], 0);
    const h = hard(rows);
    expect(h.source).toBe('blind');
    expect(h.iteration0.passing).toBe(20);
    expect(formatHardness('x', h)).toContain('Score at iteration 0: 0.06667 (20 of 300).');
    const builderOnly = hard(rows.filter((row) => row.executor !== 'blind'));
    expect(builderOnly.iteration0.passing).toBe(30);
  });

  it('keeps the builder pilot as the source without blind rows', () => {
    const h = hard(journal(BUILDER, []));
    expect(h.source).toBe('builder');
    expect(h.pilots.blind).toBeNull();
    expect(formatHardness('banked', h)).not.toContain('Pilot  ');
  });
});

describe('audit.md', () => {
  it('reads the four verdicts from a table or from lines, and names a missing one', () => {
    const table = [
      '# Audit: banked',
      '',
      '| Check | Verdict | Note |',
      '|---|---|---|',
      '| Blind pilot | pass | 2.1 items per iteration |',
      '| cheater | **FAIL** | hard-coded seed 3 raised 4 items |',
      '| cause review | pending | |',
    ].join('\n');
    expect(parseAudit(table)).toEqual([
      { check: 'blind pilot', verdict: 'pass', note: '2.1 items per iteration' },
      { check: 'cheater', verdict: 'fail', note: 'hard-coded seed 3 raised 4 items' },
      { check: 'cause review', verdict: 'pending', note: '' },
      { check: 'planted bugs', verdict: 'missing', note: '' },
    ]);
    expect(parseAudit('- planted bugs: pass, 20 of 20 lost an item\n- Cheater: maybe\n')).toEqual([
      { check: 'blind pilot', verdict: 'missing', note: '' },
      { check: 'cheater', verdict: 'missing', note: '' },
      { check: 'cause review', verdict: 'missing', note: '' },
      { check: 'planted bugs', verdict: 'pass', note: '20 of 20 lost an item' },
    ]);
  });

  it('prints the verdicts in --hardness, and says when the file is absent', () => {
    const rows = journal(BUILDER, []);
    const withAudit = formatHardness('banked', hard(rows, '| cheater | fail | seeds |'));
    expect(withAudit).toContain('Audit (validators/banked/audit.md, section 12.7):');
    expect(withAudit).toContain('  cheater: FAIL, seeds\n');
    expect(withAudit).toContain('  planted bugs: MISSING\n');
    expect(formatHardness('banked', hard(rows, null))).toContain(
      'Audit: validators/banked/audit.md is absent.',
    );
  });
});

describe('the audit gate', () => {
  const rows = journal(BUILDER, []);
  it('holds only when audit.md is present and all four checks pass', () => {
    expect(hard(rows).gate).toEqual({ holds: true, reasons: [] });
    expect(hard(rows, null).gate).toEqual({
      holds: false,
      reasons: ['audit.md is absent: no validator merges without the audit (12.7)'],
    });
    expect(
      hard(rows, PASSING_AUDIT.replace('| cheater | pass |', '| cheater | fail |')).gate.reasons,
    ).toEqual(['the audit check cheater is fail']);
    expect(
      hard(rows, PASSING_AUDIT.replace('| cause review | pass |', '| cause review | pending |')).gate.reasons,
    ).toEqual(['the audit check cause review is pending']);
    expect(hard(rows, PASSING_AUDIT.replace('| planted bugs | pass | |\n', '')).gate.reasons).toEqual([
      'the audit check planted bugs is missing',
    ]);
  });
});
