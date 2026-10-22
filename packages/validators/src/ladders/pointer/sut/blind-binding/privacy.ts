import type { PointerIO } from '../../blind/bank/index';
import { type Json, type Obj, pointerExports, Unsupported } from './reader';

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

/** The status of a scan that sent no request. */
export const NO_REQUEST = 'no-request';

/**
 * `privacy`: the real `pointerScan` over the private file. The reader reads the key itself (its labeler factory
 * reads `ANTHROPIC_API_KEY` from `env`, a getter that asks the harness), sends the request itself (`fetch` is the
 * harness callback behind the reader's own HTTP client), and stores the answer itself (`Cassette.put`, whose
 * `onPut` writes to the harness). A replay asks a cassette that reads the harness cache. What the reader stores
 * and plans is returned beside the labels, so the leak check reads it. Nothing is derived from the requested mode
 * except which of the reader's two scan modes runs.
 *
 * A file the scan sends no request for (a fence or a comment is opaque) never reaches the recorder: the result
 * carries the status `no-request` and the item differs from the contract, which expects a request.
 *
 * The result also carries `requests`: the body of each request the reader sent (a record) or would send (a replay
 * asks the cassette with it). The headers, where the key travels, are not part of it.
 */
export async function privacyOp(input: Obj, io: PointerIO | undefined): Promise<unknown> {
  if (!io) throw new Error('the privacy operation needs the harness callbacks');
  const pointer = await pointerExports();
  const record = input.mode === 'record';
  const env = {
    get ANTHROPIC_API_KEY(): string {
      return io.readKey();
    },
  };
  const requests: Json[] = [];
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Obj;
    requests.push(body as Json);
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
  const built = await pointer.buildLabelling([{ cls: 'system2', client: 'anthropic' }], {
    env,
    record,
    cwd: '.',
    fetch: fetchLike,
  });
  if (!built.ok) throw new Error(built.message);
  const [member] = built.labelling.members as Obj[];
  // One run per window: the harness plants one answer, and the reader's default asks the window three times.
  const labelling = pointer.singleLabelling({ ...member, runs: 1 });
  const cassette = new pointer.Cassette();
  const stored: Obj[] = [];
  if (record) {
    cassette.onPut = (entry: Obj) => {
      stored.push(entry);
      io.writeCassette('.cache/cassette.jsonl', [answerOf(entry.answer)] as never, false);
    };
  } else {
    // A replay asks the harness cache for the request it is handed, hit or miss.
    cassette.get = (wire: Obj, readable: Obj) => {
      requests.push(wire.body as Json);
      const key = pointer.requestKey(wire, readable);
      const found = io.readCassette();
      if (found === null) throw new pointer.CassetteMiss(key, [], undefined);
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
  const windows = ((plan?.members ?? []) as Obj[]).reduce((sum, entry) => sum + Number(entry.windows), 0);
  // The contract expects the recorder to be reached for any file; a scan with no window sends no request. That is
  // the reader's behaviour, reported as an observation that differs, not as a missing call.
  if (windows === 0)
    return { labels: [], status: NO_REQUEST, stored: cassette.render(), readerPlan: plan, requests };
  io.plan({ characters: String(input.source).length });
  const labels = record
    ? ((stored[0]?.answer as Obj | undefined)?.labels ?? [])
    : result
      ? ((io.readCassette() as Obj | null)?.labels ?? [])
      : [];
  return {
    labels,
    status: result ? 'ok' : 'miss',
    stored: cassette.render(),
    readerPlan: plan,
    requests,
  };
}
