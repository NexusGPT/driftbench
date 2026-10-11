import type { DeviationClass, Message, Observed, WorldState } from '@driftbench/core';
import { blockOutcome, type FaultSession, runOnce } from '@driftbench/generate';
import { describe, expect, it } from 'vitest';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { DRIFT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { createFollower, FOREIGN_REPLY } from '../../src/ladders/generator/follower';
import { DEVIATION_POOL, type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, runContext } from '../../src/ladders/generator/measure';

type Step = { text: string; world?: WorldState };

/** Plays user turns into one session and returns what it observed on each. */
async function play(session: () => FaultSession, steps: readonly Step[]): Promise<Observed[]> {
  const agent = session();
  const messages: Message[] = [];
  const out: Observed[] = [];
  for (const step of steps) {
    messages.push({ role: 'user', content: step.text });
    const observed = await agent.respond([...messages], step.world ?? {});
    messages.push({ role: 'assistant', content: observed.text });
    out.push(observed);
  }
  return out;
}

const stageOf = (observed: Observed | undefined) => observed?.runtime?.stages?.at(-1)?.name;

function phrase(
  spec: HiddenSpec,
  test: (intent: HiddenSpec['phrases'][number]['intent']) => boolean,
): string {
  const found = spec.phrases.find((entry) => test(entry.intent));
  if (!found) throw new Error('no phrase for the intent');
  return found.text;
}

const move = (spec: HiddenSpec, edge: string) =>
  phrase(spec, (intent) => intent.kind === 'transition' && intent.edge === edge);
const deviation = (spec: HiddenSpec, cls: DeviationClass) =>
  phrase(spec, (intent) => intent.kind === 'deviation' && intent.class === cls);

/** The first seed whose hidden specification holds a class. */
function seedWith(cls: DeviationClass): number {
  for (let seed = 1; seed < 200; seed += 1) if (hiddenSpec(seed).deviations.includes(cls)) return seed;
  throw new Error(`no seed under 200 holds ${cls}`);
}

describe('the rule follower', () => {
  it('passes every block of the hand-written baseline through the real runner, on seeds 1 to 5', async () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const spec = hiddenSpec(seed);
      const adapter = followerAdapter(createFollower(spec));
      for (const { spec: hand } of baselineSuite(spec)) {
        const run = await runOnce(hand, adapter, 1, runContext());
        expect(
          hand.blocks.map((_, index) => blockOutcome(run, index)),
          `${hand.id} on seed ${seed}`,
        ).toEqual(hand.blocks.map(() => 'pass'));
      }
    }
  });

  it('takes a move only from the stage it leaves, and calls the tool bound to the stage it enters', async () => {
    const spec = hiddenSpec(1);
    const [first, early, second] = await play(createFollower(spec), [
      { text: move(spec, `${spec.start}-to-${spec.next[spec.start]}`) },
      { text: move(spec, 'recap-to-done') },
      { text: move(spec, 'intake-to-check') },
    ]);
    expect(stageOf(first)).toBe(spec.next[spec.start]);
    expect(stageOf(early)).toBe(spec.next[spec.start]);
    expect(early?.toolCalls).toEqual([]);
    expect(stageOf(second)).toBe('check');
    expect(second?.toolCalls.map((call) => call.label)).toEqual(['lookup_record']);
  });

  it('sends a valid value as the turn gives it and refuses one the schema forbids', async () => {
    const spec = hiddenSpec(1);
    const valid = spec.data.find((value) => value.direction === 'in' && value.partition === 'at-maximum');
    const invalid = spec.data.find(
      (value) => value.direction === 'in' && value.partition === 'above-maximum',
    );
    if (!valid || !invalid) throw new Error('no bound partition');
    const [sent, refused] = await play(createFollower(spec), [
      { text: phrase(spec, (intent) => intent.kind === 'data' && intent.value === valid.id) },
      { text: phrase(spec, (intent) => intent.kind === 'data' && intent.value === invalid.id) },
    ]);
    expect(sent?.toolCalls).toHaveLength(1);
    expect((sent?.toolCalls[0]?.input as Record<string, unknown> | undefined)?.[valid.field]).toBe(
      valid.value,
    );
    expect(refused?.toolCalls).toEqual([]);
    expect(refused?.text).toMatch(/outside what/);
  });

  it('stays on its step through a detour, goes back to the goal on a goal shift, and replies once in English', async () => {
    const seed = seedWith('D2_goal_shift');
    const spec = hiddenSpec(seed);
    const detour =
      spec.deviations.find((cls) => cls === 'D1_off_topic' || cls === 'D3_contradiction') ?? null;
    const steps: Step[] = [
      { text: move(spec, `${spec.start}-to-${spec.goal}`) },
      { text: move(spec, `${spec.goal}-to-${spec.next[spec.goal]}`) },
      { text: deviation(spec, 'D2_goal_shift') },
    ];
    const seen = await play(createFollower(spec), steps);
    expect(stageOf(seen[1])).toBe(spec.next[spec.goal]);
    expect(stageOf(seen[2])).toBe(spec.goal);
    for (const observed of seen) {
      expect(observed.segments.filter((segment) => segment.type === 'text')).toHaveLength(1);
      expect(observed.text).not.toBe(FOREIGN_REPLY);
    }
    if (detour) {
      const [, stayed] = await play(createFollower(spec), [
        { text: move(spec, `${spec.start}-to-${spec.goal}`) },
        { text: deviation(spec, detour) },
      ]);
      expect(stageOf(stayed)).toBe(spec.goal);
    }
  });

  it('retries a failing read-only tool once, never a side-effecting one, and says the step failed', async () => {
    const spec = hiddenSpec(1);
    const error = { error: 'service unavailable' };
    const read = spec.tools.find((tool) => !tool.sideEffect && tool.stage !== undefined);
    if (!read?.stage) throw new Error('no read-only tool bound to a stage');
    const route: Step[] = [];
    for (let stage = spec.start; stage !== read.stage; stage = spec.next[stage] as string) {
      route.push({ text: move(spec, `${stage}-to-${spec.next[stage]}`) });
    }
    const last = route.at(-1) as Step;
    last.world = { tools: { [read.name]: error } };
    const seen = await play(createFollower(spec), route);
    const failed = seen.at(-1);
    expect(failed?.toolCalls.map((call) => call.error)).toEqual([error.error, error.error]);
    expect(failed?.text).toMatch(/not answering/);
  });
});

describe('the fault family', () => {
  it('plants three instances of every drift class and of each deviation class the specification holds', () => {
    const spec = hiddenSpec(1);
    const family = faultFamily(spec);
    expect(new Set(family.map((fault) => fault.def.id)).size).toBe(family.length);
    for (const cls of [...DRIFT_CLASSES, ...spec.deviations]) {
      const members = family.filter((fault) => fault.class === cls);
      expect(members.map((fault) => [fault.where === 'any', fault.rate])).toEqual([
        [true, 1],
        [members[1]?.where === 'any', 1],
        [true, 2],
      ]);
      expect(members.every((fault) => fault.def.target === `function:${spec.agent}`)).toBe(true);
    }
    expect(
      family.some(
        (fault) => !spec.deviations.includes(fault.class as DeviationClass) && fault.class.startsWith('D'),
      ),
    ).toBe(false);
  });

  /** One scenario per class where the follower and its every-time fault must part. */
  function scenario(spec: HiddenSpec, cls: string): Step[] {
    const toGoal = { text: move(spec, `${spec.start}-to-${spec.goal}`) };
    const toNext = { text: move(spec, `${spec.goal}-to-${spec.next[spec.goal]}`) };
    const boolOut = spec.data.find((value) => value.direction === 'out' && value.partition === 'true');
    const enumIn = spec.data.find(
      (value) => value.direction === 'in' && typeof value.value === 'string' && !value.invalid,
    );
    switch (cls) {
      case 'X1_local':
        return [{ text: phrase(spec, (intent) => intent.kind === 'data' && intent.value === enumIn?.id) }];
      case 'X2_contradiction':
      case 'X5_tool':
        return [{ text: phrase(spec, (intent) => intent.kind === 'data' && intent.value === boolOut?.id) }];
      case 'X3_flow':
      case 'X4_format':
        return [toGoal];
      case 'D8_tool_failure': {
        const read = spec.tools.find((tool) => tool.stage === spec.next[spec.goal]) ?? spec.tools[0];
        return [toGoal, { ...toNext, world: { tools: { [read?.name ?? '']: { error: 'down' } } } }];
      }
      case 'D9_out_of_scope':
        return [toGoal, toNext, { text: deviation(spec, cls) }];
      case 'D2_goal_shift':
        return [toGoal, toNext, { text: deviation(spec, cls) }];
      default:
        return [toGoal, { text: deviation(spec, cls as DeviationClass) }];
    }
  }

  it('makes every every-time fault part from the follower on a scenario built for its class', async () => {
    const classes = [...DRIFT_CLASSES, ...DEVIATION_POOL];
    for (const cls of classes) {
      const seed = cls.startsWith('X') ? 1 : seedWith(cls as DeviationClass);
      const spec = hiddenSpec(seed);
      const fault = faultFamily(spec).find(
        (entry) => entry.class === cls && entry.where === 'any' && entry.rate === 1,
      );
      if (fault?.def.agent.kind !== 'function') throw new Error(`no every-time fault for ${cls}`);
      const steps = scenario(spec, cls);
      const theirs = await play(fault.def.agent.create, steps);
      const ours = await play(createFollower(spec), steps);
      expect(JSON.stringify(theirs), `${cls} on seed ${seed}`).not.toBe(JSON.stringify(ours));
    }
  });

  it('fires an every-second-time fault on the second opportunity only', async () => {
    const spec = hiddenSpec(1);
    const fault = faultFamily(spec).find((entry) => entry.class === 'X4_format' && entry.rate === 2);
    if (fault?.def.agent.kind !== 'function') throw new Error('no every-second-time X4 fault');
    const steps = [{ text: move(spec, `${spec.start}-to-${spec.goal}`) }, { text: 'hm' }, { text: 'hm' }];
    const seen = await play(fault.def.agent.create, steps);
    expect(seen.map((observed) => observed.text === FOREIGN_REPLY)).toEqual([false, true, false]);
  });
});
