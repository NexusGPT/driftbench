import { randomUUID } from 'node:crypto';
import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  copyHistory,
  type Message,
  Observed,
  type Session,
  type WorldState,
} from '@agent-nexus/driftbench-core';

/**
 * A team's own adapter, written against the `AgentAdapter` contract: the agent sits behind a "service" the
 * adapter calls once per block. Here the service is a function; in a real adapter it is the team's
 * transport (a queue, gRPC, a websocket). The adapter adds nothing to the turn the service returns.
 */
export type QueueService = {
  /** Starts a conversation and returns what the service keeps for it. */
  start(): unknown;
  /** Answers one block: the messages so far, the block's world, the conversation's state. */
  ask(messages: Message[], world: WorldState, state: unknown): Promise<Observed> | Observed;
  /** Whether the service can be reached. */
  up: boolean;
};

type QueueState = { readonly kind: 'queue'; conversation: unknown; closed: boolean };

export function queueAdapter(service: QueueService): AgentAdapter {
  const id = 'queue';
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    toolStubs: true,
    trace: false,
    sandbox: false,
    endState: false,
    deterministic: true,
  };
  const own = (session: Session): QueueState => {
    const state = session.state as QueueState | undefined;
    if (session.adapter !== id || state?.kind !== 'queue') {
      throw new Error(`session ${session.id} was not opened by the queue adapter`);
    }
    if (state.closed) throw new Error(`session ${session.id} is closed`);
    return state;
  };
  return {
    id,
    version: '1.0.0',
    capabilities: () => ({ ...capabilities }),
    async open(given) {
      if (!service.up) throw new AdapterTransportError('the queue service refused the connection');
      const state: QueueState = { kind: 'queue', conversation: service.start(), closed: false };
      return {
        id: randomUUID(),
        adapter: id,
        target: given.target,
        given,
        history: copyHistory(given.prefix),
        state,
      };
    },
    async send(session, turn) {
      const state = own(session);
      if (!service.up) throw new AdapterTransportError('the queue service went away');
      // Validate and copy the history once: a sparse array or an accessor is refused before the service runs.
      const history = copyHistory(session.history);
      const answer = await service.ask(
        structuredClone(history),
        structuredClone(turn.given.world),
        state.conversation,
      );
      return Observed.parse(answer);
    },
    async close(session) {
      const state = session.state as QueueState;
      state.closed = true;
      state.conversation = undefined;
    },
  };
}
