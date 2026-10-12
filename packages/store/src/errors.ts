/** Why the store refused a call. Each code names one cause, so callers can branch without reading messages. */
export type StoreErrorCode =
  /** This Node.js has no `node:sqlite`; the store needs Node.js 22.13 or newer. */
  | 'NODE_VERSION'
  /** The database file could not be opened or set up. */
  | 'OPEN_FAILED'
  /** The database or a bundle was written by a newer schema than this version reads. */
  | 'SCHEMA_VERSION'
  /** A call passed a record that does not match its schema; nothing was written. */
  | 'INVALID_RECORD'
  /** A stored row holds JSON that does not parse, does not match its schema, or does not match its key. */
  | 'CORRUPT_ROW'
  /** A campaign id already holds a different campaign. Campaigns are immutable. */
  | 'CAMPAIGN_CONFLICT'
  /** The campaign a call names is not in the store. */
  | 'CAMPAIGN_MISSING'
  /** A registry version number already holds other content in this store. Versions are immutable. */
  | 'VERSION_CONFLICT'
  /** A run id is held by more than one campaign and the call did not say which. */
  | 'RUN_AMBIGUOUS'
  /** An exported bundle is incomplete or inconsistent. */
  | 'BUNDLE_INVALID'
  /** The store was closed. */
  | 'CLOSED';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(`store: ${message}`, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** A zod issue list as one line: `path: message; path: message`, at most five issues. */
export function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const shown = issues.slice(0, 5).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  const more = issues.length > 5 ? `; and ${issues.length - 5} more` : '';
  return `${shown.join('; ')}${more}`;
}

/** The message of a thrown value, on one line. */
export function describeCause(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split('\n')[0]?.trim() ?? '';
}
