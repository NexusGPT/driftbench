import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineLadder } from '@agent-nexus/driftbench-validators';
import { afterAll, describe, expect, it } from 'vitest';
import { type ValidateCommandOptions, validateCommand } from '../src/commands/validate';

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function fixture(floor: number, version = 2, failAt = 0) {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-floor-cap-'));
  roots.push(root);
  await mkdir(join(root, 'validators'));
  await writeFile(
    join(root, 'validators/floors.json'),
    JSON.stringify({
      version: 2,
      ladderVersion: { positive: version, zero: 2 },
      floors: { positive: floor, zero: 0 },
    }),
  );
  const computed: Record<string, number[]> = { positive: [], zero: [] };
  const ladders = Object.fromEntries(
    Object.keys(computed).map((component) => [
      component,
      defineLadder({
        component,
        version: 2,
        levels: Array.from({ length: 4 }, (_, index) => ({
          id: `level-${index + 1}`,
          name: `Level ${index + 1}`,
          metric: 'passing',
          threshold: 1,
          compute: () => {
            computed[component]?.push(index + 1);
            return { value: index + 1 === failAt ? 0 : 1, items: [] };
          },
        })),
      }),
    ]),
  );
  const output = { out: '', err: '' };
  const io = {
    cwd: root,
    out: (text: string) => {
      output.out += text;
    },
    err: (text: string) => {
      output.err += text;
    },
  };
  return {
    computed,
    output,
    io,
    deps: { root, ladders: () => ladders, readHead: () => 'abcdef0123456789abcdef0123456789abcdef01' },
  };
}

describe('CLI floor checks cap every applicable ladder', () => {
  it.each<ValidateCommandOptions>([{}, { items: true }, { allLevels: true }])(
    'caps positive floors for visible and hidden seeds: %j',
    async (options) => {
      const f = await fixture(2);
      expect(
        await validateCommand(
          'all',
          { ...options, seeds: '1..2', hidden: true, json: true, checkFloor: true },
          f.io,
          f.deps,
        ),
      ).toBe(0);
      expect(f.computed.positive).toEqual([1, 2, 1, 2, 1, 2]);
      expect(f.computed.zero).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
      const report = JSON.parse(f.output.out).reports.find(
        (entry: { component: string }) => entry.component === 'positive',
      );
      expect(report.level).toBe(2);
      expect(report.top).toBe(4);
      expect(
        report.seeds.every((seed: { rows: { observed: number | null }[] }) =>
          seed.rows.slice(2).every((row) => row.observed === null),
        ),
      ).toBe(true);
    },
  );

  it.each([
    [0, 2],
    [2, 1],
  ])('keeps the existing walk for floor %i at ladder version %i', async (floor, version) => {
    const f = await fixture(floor, version);
    expect(await validateCommand('positive', { checkFloor: true }, f.io, f.deps)).toBe(0);
    expect(f.computed.positive).toEqual([1, 2, 3, 4]);
  });

  it('keeps ordinary measurement uncapped', async () => {
    const f = await fixture(2);
    expect(await validateCommand('positive', {}, f.io, f.deps)).toBe(4);
    expect(f.computed.positive).toEqual([1, 2, 3, 4]);
  });

  it('still fails on a regression below the floor', async () => {
    const f = await fixture(3, 2, 2);
    expect(await validateCommand('positive', { checkFloor: true }, f.io, f.deps)).toBe(1);
    expect(f.computed.positive).toEqual([1, 2]);
    expect(f.output.err).toContain('positive is at level 1, below its floor 3.');
  });

  it('retains the diagnostic for a floor above the ladder top', async () => {
    const f = await fixture(5);
    expect(await validateCommand('all', { checkFloor: true }, f.io, f.deps)).toBe(1);
    expect(f.output.err).toContain('sets positive to 5, above the top of its ladder (4).');
  });
});
