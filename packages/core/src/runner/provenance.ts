import { createHash } from 'node:crypto';
import type { CheckContext } from '../contracts/check';
import type { RunResult } from '../schema/run';
import { contentHash } from '../spec/hash';
import type { RunOptions } from './run';

/** Hash bytes only when a check already reads them. No new file content is stored or additional read made. */
export function captureArtifacts(ctx: Pick<CheckContext, 'observed' | 'readArtifact'>) {
  const artifacts = (ctx.observed.artifacts ?? []).map((file) => ({
    path: file.path,
    sha256: file.sha256 ?? null,
  }));
  const read = ctx.readArtifact;
  return {
    artifacts,
    readArtifact:
      read === undefined
        ? undefined
        : async (path: string) => {
            try {
              const bytes = await read(path);
              artifacts.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
              return bytes;
            } catch (error) {
              artifacts.push({ path, sha256: null });
              throw error;
            }
          },
  };
}

/** Unknown seeds remain null. A driver must explicitly declare {} when it uses no randomness. */
export function runProvenance(options: RunOptions): NonNullable<RunResult['provenance']> {
  const driver = { id: options.driver.id, seeds: options.driver.seeds ?? null };
  const adapter = { id: options.adapter.id, version: options.adapter.version };
  return {
    driver,
    adapter,
    executionHash: contentHash({
      driver,
      adapter,
      target: options.target,
      mode: options.mode,
      repeat: options.repeat,
      perturbationId: options.perturbationId,
      toolPolicy: options.toolPolicy,
      retry: options.retry,
      maxSteps: options.maxSteps,
    }),
  };
}
