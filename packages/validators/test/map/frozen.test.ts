import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DeviationClass } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { registeredLadders } from '../../src/index';
import { LEVELS } from '../../src/ladders/map/bank/types';
import { MAP_DEVIATIONS } from '../../src/ladders/map/spec';
import { ROOT } from './support';

const MAP_DIR = join(ROOT, 'packages/validators/src/ladders/map');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('the map validator, frozen and registered', () => {
  it('draws deviations from D1 to D10 only, a constant of its own, so a new class in core reshuffles no seeded item', () => {
    expect(MAP_DEVIATIONS).toEqual([
      'D1_off_topic',
      'D2_goal_shift',
      'D3_contradiction',
      'D4_loose_confirmation',
      'D5_language_switch',
      'D6_instruction_in_data',
      'D7_silence_or_burst',
      'D8_tool_failure',
      'D9_out_of_scope',
      'D10_return',
    ]);
    for (const deviation of MAP_DEVIATIONS) expect(DeviationClass.safeParse(deviation).success).toBe(true);
    const live = sources(MAP_DIR).filter((path) =>
      readFileSync(path, 'utf8').includes('DeviationClass.options'),
    );
    expect(live).toEqual([]);
  });

  it('is registered, so CI and validate all run it', () => {
    const ladder = registeredLadders().map;
    expect(ladder?.levels).toHaveLength(LEVELS.length);
  });
});
