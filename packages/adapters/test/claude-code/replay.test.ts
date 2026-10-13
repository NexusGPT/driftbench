import {
  AgentFailure,
  type Observed,
  type ObservedCache,
  type ResolvedGiven,
  runSpec,
  Spec,
  type Stimulus,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { mapSession, parseJsonl, replayAdapter } from '../../src/claude-code';

const given: ResolvedGiven = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'claude-code' },
  hash: 'replay-stimulus',
};

function recording() {
  return mapSession({
    transcript: parseJsonl(
      [
        { type: 'user', message: { content: 'List the items.' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'One item.' }] } },
        { type: 'user', message: { content: [{ type: 'text', text: 'Show the total.' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Ten.' }] } },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    ),
  });
}

describe('replay stimulus alignment', () => {
  it('rejects another question and names the block, requested stimulus and recorded stimulus', async () => {
    const adapter = replayAdapter({ session: recording() });
    const session = await adapter.open(given);
    const send = () => adapter.send(session, { index: 0, given, stimulus: { user: 'Delete the items.' } });
    await expect(send()).rejects.toBeInstanceOf(AgentFailure);
    await expect(send()).rejects.toThrow(
      'stimulus mismatch at session block 0: requested {"user":"Delete the items."}; recorded {"user":"List the items."}',
    );
  });

  it('checks the selected fromBlock plus turn index, without consuming a mismatched block', async () => {
    const adapter = replayAdapter({ session: recording(), fromBlock: 1 });
    const session = await adapter.open(given);
    await expect(
      adapter.send(session, { index: 0, given, stimulus: { user: 'List the items.' } }),
    ).rejects.toThrow('stimulus mismatch at session block 1');
    expect(
      (await adapter.send(session, { index: 0, given, stimulus: { user: 'Show the total.' } })).text,
    ).toBe('Ten.');
    const fromStart = replayAdapter({ session: recording() });
    expect(
      (await fromStart.send(session, { index: 1, given, stimulus: { user: 'Show the total.' } })).text,
    ).toBe('Ten.');
  });

  it('accepts outer whitespace from folded YAML but keeps case and internal whitespace significant', async () => {
    const adapter = replayAdapter({ session: recording() });
    const session = await adapter.open(given);
    expect(
      (await adapter.send(session, { index: 0, given, stimulus: { user: '  List the items.\n' } })).text,
    ).toBe('One item.');
    for (const user of ['list the items.', 'List  the items.']) {
      await expect(adapter.send(session, { index: 0, given, stimulus: { user } })).rejects.toThrow(
        'stimulus mismatch',
      );
    }
  });

  it('compares the delivered text of injections and preserves burst message boundaries', async () => {
    const adapter = replayAdapter({ session: recording() });
    const session = await adapter.open(given);
    const stimulus: Stimulus = { injection: { class: 'D7_silence_or_burst', user: 'List the items.' } };
    expect((await adapter.send(session, { index: 0, given, stimulus })).text).toBe('One item.');
    await expect(
      adapter.send(session, { index: 0, given, stimulus: { burst: ['List', 'the items.'] } }),
    ).rejects.toThrow('stimulus mismatch');
  });

  it('fails a mismatched spec even when a previous adapter version cached its answer', async () => {
    const mapped = recording();
    const recorded = mapped.blocks[0];
    if (!recorded) throw new Error('fixture has no first block');
    const adapter = replayAdapter({ session: mapped });
    const spec = Spec.parse({
      id: 'wrong-question',
      kind: 'task',
      blocks: [{ when: { user: 'Delete the items.' } }],
    });
    const entries = new Map<string, Observed>();
    const cache: ObservedCache = {
      async cacheGet(key) {
        return entries.get(key);
      },
      async cachePut(key, observed) {
        entries.set(key, observed);
      },
    };
    const options = { driver: createScriptedDriver(), checks: [], mode: 'F' as const, repeat: 0, cache };
    const legacy = await runSpec(spec, {
      ...options,
      adapter: {
        ...adapter,
        version: '0.1.1',
        async send() {
          return recorded.observed;
        },
      },
    });
    expect(legacy.status).toBe('completed');
    const result = await runSpec(spec, { ...options, adapter });
    expect(result.cacheHit).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('stimulus mismatch');
  });
});
