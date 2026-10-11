import type * as Sqlite from 'node:sqlite';
import { StoreError } from './errors';

/** The oldest Node.js that ships `node:sqlite` without a flag. */
export const MIN_NODE_VERSION = '22.13.0';

/**
 * Throws a clear error when the running Node.js is older than 22.13, the first release on the
 * 22 line where `node:sqlite` needs no flag. The version is a parameter so the check can be tested.
 */
export function assertNodeVersion(version: string = process.versions.node): void {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (major > 22 || (major === 22 && minor >= 13)) return;
  throw new StoreError(
    'NODE_VERSION',
    `the store needs Node.js ${MIN_NODE_VERSION} or newer for node:sqlite; this is Node.js ${version}`,
  );
}

/**
 * Loads `node:sqlite` at call time, never at import time, so an older Node.js gets the clear error
 * above and not a failed import of the whole package.
 */
export function loadSqlite(): typeof Sqlite {
  assertNodeVersion();
  let sqlite: typeof Sqlite | undefined;
  try {
    sqlite =
      typeof process.getBuiltinModule === 'function'
        ? (process.getBuiltinModule('node:sqlite') as typeof Sqlite | undefined)
        : undefined;
  } catch (cause) {
    throw unavailable(cause);
  }
  if (sqlite === undefined) throw unavailable();
  return sqlite;
}

function unavailable(cause?: unknown): StoreError {
  return new StoreError(
    'NODE_VERSION',
    `node:sqlite is not available in Node.js ${process.versions.node}; the store needs Node.js ${MIN_NODE_VERSION} or newer`,
    cause === undefined ? undefined : { cause },
  );
}
