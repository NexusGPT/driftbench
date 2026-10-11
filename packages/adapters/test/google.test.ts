import type { Session } from '@driftbench/core';
import { googleAdapter } from '../src/google/index';
import { adapterContract } from './contract';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { acmeTools } from './fixtures/sdk/acme-tools';
import { deadGoogle, fakeGoogle } from './fixtures/sdk/google';

const MODEL = 'gemini-fake-acme';

function acme() {
  return googleAdapter({
    client: fakeGoogle(),
    model: MODEL,
    system: 'You are the Acme Telecom sales assistant.',
    tools: () => acmeTools().tools,
    sideEffects: ACME_SIDE_EFFECTS,
    deterministic: true,
  });
}

adapterContract('google', acme, {
  brokenTransport: () => googleAdapter({ client: deadGoogle(), model: MODEL }),
  released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
});
