import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type {
  AgentAdapter,
  DriverContext,
  DriverStep,
  Message,
  Spec,
  TargetRef,
  UserDriver,
} from '@agent-nexus/driftbench-core';
import type { Behaviour } from './plant';

/**
 * The scripted agent of the plant, behind the real function adapter, and the driver that injects a planted
 * perturbation. The agent is a lookup from the stimulus text to the planted behaviour: it holds no model and
 * no state of its own beyond what a behaviour keeps.
 */

/** The text of the last user turn: the user messages after the last assistant message, joined. */
export function lastUserText(messages: readonly Message[]): string {
  const texts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') break;
    texts.unshift(message.content);
  }
  return texts.join('\n');
}

/** The planted agent: each stimulus text answered by its behaviour, as the run's target. */
export function plantedAdapter(behaviours: ReadonlyMap<string, Behaviour>, version: string): AgentAdapter {
  return functionAdapter<{ target: TargetRef }>({
    create: (given) => ({ target: given.target }),
    respond: (messages, _world, _vars, state) => {
      const text = lastUserText(messages);
      const behave = behaviours.get(text);
      if (!behave) throw new Error(`the planted agent has no behaviour for the message "${text}"`);
      return behave(state.target);
    },
    deterministic: true,
    version,
  });
}

/**
 * A driver for mode P: plays the spec's blocks in order and injects the spec's perturbation as its own block
 * before block `inject_at`. The runner's driver contract is the interface; the validator keeps this small
 * driver so level 5 measures the recovery record, not a driver.
 */
export function plantedPerturbingDriver(spec: Spec, perturbationId: string | undefined): UserDriver {
  const perturbation = spec.perturbations?.find((entry) => entry.id === perturbationId);
  return {
    id: 'planted-perturbing',
    next(ctx: DriverContext): DriverStep {
      const injected = ctx.history.some((block) => block.injected === true);
      if (perturbation && !injected && ctx.blockIndex === perturbation.inject_at) {
        return {
          kind: 'injected',
          perturbationId: perturbation.id,
          stimulus: { user: perturbation.user ?? '' },
          beforeBlock: perturbation.inject_at,
        };
      }
      const block = ctx.spec.blocks[ctx.blockIndex];
      if (!block)
        return { kind: 'stop', reason: `the script ends after block ${ctx.spec.blocks.length - 1}` };
      return { kind: 'block', blockIndex: ctx.blockIndex, stimulus: block.when };
    },
  };
}
