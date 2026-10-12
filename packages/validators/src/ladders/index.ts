import type { Ladder } from '../ladder';
import { estateLadder } from './estate/index';
import { judgesLadder } from './judges/index';
import { statsLadder } from './stats';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return { estate: estateLadder(), judges: judgesLadder(), stats: statsLadder() };
}
