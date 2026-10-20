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
 * `privacy`: the real `pointerScan` over the private file, for every source, an opaque-only one included. The
 * reader sends the request through its own HTTP client; `fetch` is the harness callback behind it, and the key is
 * read there, when a request is sent (the labeler's own `x-api-key` header is a constant here). It stores the
 * answer itself (`Cassette.put`, whose `onPut` writes to the harness). A replay asks a cassette that reads the
 * harness cache when the reader asks it. What the reader stores and plans is returned beside the labels, so the
 * leak check reads it. Nothing is derived from the requested mode except which of the reader's two scan modes runs,
 * and nothing is decided before the scan: a source with nothing to label sends no request, reads no key and asks
 * no cache because the reader does not, and a reader that does is seen doing it (`blind/CONTRACT.md`, the
 * `spec-changed` fence and comment items).
 */
export async function privacyOp(input: Obj, io: PointerIO | undefined): Promise<unknown> {
  if (!io) throw new Error('the privacy operation needs the harness callbacks');
  const pointer = await pointerExports();
  const record = input.mode === 'record';
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Obj;
    // The key is read where the request leaves: the reader hands the transport a request, the harness holds the key.
    io.readKey();
    const answer = (await io.fetch({ url, headers: init.headers as never, body } as never)) as Obj;
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({ labels: answer.labels }) }],
        model: answer.model,
        stop_reason: answer.stop_reason,
        usage: answer.usage,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  // One run per window: the harness plants one answer, and the reader's default asks the window three times.
  const labeler = pointer.createAnthropicLabeler({
    runs: 1,
    fetch: fetchLike,
    ...(record ? { key: 'recording' } : {}),
  });
  const labelling = pointer.singleLabelling(labeler);
  const cassette = new pointer.Cassette();
  const stored: Obj[] = [];
  let hit: Obj | undefined;
  if (record) {
    cassette.onPut = (entry: Obj) => {
      stored.push(entry);
      io.writeCassette('.cache/cassette.jsonl', [answerOf(entry.answer)] as never, false);
    };
  } else {
    // A replay asks the harness cache for the request it is handed, hit or miss.
    cassette.get = (wire: Obj, readable: Obj) => {
      const key = pointer.requestKey(wire, readable);
      const found = io.readCassette();
      if (found === null) throw new pointer.CassetteMiss(key, [], undefined);
      hit = found as Obj;
      return { key, readable, answer: recordedOf(found as Obj) };
    };
  }
  let plan: Obj | undefined;
  let result: Obj | undefined;
  try {
    result = await pointer.pointerScan({
      files: [{ path: String(input.file), text: String(input.source) }],
      sets: [{ set: 'bank', description: 'bank', labels: [{ name: 'x', description: 'x' }] }],
      labelling,
      cassette,
      mode: record ? 'record' : 'replay',
      onPlan: (value: Obj) => {
        plan = value;
      },
    });
  } catch (thrown) {
    if (!(thrown instanceof pointer.CassetteMiss)) throw thrown;
  }
  io.plan({ characters: String(input.source).length });
  const labels = record ? ((stored[0]?.answer as Obj | undefined)?.labels ?? []) : (hit?.labels ?? []);
  return {
    labels,
    status: result ? 'ok' : 'miss',
    stored: cassette.render(),
    readerPlan: plan,
  };
}
