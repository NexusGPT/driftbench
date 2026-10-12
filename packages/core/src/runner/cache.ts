import { createHash } from 'node:crypto';
import type { Store } from '../contracts/store';
import type { TargetRef } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { Stimulus } from '../schema/spec';
import { canonicalJson, canonicalJsonWithList } from '../spec/hash';
import { isPlainObject } from '../spec/normalize';

/** Where the runner keeps observed blocks. A Store is one; tests pass a map. */
export type ObservedCache = Pick<Store, 'cacheGet' | 'cachePut'>;

export type BlockKeyParts = {
  specHash: string;
  /** Repeats are independent samples: without the repeat, repeat 2 would replay repeat 1. */
  repeat: number;
  /** The position of the block in the run. */
  position: number;
  /** The whole resolved Given, the history so far included, not only its short hash. */
  given: ResolvedGiven;
  stimulus: Stimulus;
  target: TargetRef;
  adapter: string;
  adapterVersion: string;
};

/**
 * The cache key of one block: the spec hash, the repeat, the block's position, its resolved Given, its
 * stimulus, the target and the adapter version, hashed whole (SHA-256 of the canonical JSON).
 */
export function blockCacheKey(parts: BlockKeyParts): string {
  // The text is the one `canonicalJson(parts)` gives; the Given, the one part that grows with the run, is
  // written by `canonicalJsonWithList`, which reads each message of its prefix once.
  const marked = canonicalJson({ ...parts, given: GIVEN_MARK });
  const text = marked.replace(JSON.stringify(GIVEN_MARK), () =>
    canonicalJsonWithList({ ...parts.given }, 'prefix'),
  );
  return `block:${sha256(text)}`;
}

const GIVEN_MARK = '\u0000given\u0000';

/** The cache key of one end-state read, taken after the block whose key is given. */
export function endStateCacheKey(blockKey: string, source: string): string {
  return `end_state:${sha256(canonicalJson({ blockKey, source }))}`;
}

/** The cache holds Observed records only, so an end-state read travels in `raw`. */
export function wrapEndState(value: unknown): Observed {
  return { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, raw: { endState: value } };
}

export function unwrapEndState(observed: Observed): unknown {
  return isPlainObject(observed.raw) ? observed.raw.endState : undefined;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
