import { type Obj, pointerExports, Unsupported } from './reader';

const WIRE_FIELDS = ['model', 'system', 'messages', 'output', 'max_tokens', 'thinking'] as const;
const SET_FIELDS = ['name', 'description'] as const;

const readerSet = (set: Obj): Obj => ({
  set: String(set.name),
  description: String(set.description),
  labels: set.labels,
});

/** The wire body is what the provider receives: the request without its set, labeler id and cut digest. */
function wireOf(request: Obj): { labeler: string; body: Obj } {
  const body: Obj = {};
  for (const field of WIRE_FIELDS) if (request[field] !== undefined) body[field] = request[field];
  return { labeler: String(request.labelerId), body };
}

async function readableFor(request: Obj): Promise<Record<string, string>> {
  const pointer = await pointerExports();
  return pointer.readableOf(wireOf(request), {
    path: 'bank.md',
    window: 'bank#1',
    promptVersion: pointer.PROMPT_VERSION,
    schemaVersion: pointer.SCHEMA_VERSION,
    set: String((request.set as Obj).name),
    setHash: pointer.setHash(readerSet(request.set as Obj)),
    model: String(request.model),
    cutDigest: String(request.cutDigest),
    cls: 'system2',
    run: '1',
  });
}

/** The bank's field name for a field the reader names in a miss; a set hash is expanded with the two sets. */
function fieldsOf(differs: string[], request: Obj, entry: Obj): string[] {
  const out = new Set<string>();
  for (const name of differs) {
    if (name.startsWith('part.')) out.add(name.slice(5));
    else if (name === 'model') out.add('model');
    else if (name === 'cutDigest') out.add('cutDigest');
    else if (name === 'labeler') out.add('labelerId');
    else if (name === 'setHash') {
      const a = request.set as Obj;
      const b = entry.set as Obj;
      for (const field of SET_FIELDS) if (a[field] !== b[field]) out.add(`set.${field}`);
      const la = (a.labels as Obj[])[0] ?? {};
      const lb = (b.labels as Obj[])[0] ?? {};
      for (const key of new Set([...Object.keys(la), ...Object.keys(lb)]))
        if (JSON.stringify(la[key]) !== JSON.stringify(lb[key])) out.add(`set.labels.${key}`);
    } else out.add(name);
  }
  return [...out];
}

export async function replayOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  if (input.mode !== 'ci') throw new Unsupported('replay', `no call for the mode ${String(input.mode)}`);
  const cassette = new pointer.Cassette();
  for (const entry of input.entries as Obj[]) {
    const request = entry.request as Obj;
    const answer = entry.answer as Obj;
    cassette.put(wireOf(request), await readableFor(request), {
      labels: answer.labels,
      returnedModel: answer.model,
      stopReason: answer.stop_reason,
      usage: { input: (answer.usage as Obj).input_tokens, output: (answer.usage as Obj).output_tokens },
    });
  }
  const request = input.request as Obj;
  try {
    const hit = cassette.get(wireOf(request), await readableFor(request));
    const answer = hit.answer as Obj;
    return {
      status: 'hit',
      answer: {
        labels: answer.labels,
        model: answer.returnedModel,
        stop_reason: answer.stopReason,
        usage: { input_tokens: answer.usage.input, output_tokens: answer.usage.output },
      },
      networkCalls: 0,
    };
  } catch (thrown) {
    if (!(thrown instanceof pointer.CassetteMiss)) throw thrown;
    const cause = thrown as {
      nearest?: string;
      differs: string[];
      closest?: { key: string; differs: string[] };
    };
    // With no entry of the same set and labeler, the reader names the closest entry of the same file and window.
    const at = cause.nearest ?? cause.closest?.key;
    const differs = cause.nearest === undefined ? (cause.closest?.differs ?? []) : cause.differs;
    if (at === undefined)
      throw new Unsupported('replay', 'the cassette holds no entry of the same file and window to compare');
    const nearest = (input.entries as Obj[]).map((entry) => entry.request as Obj);
    const stored = cassette.entries.get(at);
    const match =
      nearest.find(
        (candidate) =>
          stored &&
          candidate.labelerId === stored.readable.labeler &&
          candidate.cutDigest === stored.readable.cutDigest,
      ) ??
      nearest[0] ??
      {};
    const fields = fieldsOf(differs, request, match);
    if (fields.length !== 1)
      throw new Unsupported(
        'replay',
        `the reader named ${fields.length} differing fields: ${fields.join(', ')}`,
      );
    // A cut mismatch reports the runtimes only when the reader's own diagnostic names both versions.
    const named = (thrown as Error).message;
    const versionsRequired = /\bNode \d[\w.]*/.test(named) && /\bICU \d[\w.]*/.test(named);
    return {
      status: 'miss',
      differingField: fields[0],
      networkCalls: 0,
      ...(fields[0] === 'cutDigest' && versionsRequired ? { versionsRequired: ['node', 'icu'] } : {}),
    };
  }
}
