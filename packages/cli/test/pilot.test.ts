import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PILOT_REPORT_FILE } from '../src/commands/pilot';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = 'examples/acme/map/approved.yaml';
const SUITE = 'examples/acme/generated/specs';

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-pilot-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench pilot plan', () => {
  it('prints per cell the conversations, wordings, runs and a cost of 0 in process', async () => {
    const { code, out, err } = await cli(['pilot', 'plan', '--map', MAP, '--suite', SUITE, '--repeats', '2']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toMatch(
      /^Pilot plan: \d+ cells by behaviour; per cell up to 10 conversations x 3 approved wordings x 2 repeats\./,
    );
    expect(out).toMatch(/behaviour=B-001\s+10\s+\d+\s+\d+\s+\d+\s+\$0\.00/);
    expect(out).toContain('Cost: the agent runs in process: no model call, nothing billed.');
  }, 20_000);

  it('gives the plan as JSON: runs are wordings times repeats, cell by cell', async () => {
    const { code, out } = await cli([
      'pilot',
      'plan',
      '--map',
      MAP,
      '--suite',
      SUITE,
      '--conversations',
      '2',
      '--repeats',
      '4',
      '--json',
    ]);
    expect(code).toBe(0);
    const { plan } = JSON.parse(out) as {
      plan: {
        cells: Array<{ conversations: number; wordings: number; runs: number }>;
        total: { runs: number };
      };
    };
    for (const line of plan.cells) {
      expect(line.conversations).toBe(2);
      expect(line.runs).toBe(line.wordings * 4);
    }
    expect(plan.total.runs).toBe(plan.cells.reduce((sum, line) => sum + line.runs, 0));
  });

  it('caps the approved wordings per conversation with --wordings, and names cells by the --by dimensions', async () => {
    type Plan = { plan: { cells: Array<{ cell: string; conversations: number; wordings: number }> } };
    const plan = async (flags: string[]) => {
      const { code, out, err } = await cli([
        'pilot',
        'plan',
        '--map',
        MAP,
        '--suite',
        SUITE,
        ...flags,
        '--json',
      ]);
      expect(err).toBe('');
      expect(code).toBe(0);
      return (JSON.parse(out) as Plan).plan.cells;
    };
    const one = await plan(['--wordings', '1']);
    for (const line of one) expect(line.wordings).toBe(line.conversations);
    const three = await plan([]);
    expect(three.some((line) => line.wordings > line.conversations)).toBe(true);

    const byDeviation = await plan(['--by', 'deviation']);
    for (const line of byDeviation) expect(line.cell).toMatch(/^deviation=[^,]+$/);
    const byTwo = await plan(['--by', 'behaviour,deviation']);
    for (const line of byTwo) expect(line.cell).toMatch(/^behaviour=[^,]+,deviation=[^,]+$/);
    const empty = await cli(['pilot', 'plan', '--map', MAP, '--suite', SUITE, '--by', ' , ']);
    expect(empty.code).toBe(2);
    expect(empty.err).toBe('--by names at least one dimension.\n');
  }, 60_000);

  it('refuses a bad number with exit 2', async () => {
    const { code, err } = await cli(['pilot', 'plan', '--map', MAP, '--suite', SUITE, '--repeats', '0']);
    expect(code).toBe(2);
    expect(err).toBe('--repeats takes a whole number of at least 1, not "0".\n');
  });
});

describe('driftbench pilot run and analyse', () => {
  it('runs the deterministic Acme agent, writes the report and finds no run-to-run variance', async () => {
    const store = join(dir, 'acme.db');
    const out = join(dir, 'acme');
    const run = await cli([
      'pilot',
      'run',
      '--map',
      MAP,
      '--suite',
      SUITE,
      '--target',
      'function:acme',
      '--store',
      store,
      '--out',
      out,
      '--conversations',
      '2',
      '--repeats',
      '3',
      '--iterations',
      '50',
    ]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('Flip rate: 0 of ');
    const report = JSON.parse(await readFile(join(out, PILOT_REPORT_FILE), 'utf8'));
    expect(report.generator).toBe('driftbench pilot');
    expect(report.analysis.pooled.levels.map((level: { level: string }) => level.level)).toEqual([
      'cell',
      'conversation',
      'wording',
      'repeat',
    ]);
    expect(report.analysis.noiseFloor.variance).toBe(0);
    expect(report.plan.total.usd).toBe(0);

    const again = await cli([
      'pilot',
      'analyse',
      '--store',
      store,
      '--out',
      join(dir, 'again'),
      '--iterations',
      '50',
    ]);
    expect(again.code).toBe(0);
    const reread = JSON.parse(await readFile(join(dir, 'again', PILOT_REPORT_FILE), 'utf8'));
    expect(reread.campaignId).toBe(report.campaignId);
    expect(reread.analysis).toEqual(report.analysis);
  }, 60_000);

  it('reads --floor, --pool and --sensitivity into the analysis, and refuses an unknown --resample unit', async () => {
    const store = join(dir, 'options.db');
    const run = await cli([
      'pilot',
      'run',
      '--map',
      MAP,
      '--suite',
      SUITE,
      '--target',
      'function:acme',
      '--store',
      store,
      '--out',
      join(dir, 'options-run'),
      '--conversations',
      '1',
      '--repeats',
      '2',
      '--wordings',
      '1',
      '--iterations',
      '20',
    ]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    const out = join(dir, 'options');
    const analysed = await cli([
      'pilot',
      'analyse',
      '--store',
      store,
      '--out',
      out,
      '--iterations',
      '20',
      '--floor',
      '0.07',
      '--pool',
      '40',
      '--sensitivity',
      '0.3',
      '--resample',
      'cells',
    ]);
    expect(analysed.err).toBe('');
    expect(analysed.code).toBe(0);
    const { analysis } = JSON.parse(await readFile(join(out, PILOT_REPORT_FILE), 'utf8')) as {
      analysis: {
        noiseFloor: { floor: number };
        wording: { threshold: number };
        allocation: { pool: number; strata: Array<{ allocated: number }> };
      };
    };
    expect(analysis.noiseFloor.floor).toBe(0.07);
    expect(analysis.wording.threshold).toBe(0.3);
    expect(analysis.allocation.pool).toBe(40);
    expect(analysis.allocation.strata.reduce((sum, stratum) => sum + stratum.allocated, 0)).toBe(40);

    const bad = await cli(['pilot', 'analyse', '--store', store, '--out', out, '--resample', 'blocks']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--resample takes cells, conversations or both, not "blocks".');
  }, 60_000);

  it('refuses to run on an agent that is not in process: that pilot is billed', async () => {
    const { code, err } = await cli([
      'pilot',
      'run',
      '--map',
      MAP,
      '--suite',
      SUITE,
      '--target',
      'process:acme-ops',
      '--store',
      join(dir, 'ops.db'),
      '--out',
      join(dir, 'ops'),
    ]);
    expect(code).toBe(2);
    expect(err).toMatch(/which is not in process: it is billed/);
  });

  it('refuses a target it has no adapter for, and a store without a pilot', async () => {
    const target = await cli([
      'pilot',
      'run',
      '--map',
      MAP,
      '--suite',
      SUITE,
      '--target',
      'http:zed',
      '--store',
      join(dir, 'none.db'),
    ]);
    expect(target.code).toBe(2);
    expect(target.err).toMatch(/^No adapter is set up for http:zed\./);
    await openStore(join(dir, 'empty.db')).close();
    const empty = await cli([
      'pilot',
      'analyse',
      '--store',
      join(dir, 'empty.db'),
      '--out',
      join(dir, 'empty'),
    ]);
    expect(empty.code).toBe(2);
    expect(empty.err).toMatch(/holds no pilot campaign/);
  });
});
