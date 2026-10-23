/**
 * The outcome of one static check (a lint rule, an invariant, a scan summary) with what it covered. A check over
 * zero inputs, or one whose requirement the run lacks, did not run: it is `not-run`, never a pass. Its coverage
 * names what it read, what it left out and why, and the files under the estate root no part type covers: a check
 * cannot have looked at those, so a run with any is never called clean.
 */

/** What a check may need from the run before it can say anything. */
export type CheckCapability = 'model-map' | 'settings' | 'guards' | 'execution';

export const CHECK_CAPABILITIES: readonly CheckCapability[] = [
  'model-map',
  'settings',
  'guards',
  'execution',
];

/** One input a check left out, and the code of why. */
export type SkippedInput = { what: string; reason: string };

export type CheckCoverage = {
  /** How many inputs the check read. */
  read: number;
  skipped: SkippedInput[];
  /** Files under the estate root no part type covers, root-relative: inputs the check could not see. */
  unknown: string[];
  /** The requirements the run lacked. */
  missing: CheckCapability[];
};

export type CheckStatus = 'pass' | 'fail' | 'not-run';

/** Why a check did not run, as a code a reader branches on. */
export type NotRunReason = 'missing-capability' | 'no-input';

export type CheckOutcome<F = unknown> = {
  check: string;
  status: CheckStatus;
  coverage: CheckCoverage;
  /** What the check declared it requires of the run. */
  requires: CheckCapability[];
  findings: F[];
  /** Set exactly when the status is `not-run`. */
  notRun?: NotRunReason;
};

/** A check and the capabilities it requires. */
export type CheckDeclaration = { id: string; requires: readonly CheckCapability[] };

/** What a check body returns: the inputs it read, the ones it skipped, the unknown files, and its findings. */
export type CheckRun<F> = {
  read: number;
  skipped?: SkippedInput[];
  unknown?: readonly string[];
  findings: F[];
};

/**
 * Runs a check when the run has what it requires. A requirement absent gives `not-run` without calling the
 * body; a body that read no input gives `not-run` too; else a finding fails it and none passes it.
 */
export function runCheck<F>(
  declaration: CheckDeclaration,
  available: ReadonlySet<CheckCapability>,
  body: () => CheckRun<F>,
): CheckOutcome<F> {
  const requires = [...declaration.requires];
  const missing = requires.filter((capability) => !available.has(capability));
  if (missing.length > 0)
    return {
      check: declaration.id,
      status: 'not-run',
      coverage: { read: 0, skipped: [], unknown: [], missing },
      requires,
      findings: [],
      notRun: 'missing-capability',
    };
  return checkOutcome(declaration.id, body(), requires);
}

/** The outcome of a check that already ran, from what it read and found, with what it declared it requires. */
export function checkOutcome<F>(
  check: string,
  run: CheckRun<F>,
  requires: readonly CheckCapability[] = [],
): CheckOutcome<F> {
  const coverage: CheckCoverage = {
    read: run.read,
    skipped: run.skipped ?? [],
    unknown: [...(run.unknown ?? [])],
    missing: [],
  };
  const declared = [...requires];
  if (run.findings.length > 0)
    return { check, status: 'fail', coverage, requires: declared, findings: run.findings };
  if (run.read === 0)
    return { check, status: 'not-run', coverage, requires: declared, findings: [], notRun: 'no-input' };
  return { check, status: 'pass', coverage, requires: declared, findings: [] };
}

/** True when no check of the list ran: every one is `not-run`. An empty list ran nothing either. */
export function noneRan(outcomes: readonly CheckOutcome[]): boolean {
  return outcomes.every((outcome) => outcome.status === 'not-run');
}
