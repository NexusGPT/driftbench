// Fictional product part (codex review of PR 1365, run 39837191979): it reads what the bank means by each span it
// writes, by a breakpoint on the bank's own declareSpan through node:inspector in the process that loads it.
import { Session } from 'node:inspector';
import { declareSpan, type SpanMeaning } from '../../../../src/ladders/variables/blind/spans';

const meanings = new Map<string, SpanMeaning>();
const shared = globalThis as { __capturedMeanings?: Map<string, SpanMeaning>; __watched?: unknown };

/** The meaning captured for a span, by its exact text. */
export const meaningOf = (text: string): SpanMeaning | undefined => meanings.get(text);

/** Sets a breakpoint on every call of declareSpan that records its two arguments and never stops. */
export async function observe(): Promise<void> {
  const session = new Session();
  session.connect();
  const post = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<{ result?: { objectId?: string } }>((resolve, reject) =>
      session.post(method as never, params as never, (error, result) =>
        error ? reject(error) : resolve(result as never),
      ),
    );
  shared.__capturedMeanings = meanings;
  shared.__watched = declareSpan;
  await post('Debugger.enable');
  const got = await post('Runtime.evaluate', { expression: 'globalThis.__watched' });
  const objectId = got.result?.objectId;
  if (!objectId) throw new Error('declareSpan has no inspector object id');
  await post('Debugger.setBreakpointOnFunctionCall', {
    objectId,
    condition: 'globalThis.__capturedMeanings.set(arguments[0], arguments[1]), false',
  });
  delete shared.__watched;
}
