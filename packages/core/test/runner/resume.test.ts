import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeSpec, echoAdapter, loadAcmeConversations, memoryCache, minimalChecks } from './support';

const loaded = await loadAcmeConversations();
const spec = acmeSpec(loaded, 'acme-new-customer-coverage');
const driver = createScriptedDriver();

/** An adapter that answers like the echo adapter until the Nth send, which fails: the run is cut short there. */
function killedAt(n: number) {
  const inner = echoAdapter('ok');
  let sends = 0;
  return {
    ...inner,
    async send(session: never, turn: never) {
      sends += 1;
      if (sends === n) throw new Error('killed mid-run');
      return inner.send(session, turn);
    },
  } as typeof inner;
}

describe('a partly cached run resumes from its first unfinished block', () => {
  it('a run killed mid-way resumes to the same verdicts as an uninterrupted run, and only sends the unfinished blocks', async () => {
    const reference = await runSpec(spec, {
      adapter: echoAdapter('ok'),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    const cache = memoryCache();
    const killed = await runSpec(spec, {
      adapter: killedAt(3),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
    });
    expect(killed.status).toBe('failed');
    expect(cache.entries.size).toBe(2);

    const resumeInner = echoAdapter('ok');
    let resumeSends = 0;
    const resumeAdapter = {
      ...resumeInner,
      async send(session: never, turn: never) {
        resumeSends += 1;
        return resumeInner.send(session, turn);
      },
    } as typeof resumeInner;
    const resumed = await runSpec(spec, {
      adapter: resumeAdapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.blocks.length).toBe(reference.blocks.length);
    expect(resumed.blocks.map((b) => b.pass)).toEqual(reference.blocks.map((b) => b.pass));
    expect(resumed.blocks.map((b) => b.verdicts.map((v) => [v.id, v.outcome]))).toEqual(
      reference.blocks.map((b) => b.verdicts.map((v) => [v.id, v.outcome])),
    );
    expect(resumed.blocks.map((b) => b.observed.text)).toEqual(reference.blocks.map((b) => b.observed.text));
    // The two blocks finished before the kill came from the cache: only the rest reached the adapter.
    expect(resumeSends).toBe(reference.blocks.length - 2);
    expect(resumed.cacheHit).toBe(false);
  });
});
