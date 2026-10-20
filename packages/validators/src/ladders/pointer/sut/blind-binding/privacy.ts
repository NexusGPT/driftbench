import type { PointerIO } from '../../blind/bank/index';
import { type Obj, pointerExports } from './reader';

const answerOf = (recorded: Obj) => ({
  labels: recorded.labels,
  model: recorded.returnedModel,
  stop_reason: recorded.stopReason,
  usage: { input_tokens: recorded.usage.input, output_tokens: recorded.usage.output },
});

const recordedOf = (answer: Obj) => ({
  labels: answer.labels,
  returnedModel: answer.model,
  stopReason: answer.stop_reason,
  usage: { input: answer.usage.input_tokens, output: answer.usage.output_tokens },
});

/**
 * `privacy`: the recorder seam of the reader, driven through its own `Cassette`. The request goes on the wire the
 * way a labeler renders it; a record-mode miss reads the key and fetches through the harness callbacks, and the
 * answer is stored by `Cassette.put`, whose `onPut` writes it to the harness. A replay reads the stored answer
 * through the cassette and never fetches or reads the key. A replay miss is a `CassetteMiss`. The plan is a count of
 * characters, normalised to the characters of the source as the contract (`blind/CONTRACT.md`) allows; no text
 * reaches a log or a plan.
 */
export async function privacyOp(input: Obj, io: PointerIO | undefined): Promise<unknown> {
  if (!io) throw new Error('the privacy operation needs the harness callbacks');
  const pointer = await pointerExports();
  const request = input.request as Obj;
  const wire = { labeler: 'bank', body: request };
  const readable = pointer.readableOf(wire, {
    path: String(input.file),
    window: 'bank#1',
    promptVersion: pointer.PROMPT_VERSION,
    schemaVersion: pointer.SCHEMA_VERSION,
    set: 'bank',
    setHash: 'bank',
    model: 'bank',
    cutDigest: 'bank',
    cls: 'system2',
    run: '1',
  });
  const cassette = new pointer.Cassette();
  io.plan({ characters: String(input.source).length });
  // The stored answer comes from the harness cache, read when the cassette is asked for the request.
  const stored = io.readCassette();
  if (stored !== null) cassette.put(wire, readable, recordedOf(stored as Obj));
  // Only an answer recorded now is written; the stored one is read, never rewritten.
  cassette.onPut = (entry: Obj) =>
    io.writeCassette('.cache/cassette.jsonl', [answerOf(entry.answer)] as never, false);
  try {
    cassette.get(wire, readable);
  } catch (thrown) {
    if (!(thrown instanceof pointer.CassetteMiss)) throw thrown;
    if (input.mode !== 'record') return { labels: [], status: 'miss' };
    io.readKey();
    const fetched = (await io.fetch(request as never)) as Obj;
    cassette.put(wire, readable, recordedOf(fetched));
    return { labels: fetched.labels, status: 'ok' };
  }
  return { labels: (stored as Obj).labels, status: 'ok' };
}
