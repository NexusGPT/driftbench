import { type DriverStep, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createScriptedDriver } from '../src/index';

const loaded = validateSpec({
  id: 'script',
  blocks: [
    { user: 'first', expect: { must: ['a'] } },
    { burst: ['second', 'third'], expect: { must: ['b'] } },
    {
      when: { injection: { class: 'D1_off_topic', user: 'are you open on Sunday?' } },
      expect: { must: ['c'] },
    },
  ],
});
if (!loaded.ok) throw new Error('invalid test spec');
const spec = loaded.spec;

describe('the scripted driver', () => {
  it("replays the spec's blocks in order, each with its own stimulus, then stops after the last", () => {
    const driver = createScriptedDriver();
    const steps: DriverStep[] = [];
    for (let blockIndex = 0; blockIndex <= spec.blocks.length; blockIndex++) {
      steps.push(driver.next({ spec, mode: 'F', blockIndex, history: [] }) as DriverStep);
    }
    expect(steps).toEqual([
      { kind: 'block', blockIndex: 0, stimulus: { user: 'first' } },
      { kind: 'block', blockIndex: 1, stimulus: { burst: ['second', 'third'] } },
      {
        kind: 'block',
        blockIndex: 2,
        stimulus: { injection: { class: 'D1_off_topic', user: 'are you open on Sunday?' } },
      },
      { kind: 'stop', reason: 'the script ends after block 2' },
    ]);
  });

  it('decides from its context alone, so one instance drives any number of runs', () => {
    const driver = createScriptedDriver();
    const at = (blockIndex: number) => driver.next({ spec, mode: 'F', blockIndex, history: [] });
    expect(at(1)).toEqual(at(1));
    expect(at(3)).toEqual({ kind: 'stop', reason: 'the script ends after block 2' });
    expect(at(0)).toEqual({ kind: 'block', blockIndex: 0, stimulus: { user: 'first' } });
    expect(driver.id).toBe('scripted');
  });
});

describe('the scripted driver and an end verdict', () => {
  it('stops after the last block with the spec verdict, when the spec ends with one', () => {
    const ended = validateSpec({
      id: 'ended',
      blocks: [{ user: 'hi' }],
      end: { verdict: 'success', reason: 'the customer was served' },
    });
    if (!ended.ok) throw new Error('invalid test spec');
    const step = createScriptedDriver().next({ spec: ended.spec, mode: 'F', blockIndex: 1, history: [] });
    expect(step).toEqual({ kind: 'stop', reason: 'the customer was served', verdict: 'success' });
  });

  it('stops after atBlock: the blocks after it are never sent', () => {
    const ended = validateSpec({
      id: 'mid',
      blocks: [{ user: 'one' }, { user: 'two' }, { user: 'three' }],
      end: { verdict: 'failure', reason: 'refused', atBlock: 0 },
    });
    if (!ended.ok) throw new Error('invalid test spec');
    const driver = createScriptedDriver();
    const at = (blockIndex: number) => driver.next({ spec: ended.spec, mode: 'F', blockIndex, history: [] });
    expect(at(0)).toEqual({ kind: 'block', blockIndex: 0, stimulus: { user: 'one' } });
    expect(at(1)).toEqual({ kind: 'stop', reason: 'refused', verdict: 'failure' });
    expect(at(2)).toEqual({ kind: 'stop', reason: 'refused', verdict: 'failure' });
  });
});
