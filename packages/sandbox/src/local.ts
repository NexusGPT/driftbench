import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ExecOptions,
  ExecutionRecord,
  SandboxOptions,
  SandboxProvider,
} from '@agent-nexus/driftbench-core';
import { FolderSandbox, makeWorkspaceFolder } from './folder';
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  resolveLimits,
  type SnapshotLimits,
} from './limits';
import { runProcess } from './run';

/**
 * The local sandbox: a fresh temporary folder on this machine. Commands run in it through /bin/sh as
 * the current user, so the isolation is weak: the folder bounds what the run records, not what the agent
 * can reach. Every report says so.
 */

export type LocalProviderOptions = {
  /** The parent folder of each sandbox. Default: the system temp folder. */
  dir?: string;
  /** Bounds of the workspace walk. */
  limits?: Partial<SnapshotLimits>;
};

/**
 * Host variables a command receives. Nothing else passes through, so a secret in the evaluator's
 * environment never reaches the agent; give the agent what it needs in `env`.
 */
const PASSED_VARIABLES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
];

export function localProvider(options: LocalProviderOptions = {}): SandboxProvider {
  const limits = resolveLimits(options.limits);
  return {
    kind: 'local',
    async available() {
      try {
        const folder = await makeWorkspaceFolder(options.dir);
        await rm(folder, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
    async create(create: SandboxOptions = {}) {
      const folder = await makeWorkspaceFolder(create.dir ?? options.dir);
      return new LocalSandbox(folder, limits, create.keep ?? false);
    },
  };
}

export class LocalSandbox extends FolderSandbox {
  readonly kind = 'local' as const;
  readonly isolation = 'weak' as const;
  readonly root: string;
  private destroyed = false;

  constructor(folder: string, limits: SnapshotLimits, keep: boolean) {
    super(folder, limits, keep);
    this.root = folder;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecutionRecord> {
    if (this.destroyed) throw new Error('the sandbox is destroyed');
    const cwd = join(this.folder, await this.workingFolder(options.cwd));
    return runProcess('/bin/sh', ['-c', command], command, {
      cwd,
      env: { ...hostEnvironment(), ...options.env },
      stdin: options.stdin,
      timeoutMs: options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    });
  }

  /** Removes the folder unless the sandbox keeps it. A second call does nothing. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    await this.removeFolder();
    this.destroyed = true;
  }
}

function hostEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
