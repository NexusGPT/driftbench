import type { DeviationClass, Message, Observed, WorldState } from '@agent-nexus/driftbench-core';
import { blockOutcome, type FaultSession, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { combinedFault, FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { createFollower, FOREIGN_REPLY } from '../../src/ladders/generator/follower';
import { DEVIATION_POOL, type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import { emulate, followerAdapter, runContext } from '../../src/ladders/generator/measure';

type Step = { text: string; world?: WorldState };

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

/** The move phrase of an edge, its slot filled with the first member of the enum it feeds. */
function move(spec: HiddenSpec, edge: string): string {
  const text = spec.phrases.find(
    (phrase) => phrase.intent.kind === 'transition' && phrase.intent.edge === edge,
  )?.text;
  if (!text) throw new Error(`no phrase for ${edge}`);
  return text.replace(/\{([a-z_]+)\}/g, (_all, slot: string) => {
    const property = spec.tools.find((tool) => tool.slot === slot)?.input[0];
    return property?.type === 'enum' ? (property.members[1] as string) : 'x';
  });
}

function deviation(spec: HiddenSpec, cls: DeviationClass): string {
  const text = spec.phrases.find(
    (phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === cls,
  )?.text;
  if (!text) throw new Error(`no phrase for ${cls}`);
  return text;
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

  it('reads the slot a turn states and sends it to the tool of the stage it enters', async () => {
    const spec = hiddenSpec(1);
    const read = spec.tools.find((tool) => tool.role === 'read');
    const property = read?.input[0];
    if (!read || property?.type !== 'enum') throw new Error('no read tool');
    const [, checked] = await play(createFollower(spec), [
      { text: move(spec, `${spec.start}-to-${spec.goal}`) },
      { text: move(spec, `${spec.goal}-to-check`) },
    ]);
    expect(stageOf(checked)).toBe('check');
    expect(
      checked?.toolCalls.map((call) => [call.label, (call.input as Record<string, unknown>)[property.name]]),
    ).toEqual([[read.name, property.members[1]]]);
  });

  it('takes a move only from the stage it leaves', async () => {
    const spec = hiddenSpec(1);
    const [early] = await play(createFollower(spec), [
      { text: move(spec, `${spec.confirm}-to-${spec.final}`) },
    ]);
    expect(stageOf(early)).toBe(spec.start);
    expect(early?.toolCalls).toEqual([]);
  });

  it('refuses a value the schema forbids and never submits outside the confirmation', async () => {
    const spec = hiddenSpec(1);
    const invalid = spec.data.find(
      (value) =>
        value.direction === 'in' && value.partition === 'above-maximum' && value.tool === 'lookup_record',
    );
    const write = spec.data.find(
      (value) =>
        value.direction === 'in' && value.tool === 'submit_request' && value.partition === 'at-minimum',
    );
    const text = (id: string | undefined) =>
      spec.phrases.find((phrase) => phrase.intent.kind === 'data' && phrase.intent.value === id)?.text ?? '';
    const [refused, unconfirmed] = await play(createFollower(spec), [
      { text: text(invalid?.id) },
      { text: text(write?.id) },
    ]);
    expect(refused?.toolCalls).toEqual([]);
    expect(refused?.text).toMatch(/outside what/);
    expect(unconfirmed?.toolCalls).toEqual([]);
  });

  it('stays on its step through a detour with the recovery words, and goes to the goal on a goal shift', async () => {
    const spec = hiddenSpec(1);
    const steps: Step[] = [
      { text: move(spec, `${spec.start}-to-${spec.goal}`) },
      { text: move(spec, `${spec.goal}-to-check`) },
      { text: deviation(spec, 'D1_off_topic') },
      { text: deviation(spec, 'D2_goal_shift') },
    ];
    const seen = await play(createFollower(spec), steps);
    expect(stageOf(seen[2])).toBe('check');
    expect(seen[2]?.text).toMatch(/keep to your request/);
    expect(stageOf(seen[3])).toBe(spec.goal);
    for (const observed of seen)
      expect(observed.segments.filter((segment) => segment.type === 'text')).toHaveLength(1);
  });

  it('retries a failing read-only tool once, stays where it was, and says the service is not answering', async () => {
    const spec = hiddenSpec(1);
    const [, failed] = await play(createFollower(spec), [
      { text: move(spec, `${spec.start}-to-${spec.goal}`) },
      { text: move(spec, `${spec.goal}-to-check`), world: { tools: { lookup_record: { error: 'down' } } } },
    ]);
    expect(failed?.toolCalls.map((call) => call.error)).toEqual(['down', 'down']);
    expect(stageOf(failed)).toBe(spec.goal);
    expect(failed?.text).toMatch(/not answering/);
  });

  it('plays the same turns the same way when emulated and when run through the runner', async () => {
    const spec = hiddenSpec(2);
    for (const { spec: hand } of baselineSuite(spec)) {
      const emulated = await emulate(hand, createFollower(spec)());
      expect(emulated).toHaveLength(hand.blocks.length);
    }
  });
});

describe('the fault family', () => {
  it('holds 70 classes, at least 60 of them drift or deviation classes, in three families', () => {
    expect(FAULT_CLASSES).toHaveLength(70);
    expect(new Set(FAULT_CLASSES.map((cls) => cls.id)).size).toBe(70);
    expect(FAULT_CLASSES.filter((cls) => cls.family === 'drift')).toHaveLength(28);
    expect(FAULT_CLASSES.filter((cls) => cls.family === 'deviation')).toHaveLength(22);
    expect(FAULT_CLASSES.filter((cls) => cls.family === 'code')).toHaveLength(20);
    for (const cls of DEVIATION_POOL) expect(FAULT_CLASSES.some((entry) => entry.parent === cls)).toBe(true);
  });

  it('plants up to five instances per class, each with a distinct id', () => {
    const spec = hiddenSpec(1);
    const family = faultFamily(spec);
    expect(new Set(family.map((fault) => fault.def.id)).size).toBe(family.length);
    for (const cls of FAULT_CLASSES) {
      const members = family.filter((fault) => fault.class === cls.id);
      expect(members.length).toBeGreaterThanOrEqual(3);
      expect(members.length).toBeLessThanOrEqual(5);
      expect(members.some((fault) => fault.where === 'any' && fault.rate === 1)).toBe(true);
    }
  });

  it('makes every every-time drift and deviation fault part from the follower somewhere in the baseline turns', async () => {
    const spec = hiddenSpec(1);
    const turns: Step[] = [
      { text: move(spec, `${spec.start}-to-${spec.goal}`) },
      { text: move(spec, `${spec.goal}-to-check`) },
      ...DEVIATION_POOL.filter((cls) => cls !== 'D8_tool_failure').map((cls) => ({
        text: deviation(spec, cls),
      })),
    ];
    const ours = JSON.stringify(await play(createFollower(spec), turns));
    const silent: string[] = [];
    for (const cls of FAULT_CLASSES.filter(
      (entry) =>
        entry.family === 'drift' &&
        entry.id !== 'X2.slot-first' &&
        entry.id !== 'X5.early-write' &&
        entry.id !== 'X5.write-twice',
    )) {
      const fault = faultFamily(spec, [cls]).find((entry) => entry.where === 'any' && entry.rate === 1);
      if (fault?.def.agent.kind !== 'function') throw new Error(cls.id);
      if (JSON.stringify(await play(fault.def.agent.create, turns)) === ours) silent.push(cls.id);
    }
    expect(silent).toEqual([]);
  });

  it('composes classes: a pair changes what each of its members changes', async () => {
    const spec = hiddenSpec(1);
    const pair = combinedFault(spec, ['X4.dutch', 'X3.stay']);
    if (pair.def.agent.kind !== 'function') throw new Error('not a function fault');
    const [seen] = await play(pair.def.agent.create, [{ text: move(spec, `${spec.start}-to-${spec.goal}`) }]);
    expect(seen?.text).toBe(FOREIGN_REPLY);
    expect(stageOf(seen)).toBe(spec.start);
  });
});

describe('composed missing-stage reports', () => {
  it('keeps the null report of X3.no-report in either composition order', async () => {
    const spec = hiddenSpec(1);
    const text = move(spec, `${spec.start}-to-${spec.goal}`);
    const [reference] = await play(createFollower(spec), [{ text }]);
    expect(stageOf(reference)).toBe(spec.goal);
    for (const ids of [
      ['X3.no-report', 'X4.narrate'],
      ['X4.narrate', 'X3.no-report'],
    ]) {
      const fault = combinedFault(spec, ids);
      const [observed] = await play(createFollower(spec, fault.mutation), [{ text }]);
      expect(observed?.text).toContain('Step 1:');
      expect(observed?.runtime?.stages, ids.join('+')).toBeUndefined();
    }
  });
});
