import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendJournal,
  formatHardness,
  type JournalRow,
  JournalRowSchema,
  measureHardness,
  readJournal,
} from '../src/index';
import { journalOf, journalRow, PASSING_AUDIT } from './support';

/**
 * Pilot rounds (docs/validators.md 12.4 and 12.7). An audit runs a blind pilot per round, and a later round starts at its
 * own iteration 0 or 1 on a bank that has grown. `measurePilot` used to take the first blind iteration 0 and every blind
 * row from 1 to 10, so a second pilot could not be measured: the report described the first round or mixed the two. A row
 * now carries `pilotRound`, an id of the round it belongs to; the iterations count on their own inside a round, and
 * `--hardness` measures the latest complete round and names it.
 */

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const TIERS = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const hash = (letter: string) => letter.repeat(64);

/** Blind rows of one round: the passing counts of iterations 0 to n, on a bank of `bankSize`, with the round id when given. */
function blindRound(
  round: string | undefined,
  passing: number[],
  bankSize = 300,
  bankHash?: string,
): JournalRow[] {
  return journalOf(passing, bankSize, TIERS, (failing) => failing).map((row) =>
    JournalRowSchema.parse({
      ...(row as object),
      executor: 'blind',
      ...(round === undefined ? {} : { pilotRound: round }),
      ...(bankHash === undefined ? {} : { bankHash }),
    }),
  );
}

/** The builder iteration 0 row the blind rows may start from. */
const builderZero = (bankHash?: string): JournalRow[] =>
  journalOf([30], 300, TIERS, (failing) => failing).map((row) =>
    JournalRowSchema.parse({ ...(row as object), ...(bankHash === undefined ? {} : { bankHash }) }),
  );

const ROUND_2 = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30]; // 3 items fixed per iteration
const ROUND_4 = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // 10 per iteration
const measure = (rows: JournalRow[], options: { bankHash?: string } = {}) =>
  measureHardness(rows, { audit: PASSING_AUDIT, ...options });

describe('the pilot round of a journal row', () => {
  it('is an optional short id, and a row without one is valid', () => {
    expect(JournalRowSchema.safeParse(journalRow(1, { pilotRound: 'r4' })).success).toBe(true);
    expect(JournalRowSchema.safeParse(journalRow(1)).success).toBe(true);
    for (const bad of ['', ' r4', 'round four with spaces', 'r'.repeat(40)])
      expect(JournalRowSchema.safeParse(journalRow(1, { pilotRound: bad })).success, bad).toBe(false);
  });

  it('starts the count of iterations again in a new round, for the same executor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-rounds-'));
    made.push(root);
    expect('row' in appendJournal(root, 'x', journalRow(0))).toBe(true);
    for (let i = 0; i <= 10; i += 1)
      expect('row' in appendJournal(root, 'x', journalRow(i, { executor: 'blind', pilotRound: 'r2' }))).toBe(
        true,
      );
    // Round r2 holds iterations 0 to 10: the next row of r2 is iteration 11, and a new round starts at 0 or 1.
    expect(appendJournal(root, 'x', journalRow(3, { executor: 'blind', pilotRound: 'r4' }))).toEqual({
      refused: ['iteration must be 0 or 1, the next blind row of the journal, not 3'],
    });
    expect('row' in appendJournal(root, 'x', journalRow(0, { executor: 'blind', pilotRound: 'r4' }))).toBe(
      true,
    );
    expect('row' in appendJournal(root, 'x', journalRow(1, { executor: 'blind', pilotRound: 'r4' }))).toBe(
      true,
    );
    expect(appendJournal(root, 'x', journalRow(1, { executor: 'blind', pilotRound: 'r4' }))).toEqual({
      refused: ['iteration must be 2, the next blind row of the journal, not 1'],
    });
    const { rows, problems } = readJournal(root, 'x');
    expect(problems).toEqual([]);
    expect(rows.filter((row) => row.pilotRound === 'r4').map((row) => row.iteration)).toEqual([0, 1]);
  });

  it('keeps the old rule for rows with no round: one series, counted from its last row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-rounds-'));
    made.push(root);
    expect('row' in appendJournal(root, 'x', journalRow(1, { executor: 'blind' }))).toBe(true);
    expect(appendJournal(root, 'x', journalRow(1, { executor: 'blind' }))).toEqual({
      refused: ['iteration must be 2, the next blind row of the journal, not 1'],
    });
  });
});

describe('--hardness with two pilot rounds', () => {
  it('measures the later of two complete rounds and names it', () => {
    const h = measure([...builderZero(), ...blindRound('r2', ROUND_2), ...blindRound('r4', ROUND_4)]);
    expect(h.source).toBe('blind');
    expect(h.pilots.blind?.round).toBe('r4');
    expect(h.pilot).toMatchObject({ round: 'r4', iterations: 10, complete: true, end: { passing: 100 } });
    expect(h.fixedPerIteration).toBe(10);
    expect(h.iteration0).toMatchObject({ passing: 0 });
    expect(h.remaining).toBe(200);
    expect(h.forecast).toBe(20);
    expect(h.gate.reasons.join(' | ')).not.toMatch(/fall from|holds \d+ of 10/);
    expect(formatHardness('x', h)).toMatch(/Pilot round measured: r4, the latest complete round of the blind pilot \(rounds in the journal: .*blind r2 \(10 of 10\), blind r4 \(10 of 10\)\)/);
  });

  it('measures the same round when the rounds are appended in the other order of ids', () => {
    // The latest round is the last one appended, whatever its id.
    const h = measure([...builderZero(), ...blindRound('r4', ROUND_4), ...blindRound('r2', ROUND_2)]);
    expect(h.pilots.blind?.round).toBe('r2');
    expect(h.fixedPerIteration).toBe(3);
  });

  it('measures the latest complete round while a newer round is still running, and says so', () => {
    const h = measure([
      ...builderZero(),
      ...blindRound('r2', ROUND_2),
      ...blindRound('r4', ROUND_4.slice(0, 4)),
    ]);
    expect(h.pilots.blind?.round).toBe('r2');
    expect(h.pilot).toMatchObject({ round: 'r2', iterations: 10, complete: true });
    expect(h.flags.join(' ')).toMatch(/r4 holds 3 of 10/);
  });

  it('measures the only round, incomplete, when no round is complete', () => {
    const h = measure([...builderZero(), ...blindRound('r4', ROUND_4.slice(0, 4))]);
    expect(h.pilot).toMatchObject({ round: 'r4', iterations: 3, complete: false });
    expect(h.gate.reasons).toContain('the blind pilot holds 3 of 10 iterations');
  });

  it('does not read the start of a later round as a loss, nor the old bank hashes as stale', () => {
    const rows = [
      ...builderZero(hash('b')),
      ...blindRound('r2', ROUND_2, 300, hash('a')),
      ...blindRound('r4', ROUND_4, 300, hash('b')),
    ];
    const h = measure(rows, { bankHash: hash('b') });
    expect(h.gate.reasons.join(' | ')).not.toMatch(/fall from/);
    expect(h.freshness?.status).toBe('current');
    // The same journal with the old round alone is stale for the live bank.
    const old = measure([...builderZero(hash('a')), ...blindRound('r2', ROUND_2, 300, hash('a'))], {
      bankHash: hash('b'),
    });
    expect(old.freshness?.status).toBe('stale');
  });

  it('still reads a loss inside the measured round', () => {
    const dip = [0, 10, 20, 30, 25, 50, 60, 70, 80, 90, 100];
    const h = measure([...builderZero(), ...blindRound('r2', ROUND_2), ...blindRound('r4', dip)]);
    expect(h.gate.reasons.join(' | ')).toMatch(/fall from 30 at iteration 3 to 25 at iteration 4 \(blind\)/);
  });

  it('gives a journal with no round ids the report it always gave, with no round named', () => {
    const h = measure([...builderZero(), ...blindRound(undefined, ROUND_4)]);
    expect(h.pilots.blind?.round).toBeNull();
    expect(h.fixedPerIteration).toBe(10);
    expect(formatHardness('x', h)).not.toMatch(/round/i);
  });
});

describe('measure-row.ts --round', () => {
  it('puts the pilot round on the row it prints', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-measure-row-'));
    made.push(dir);
    const report = {
      level: 0,
      seeds: [
        {
          seed: 1,
          hidden: false,
          level: 0,
          rows: [{ level: 1, id: 'store-core', metric: 'm', threshold: 1, observed: 0 }],
        },
      ],
      bank: {
        size: 3,
        passing: 0,
        failingByFamily: { core: 3 },
        byFamilyTier: { core: { '1': 3 } },
        rows: [{ id: 'a', passEverySeed: false }],
      },
    };
    const file = join(dir, 'report.json');
    await writeFile(file, JSON.stringify(report));
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'validators/variables/measure-row.ts'),
          ...['--before', file, '--after', file, '--iteration', '0', '--executor', 'blind', ...extra],
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
      );
    const withRound = run(['--round', 'r4']);
    expect(withRound.status, withRound.stderr).toBe(0);
    expect(JSON.parse(withRound.stdout).pilotRound).toBe('r4');
    const without = run([]);
    expect(without.status, without.stderr).toBe(0);
    expect(JSON.parse(without.stdout)).not.toHaveProperty('pilotRound');
  }, 120_000);
});
