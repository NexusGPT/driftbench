import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { measureHardness } from '../../src/hardness';
import { JournalRowSchema, readJournal } from '../../src/journal';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const folders: string[] = [];
const temporary = () => {
  const folder = mkdtempSync(join(tmpdir(), 'generator-measure-'));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const report = () => ({
  component: 'generator',
  level: 0,
  seeds: [
    { seed: 1, hidden: false, level: 0 },
    { seed: 9000001, hidden: true, level: 1 },
  ].map((seed) => ({
    ...seed,
    rows: [{ level: 1, id: 'planner-v2', metric: 'passing share', threshold: 1, observed: 0.5 }],
  })),
  bank: {
    size: 2,
    passing: 1,
    failingCauses: 0,
    failingComposite: 1,
    failingWithoutCause: 0,
    failingByFamily: { planner: 1 },
    byFamilyTier: { planner: { '1': 2 } },
    catch: { size: 1, passing: 1 },
    rows: [
      { id: 'planner.triples', passEverySeed: false },
      { id: 'planner.seeds', passEverySeed: true },
    ],
  },
});
const save = (folder: string, name: string, value: unknown) => {
  const path = join(folder, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const script = (name: string) => join(root, 'validators/generator', `${name}.ts`);
const run = (name: string, args: string[]) =>
  JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', script(name), ...args], {
      cwd: root,
      encoding: 'utf8',
    }),
  );

describe('generator measurement journal projection', () => {
  it('matches seed labels, retains composite/catch counts and validates blind rows', () => {
    const folder = temporary();
    const before = report();
    const after = report();
    after.seeds.reverse();
    const row = JournalRowSchema.parse(
      run('measure-row', [
        '--before',
        save(folder, 'before.json', before),
        '--after',
        save(folder, 'after.json', after),
        '--iteration',
        '1',
        '--executor',
        'blind',
      ]),
    );
    expect(row.perSeed).toEqual([
      { seed: 'hidden', before: 1, after: 1 },
      { seed: '1', before: 0, after: 0 },
    ]);
    expect(row).toMatchObject({
      executor: 'blind',
      failingCauses: 0,
      failingComposite: 1,
      catchItems: { size: 1, passing: 1 },
      failingBefore: ['planner.triples'],
    });
  });

  it('writes a fresh baseline journal, refuses a duplicate, and keeps all audit seats pending', () => {
    const folder = temporary();
    const path = save(folder, 'report.json', report());
    const args = ['--report', path, '--journal-root', folder, '--executor', 'builder'];
    const row = run('baseline', args);
    const journal = readJournal(folder, 'generator');
    expect(journal.problems).toEqual([]);
    expect(journal.rows).toEqual([row]);
    const audit = readFileSync(join(root, 'validators/generator/audit.md'), 'utf8');
    const hardness = measureHardness(journal.rows, { audit });
    expect(hardness.gate.holds).toBe(false);
    expect(hardness.audit?.map((seat) => seat.verdict)).toEqual(['pending', 'pending', 'pending', 'pending']);
    const second = spawnSync(process.execPath, ['--import', 'tsx', script('baseline'), ...args], {
      cwd: root,
    });
    expect(second.status).not.toBe(0);
    expect(readJournal(folder, 'generator').rows).toEqual([row]);
  });

  it('refuses inconsistent bank counts, changed seed cohorts and invalid executor labels', () => {
    const folder = temporary();
    const before = save(folder, 'before.json', report());
    const invalidBank = report();
    invalidBank.bank.passing = 2;
    const otherSeeds = report();
    const visible = otherSeeds.seeds[0];
    if (visible) visible.seed = 2;
    for (const [after, executor] of [
      [save(folder, 'bank.json', invalidBank), 'blind'],
      [save(folder, 'seeds.json', otherSeeds), 'blind'],
      [before, 'typo'],
    ] as const) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          script('measure-row'),
          '--before',
          before,
          '--after',
          after,
          '--executor',
          executor,
        ],
        { cwd: root },
      );
      expect(result.status).not.toBe(0);
    }
  });
});
