import { fileURLToPath } from 'node:url';
import { type Control, CONTROL_FAILED } from './controls';
import { isolated, newPool, stopPool } from './run';
import { fail, type Outcome } from './types';

/**
 * The planted readers of the harness controls, by the cheat they carry (plants/). Each loads in the process the
 * harness starts for it and runs its cheat there; each is broken, so a control run on it must fail.
 */
export const PLANTS = {
  send: fileURLToPath(new URL('./plants/cheat-send.ts', import.meta.url)),
  fd: fileURLToPath(new URL('./plants/cheat-fd.ts', import.meta.url)),
  env: fileURLToPath(new URL('./plants/cheat-env.ts', import.meta.url)),
} as const;

/** The longest one control may take before the process that serves it is stopped, in milliseconds. */
const CONTROL_LIMIT_MS = 45_000;

/**
 * Runs a control through the harness exactly as the runner serves an item: a process of its own resolves the
 * planted reader from `plant` and answers the control. The outcome is the control's own, or a failure that says
 * the process could not serve it.
 */
export async function probe(plant: string, control: Control): Promise<Outcome> {
  const pool = newPool(plant);
  try {
    const out = await isolated<Outcome>({ control }, CONTROL_LIMIT_MS, (why) => fail(why), pool);
    return out ?? fail('the harness could not start a process for the control');
  } finally {
    await stopPool(pool);
  }
}

/**
 * Whether an outcome shows that the reader gave no pass: the control failed on the reader's own outputs, or the
 * reader's process ended. Any other failure (the process did not start, the control timed out) says nothing about
 * the reader, so it is not a proof.
 */
export function readerGainedNothing(outcome: Outcome): boolean {
  return !outcome.pass && (outcome.detail.startsWith(CONTROL_FAILED) || /reader's process/.test(outcome.detail));
}
