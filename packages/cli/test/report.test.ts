import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@driftbench/store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { registerReportCommand } from '../src/commands/report';
import { type Io, main } from '../src/index';

const PILOT = fileURLToPath(new URL('../../../examples/acme/pilot/acme-random', import.meta.url));

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-report-'));
  const store = openStore(join(dir, 'store.db'));
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F', 'P'], repeats: 2 });
    await storeAcmeCampaign(store, {
      campaignId: 'c-x3',
      modes: ['F', 'P'],
      repeats: 2,
      fault: 'x3-skips-recap',
      createdAt: '2026-10-11T13:00:00.000Z',
    });
  } finally {
    await store.close();
  }
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
    cwd: dir,
  };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerReportCommand(program, io, (exit) => {
    code = exit;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

describe('driftbench report', () => {
  it('writes the scorecard and the JUnit XML of a campaign, exit 0', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/card.html',
      '--junit',
      'out/junit.xml',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('Campaign c-x3: 34 runs');
    expect(out).toContain('Wrote out/card.html and out/junit.xml.');
    const html = readFileSync(join(dir, 'out/card.html'), 'utf8');
    expect(html).toContain('<title>Scorecard c-x3</title>');
    expect(html).not.toContain('<section id="compare">');
    const xml = readFileSync(join(dir, 'out/junit.xml'), 'utf8');
    expect(xml).toMatch(/<testsuites name="c-x3" tests="34" failures="[1-9]\d*" errors="0"/);
  });

  it('scores --aggregate criteria over the campaign, prints each, and refuses one it cannot read', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/agg.html',
      '--aggregate',
      'pass-rate:>=0.99',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('aggregate pass-rate >= 0.99: fails');
    const bad = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/bad.html',
      '--aggregate',
      'nope:>=1',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown aggregate nope');
  });

  it('chooses the margin from the baseline by default, as compare and ci do, and prints it', async () => {
    const { code, out } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'auto.html',
      '--baseline',
      'c-acme',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(
      /^Margin auto: \d+\.\d points, the smallest half point at which the baseline compared with itself is non-inferior/m,
    );
    const margin = /Margin auto: (\d+\.\d) points/.exec(out)?.[1];
    expect(out).toContain(`Against baseline c-acme: regressed, margin ${margin} points.`);
    const strict = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'strict.html',
      '--baseline',
      'c-acme',
      '--strict',
      '--min-goldens',
      '2',
    ]);
    expect(strict.code).toBe(0);
    expect(strict.out).toContain('Against baseline c-acme: regressed');
  });

  it('adds the compare diff against a baseline and the pilot report', async () => {
    const { code, out } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'diff.html',
      '--baseline',
      'c-acme',
      '--margin',
      '15',
      '--pilot',
      PILOT,
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Against baseline c-acme: regressed, margin 15.0 points.');
    const html = readFileSync(join(dir, 'diff.html'), 'utf8');
    expect(html).toContain('<section id="compare">');
    expect(html).toContain('<section id="pilot">');
    expect(html).toContain('Margin 15.0 points');
  });

  it('reads the latest campaign without an id, and prints the scorecard with --json', async () => {
    const { code, out } = await cli([
      'report',
      '--store',
      'store.db',
      '--out',
      'latest.html',
      '--json',
      '--spread-mode',
      'P',
    ]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as {
      campaign: { campaignId: string };
      spread: { mode: string };
      lines: unknown[];
    };
    expect(json.campaign.campaignId).toBe('c-x3');
    expect(json.spread.mode).toBe('P');
    expect(json.lines.length).toBe(17);
    expect(existsSync(join(dir, 'latest.html'))).toBe(true);
  });

  it.each([
    [['c-nope'], 'No campaign c-nope'],
    [['c-x3', '--baseline', 'c-nope'], 'No campaign c-nope'],
    [['c-x3', '--margin', '-1'], '--margin takes a number of points'],
    [['c-x3', '--max-runs', 'many'], '--max-runs takes a whole number'],
    [['c-x3', '--spread-mode', 'T,F'], '--spread-mode takes one mode'],
    [['c-x3', '--spread-mode', 'Q'], 'Unknown mode "Q"'],
    [['c-x3', '--pilot', 'nowhere'], 'No pilot report at'],
  ])('exits 2 on bad input %j and writes nothing', async (args, message) => {
    const { code, err } = await cli(['report', ...args, '--store', 'store.db', '--out', 'bad.html']);
    expect(code).toBe(2);
    expect(err).toContain(message);
    expect(existsSync(join(dir, 'bad.html'))).toBe(false);
  });

  it('exits 2 on a store that holds no campaign', async () => {
    const { code, err } = await cli(['report', '--store', 'empty.db', '--out', 'bad.html']);
    expect(code).toBe(2);
    expect(err).toContain('The store holds no campaign.');
  });

  it('is wired into the CLI', async () => {
    let out = '';
    const code = await main(['report', '--help'], {
      out: (text) => {
        out += text;
      },
      err: () => {},
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(out).toContain('--out <file.html>');
    expect(out).toContain('--junit <file.xml>');
    expect(out).toContain('--pilot <path>');
  });
});
