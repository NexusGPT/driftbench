import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';

vi.setConfig({ testTimeout: 60_000 });

/**
 * `estate scan` and `estate lint` with `--home` and the `home:` key, through the CLI. The rule: a guard script
 * written from the user's home folder is looked for in the folder the run was given, and only there; the machine's
 * own home folder is never read, so one estate and one command give one result on every machine. The expected
 * results follow from that rule. The guard scripts are empty files of invented names.
 */

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function folder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-home-cli-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const settings = (command: string) =>
  JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } });
const SCRIPT = '#!/usr/bin/env python3\n';
const SKIPPED = 'home-not-mapped';

const saved = process.env.HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
});

/** An estate whose one guard runs `command`; the estate is the folder `p` of the working folder. */
const estateOf = (command: string, extra: Record<string, string> = {}) =>
  folder({ 'p/CLAUDE.md': '# Project\n', 'p/.claude/settings.json': settings(command), ...extra });

const scan = (work: string, ...extra: string[]) =>
  run(['estate', 'scan', 'p', '--no-model', '--out', 'map.yaml', ...extra], work);
const lint = (work: string, ...extra: string[]) => run(['estate', 'lint', 'map.yaml', ...extra], work);

describe('without a home folder', () => {
  it.each([
    'python3 ~/guards/zz-check.py',
    'python3 $HOME/guards/zz-check.py',
    'python3 ${HOME}/guards/zz-check.py',
  ])('skips %s, says so, and does not call the run clean', async (command) => {
    process.env.HOME = await folder({ 'guards/zz-check.py': SCRIPT });
    const work = await estateOf(command);
    expect((await scan(work)).code).toBe(0);
    const result = await lint(work);
    expect(result.code).toBe(0);
    expect(result.out).toContain('SKIPPED');
    expect(result.out).toContain(SKIPPED);
    expect(result.out).not.toContain('Clean.');
    expect(result.out).not.toContain('MISSING_SCRIPT  ');
  });
});

describe('--home', () => {
  const forms = [
    'python3 ~/guards/zz-check.py',
    'python3 $HOME/guards/zz-check.py',
    'python3 ${HOME}/guards/zz-check.py',
  ];

  it.each(forms)(
    'on scan and lint finds %s there, and the map never holds the machine folder',
    async (command) => {
      const home = await folder({ 'guards/zz-check.py': SCRIPT });
      const work = await estateOf(command);
      const scanned = await scan(work, '--home', home);
      expect(scanned.code).toBe(0);
      const map = await readFile(join(work, 'map.yaml'), 'utf8');
      expect(map).toContain('~/guards/zz-check.py');
      expect(map).not.toContain(home);
      const linted = await lint(work, '--home', home);
      expect(linted.code).toBe(0);
      expect(linted.out).toContain('Clean.');
    },
  );

  it('reports a script the folder does not hold as missing, exit 1', async () => {
    const home = await folder({ 'other/x.py': SCRIPT });
    const work = await estateOf('python3 ${HOME}/guards/zz-check.py');
    await scan(work);
    const result = await lint(work, '--home', home);
    expect(result.code).toBe(1);
    expect(result.out).toContain('MISSING_SCRIPT');
  });

  it('does not count a directory named like the script as the script', async () => {
    const home = await folder({ 'guards/zz-check.py/inner.txt': 'x' });
    const work = await estateOf('python3 ~/guards/zz-check.py');
    await scan(work);
    expect((await lint(work, '--home', home)).code).toBe(1);
  });

  it('resolves a relative folder from where the command is typed', async () => {
    const work = await estateOf('python3 ~/guards/zz-check.py', { 'base/guards/zz-check.py': SCRIPT });
    await scan(work);
    const result = await lint(work, '--home', 'base');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Clean.');
  });

  it('expands a ~ the user wrote on the command line: an explicit mapping of their own', async () => {
    process.env.HOME = await folder({ 'base/guards/zz-check.py': SCRIPT });
    const work = await estateOf('python3 ~/guards/zz-check.py');
    await scan(work);
    const result = await lint(work, '--home', '~/base');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Clean.');
  });

  it('is refused empty, on scan and on lint, exit 2', async () => {
    const work = await estateOf('python3 ~/guards/zz-check.py');
    const scanned = await scan(work, '--home', '');
    expect(scanned.code).toBe(2);
    expect(scanned.err).toContain('--home');
    await scan(work);
    const linted = await lint(work, '--home', '');
    expect(linted.code).toBe(2);
    expect(linted.err).toContain('--home');
  });
});

describe('the home: key of the configuration file', () => {
  it('names a folder of the estate, relative to the estate root', async () => {
    const work = await estateOf('python3 ~/guards/zz-check.py', {
      'p/base/guards/zz-check.py': SCRIPT,
      'p/driftbench.estate.yaml': 'home: base\n',
    });
    await scan(work);
    const result = await lint(work);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Clean.');
  });

  it('is given the flag as well: the flag wins', async () => {
    const other = await folder({ 'guards/zz-check.py': SCRIPT });
    const work = await estateOf('python3 ~/guards/zz-check.py', {
      'p/driftbench.estate.yaml': 'home: base\n',
    });
    await scan(work);
    expect((await lint(work, '--home', other)).code).toBe(0);
    expect((await lint(work)).code).toBe(1);
  });

  it.each(['~', '~/base'])(
    'refuses %s: the same estate gives the same lint on two machines, whatever their home holds',
    async (written) => {
      const work = await estateOf('python3 ~/guards/zz-check.py', {
        'p/driftbench.estate.yaml': `home: "${written}"\n`,
      });
      const results: string[] = [];
      for (const holds of [true, false]) {
        process.env.HOME = await folder(
          holds ? { 'base/guards/zz-check.py': SCRIPT, 'guards/zz-check.py': SCRIPT } : {},
        );
        await scan(work);
        const result = await lint(work);
        expect(result.out).toContain(SKIPPED);
        expect(result.out).not.toContain('Clean.');
        results.push(`${result.code}\n${result.out}`);
      }
      expect(results[0]).toBe(results[1]);
    },
  );
});

describe('the shapes of a command that runs a script from the home folder', () => {
  // The home folder lies in the estate (under the layout folder), so the dispatcher and its target are files the
  // reader holds. A shape the reader does not follow would lose the home folder and call the script missing.
  const SHAPES: Array<{ id: string; command: string }> = [
    { id: 'direct', command: '$HOME/guards/zz-check.py' },
    { id: 'interpreter', command: 'python3 $HOME/guards/zz-check.py' },
    { id: 'environment prefix', command: 'MODE=strict python3 $HOME/guards/zz-check.py' },
    { id: 'guarded', command: '[ -n "$GUARDS_ON" ] || python3 $HOME/guards/zz-check.py' },
    { id: 'sh -c', command: `sh -c "python3 $HOME/guards/zz-check.py"` },
    { id: 'cd then run', command: 'cd $HOME/guards && python3 zz-check.py' },
    { id: 'time limit', command: 'timeout 5 python3 $HOME/guards/zz-check.py' },
  ];
  it.each(SHAPES)(
    '$id: found when the folder holds the script, missing when it does not',
    async ({ command }) => {
      const present = await estateOf(command, { 'p/.claude/user-base/guards/zz-check.py': SCRIPT });
      await scan(present, '--home', join(present, 'p/.claude/user-base'));
      const found = await lint(present, '--home', join(present, 'p/.claude/user-base'));
      expect(found.code).toBe(0);
      expect(found.out).not.toContain('MISSING_SCRIPT  ');
      const absent = await estateOf(command, { 'p/.claude/user-base/other/x.py': SCRIPT });
      await scan(absent, '--home', join(absent, 'p/.claude/user-base'));
      expect((await lint(absent, '--home', join(absent, 'p/.claude/user-base'))).code).toBe(1);
    },
  );

  it('a dispatcher run from the home folder that names its target by argument: the target is judged too', async () => {
    const dispatcher = [
      '#!/usr/bin/env python3',
      '"""Usage: run.py <hook>. Runs the hook script <hook>.py beside it."""',
      'import subprocess',
      'import sys',
      'from pathlib import Path',
      'hook = Path(__file__).resolve().parent / f"{sys.argv[1]}.py"',
      'raise SystemExit(subprocess.run([sys.executable, str(hook)]).returncode)',
    ].join('\n');
    const command = 'python3 $HOME/guards/run.py zz-target';
    const base = 'p/.claude/user-base';
    const present = await estateOf(command, {
      [`${base}/guards/run.py`]: `${dispatcher}\n`,
      [`${base}/guards/zz-target.py`]: SCRIPT,
    });
    await scan(present, '--home', join(present, base));
    expect((await lint(present, '--home', join(present, base))).code).toBe(0);
    const absent = await estateOf(command, { [`${base}/guards/run.py`]: `${dispatcher}\n` });
    await scan(absent, '--home', join(absent, base));
    const missing = await lint(absent, '--home', join(absent, base));
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('MISSING_SCRIPT');
  });
});

describe('quotes', () => {
  it.each([
    "python3 '$HOME/guards/zz-check.py'",
    'python3 "~/guards/zz-check.py"',
    "python3 '~/guards/zz-check.py'",
  ])('%s is text for the shell, so the guard is not anchored', async (command) => {
    const home = await folder({ 'guards/zz-check.py': SCRIPT });
    const work = await estateOf(command);
    await scan(work, '--home', home);
    const result = await lint(work, '--home', home);
    expect(result.out).toContain('UNANCHORED_GUARD');
  });

  // The home folder lies in the estate and holds a file named like the script. A quoted tilde is not the home
  // folder, so the shell runs a path under the working folder and that file is never run: the guard must not be
  // shown as enforced by it.
  it.each([
    'python3 "~/guard.py"',
    "python3 '~/guard.py'",
    'cd "~" && python3 guard.py',
    "python3 '$HOME/guard.py'",
  ])('%s does not map to the file of the home folder that lies in the estate', async (command) => {
    const work = await estateOf(command, { 'p/.claude/h/guard.py': SCRIPT });
    const home = join(work, 'p/.claude/h');
    await scan(work, '--home', home);
    const map = await readFile(join(work, 'map.yaml'), 'utf8');
    expect(map).not.toContain('script: .claude/h/guard.py');
    const result = await lint(work, '--home', home);
    expect(result.out).toContain('UNANCHORED_GUARD');
  });

  it('"$HOME/..." in double quotes is expanded by the shell, so it is the home folder', async () => {
    const home = await folder({ 'guards/zz-check.py': SCRIPT });
    const work = await estateOf('python3 "$HOME/guards/zz-check.py"');
    await scan(work, '--home', home);
    const result = await lint(work, '--home', home);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain('UNANCHORED_GUARD');
  });
});
