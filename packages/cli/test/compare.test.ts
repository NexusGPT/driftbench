import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { registerCompareCommand } from '../src/commands/compare';
import { type Io, main } from '../src/index';

let dir = '';
let db = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-compare-'));
  db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F', 'P'], repeats: 2 });
    await storeAcmeCampaign(store, {
      campaignId: 'c-x3',
      modes: ['F', 'P'],
      repeats: 2,
      fault: 'x3-skips-recap',
    });
    await storeAcmeCampaign(store, { campaignId: 'c-acme-again', modes: ['F', 'P'], repeats: 2 });
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
  registerCompareCommand(program, io, (exit) => {
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

describe('driftbench compare', () => {
  it('exits 1 and prints REGRESSED for the fault that skips the recap', async () => {
    const { code, out, err } = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-x3',
      '--store',
      'store.db',
      '--margin',
      '15',
    ]);
    expect(err).toBe('');
    expect(code).toBe(1);
    expect(out).toContain('Paired: 17 goldens');
    expect(out).toMatch(/Both pass \d+, regressed [1-9]\d*, improved 0/);
    expect(out).toContain('Verdict: REGRESSED.');
    expect(out).toContain('all-pass dropped: McNemar exact p =');
  });

  it('exits 0 for the same agent again when the margin is wider than every interval', async () => {
    const { code, out } = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-acme-again',
      '--store',
      'store.db',
      '--margin',
      '50',
    ]);
    expect(out).toContain('Verdict: NON-INFERIOR.');
    expect(code).toBe(0);
  });

  it('exits 1 without calling it a regression when the margin is too tight to show parity', async () => {
    const { code, out } = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-acme-again',
      '--store',
      'store.db',
      '--margin',
      '2',
    ]);
    expect(out).toContain('Verdict: NOT SHOWN NON-INFERIOR.');
    expect(code).toBe(1);
  });

  it('prints one JSON document with --json, the per-golden sides as plain objects', async () => {
    const { code, out } = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-x3',
      '--store',
      'store.db',
      '--margin',
      '15',
      '--mode',
      'F',
      '--json',
    ]);
    expect(code).toBe(1);
    const json = JSON.parse(out) as {
      verdict: string;
      modes: string[];
      pairs: Array<{ baseline: { criteria: Record<string, { pass: boolean }>; flags: string[] } }>;
    };
    expect(json.verdict).toBe('regressed');
    expect(json.modes).toEqual(['F']);
    expect(json.pairs).toHaveLength(6);
    expect(json.pairs[0]?.baseline.criteria.tools?.pass).toBe(true);
    expect(Array.isArray(json.pairs[0]?.baseline.flags)).toBe(true);
  });

  it.each([
    [['--margin', '0'], '--margin takes a number of points above 0 and below 100'],
    [['--margin', '100'], '--margin takes a number of points above 0 and below 100'],
    [['--margin', 'two'], '--margin takes a number of points'],
    [['--margin', '5', '--mode', 'X'], 'Unknown mode "X"'],
    [['--margin', '5', '--q', '1'], '--q takes a number between 0 and 1'],
  ])('exits 2 on bad input %j', async (flags, message) => {
    const { code, err } = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-x3',
      '--store',
      'store.db',
      ...flags,
    ]);
    expect(code).toBe(2);
    expect(err).toContain(message);
  });

  it('exits 2 on a missing campaign and when the campaigns share no mode', async () => {
    const missing = await cli([
      'compare',
      '--baseline',
      'nope',
      '--candidate',
      'c-x3',
      '--store',
      'store.db',
      '--margin',
      '5',
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('No campaign nope');
    const noMode = await cli([
      'compare',
      '--baseline',
      'c-acme',
      '--candidate',
      'c-x3',
      '--store',
      'store.db',
      '--margin',
      '5',
      '--mode',
      'T',
    ]);
    expect(noMode.code).toBe(2);
    expect(noMode.err).toContain('share no golden');
  });

  it('is wired into the CLI', async () => {
    let out = '';
    const code = await main(['compare', '--help'], {
      out: (text) => {
        out += text;
      },
      err: () => {},
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(out).toContain('--baseline <campaign>');
    expect(out).toContain('--margin <points|auto>');
  });
});
