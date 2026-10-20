import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

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
  return { code, out, err };
}

describe('README, Rule files: the project value-check file and its commands', () => {
  it('prints the lines the README shows', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const file = /# file: rules\/driftbench\/policy\/value-check\/acme\.yaml\n([\s\S]*?)\n```/.exec(
      readme,
    )?.[1];
    expect(file, 'the README shows the rule file').toBeDefined();
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-readme-rules-'));
    try {
      await mkdir(join(dir, 'rules/specs'), { recursive: true });
      await mkdir(join(dir, 'rules/driftbench/policy/value-check'), { recursive: true });
      await cp(
        `${ROOT}/examples/acme/specs/conversations/plan-upgrade.yaml`,
        join(dir, 'rules/specs/plan-upgrade.yaml'),
      );
      await writeFile(join(dir, 'rules/driftbench.yaml'), 'plugins: []\n');
      await writeFile(join(dir, 'rules/driftbench/policy/value-check/acme.yaml'), `${file}\n`);
      const spec = 'specs/plan-upgrade.yaml';
      const home = join(dir, 'rules');
      const show = await cli(['object', 'show', 'policy/value-check/acme'], home);
      expect(show.code, show.err).toBe(0);
      const rows = show.out.split('\n').map((line) => line.trimEnd());
      const shown = [...rows.slice(0, 3), rows.find((line) => line.startsWith('project ')) ?? ''];
      expect(readme, JSON.stringify(shown)).toContain(shown.join('\n'));
      const run = await cli(
        [
          'campaign',
          'run',
          spec,
          '--target',
          'function:acme-sales',
          '--agent-version',
          'acme-v1',
          '--campaign',
          'full',
          '--store',
          'runs.db',
        ],
        home,
      );
      expect(run.code, run.err).toBe(0);
      const score = await cli(
        [
          'campaign',
          'rejudge',
          spec,
          '--from',
          'full',
          '--campaign',
          'acme',
          '--store',
          'runs.db',
          '--use',
          'policy/value-check/acme',
        ],
        home,
      );
      expect(score.code, score.err).toBe(0);
      expect(readme).toContain(score.out.trimEnd());
      const refused = await cli(
        [
          'campaign',
          'rejudge',
          spec,
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
  }, 180_000);
});
