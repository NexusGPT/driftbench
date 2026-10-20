import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main as benchMain } from '../../../benchmarks/cli';
import { main } from '../src/main';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
type Run = (
  args: string[],
  io: { cwd: string; out: (s: string) => void; err: (s: string) => void },
) => Promise<number>;
async function run(args: string[], at = cwd, entry: Run = main) {
  let out = '';
  let err = '';
  const code = await entry(args, {
    cwd: at,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

/** The option lines of a help text, without the help option itself. */
const optionsOf = (help: string) =>
  help
    .split('\n')
    .filter((line) => /^\s+-/.test(line) && !line.includes('--help'))
    .map((line) => line.trim().replace(/\s{2,}/g, '  '));

describe('driftbench bench', () => {
  it('is listed in the top-level help', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\s+bench\b/m);
  });

  it('takes the same options as pnpm bench, command by command', async () => {
    for (const command of ['replay', 'record', 'floors']) {
      const cli = await run(['bench', command, '--help']);
      const repo = await run([command, '--help'], cwd, benchMain);
      expect(cli.code, command).toBe(0);
      expect(optionsOf(cli.out), command).toEqual(optionsOf(repo.out));
      expect(optionsOf(cli.out).length, command).toBeGreaterThan(2);
    }
  });

  it('replays a slice offline from another folder with --root, as pnpm bench does', async () => {
    const away = await mkdtemp(join(tmpdir(), 'bench-away-'));
    try {
      const args = [
        'replay',
        '--slice',
        'planted-rubric',
        '--model',
        'gpt-6-luna',
        '--check-floor',
        '--json',
      ];
      const cli = await run(['bench', ...args, '--root', cwd], away);
      expect(cli.err).toBe('');
      expect(cli.code).toBe(0);
      const repo = await run([...args, '--root', cwd], away, benchMain);
      // The two runs differ only in when they ran.
      const untimed = (text: string) => text.replace(/"(started|finished)At": "[^"]+"/g, '"$1At": ""');
      expect(JSON.parse(untimed(cli.out))).toEqual(JSON.parse(untimed(repo.out)));
      expect(JSON.parse(cli.out).reports[0]).toMatchObject({ slice: 'planted-rubric', judge: 'gpt-6-luna' });
    } finally {
      await rm(away, { recursive: true, force: true });
    }
  }, 120_000);

  it('exits 2 with the reason when --root holds no benchmarks', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'bench-empty-'));
    try {
      const r = await run(['bench', 'replay', '--root', empty]);
      expect(r.code).toBe(2);
      expect(r.err).toContain('bench:');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
