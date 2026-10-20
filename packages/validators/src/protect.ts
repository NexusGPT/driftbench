import { execFileSync } from 'node:child_process';

/** Branches executors push from start with this prefix. */
export const EXECUTOR_BRANCH_PREFIX = 'exec/';

/**
 * The files an executor branch may not change: the validator code (its ladders and banks, thresholds, the
 * hidden seed derivation, the bank, hardness and floor logic, and the frame that scores them), the bank
 * fixtures and the validator's own tests, the floors, the executor instruction, the fault family, the
 * statistics reference fixtures, the benchmark frame and its CLI, and the jobs that enforce all of this.
 * A path ending in "/" covers its folder; a trailing "*" covers a filename prefix.
 */
export const PROTECTED_PATHS = [
  'packages/validators/src/',
  'packages/validators/fixtures/',
  'packages/validators/test/',
  'validators/floors.json',
  'validators/EXECUTOR.md',
  'examples/acme/faults/',
  'packages/stats/test/reference/',
  '.github/workflows/validators.yml',
  'benchmarks/',
  'tools/bench-lint*',
  'packages/cli/src/commands/bench*',
  '.github/workflows/ci.yml',
  'tools/ci/',
  '.github/workflows/bench-record.yml',
] as const;

/** The protected files a branch changes; always empty for a branch that is not an executor branch. */
export function protectedChanges(branch: string, files: readonly string[]): string[] {
  if (!branch.startsWith(EXECUTOR_BRANCH_PREFIX)) return [];
  return files.filter((file) =>
    PROTECTED_PATHS.some((path) =>
      path.endsWith('*')
        ? file.startsWith(path.slice(0, -1))
        : path.endsWith('/')
          ? file.startsWith(path)
          : file === path,
    ),
  );
}

/** Lists the files changed between a base and HEAD (`git diff --name-only base...HEAD`). Throws on a git error. */
export type DiffReader = (root: string, base: string) => string[];

export const gitChangedFiles: DiffReader = (root, base) =>
  execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
