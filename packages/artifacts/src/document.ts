import type {
  ArtifactCheck,
  ArtifactCheckResult,
  ArtifactDocument,
  ArtifactKind,
  ArtifactReader,
} from '@agent-nexus/driftbench-core';
import { CheckArgumentError, isRecord, Missing } from './args';

/** What one check found. */
export type Outcome = { ok: boolean; evidence: string };

/** Passes when no problem was found; otherwise the first problems join the evidence. */
export function outcome(evidence: string, problems: readonly string[]): Outcome {
  if (problems.length === 0) return { ok: true, evidence };
  const more = problems.length > 4 ? `; and ${problems.length - 4} more` : '';
  return { ok: false, evidence: `${evidence}; ${problems.slice(0, 4).join('; ')}${more}` };
}

/** A check that reads the rendered text, the same text a judge reads. */
export type TextCheck = {
  readonly reads: 'text';
  /** How the check is written, shown when its argument is wrong. */
  readonly usage: string;
  run(arg: unknown, text: string): Outcome;
};

/** A check that reads the structure the reader parsed: sheets, headings, slides, rows, keys. */
export type StructureCheck<D> = {
  readonly reads: 'structure';
  readonly usage: string;
  run(arg: unknown, data: D, text: string): Outcome;
};

export type CheckTable<D> = Readonly<Record<string, TextCheck | StructureCheck<D>>>;

/** A reader that also lists the check names its documents answer, in the order the docs give them. */
export interface KindReader extends ArtifactReader {
  readonly checkNames: readonly string[];
}

/**
 * Why a file could not be read. `text` stops every check, `structure` only the checks that read the
 * structure: a CSV or JSON file that does not parse still has a text to search.
 */
export type ReadProblem = { text?: string; structure?: string };

export class ReaderDocument<D> implements ArtifactDocument {
  constructor(
    readonly kind: ArtifactKind,
    readonly path: string,
    private readonly rendered: string,
    private readonly checks: CheckTable<D>,
    private readonly data: D | undefined,
    private readonly problem: ReadProblem = {},
  ) {}

  text(): string {
    return this.rendered;
  }

  check(check: ArtifactCheck): ArtifactCheckResult {
    const fail = (evidence: string): ArtifactCheckResult => ({ check, ok: false, evidence });
    if (!isRecord(check))
      return fail('a check is a mapping whose key names it, such as { contains: "text" }');
    const names = Object.keys(check);
    const [name] = names;
    if (name === undefined) return fail('the check is empty: name one check, such as { contains: "text" }');
    if (names.length > 1) return fail(`a check names one check; this one names ${names.join(', ')}`);
    const entry = Object.hasOwn(this.checks, name) ? this.checks[name] : undefined;
    if (!entry) {
      return fail(
        `unknown check "${name}" for ${this.kind}; the ${this.kind} checks are ${Object.keys(this.checks).join(', ')}`,
      );
    }
    const problem =
      entry.reads === 'text' ? this.problem.text : (this.problem.text ?? this.problem.structure);
    if (problem !== undefined) return fail(problem);
    try {
      const found =
        entry.reads === 'text'
          ? entry.run(check[name], this.rendered)
          : entry.run(check[name], this.data as D, this.rendered);
      return { check, ...found };
    } catch (cause) {
      if (cause instanceof Missing) return fail(cause.message);
      if (cause instanceof CheckArgumentError) return fail(`${name} ${cause.message}; write ${entry.usage}`);
      return fail(`${name} could not run: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/** The message of an error thrown while a file was opened, for the evidence. */
export function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A document for a file the reader could not open: every check fails and names why. */
export function unreadable<D>(
  kind: ArtifactKind,
  path: string,
  checks: CheckTable<D>,
  cause: unknown,
): ReaderDocument<D> {
  const why = `${path} could not be read as ${kind}: ${describeFailure(cause)}`;
  return new ReaderDocument<D>(kind, path, `[${why}]`, checks, undefined, { text: why });
}

/** Copies bytes into a fresh buffer, so a parser that transfers or keeps it never touches the caller's. */
export function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
