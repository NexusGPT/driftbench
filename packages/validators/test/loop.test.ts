import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendJournal,
  checkHandover,
  composeBrief,
  handoverTemplate,
  type JournalRow,
  JournalRowSchema,
  readJournal,
  runSeeds,
  seedSpecs,
  setLevelTable,
} from '../src/index';
import { journalRow, plantedLadder } from './support';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

function issues(value: unknown): string[] {
  const parsed = JournalRowSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('the journal row schema', () => {
  it('accepts a complete row', () => {
    expect(issues(journalRow())).toEqual([]);
  });
  it('refuses a bad row: a missing field, an extra field, a level that is not the seed minimum, a wrong result', () => {
    const { hypothesis: _dropped, ...noHypothesis } = journalRow();
    expect(issues(noHypothesis).join(' ')).toMatch(/hypothesis/);
    expect(issues(journalRow(1, { mood: 'good' })).join(' ')).toMatch(/mood|Unrecognized/);
    expect(issues(journalRow(1, { level: { before: 1, after: 2 } })).join(' ')).toMatch(
      /minimum over perSeed: before 1, after 3/,
    );
    expect(issues(journalRow(1, { result: 'unchanged' })).join(' ')).toMatch(/result is raised/);
    expect(issues(journalRow(1, { seeds: ['1'] })).join(' ')).toMatch(/exactly the seeds listed/);
    expect(issues(journalRow(1, { at: 'yesterday' })).join(' ')).toMatch(/^at:/);
    expect(issues(journalRow(1, { change: { files: [], commit: 'not-a-sha' } })).join(' ')).toMatch(/commit/);
    expect(
      issues(
        journalRow(1, {
          metrics: [{ level: 2, id: 'second', metric: 'a / b', threshold: 1, before: 0, after: 1 }],
        }),
      ).join(' '),
    ).toMatch(/every level in order/);
  });
  it('appends only the next iteration, one line per row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-journal-test-'));
    made.push(root);
    expect(appendJournal(root, 'planted', journalRow(1))).toEqual({
      refused: ['iteration must be 0, the next row of the journal, not 1'],
    });
    expect('row' in appendJournal(root, 'planted', journalRow(0))).toBe(true);
    expect(appendJournal(root, 'planted', journalRow(3))).toEqual({
      refused: ['iteration must be 1, the next row of the journal, not 3'],
    });
    expect('refused' in appendJournal(root, 'planted', { iteration: 1 })).toBe(true);
    expect('row' in appendJournal(root, 'planted', journalRow(1))).toBe(true);
    expect(readJournal(root, 'planted').rows.map((row) => row.iteration)).toEqual([0, 1]);
  });
});

describe('the handover check', () => {
  const row = JournalRowSchema.parse(journalRow()) as JournalRow;
  it('passes a template with the level table written from the last row', () => {
    expect(checkHandover(handoverTemplate('planted', 0), undefined)).toEqual([]);
    expect(checkHandover(setLevelTable(handoverTemplate('planted', 0), row), row)).toEqual([]);
  });
  it('names a missing section and a level table that differs from the last journal row', () => {
    const missing = setLevelTable(handoverTemplate('planted', 0), row).replace('## Pitfalls', '## Traps');
    expect(checkHandover(missing, row)).toEqual(['the section "## Pitfalls" is missing']);
    const stale = handoverTemplate('planted', 0);
    expect(checkHandover(stale, row)).toEqual([
      'the level table says nothing but journal iteration 1 says 1=3, hidden=3',
    ]);
    const edited = setLevelTable(handoverTemplate('planted', 0), row).replace(
      '| hidden | 3 |',
      '| hidden | 2 |',
    );
    expect(checkHandover(edited, row)).toEqual([
      'the level table says 1=3, hidden=2 but journal iteration 1 says 1=3, hidden=3',
    ]);
    const noActions = handoverTemplate('planted', 0).replace(
      /## Next actions\n\n[^#]*/,
      '## Next actions\n\n',
    );
    expect(checkHandover(noActions, undefined)).toEqual(['"## Next actions" holds no numbered action']);
  });
});

describe('composeBrief', () => {
  it('embeds the live state: the ladder, the failing items, the floor, the last row, the next actions', async () => {
    const { ladder } = plantedLadder([2]);
    const report = await runSeeds(ladder, seedSpecs([1, 2]));
    const row = JournalRowSchema.parse(journalRow()) as JournalRow;
    const handover = setLevelTable(handoverTemplate('planted', 2), row).replace(
      'None yet. Each entry',
      'The finder caches stale input: rejected, the cache was empty on seed 2. Each entry',
    );
    const input = {
      component: 'planted',
      executor: 'Run `driftbench validate <component>` and read validators/<component>/HANDOVER.md.\n',
      report,
      floor: 2,
      last: row,
      handover,
      head: 'abcdef0123456789abcdef0123456789abcdef01',
      fresh: false,
    };
    const brief = composeBrief(input);
    expect(brief).toContain('# Brief: validator planted');
    expect(brief).toContain('at commit abcdef012345');
    expect(brief).toContain('Level per seed: 1 = 3, 2 = 1');
    expect(brief).toContain('Floor: 2. BELOW THE FLOOR.');
    expect(brief).toContain('plant-2-a  [fixture/finder]  the planted item a was missed');
    expect(brief).toContain('"iteration": 1');
    expect(brief).toContain('"hypothesis": "The finder drops the last planted item');
    expect(brief).toContain('1. Run `pnpm driftbench validate planted --seeds 1..20 --hidden`');
    expect(brief).toContain('The finder caches stale input: rejected');
    expect(brief).toContain('Run `driftbench validate planted` and read validators/planted/HANDOVER.md.');
    expect(brief.indexOf('## Live state')).toBeLessThan(brief.indexOf('Run `driftbench validate planted`'));
    const fresh = composeBrief({ ...input, fresh: true });
    expect(fresh).toContain('# Brief: validator planted (fresh)');
    expect(fresh).not.toContain('The finder caches stale input');
    expect(fresh).not.toContain('"hypothesis"');
    expect(fresh).toContain('plant-2-a');
    expect(fresh).toContain('1. Run `pnpm driftbench validate planted --seeds 1..20 --hidden`');
  });
});
