import type { ArtifactCheck, ArtifactExpect } from '../schema/spec';

/**
 * The artifact reader contract. A reader opens one kind of produced file and answers the checks a
 * spec declares on it (`expect.artifacts[].checks`). The artifact check in the checks package only
 * delegates: the reader knows the format, the check knows the verdict shape.
 */

export type ArtifactKind = NonNullable<ArtifactExpect['kind']>;

export type ArtifactCheckResult = {
  /** The check as the spec wrote it, for the evidence line. */
  check: ArtifactCheck;
  ok: boolean;
  /** What was found: the sheet names, the cell values, the missing heading. */
  evidence: string;
};

export interface ArtifactDocument {
  readonly kind: ArtifactKind;
  readonly path: string;
  /** The rendered text of the document, what a judge reads instead of the agent's own description. */
  text(): string;
  /** Answers one declared check. An unknown check name is a failed result that names it. */
  check(check: ArtifactCheck): ArtifactCheckResult;
}

export interface ArtifactReader {
  readonly kind: ArtifactKind;
  open(bytes: Uint8Array, path: string): Promise<ArtifactDocument>;
}

export interface ArtifactReaderRegistry {
  get(kind: ArtifactKind): ArtifactReader | undefined;
  /** Picks the reader from the file extension when the spec names no kind. */
  forPath(path: string): ArtifactReader | undefined;
}
