import { execFileSync } from 'node:child_process';

/** Branches executors push from start with this prefix. */
export const EXECUTOR_BRANCH_PREFIX = 'exec/';

/**
 * The files an executor branch may not change: the validator code (its ladders and banks, thresholds, the
 * hidden seed derivation, the bank, hardness and floor logic, and the frame that scores them), the bank
 * fixtures and the validator's own tests, the floors, the executor instruction, the fault family, the
 * statistics reference fixtures, the benchmark frame and its CLI, and the jobs that enforce all of this.
 * A path ending in "/" covers its folder; a trailing "*" covers a filename prefix; a star between two
 * slashes stands for one folder name, so the catch.json of every validator folder is covered.
 */
export const PROTECTED_PATHS = [
  'packages/validators/src/',
  'packages/validators/fixtures/',
  'packages/validators/test/',
  'validators/floors.json',
  'validators/EXECUTOR.md',
  'validators/*/catch.json',
  'examples/acme/faults/',
  'packages/stats/test/reference/',
  '.github/workflows/validators.yml',
  'benchmarks/',
  'tools/bench-lint*',
  'packages/cli/src/commands/bench*',
  '.github/workflows/ci.yml',
  '.github/workflows/bench-record.yml',
] as const;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The protected files a branch changes; always empty for a branch that is not an executor branch. */
export function protectedChanges(branch: string, files: readonly string[]): string[] {
  if (!branch.startsWith(EXECUTOR_BRANCH_PREFIX)) return [];
  return files.filter((file) =>
    PROTECTED_PATHS.some((path) =>
      path.includes('/*/')
        ? new RegExp(`^${path.split('/*/').map(escapeRegex).join('/[^/]+/')}$`).test(file)
        : path.endsWith('*')
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
