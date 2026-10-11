import type { WorldState } from '../schema/common';
import type { ExecutionRecord, WorkspaceDiff } from '../schema/run';

/**
 * The sandbox contract. A sandbox is a workspace a code agent works in for one run: seeded from the
 * Given, snapshotted before and after, read with bounds, destroyed in a finally block.
 */

export type SandboxKind = 'docker' | 'local';

/** The files of a workspace and their hashes at one moment. */
export type WorkspaceSnapshot = {
  takenAt: string;
  files: Record<string, { sha256: string; bytes: number }>;
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** stdout and stderr are cut at this size and the record says so. */
  maxOutputBytes?: number;
  stdin?: string;
};

export interface Sandbox {
  readonly kind: SandboxKind;
  /** The workspace path as the agent sees it. */
  readonly root: string;
  /** docker is strong; a local folder is weak and every report says so. */
  readonly isolation: 'strong' | 'weak';
  seed(workspace: NonNullable<WorldState['workspace']>): Promise<void>;
  snapshot(): Promise<WorkspaceSnapshot>;
  diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff;
  exec(command: string, options?: ExecOptions): Promise<ExecutionRecord>;
  listFiles(): Promise<string[]>;
  readFile(path: string, maxBytes?: number): Promise<Uint8Array>;
  /** Removes the sandbox unless it was created with keep. Safe to call twice. */
  destroy(): Promise<void>;
}

export type SandboxOptions = {
  /** Keep the sandbox on disk after the run, for inspection. */
  keep?: boolean;
  /** The docker image for a docker sandbox. */
  image?: string;
  /** The parent folder for a local sandbox. */
  dir?: string;
};

export interface SandboxProvider {
  readonly kind: SandboxKind;
  /** True when this provider can run here (docker reachable, a writable temp folder). */
  available(): Promise<boolean>;
  create(options?: SandboxOptions): Promise<Sandbox>;
}
