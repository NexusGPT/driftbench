import type { Session } from '@driftbench/core';
import { describe } from 'vitest';
import { anthropicAdapter } from '../src/anthropic/index';
import { adapterContract } from './contract';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { acmeTools } from './fixtures/sdk/acme-tools';
import { deadAnthropic, fakeAnthropic } from './fixtures/sdk/anthropic';

const MODEL = 'claude-fake-acme';

function acme() {
  return anthropicAdapter({
    client: fakeAnthropic(),
    model: MODEL,
    system: 'You are the Acme Telecom sales assistant.',
    tools: () => acmeTools().tools,
    sideEffects: ACME_SIDE_EFFECTS,
    deterministic: true,
  });
}

adapterContract('anthropic', acme, {
  brokenTransport: () => anthropicAdapter({ client: deadAnthropic(), model: MODEL }),
  released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
});

describe('anthropic adapter', () => {});
