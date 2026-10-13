import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DockerSandbox, dockerProvider, TIMEOUT_EXIT_CODE } from '@agent-nexus/driftbench-sandbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runner from '../src/run';

let dir: string;
let box: DockerSandbox;
const runProcess = runner.runProcess;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-docker-env-test-'));
  const binary = join(dir, 'docker');
  await copyFile(fileURLToPath(new URL('./fixtures/fake-docker.mjs', import.meta.url)), binary);
  await chmod(binary, 0o755);
  vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
  box = (await dockerProvider({ image: 'acme/agent:1', binary: 'docker', dir }).create()) as DockerSandbox;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await box?.destroy();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function envFileOf(args: readonly string[]): string {
  expect(args).toContain('--env-file');
  return args[args.indexOf('--env-file') + 1] as string;
}
function expectRemoved(file: string) {
  expect(existsSync(file)).toBe(false);
  expect(existsSync(dirname(file))).toBe(false);
}

describe('Docker exec env files', () => {
  it('keeps container PATH out of the client and resolves the docker binary on host PATH', async () => {
    const record = await box.exec('printf "%s" "$PATH"', { env: { PATH: '/container-only-bin' } });
    expect(record).toMatchObject({ exitCode: 0, stdout: '/container-only-bin' });
    const calls = (await readFile(join(dir, 'containers/calls.jsonl'), 'utf8')).trim().split('\n');
    const exec = calls.map((line) => JSON.parse(line) as string[]).find((args) => args[0] === 'exec');
    expect(exec).not.toContain('/container-only-bin');
    expectRemoved(envFileOf(exec ?? []));
  });

  it('keeps Docker settings and proxy variables out of the client environment', async () => {
    const env = {
      DOCKER_HOST: 'tcp://container-only.invalid:2375',
      DOCKER_CONFIG: '/container-config',
      DOCKER_CONTEXT: 'container-context',
      HTTP_PROXY: 'http://container-proxy.invalid:8080',
    };
    const client = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    const spy = vi.spyOn(runner, 'runProcess').mockImplementation(async (file, args, command, options) => {
      for (const key of Object.keys(env)) expect(options.env[key] === client[key]).toBe(true);
      const content = await readFile(envFileOf(args), 'utf8');
      for (const [key, value] of Object.entries(env)) expect(content).toContain(`${key}=${value}\n`);
      return runProcess(file, args, command, options);
    });
    const record = await box.exec('printf "%s" "$DOCKER_HOST"', { env });
    expect(record).toMatchObject({ exitCode: 0, stdout: env.DOCKER_HOST });
    expect(spy).toHaveBeenCalledOnce();
  });

  it.each([
    ['spaces', '  leading and trailing  '],
    ['equals', 'left=middle=right'],
    ['hash', '#leading and #inline'],
    ['quotes', `"double" and 'single'`],
    ['literal shell text', '$VALUE `command` \\t'],
    ['empty', ''],
  ])('round-trips %s literally through a private file, never argv', async (_label, value) => {
    let envFile = '';
    vi.spyOn(runner, 'runProcess').mockImplementation(async (file, args, command, options) => {
      envFile = envFileOf(args);
      expect((await stat(envFile)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(envFile))).mode & 0o777).toBe(0o700);
      expect(dirname(envFile).startsWith(box.folder)).toBe(false);
      expect(await readFile(envFile, 'utf8')).toBe(`FIXTURE_VALUE=${value}\n`);
      if (value !== '') expect(args.some((arg) => arg.includes(value))).toBe(false);
      expect(options.env.FIXTURE_VALUE).toBeUndefined();
      return runProcess(file, args, command, options);
    });
    const record = await box.exec('printf "%s|%s" "$FIXTURE_VALUE" "$(cat)"', {
      env: { FIXTURE_VALUE: value },
      stdin: 'input preserved',
    });
    expect(record).toMatchObject({ exitCode: 0, stdout: `${value}|input preserved` });
    expectRemoved(envFile);
  });

  it.each(['line\nbreak', 'line\rbreak', 'line\r\nbreak'])(
    'rejects line breaks with the variable name',
    async (value) => {
      const spy = vi.spyOn(runner, 'runProcess');
      await expect(box.exec('true', { env: { MULTILINE: value } })).rejects.toThrow(/MULTILINE.*line break/);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(['#COMMENT', ' SPACE', 'LINE\nBREAK', 'WITH=EQUALS'])(
    'rejects a name the file would reinterpret: %s',
    async (name) => {
      const spy = vi.spyOn(runner, 'runProcess');
      await expect(box.exec('true', { env: { [name]: 'fixture' } })).rejects.toThrow(
        /variable name.*invalid/,
      );
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('removes the file and private folder when the client throws', async () => {
    let envFile = '';
    vi.spyOn(runner, 'runProcess').mockImplementationOnce(async (_file, args) => {
      envFile = envFileOf(args);
      expect(existsSync(envFile)).toBe(true);
      throw new Error('fixture launch failed');
    });
    await expect(box.exec('true', { env: { FIXTURE_VALUE: 'private fixture' } })).rejects.toThrow(
      'fixture launch failed',
    );
    expectRemoved(envFile);
  });

  it('removes the file and private folder after a timeout', async () => {
    let envFile = '';
    vi.spyOn(runner, 'runProcess').mockImplementation(async (file, args, command, options) => {
      if (args[0] === 'exec') envFile = envFileOf(args);
      return runProcess(file, args, command, options);
    });
    const record = await box.exec('sleep 30', { env: { FIXTURE_VALUE: 'private fixture' }, timeoutMs: 300 });
    expect(record.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expectRemoved(envFile);
  });
});
