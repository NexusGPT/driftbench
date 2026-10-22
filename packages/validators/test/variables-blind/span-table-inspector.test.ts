import { Session } from 'node:inspector';
import { describe, expect, it } from 'vitest';
import * as spans from '../../src/ladders/variables/blind/spans';

/**
 * The residual of the span table, written as a test (review of #1365, run 39837191979). The table is no longer
 * reachable by import or by the public sink, but the bank still declares each meaning by calling `declareSpan` in the
 * process that loads the implementation. A product can attach a conditional breakpoint to that function through
 * node:inspector, read its two arguments and label spans from them, without ever calling `setSpanSink`.
 *
 * The real fix is that the meanings never exist in the product's process: the bank declares them in the validator's
 * process and the product only receives texts (the frame isolation work of docs/validators.md 12.9, queued for
 * opus-stats-986). Until then:
 * - the first test pins that the attack works today, so nobody reads the claim as closed;
 * - the second test states the property the frame work must give and is an expected failure (`it.fails`), so it turns
 *   into a failing test the day the frame work makes the property true and the marker must go.
 */

const post = (session: Session, method: string, params?: object): Promise<any> =>
  new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => (error ? reject(error) : resolve(result)));
  });

/** Attaches a conditional breakpoint to `fn` that copies its arguments out, runs `run`, and returns what it saw. */
async function observe(fn: (...args: any[]) => unknown, argNames: string[], run: () => void): Promise<unknown[][]> {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__observed = [];
  g.__target = fn;
  const session = new Session();
  session.connect();
  try {
    await post(session, 'Debugger.enable');
    const { result } = await post(session, 'Runtime.evaluate', { expression: '__target' });
    await post(session, 'Debugger.setBreakpointOnFunctionCall', {
      objectId: result.objectId,
      condition: `(globalThis.__observed.push([${argNames.join(', ')}]), false)`,
    });
    run();
    return g.__observed as unknown[][];
  } finally {
    session.disconnect();
    delete g.__observed;
    delete g.__target;
  }
}

describe('the span table against an observer inside the process', () => {
  it('control: the observer captures the arguments of an ordinary function', async () => {
    const f = (a: string, b: number): void => void [a, b];
    const seen = await observe(f, ['a', 'b'], () => f('x', 7));
    expect(seen).toEqual([['x', 7]]);
  });

  it('today the observer reads the meaning of every declared span, with no sink set', async () => {
    spans.setSpanSink(undefined);
    const seen = await observe(spans.declareSpan, ['text', 'meaning'], () => {
      spans.numeric('the audit value is above 12 euros', 'the audit value', 12, 'gt');
    });
    expect(seen.length).toBe(1);
    expect(seen[0]?.[0]).toBe('the audit value is above 12 euros');
    expect(seen[0]?.[1]).toMatchObject({ kind: 'numeric', limit: 12 });
  });

  // Expected failure until the implementation runs in its own process (frame work, docs/validators.md 12.9).
  it.fails('the observer reads no meaning of a declared span', async () => {
    spans.setSpanSink(undefined);
    const seen = await observe(spans.declareSpan, ['text', 'meaning'], () => {
      spans.numeric('the audit value is above 12 euros', 'the audit value', 12, 'gt');
    });
    expect(seen.length).toBe(0);
  });
});
