import { type DriverStep, validateSpec } from '@driftbench/core';
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
