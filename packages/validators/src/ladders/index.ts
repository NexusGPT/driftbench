import type { Ladder } from '../ladder';
import { judgesLadderV2 } from './judges/v2/index';
import { mapLadder } from './map';
import { statsLadder } from './stats';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return { judges: judgesLadderV2(), map: mapLadder(), stats: statsLadder() };
}
