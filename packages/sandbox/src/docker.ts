import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type {
  ExecOptions,
  ExecutionRecord,
  SandboxOptions,
  SandboxProvider,
} from '@agent-nexus/driftbench-core';
import { untrackFolder } from './cleanup';
import { FolderSandbox, makeWorkspaceFolder } from './folder';
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  resolveLimits,
  type SnapshotLimits,
} from './limits';
import { runProcess } from './run';

/**
 * The docker sandbox: one container per sandbox, with the workspace folder of this machine mounted at
 * /workspace. Commands run in the container through /bin/sh, so the image needs a shell. The container
 * runs as the current user, so every file the agent writes stays removable, and only the variables a
 * command is given reach it. The isolation is strong.
 */

export type DockerProviderOptions = {
  /** The image every sandbox starts from, such as node:22-alpine. A create can name another. */
  image: string;
  /** The docker command line. Default `docker`. Any binary that speaks its run, exec, restart and rm works. */
  binary?: string;
  /** The parent folder of each workspace on this machine. Default: the system temp folder. */
  dir?: string;
  /** Bounds of the workspace walk. */
  limits?: Partial<SnapshotLimits>;
  /**
   * The container's network. Default `none`: a command the agent runs reaches no host and no internet. Name
   * `bridge` when the agent's task needs the network (a package install, an API it calls).
   */
  network?: 'none' | 'bridge';
  /** Docker memory limit, in Docker units. Default `1g`; `0` removes the limit. */
  memory?: string;
  /** CPU quota in cores. Default 1; 0 removes the quota. */
  cpus?: number;
  /** Maximum container processes. Default 256; -1 removes the limit. */
  pidsLimit?: number;
  /** Linux capabilities to drop. Default ['ALL']; [] keeps Docker's default capabilities. */
  capDrop?: readonly string[];
  /** Prevent gaining privileges through exec. Default true; false omits the security option. */
  noNewPrivileges?: boolean;
};

/** Where the workspace is mounted in the container: the root the agent sees. */
export const DOCKER_WORKSPACE = '/workspace';

/** Time a docker housekeeping call (version, rm, restart) may take. */
const HOUSEKEEPING_TIMEOUT_MS = 60_000;

/** Time `docker run` may take, which includes pulling the image the first time. */
const START_TIMEOUT_MS = 5 * 60_000;

export function dockerProvider(options: DockerProviderOptions): SandboxProvider {
  const binary = options.binary ?? 'docker';
  const limits = resolveLimits(options.limits);
  return {
    kind: 'docker',
    async available() {
      try {
        const version = await docker(binary, ['version', '--format', '{{.Server.Version}}'], 15_000);
        return version.exitCode === 0 && (version.stdout ?? '').trim() !== '';
      } catch {
        return false;
      }
    },
    async create(create: SandboxOptions = {}) {
      const image = create.image ?? options.image;
      const folder = await makeWorkspaceFolder(create.dir ?? options.dir);
      const container = `driftbench-${randomUUID()}`;
      const args = ['run', '-d', '--init', '--name', container, '-v', `${folder}:${DOCKER_WORKSPACE}`];
      args.push('-w', DOCKER_WORKSPACE, '-e', 'HOME=/tmp');
      // Default-deny network: a command the agent runs reaches no host and no internet unless the provider names bridge.
      args.push('--network', options.network ?? 'none');
      args.push('--memory', options.memory ?? '1g', '--cpus', String(options.cpus ?? 1));
      args.push('--pids-limit', String(options.pidsLimit ?? 256));
      for (const capability of options.capDrop ?? ['ALL']) args.push('--cap-drop', capability);
      if (options.noNewPrivileges ?? true) args.push('--security-opt', 'no-new-privileges');
      if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
        args.push('--user', `${process.getuid()}:${process.getgid()}`);
      }
      args.push('--entrypoint', '/bin/sh', image, '-c', 'while :; do sleep 3600; done');
      const started = await docker(binary, args, START_TIMEOUT_MS).catch((error: unknown) => {
        return { exitCode: -1, stderr: String(error) } as ExecutionRecord;
      });
      if (started.exitCode !== 0) {
        await docker(binary, ['rm', '-f', container], HOUSEKEEPING_TIMEOUT_MS).catch(() => undefined);
        await rm(folder, { recursive: true, force: true });
        untrackFolder(folder);
        throw new Error(`docker could not start a container from ${image}: ${(started.stderr ?? '').trim()}`);
      }
      return new DockerSandbox(folder, limits, create.keep ?? false, binary, container);
    },
  };
}

export class DockerSandbox extends FolderSandbox {
  readonly kind = 'docker' as const;
  readonly isolation = 'strong' as const;
  readonly root = DOCKER_WORKSPACE;
  private containerRemoved = false;
  private destroyed = false;

  constructor(
    folder: string,
    limits: SnapshotLimits,
    keep: boolean,
    private readonly binary: string,
    /** The container name. */
    readonly container: string,
  ) {
    super(folder, limits, keep);
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecutionRecord> {
    if (this.destroyed) throw new Error('the sandbox is destroyed');
    const rel = await this.workingFolder(options.cwd);
    const args = ['exec', '-i', '-w', rel === '.' ? DOCKER_WORKSPACE : posix.join(DOCKER_WORKSPACE, rel)];
    const entries = Object.entries(options.env ?? {});
    for (const [name, value] of entries) {
      if (name === '' || name.startsWith('#') || /[=\s\0]/u.test(name))
        throw new Error(`the variable name ${JSON.stringify(name)} is invalid`);
      if (/[\r\n]/.test(value))
        throw new Error(
          `the variable ${JSON.stringify(name)} contains a line break; Docker env files require single-line values`,
        );
      if (value.includes('\0'))
        throw new Error(`the variable ${JSON.stringify(name)} contains a NUL character`);
    }
    let envDir: string | undefined;
    try {
      if (entries.length > 0) {
        // Keep credentials outside the mounted workspace. Docker reads literal KEY=value lines:
        // quotes, spaces, equals signs and hashes in values must not be escaped.
        envDir = await mkdtemp(join(tmpdir(), 'driftbench-docker-env-'));
        const envFile = join(envDir, 'env');
        await writeFile(envFile, entries.map(([name, value]) => `${name}=${value}\n`).join(''), {
          mode: 0o600,
          flag: 'wx',
        });
        args.push('--env-file', envFile);
      }
      args.push(this.container, '/bin/sh', '-c', command);
      return await runProcess(this.binary, args, command, {
        // Container variables must never configure the Docker client itself.
        env: process.env,
        stdin: options.stdin,
        timeoutMs: options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
        maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        // Killing the docker client leaves the command running in the container; a restart ends every
        // process there and keeps the workspace, which lives on this machine.
        onTimeout: () => this.restart(),
      });
    } finally {
      if (envDir !== undefined) await rm(envDir, { recursive: true, force: true });
    }
  }

  /** Removes the container, then the folder unless the sandbox keeps it. A second call does nothing. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    if (!this.containerRemoved) {
      const removed = await docker(this.binary, ['rm', '-f', this.container], HOUSEKEEPING_TIMEOUT_MS);
      if (removed.exitCode !== 0 && !/no such container/i.test(removed.stderr ?? '')) {
        throw new Error(
          `docker could not remove container ${this.container}: ${(removed.stderr ?? '').trim()}`,
        );
      }
      this.containerRemoved = true;
    }
    await this.removeFolder();
    this.destroyed = true;
  }

  private async restart(): Promise<void> {
    const restarted = await docker(
      this.binary,
      ['restart', '-t', '0', this.container],
      HOUSEKEEPING_TIMEOUT_MS,
    );
    if (restarted.exitCode !== 0) {
      throw new Error(
        `docker could not restart container ${this.container}: ${(restarted.stderr ?? '').trim()}`,
      );
    }
  }
}

function docker(binary: string, args: string[], timeoutMs: number): Promise<ExecutionRecord> {
  return runProcess(binary, args, `${binary} ${args[0] ?? ''}`, {
    env: process.env,
    timeoutMs,
    maxOutputBytes: 1024 * 1024,
  });
}
