import type { Session } from '@driftbench/core';
import { openaiAgentsAdapter } from '../src/openai-agents/index';
import { adapterContract } from './contract';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { acmeAgent, deadRunner, fakeRunner } from './fixtures/sdk/openai-agents';

function acme() {
  return openaiAgentsAdapter({
    runner: fakeRunner(),
    agent: () => acmeAgent(),
    sideEffects: ACME_SIDE_EFFECTS,
    deterministic: true,
  });
}

adapterContract('openai-agents', acme, {
  brokenTransport: () => openaiAgentsAdapter({ runner: deadRunner(), agent: acmeAgent() }),
  released: (session: Session) => {
    const state = session.state as { closed?: boolean; agent?: unknown };
    return state.closed === true && state.agent === undefined;
  },
});
