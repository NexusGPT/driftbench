import { type BlockResult, provenanceHash, type Spec } from '@agent-nexus/driftbench-core';
import { SimulatedUserError } from '../simulated';

/**
 * Freezing a found failure: a simulated run's messages become fixed user turns. Each simulated block of the
 * spec that ran becomes a `replay` block whose user text is the message the run sent, with its hash; the
 * blocks the run did not reach are dropped, since the conversation that reached them is not this one. The
 * frozen spec runs with the scripted driver and gives the same messages on every run.
 *
 * The run must have stored the text (`recordRealizedText`): a run that kept only the hash cannot be frozen.
 */
export function freezeSimulatedRun(spec: Spec, blocks: readonly BlockResult[], from?: string): Spec {
  const ran = blocks.filter((block) => block.injected !== true);
  const out = ran.map((result, position) => {
    const index = result.specIndex ?? specIndexOf(spec, result, position);
    const block = spec.blocks[index];
    if (!block) throw new SimulatedUserError(`${spec.id}: the run holds a block ${index} the spec does not`);
    const when = block.when;
    if (!('user' in when) || when.simulated_user?.mode !== 'simulated') return block;
    let text: string;
    if (result.realized === undefined) text = when.user;
    else if (result.realized.text === undefined) {
      throw new SimulatedUserError(
        `${spec.id}: block ${index} kept only the hash of its message: rerun with the realized text recorded to freeze it`,
      );
    } else {
      text = result.realized.text;
      if (provenanceHash(text) !== result.realized.hash) {
        throw new SimulatedUserError(`${spec.id}: block ${index} holds a text that does not match its hash`);
      }
    }
    return {
      ...block,
      when: {
        user: text,
        simulated_user: {
          ...when.simulated_user,
          mode: 'replay' as const,
          recorded: { hash: provenanceHash(text), ...(from === undefined ? {} : { from }) },
        },
      },
    };
  });
  if (out.length === 0) throw new SimulatedUserError(`${spec.id}: the run holds no block to freeze`);
  const { end: _end, ...rest } = spec;
  return { ...rest, id: `${spec.id}-replay`, blocks: out };
}

function specIndexOf(spec: Spec, result: BlockResult, position: number): number {
  if (result.blockId !== undefined) {
    const found = spec.blocks.findIndex((block) => block.id === result.blockId);
    if (found >= 0) return found;
  }
  return position;
}
