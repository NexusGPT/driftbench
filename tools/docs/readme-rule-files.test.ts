import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const run = promisify(execFile);

async function cli(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  const lines = out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  return { code, err, lines };
}

/** The body of the README block that starts `# file: <name>`. */
function fileOf(readme: string, name: string): string {
  const marker = `# file: ${name}\n`;
  const from = readme.indexOf(marker);
  expect(from, `the README shows ${name}`).toBeGreaterThan(0);
  return readme.slice(from + marker.length, readme.indexOf('\n```', from));
}

/** One command of the README block, with the lines it printed. */
function shows(readme: string, command: string, lines: string[]): void {
  expect(readme).toContain([`$ ${command}`, ...lines].join('\n'));
}

describe('README, Rule files: a project check set and a re-score', () => {
  it('prints the lines the README shows, and the stamp of each verdict', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    // The stamp script resolves the store package from the clone, so the folder lives inside it.
    const dir = await mkdtemp(join(ROOT, '.readme-rules-'));
    try {
      const home = join(dir, 'rules');
      await mkdir(join(home, 'specs'), { recursive: true });
      await mkdir(join(home, 'driftbench/check-set'), { recursive: true });
      await writeFile(join(home, 'driftbench.yaml'), 'plugins: []\n');
      await writeFile(join(home, 'specs/wording.yaml'), `${fileOf(readme, 'rules/specs/wording.yaml')}\n`);
      await writeFile(
        join(home, 'driftbench/check-set/acme.yaml'),
        `${fileOf(readme, 'rules/driftbench/check-set/acme.yaml')}\n`,
      );
      await writeFile(join(home, 'stamps.mts'), `${fileOf(readme, 'rules/stamps.mts')}\n`);

      const show = await cli(['object', 'show', 'check-set/acme'], home);
      expect(show.code, show.err).toBe(0);
      shows(readme, 'driftbench object show check-set/acme', [
        show.lines[0] ?? '',
        show.lines.find((line) => line.trim().startsWith('must ')) ?? '',
        show.lines.find((line) => line.startsWith('project ')) ?? '',
      ]);

      const base = ['--target', 'function:acme-sales', '--agent-version', 'acme-v1'];
      const first = await cli(
        ['campaign', 'run', 'specs/wording.yaml', ...base, '--campaign', 'full', '--store', 'runs.db'],
        home,
      );
      expect(first.code, first.err).toBe(1);
      shows(
        readme,
        'driftbench campaign run specs/wording.yaml --target function:acme-sales --agent-version acme-v1 --campaign full --store runs.db',
        first.lines.slice(-2),
      );

      const score = await cli(
        [
          'campaign',
          'rejudge',
          'specs/wording.yaml',
          '--from',
          'full',
          '--campaign',
          'acme',
          '--store',
          'runs.db',
          '--use',
          'check-set/acme',
        ],
        home,
      );
      expect(score.code, score.err).toBe(0);
      shows(
        readme,
        'driftbench campaign rejudge specs/wording.yaml --from full --campaign acme --store runs.db --use check-set/acme',
        score.lines,
      );

      const status = await cli(['campaign', 'status', 'acme', '--store', 'runs.db'], home);
      expect(status.code, status.err).toBe(0);
      shows(readme, 'driftbench campaign status acme --store runs.db', status.lines.slice(1));

      const stamps = await run(join(ROOT, 'node_modules/.bin/tsx'), ['stamps.mts', 'runs.db'], { cwd: home });
      shows(
        readme,
        'pnpm exec tsx stamps.mts runs.db',
        stamps.stdout.split('\n').filter((line) => line !== ''),
      );

      const refused = await cli(
        [
          'campaign',
          'rejudge',
          'specs/wording.yaml',
          '--from',
          'full',
          '--campaign',
          'refused',
          '--store',
          'runs.db',
          '--use',
          'run-profile/fast',
        ],
        home,
      );
      expect(refused.code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
