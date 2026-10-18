import { fileURLToPath } from 'node:url';
import { extractMap, type Recording } from '@agent-nexus/driftbench-generate';
import { oracleRecording } from '../../src/ladders/map/oracle';
import type { Rendered } from '../../src/ladders/map/render';
import type { Answerer, Extract } from '../../src/ladders/map/run';
import type { HiddenSpec } from '../../src/ladders/map/spec';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

// biome-ignore lint/suspicious/noExplicitAny: a recorded answer is JSON; the planted faults edit it as data
type Json = any;

/** The perfect model's answers, edited by `edit` before the extractor reads them: a planted model fault. */
export function editedAnswers(edit: (answers: Json, spec: HiddenSpec, rendered: Rendered) => void): Answerer {
  return (spec, rendered) => {
    const recording = structuredClone(oracleRecording(spec, rendered)) as Recording;
    edit(recording.answers, spec, rendered);
    return recording;
  };
}

/** The real extractor, its proposal edited by `edit` afterwards: a planted pipeline fault. */
export function editedExtract(edit: (proposal: Json, input: Parameters<Extract>[0]) => void): Extract {
  return async (input) => {
    const result = await extractMap(input);
    if (result.ok) edit(result.proposal, input);
    return result;
  };
}

/**
 * The real extractor with roles that do not depend on the order dimensions arrive in: a tool-schema dimension
 * is a detail, and the axis of each kind is its first other dimension by id. It stands in for a fixed role
 * proposer, so the tests can reach the levels above the first failing one of the current code.
 */
export const orderFreeRoles: Extract = editedExtract((proposal) => {
  const dimensions = proposal.dimensions as Array<{
    id: string;
    kind: string;
    role: string;
    produced_by: string;
  }>;
  const own = (dimension: { id: string }) => !dimension.id.includes('.');
  for (const dimension of dimensions) {
    if (!own(dimension)) continue;
    const first = dimensions
      .filter((peer) => peer.kind === dimension.kind && own(peer))
      .map((peer) => peer.id)
      .sort()[0];
    dimension.role = first === dimension.id ? 'axis' : 'detail';
  }
});
