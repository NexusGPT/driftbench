/**
 * The bounds every sandbox applies, so a runaway agent cannot exhaust the run: command output, file
 * reads, command time and the workspace walk.
 */

/** stdout and stderr of one command are each cut at this size: 10 MB. */
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** One file read returns at most this many bytes: 100 MB. */
export const DEFAULT_MAX_READ_BYTES = 100 * 1024 * 1024;

/** A command with no timeout of its own is killed after 10 minutes. */
export const DEFAULT_EXEC_TIMEOUT_MS = 10 * 60 * 1000;

/** The exit code of a command killed at its timeout, as the coreutils `timeout` command reports it. */
export const TIMEOUT_EXIT_CODE = 124;

/** Bounds of one workspace walk (a snapshot or a file listing). Past any of them the walk stops with an error. */
export type SnapshotLimits = {
  /** The most files the walk records. */
  maxFiles: number;
  /** The deepest folder, counted in levels below the workspace root. */
  maxDepth: number;
  /** The most bytes the walk hashes, summed over every file. */
  maxBytes: number;
};

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 20_000,
  maxDepth: 32,
  maxBytes: 1024 * 1024 * 1024,
};

/** Entries the walk never enters or records, at any depth. */
export const SKIPPED_NAMES: readonly string[] = ['node_modules', '.git'];

/** A bound was passed: too many files, too deep, too many bytes, or a file too large to read. */
export class SandboxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxLimitError';
  }
}

/** A path leaves the workspace, by `..`, by an absolute path or through a symbolic link. */
export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPathError';
  }
}

export function resolveLimits(limits: Partial<SnapshotLimits> | undefined): SnapshotLimits {
  return { ...DEFAULT_SNAPSHOT_LIMITS, ...limits };
}
