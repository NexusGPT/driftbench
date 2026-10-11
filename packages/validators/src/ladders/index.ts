import type { Ladder } from '../ladder';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return {};
}
