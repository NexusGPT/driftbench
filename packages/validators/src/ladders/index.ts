import type { Ladder } from '../ladder';
import { judgesLadder } from './judges/index';
import { statsLadder } from './stats';
import { systemLadder } from './system';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return { judges: judgesLadder(), stats: statsLadder(), system: systemLadder() };
}
