import { assistantMessage, type Message, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { createFollower } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, runContext } from '../../src/ladders/generator/measure';

const hidden = hiddenSpec(1);
const hand = baselineSuite(hidden)[0]!.spec;
const options = { ...runContext(), driver: createScriptedDriver(), mode: 'T' as const, repeat: 1 };

describe('follower supplied history', () => {
  it('passes the reference walk with a fresh session at every teacher-forced block', async () => {
    const run = await runSpec(hand, { ...options, adapter: followerAdapter(createFollower(hidden)) });
    expect(run.blocks.map((block) => block.pass)).toEqual(hand.blocks.map(() => true));
  });

  it('keeps a stage-skipping mutant red after loading the correct prefix', async () => {
    const run = await runSpec(hand, {
      ...options,
      adapter: followerAdapter(createFollower(hidden, { move: (from) => from })),
    });
    expect(run.blocks.some((block) => !block.pass)).toBe(true);
    const restored = await runSpec(hand, { ...options, adapter: followerAdapter(createFollower(hidden)) });
    expect(restored.blocks.every((block) => block.pass)).toBe(true);
  });

  it('rejects a generator output mutant that erases the canonical conversation prefix', async () => {
    const mutant = structuredClone(hand);
    for (const block of mutant.blocks.slice(1)) block.given = { ...block.given, prefix: [] };
    const red = await runSpec(mutant, { ...options, adapter: followerAdapter(createFollower(hidden)) });
    expect(red.blocks.some((block) => !block.pass)).toBe(true);
    const restored = await runSpec(hand, { ...options, adapter: followerAdapter(createFollower(hidden)) });
    expect(restored.blocks.every((block) => block.pass)).toBe(true);
  });

  it('restores a historical tool failure without applying the current world to earlier turns', async () => {
    const phrase = (edge: string) =>
      hidden.phrases
        .find((p) => p.intent.kind === 'transition' && p.intent.edge === edge)!
        .text.replace(/\{[^}]+\}/g, 'green');
    const session = createFollower(hidden)();
    const messages: Message[] = [{ role: 'user', content: phrase(`${hidden.start}-to-${hidden.goal}`) }];
    messages.push(assistantMessage(await session.respond(messages, {})));
    messages.push({ role: 'user', content: phrase(`${hidden.goal}-to-check`) });
    messages.push(
      assistantMessage(await session.respond(messages, { tools: { lookup_record: { error: 'down' } } })),
    );
    messages.push({ role: 'user', content: phrase(`${hidden.goal}-to-check`) });
    const resumed = await createFollower(hidden)().respond(messages, {});
    expect(resumed.runtime?.stages?.at(-1)?.name).toBe('check');
    expect(resumed.toolCalls).toHaveLength(1);
    expect(resumed.toolCalls[0]?.error).toBeUndefined();
  });

  it('does not count a completed historical write as a new end-state payload', async () => {
    const live = createFollower(hidden)();
    const prefix: Message[] = [];
    for (const block of hand.blocks) {
      if (!block.when) throw new Error('missing stimulus');
      const messages =
        'user' in block.when
          ? [{ role: 'user' as const, content: block.when.user }]
          : 'injection' in block.when
            ? [{ role: 'user' as const, content: block.when.injection.user }]
            : block.when.burst.map((content) => ({ role: 'user' as const, content }));
      prefix.push(...messages);
      prefix.push(assistantMessage(await live.respond(prefix, {})));
    }
    expect(live.payloads()).toHaveLength(1);
    const session = createFollower(hidden)();
    const got = await session.respond([...prefix, { role: 'user', content: 'Thank you.' }], {});
    expect(got.toolCalls).toEqual([]);
    expect(got.runtime?.stages?.at(-1)?.name).toBe(hidden.final);
    expect(session.payloads()).toEqual([]);
  });
});
