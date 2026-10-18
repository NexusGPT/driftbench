// The proof a team runs on its own adapter: the same suite every built-in adapter passes.
//   pnpm vitest run examples/adapter-contract
import { adapterContract, createAcmeAgent, createStore } from '@agent-nexus/driftbench-adapters/contract';
import type { Session } from '@agent-nexus/driftbench-core';
import { queueAdapter } from '../src/queue-adapter';

type Conversation = { agent: ReturnType<typeof createAcmeAgent> };

/** The adapter under test, reaching the suite's reference agent through the team's transport. */
function adapter(up = true) {
  return queueAdapter({
    up,
    start: (): Conversation => ({ agent: createAcmeAgent(createStore()) }),
    ask: (messages, world, state) => (state as Conversation).agent.respond(messages, world),
  });
}

adapterContract('queue', () => adapter(), {
  brokenTransport: () => adapter(false),
  released: (session: Session) => {
    const state = session.state as { closed: boolean; conversation: unknown };
    return state.closed && state.conversation === undefined;
  },
});
