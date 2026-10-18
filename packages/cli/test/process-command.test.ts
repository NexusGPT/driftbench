import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const AGENT = fileURLToPath(new URL('./fixtures/echo-agent.mjs', import.meta.url));
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
      stage: echoed
      must: ['echo: hello']
  - id: wrong
    user: bye
    expect:
      must: ['farewell']
`;

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-process-command-'));
  made.push(dir);
  await writeFile(join(dir, 'echo.yaml'), SPEC);
  return dir;
}

describe('campaign run --process-command', () => {
  it('runs a process target with the given command and prints every block with its verdicts', async () => {
    const dir = await folder();
    const command = JSON.stringify([process.execPath, AGENT]);
    const { code, out, err } = await cli(
      ['campaign', 'run', 'echo.yaml', '--target', 'process:echo', '--process-command', command, '--json'],
      dir,
    );
    expect(err).toBe('');
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      cells: Array<{
        state: string;
        blocks: Array<{
          index: number;
          blockId?: string;
          pass: boolean;
          stage?: string;
          verdicts: Array<{ id: string; outcome: string; gating: boolean; evidence: string }>;
        }>;
      }>;
    };
    const [cell] = report.cells;
    expect(cell?.state).toBe('fail');
    expect(cell?.blocks.map((block) => [block.index, block.blockId, block.pass, block.stage])).toEqual([
      [0, 'greet', true, 'echoed'],
      [1, 'wrong', false, 'echoed'],
    ]);
    const failed = cell?.blocks[1]?.verdicts.find((verdict) => verdict.outcome === 'fail');
    expect(failed).toMatchObject({ id: 'must.0', gating: true });
    expect(failed?.evidence).toContain('farewell');
  });

  it('splits a plain command on spaces', async () => {
    const dir = await folder();
    const { code, out } = await cli(
      ['campaign', 'run', 'echo.yaml', '--target', 'process:echo', '--process-command', `node ${AGENT}`],
      dir,
    );
    expect(code).toBe(1);
    expect(out).toMatch(/✗ echo · process:echo · F · repeat 0 {2}fail {2}block 1 must\.0/);
  });

  it('says where the command runs when an argument is a file of the working folder, given by a relative path', async () => {
    const dir = await folder();
    await copyFile(AGENT, join(dir, 'agent.mjs'));
    const { code, out, err } = await cli(
      ['campaign', 'run', 'echo.yaml', '--target', 'process:echo', '--process-command', 'node agent.mjs'],
      dir,
    );
    // The run is unchanged: the agent is not in the sandbox, so it prints nothing and the first block fails.
    expect(code).toBe(1);
    expect(out).toMatch(/✗ echo · process:echo · F · repeat 0 {2}fail {2}block 0/);
    expect(err).toContain('--process-command runs in the workspace of each sandbox');
    expect(err).toContain('agent.mjs is a file of the working folder');
    expect(err).toContain(JSON.stringify(join(dir, 'agent.mjs')));
  });

  it('says nothing about an absolute path, or a word that names no file of the working folder', async () => {
    const dir = await folder();
    await copyFile(AGENT, join(dir, 'agent.mjs'));
    const { err } = await cli(
      [
        'campaign',
        'run',
        'echo.yaml',
        '--target',
        'process:echo',
        '--process-command',
        `node ${AGENT} echo.txt`,
      ],
      dir,
    );
    expect(err).toBe('');
  });

  it('refuses a process command that is not a JSON list of strings or a word list', async () => {
    const dir = await folder();
    const { code, err } = await cli(
      ['campaign', 'run', 'echo.yaml', '--target', 'process:echo', '--process-command', '[1, 2]'],
      dir,
    );
    expect(code).toBe(2);
    expect(err).toContain('--process-command takes a JSON list of strings');
  });

  it('still refuses a process target it has no command for', async () => {
    const dir = await folder();
    const { code, err } = await cli(['campaign', 'run', 'echo.yaml', '--target', 'process:echo'], dir);
    expect(code).toBe(2);
    expect(err).toContain('process:echo');
  });
});
