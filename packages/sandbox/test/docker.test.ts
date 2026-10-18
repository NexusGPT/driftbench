import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCKER_WORKSPACE,
  type DockerSandbox,
  dockerProvider,
  TIMEOUT_EXIT_CODE,
} from '@agent-nexus/driftbench-sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two layers. The fake docker command line (fixtures/fake-docker.mjs) drives the docker sandbox code on
 * any machine: the calls it makes, the path mapping, the restart at a timeout, the removal. The real
 * docker tests run when a docker binary and daemon answer, and print that they skipped otherwise.
 */

const FAKE = fileURLToPath(new URL('./fixtures/fake-docker.mjs', import.meta.url));

let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-docker-test-')));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A private copy of the fake docker, with its own container state. */
async function fakeDocker(name: string) {
  const dir = join(root, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'workspaces'), { recursive: true });
  const binary = join(dir, 'fake-docker.mjs');
  await copyFile(FAKE, binary);
  await chmod(binary, 0o755);
  const calls = async (): Promise<string[][]> =>
    (await readFile(join(dir, 'containers', 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
  const state = async (container: string) =>
    JSON.parse(await readFile(join(dir, 'containers', `${container}.json`), 'utf8')) as { restarts: number };
  return { binary, workspaces: join(dir, 'workspaces'), calls, state, dir };
}

describe('the docker sandbox, on the fake docker command line', () => {
  it('is available when docker answers, and not when it is missing or failing', async () => {
    const fake = await fakeDocker('available');
    expect(await dockerProvider({ image: 'acme/agent:1', binary: fake.binary }).available()).toBe(true);
    expect(
      await dockerProvider({ image: 'acme/agent:1', binary: join(fake.dir, 'missing') }).available(),
    ).toBe(false);
    expect(await dockerProvider({ image: 'acme/agent:1', binary: 'false' }).available()).toBe(false);
  });

  it('starts one container per sandbox with the folder mounted at /workspace, as the current user', async () => {
    const fake = await fakeDocker('start');
    const provider = dockerProvider({ image: 'acme/agent:1', binary: fake.binary, dir: fake.workspaces });
    expect(provider.kind).toBe('docker');
    const box = (await provider.create()) as DockerSandbox;
    try {
      expect(box.kind).toBe('docker');
      expect(box.isolation).toBe('strong');
      expect(box.root).toBe(DOCKER_WORKSPACE);
      expect(box.folder.startsWith(fake.workspaces)).toBe(true);
      const [run] = await fake.calls();
      expect(run?.slice(0, 7)).toEqual([
        'run',
        '-d',
        '--init',
        '--name',
        box.container,
        '-v',
        `${box.folder}:/workspace`,
      ]);
      expect(run).toContain('acme/agent:1');
      if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
        expect(run).toContain(`${process.getuid()}:${process.getgid()}`);
      }
    } finally {
      await box.destroy();
    }
  });

  it('starts the container with no network by default, so a command cannot reach a host or the internet', async () => {
    const fake = await fakeDocker('network-default');
    const provider = dockerProvider({ image: 'acme/agent:1', binary: fake.binary, dir: fake.workspaces });
    const box = (await provider.create()) as DockerSandbox;
    try {
      const [run] = await fake.calls();
      const at = run?.indexOf('--network') ?? -1;
      expect(at).toBeGreaterThan(-1);
      expect(run?.[at + 1]).toBe('none');
      expect(run).toContain('acme/agent:1');
    } finally {
      await box.destroy();
    }
  });

  it('starts the container on the network the provider names', async () => {
    const fake = await fakeDocker('network-bridge');
    const provider = dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
      network: 'bridge',
    });
    const box = (await provider.create()) as DockerSandbox;
    try {
      const [run] = await fake.calls();
      const at = run?.indexOf('--network') ?? -1;
      expect(at).toBeGreaterThan(-1);
      expect(run?.[at + 1]).toBe('bridge');
    } finally {
      await box.destroy();
    }
  });

  it('bounds resources and drops privileges by default', async () => {
    const fake = await fakeDocker('limits-default');
    const box = await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
    }).create();
    try {
      const [run] = await fake.calls();
      for (const [flag, value] of [
        ['--memory', '1g'],
        ['--cpus', '1'],
        ['--pids-limit', '256'],
        ['--cap-drop', 'ALL'],
        ['--security-opt', 'no-new-privileges'],
        ['--network', 'none'],
      ]) {
        expect(run).toContain(flag);
        expect(run?.[(run?.indexOf(flag as string) ?? -1) + 1]).toBe(value);
      }
    } finally {
      await box.destroy();
    }
  });

  it('uses each explicit resource and privilege override', async () => {
    const fake = await fakeDocker('limits-overrides');
    const box = await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
      memory: '2g',
      cpus: 0.5,
      pidsLimit: 64,
      capDrop: ['NET_RAW', 'SYS_ADMIN'],
      noNewPrivileges: false,
    }).create();
    try {
      const [run] = await fake.calls();
      for (const [flag, value] of [
        ['--memory', '2g'],
        ['--cpus', '0.5'],
        ['--pids-limit', '64'],
      ]) {
        expect(run).toContain(flag);
        expect(run?.[(run?.indexOf(flag as string) ?? -1) + 1]).toBe(value);
      }
      expect(run?.filter((_, index) => run[index - 1] === '--cap-drop')).toEqual(['NET_RAW', 'SYS_ADMIN']);
      expect(run).not.toContain('--security-opt');
    } finally {
      await box.destroy();
    }
  });

  it('preserves explicit zero limits and an empty capability-drop list', async () => {
    const fake = await fakeDocker('limits-disabled');
    const box = await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
      memory: '0',
      cpus: 0,
      pidsLimit: -1,
      capDrop: [],
    }).create();
    try {
      const [run] = await fake.calls();
      for (const [flag, value] of [
        ['--memory', '0'],
        ['--cpus', '0'],
        ['--pids-limit', '-1'],
      ]) {
        expect(run).toContain(flag);
        expect(run?.[(run?.indexOf(flag as string) ?? -1) + 1]).toBe(value);
      }
      expect(run).not.toContain('--cap-drop');
      expect(run).toContain('no-new-privileges');
    } finally {
      await box.destroy();
    }
  });

  it('keeps exec environment values out of argv while preserving values and stdin', async () => {
    const fake = await fakeDocker('env-private');
    const box = await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
    }).create();
    const env = { FIXTURE_VALUE: "fictional=value with spaces and 'quotes'", EMPTY_VALUE: '' };
    try {
      const record = await box.exec('printf "%s|%s|%s" "$FIXTURE_VALUE" "$EMPTY_VALUE" "$(cat)" > env.txt', {
        env,
        stdin: 'input preserved',
      });
      expect(record.exitCode).toBe(0);
      expect(Buffer.from(await box.readFile('env.txt')).toString('utf8')).toBe(
        `${env.FIXTURE_VALUE}||input preserved`,
      );
      const exec = (await fake.calls()).find((call) => call[0] === 'exec');
      expect(exec).toContain('--env-file');
      expect(exec?.some((arg) => arg.includes(env.FIXTURE_VALUE))).toBe(false);
      expect((await box.exec('printenv FIXTURE_VALUE')).exitCode).toBe(1);
      expect(process.env.FIXTURE_VALUE).toBeUndefined();
    } finally {
      await box.destroy();
    }
  });

  it('runs commands in the container path with only the given variables, and diffs the mounted folder', async () => {
    const fake = await fakeDocker('exec');
    const box = (await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
    }).create()) as DockerSandbox;
    try {
      await box.seed({ files: { 'catalog.csv': 'plan_id\nmobile-s\n', 'sub/keep.txt': '' } });
      const before = await box.snapshot();
      const record = await box.exec('printf "%s|%s" "$GREETING" "$(cat)" > made.txt; printf ok', {
        cwd: 'sub',
        env: { GREETING: 'hello' },
        stdin: 'from stdin',
      });
      expect(record).toMatchObject({ exitCode: 0, stdout: 'ok' });
      const exec = (await fake.calls()).find((call) => call[0] === 'exec');
      expect(exec?.slice(0, 7)).toEqual([
        'exec',
        '-i',
        '-w',
        '/workspace/sub',
        '--env-file',
        expect.any(String),
        box.container,
      ]);
      expect(Buffer.from(await box.readFile('sub/made.txt')).toString('utf8')).toBe('hello|from stdin');
      expect(box.diff(before, await box.snapshot())).toEqual({
        created: ['sub/made.txt'],
        changed: [],
        deleted: [],
      });
      expect((await box.exec('exit 7')).exitCode).toBe(7);
    } finally {
      await box.destroy();
    }
  });

  it('restarts the container when a command times out, which kills what the client left running', async () => {
    const fake = await fakeDocker('timeout');
    const box = (await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
    }).create()) as DockerSandbox;
    try {
      // The command outlives the restart by a wide margin: each fake docker call starts a Node process,
      // which takes over a second on a loaded host, and a command that ends before the restart lands
      // writes late.txt whatever the sandbox does. The check waits past the command's own end.
      const late = 4000;
      const started = Date.now();
      const record = await box.exec(`sleep ${late / 1000}; echo late > late.txt`, { timeoutMs: 300 });
      expect(Date.now() - started).toBeLessThan(late);
      expect(record.exitCode).toBe(TIMEOUT_EXIT_CODE);
      expect(record.stderr).toContain('timed out after 300 ms');
      expect(await fake.calls()).toContainEqual(['restart', '-t', '0', box.container]);
      expect((await fake.state(box.container)).restarts).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, late + 500 - (Date.now() - started)));
      expect(existsSync(join(box.folder, 'late.txt'))).toBe(false);
      expect((await box.exec('echo again')).stdout).toBe('again\n');
    } finally {
      await box.destroy();
    }
  }, 20_000);

  it('removes the container and the folder, keeps the folder with keep, and is safe to call twice', async () => {
    const fake = await fakeDocker('destroy');
    const provider = dockerProvider({ image: 'acme/agent:1', binary: fake.binary, dir: fake.workspaces });
    const box = (await provider.create()) as DockerSandbox;
    await box.destroy();
    await box.destroy();
    expect(existsSync(box.folder)).toBe(false);
    expect((await fake.calls()).filter((call) => call[0] === 'rm')).toEqual([['rm', '-f', box.container]]);
    await expect(box.exec('true')).rejects.toThrow(/destroyed/);

    const kept = (await provider.create({ keep: true })) as DockerSandbox;
    await kept.seed({ files: { 'a.txt': 'kept' } });
    await kept.destroy();
    expect(await readFile(join(kept.folder, 'a.txt'), 'utf8')).toBe('kept');
    expect(await fake.calls()).toContainEqual(['rm', '-f', kept.container]);
  });

  it('treats a container already gone as removed', async () => {
    const fake = await fakeDocker('gone');
    const box = (await dockerProvider({
      image: 'acme/agent:1',
      binary: fake.binary,
      dir: fake.workspaces,
    }).create()) as DockerSandbox;
    await rm(join(fake.dir, 'containers', `${box.container}.json`));
    await expect(box.destroy()).resolves.toBeUndefined();
    expect(existsSync(box.folder)).toBe(false);
  });

  it('fails a create whose container cannot start and leaves no folder behind', async () => {
    const fake = await fakeDocker('missing-image');
    const provider = dockerProvider({
      image: 'driftbench/missing-image',
      binary: fake.binary,
      dir: fake.workspaces,
    });
    await expect(provider.create()).rejects.toThrow(
      /could not start a container from driftbench\/missing-image/,
    );
    expect(await readdir(fake.workspaces)).toEqual([]);
  });
});

const IMAGE = process.env.DRIFTBENCH_DOCKER_IMAGE ?? 'node:22-alpine';
const real = dockerProvider({ image: IMAGE });
const dockerReady = (await real.available()) && imageReady(IMAGE);

/** True when the image is present or pulls. A machine that cannot pull skips, and says so. */
function imageReady(image: string): boolean {
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) return true;
  const pulled = spawnSync('docker', ['pull', image], { stdio: 'ignore', timeout: 180_000 });
  if (pulled.status !== 0) skipped(`the image ${image} cannot be pulled`);
  return pulled.status === 0;
}

if (!dockerReady) skipped('no docker binary or daemon answers on this machine');

/** Written past the test console, so every reporter prints it. */
function skipped(reason: string): void {
  process.stderr.write(`docker sandbox tests on docker skipped: ${reason}\n`);
}

describe.runIf(dockerReady)(`the docker sandbox, on docker with ${IMAGE}`, () => {
  it('runs a command in the container as the current user and diffs the mounted workspace', async () => {
    const box = await real.create();
    try {
      await box.seed({ files: { 'catalog.csv': 'plan_id\nmobile-s\n' } });
      const before = await box.snapshot();
      const record = await box.exec('pwd; id -u; cat catalog.csv | wc -l > out.txt');
      expect(record.exitCode).toBe(0);
      const [pwd, uid] = (record.stdout ?? '').trim().split('\n');
      expect(pwd).toBe('/workspace');
      if (typeof process.getuid === 'function') expect(uid).toBe(String(process.getuid()));
      expect(box.diff(before, await box.snapshot())).toEqual({
        created: ['out.txt'],
        changed: [],
        deleted: [],
      });
      expect(
        Buffer.from(await box.readFile('out.txt'))
          .toString('utf8')
          .trim(),
      ).toBe('2');
    } finally {
      await box.destroy();
    }
  });

  it('kills a command at its timeout and keeps the container usable', async () => {
    const box = await real.create();
    try {
      const record = await box.exec('sleep 30', { timeoutMs: 1000 });
      expect(record.exitCode).toBe(TIMEOUT_EXIT_CODE);
      expect((await box.exec('echo ok')).stdout).toBe('ok\n');
    } finally {
      await box.destroy();
    }
  });
});
