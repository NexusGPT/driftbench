import { runChild } from '../kit/child-run';
import type { CutResult, PointerSut } from '../sut/port';
import { fail, type Outcome, pass } from './types';

/**
 * Controls: requests the process that serves the items answers outside the bank, to look at the harness itself. A
 * control has a verdict of its own, computed here by code that reads the outputs of the reader. A planted reader
 * (plants/) is run through a control to show that what the reader does in its process cannot change the verdict.
 */

export type Control = {
  name: 'verdict' | 'sandbox-cut';
  /** The text the reader is expected to cut (sandbox-cut). */
  expect?: string;
};

/** The detail of a control that failed because of the reader's own outputs. */
export const CONTROL_FAILED = 'control failed';

const SENTENCE = 'The ledger is closed on the last day of the month.';
const FILE = { path: 'control.md', text: `${SENTENCE}\n` };

const markerOf = (cut: CutResult): string => cut.units[0]?.text ?? '';

/** The reader is asked for one cut; the verdict is whether a unit holds the sentence. */
async function verdict(sut: PointerSut): Promise<Outcome> {
  const got = await sut.cut(FILE);
  return got.units.some((unit) => unit.text.trim() === SENTENCE)
    ? pass('the reader cut the control sentence')
    : fail(`${CONTROL_FAILED}: no unit of the reader holds the control sentence`);
}

/** The reader is asked for one cut here and one in a sandboxed process; both must give the expected marker. */
async function sandboxCut(sut: PointerSut, expected: string): Promise<Outcome> {
  const here = markerOf(await sut.cut(FILE));
  const child = await runChild({ kind: 'cut', file: FILE }, { timeoutMs: 60_000 });
  try {
    const there = child.output?.ok
      ? markerOf(child.output.result as CutResult)
      : `no output (${child.stderr.slice(0, 120)})`;
    return here === expected && there === expected
      ? pass('both processes ran the reader the harness named')
      : fail(
          `${CONTROL_FAILED}: the reader cut ${JSON.stringify(here)} here and ${JSON.stringify(there)} in the sandboxed process, expected ${JSON.stringify(expected)}`,
        );
  } finally {
    child.cleanup();
  }
}

export async function runControl(control: Control, sut: PointerSut): Promise<Outcome> {
  try {
    if (control.name === 'verdict') return await verdict(sut);
    if (control.name === 'sandbox-cut') return await sandboxCut(sut, control.expect ?? '');
    return fail(`${CONTROL_FAILED}: no control ${String(control.name)}`);
  } catch (cause) {
    return fail(`${CONTROL_FAILED}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
