import type { Session } from '@driftbench/core';
import { langgraphAdapter } from '../src/langgraph/index';
import { adapterContract } from './contract';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { deadGraph, type FakeGraph, fakeGraph } from './fixtures/sdk/langgraph';

let lastGraph: FakeGraph | undefined;

function acme(checkpointed: boolean) {
  return () => {
    lastGraph = fakeGraph({ checkpointed });
    return langgraphAdapter({ graph: lastGraph, sideEffects: ACME_SIDE_EFFECTS, deterministic: true });
  };
}

adapterContract('langgraph', acme(true), {
  brokenTransport: () => langgraphAdapter({ graph: deadGraph() }),
  released: (session: Session) => {
    const thread = (session.state as { threadId: string }).threadId;
    return lastGraph?.saver?.threads.has(thread) === false;
  },
});
