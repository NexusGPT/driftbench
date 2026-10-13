import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { CiSummary } from '../src/commands/ci';
import { type Io, main } from '../src/index';

/** Fictional data only: an agent that echoes the user turn. */
const AGENT = fileURLToPath(new URL('./fixtures/echo-agent.mjs', import.meta.url));
const COMMAND = JSON.stringify([process.execPath, AGENT]);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SLOW = 120_000;
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

const SPEC = `id: echo
blocks:
  - id: greet
    user: hello
    expect:
      must: ['echo: hello']
`;

/**
 * A folder with one spec and a store that holds its baseline campaign on the echo agent. One golden shows
 * parity at the automatic margin only, so the tests leave --margin at its default.
 */
async function baselined(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-ci-process-'));
  made.push(dir);
  await writeFile(join(dir, 'echo.yaml'), SPEC);
  const run = await cli(
    [
      'campaign',
      'run',
      'echo.yaml',
      '--target',
      'process:echo',
      '--process-command',
      COMMAND,
      '--store',
      'runs.db',
      '--campaign',
      'baseline',
    ],
    dir,
  );
  expect(run.code).toBe(0);
  return dir;
}

const CI = [
  'ci',
  '--specs',
  'echo.yaml',
  '--target',
  'process:echo',
  '--baseline',
  'baseline',
  '--store',
  'runs.db',
];

describe('ci --process-command', () => {
  it('runs the candidate on a process target with the given command and compares it with the baseline', async () => {
    const dir = await baselined();
    const result = await cli([...CI, '--process-command', COMMAND, '--out', 'summary.json'], dir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as CiSummary;
    expect(summary.verdict).toBe('parity');
    expect(summary.candidate.target).toBe('process:echo');
  });

  it('refuses a process command it cannot read, exit 2', async () => {
    const dir = await baselined();
    const result = await cli([...CI, '--process-command', '[1, 2]'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('--process-command takes a JSON list of strings');
  });

  it('still refuses a process target it has no command for, exit 2', async () => {
    const dir = await baselined();
    const result = await cli(CI, dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('No adapter is set up for process:echo');
  });

  it(
    'the GitHub Action passes its process-command input to ci',
    async () => {
      const dir = await baselined();
      const yml = await readFile(join(ROOT, 'action/action.yml'), 'utf8');
      expect(yml).toMatch(/^ {2}process-command:\n {4}description: /m);
      expect(yml).toMatch(/INPUT_PROCESS_COMMAND: \$\{\{ inputs\.process-command \}\}/);
      const output = join(dir, 'output.txt');
      const report = join(dir, 'report.json');
      const tsx = join(ROOT, 'node_modules/.bin/tsx');
      const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          INPUT_SPECS: join(dir, 'echo.yaml'),
          INPUT_TARGET: 'process:echo',
          INPUT_PROCESS_COMMAND: COMMAND,
          INPUT_BASELINE: 'baseline',
          INPUT_STORE: join(dir, 'runs.db'),
          INPUT_REPORT_PATH: report,
          INPUT_DRIFTBENCH: `${tsx} packages/cli/src/bin.ts`,
        },
      });
      expect(result.status).toBe(0);
      expect(await readFile(output, 'utf8')).toBe(`verdict=parity\nreport-path=${report}\n`);
    },
    SLOW,
  );
});
