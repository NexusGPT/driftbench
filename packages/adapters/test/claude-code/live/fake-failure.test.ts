import { join } from 'node:path';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { expect, it } from 'vitest';
import { claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import { ASK_INVOICE, ESTATE, FAKE, givenOf, scratch, turnOf } from './support';

it('fails the cell loudly when the stand-in cannot resolve a skill obligation', async () => {
  const work = await scratch();
  const adapter = claudeCodeLiveAdapter({
    command: FAKE,
    estateRoot: ESTATE,
    provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
    config: 'isolated',
  });
  const given = givenOf();
  const session = await adapter.open(given);
  try {
    await expect(adapter.send(session, turnOf(0, ASK_INVOICE, given))).rejects.toThrow('ordering obligation');
  } finally {
    await adapter.close(session);
    await work.done();
  }
});
