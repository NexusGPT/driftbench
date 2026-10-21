import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { RUNS } from '../../src/ladders/pointer/kit/fixture';
import type { PointerSut, ScanRequest, Transport } from '../../src/ladders/pointer/sut/port';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';

/**
 * Cause review of the pointer bank: an item fails for the cause it names, and for no earlier one. For each repaired
 * item the reference reader passes it, and a reader planted with the bug of its cause fails it with the words of
 * that cause. The positive fixture of a replay item has to pass on the reference before the item reaches its own check.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
async function run(id: string, sut: PointerSut) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    return await runItem(item(id), 1, sut);
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}
const mutant = (name: string, scan: (request: ScanRequest) => ReturnType<PointerSut['scan']>): PointerSut => ({
  ...ref,
  name,
  scan,
});

/** A reader that replays a stale cassette as if it were the committed one: it never checks the readable fields of a hit. */
const acceptsStale = (): PointerSut => {
  let calls = 0;
  let committed = '';
  return mutant('accepts-stale-readable-fields', (request) => {
    calls += 1;
    if (calls === 1) committed = request.cassette?.text ?? '';
    return ref.scan({ ...request, cassette: { mode: 'replay', text: committed } });
  });
};

/** A reader whose replay is not frozen: from its second replay on it also asks the transport, and ignores the answer. */
const reasks = (): PointerSut => {
  let replays = 0;
  return mutant('replay-asks-again', async (request) => {
    const out = await ref.scan(request);
    if (request.cassette?.mode === 'replay') replays += 1;
    if (replays > 1 && request.model)
      await request.model.transport({ url: 'https://reader.invalid', headers: {}, body: '{}' });
    return out;
  });
};

/** A reader whose replays differ from one call to the next. */
const drifts = (): PointerSut => {
  let calls = 0;
  return mutant('replay-drifts', async (request) => {
    const out = await ref.scan(request);
    calls += 1;
    return out.ledger ? { ...out, ledger: { ...out.ledger, raw: `${out.ledger.raw}${' '.repeat(calls)}` } } : out;
  });
};

/** A reader whose miss says only that the cassette has no answer: it names no field. */
const unnamedMiss = (): PointerSut =>
  mutant('miss-names-nothing', async (request) => {
    const out = await ref.scan(request);
    return out.ok ? out : { ...out, error: 'the cassette has no answer' };
  });

/** A reader that asks one request per window and set, whatever the number of independent runs. */
const asksOnce = (): PointerSut =>
  mutant('asks-once', (request) => {
    if (!request.model) return ref.scan(request);
    const inner = request.model.transport;
    const seen = new Map<string, ReturnType<Transport>>();
    const transport: Transport = (call) => {
      let answer = seen.get(call.body);
      if (!answer) {
        answer = inner(call);
        seen.set(call.body, answer);
      }
      return answer;
    };
    return ref.scan({ ...request, model: { ...request.model, transport } });
  });

/** A reader that reports no event per id, as the product reader does until it exposes `eventsById`. */
const noEventsById = (): PointerSut =>
  mutant('no-events-by-id', async (request) => {
    const { events: _events, ...rest } = await ref.scan(request);
    return rest;
  });

describe('a replay item fails only for the cause it names', () => {
  const cases: Array<[string, () => PointerSut, RegExp]> = [
    ['replay.answers-frozen-despite-random-transport', reasks, /replay used random transport or changed ledger/],
    ['replay.replay-twice-identical', drifts, /two fixture replays differ/],
    ['replay.miss-names-new-file', unnamedMiss, /miss does not name/],
    ['replay.fixture-haiku-replays-committed', acceptsStale, /a one-field stale cassette was accepted/],
    ['replay.fixture-miss-names-prompt-version', acceptsStale, /a one-field stale cassette was accepted/],
    ['replay.fixture-miss-names-model', acceptsStale, /a one-field stale cassette was accepted/],
    ['replay.fixture-jev-replays-committed', acceptsStale, /a one-field stale cassette was accepted/],
  ];
  for (const [id, plant, words] of cases) {
    it(`${id}: the positive fixture passes, the planted bug fails the named check`, async () => {
      expect(await run(id, ref), id).toMatchObject({ pass: true });
      const planted = await run(id, plant());
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(words);
      // The fixture replay is not what failed.
      expect(planted.detail, id).not.toContain('positive witness');
    }, 120_000);
  }
  it('every replay item passes its positive fixture on the reference', async () => {
    for (const x of bank.filter((i) => i.family === 'replay')) {
      const out = await run(x.id, ref);
      expect(out, x.id).toMatchObject({ pass: true });
    }
  }, 600_000);
});

describe('the replay items that read the readable fields of a hit name one cause', () => {
  it('an item a reader fails by accepting a stale field names the cassette field check', async () => {
    const wrong: string[] = [];
    let stale = 0;
    for (const x of bank.filter((i) => i.family === 'replay')) {
      const out = await run(x.id, acceptsStale());
      if (out.pass || !/a one-field stale cassette was accepted/.test(out.detail)) continue;
      stale += 1;
      if (x.cause !== 'cassette:miss-names-field') wrong.push(`${x.id} (${x.cause})`);
    }
    expect(wrong).toEqual([]);
    // Twelve fixture items, the tampered cut digest and the cut digest mismatch.
    expect(stale).toBe(14);
  }, 600_000);
});

describe('the Jev replay setting is reached offline', () => {
  it('labels.jev-threshold-is-a-replay-setting: the reference passes, a reader that ignores the threshold fails', async () => {
    const id = 'labels.jev-threshold-is-a-replay-setting';
    expect(await run(id, ref), id).toMatchObject({ pass: true });
    const ignores = mutant('ignores-the-threshold', (request) =>
      ref.scan(request.model ? { ...request, model: { ...request.model, threshold: undefined } } : request),
    );
    const planted = await run(id, ignores);
    expect(planted.pass, id).toBe(false);
    expect(planted.detail, id).toMatch(/must be none|expected none/);
  }, 120_000);
});

describe('the call count of the system 2 labeler follows the documented contract', () => {
  it('labels.haiku-dense-request: one dense request per window and run, three independent runs', async () => {
    const id = 'labels.haiku-dense-request';
    expect(RUNS.haiku).toBe(3);
    expect(await run(id, ref), id).toMatchObject({ pass: true });
    const planted = await run(id, asksOnce());
    expect(planted.pass, id).toBe(false);
    expect(planted.detail, id).toContain('2 requests for 2 files, expected 6');
  }, 120_000);
  for (const id of [
    'labels.haiku-thinking-block-first',
    'labels.haiku-stop-reason-refused',
    'labels.haiku-refuse-wrong-window-or-set',
  ]) {
    it(`${id}: counts the requests of every run`, async () => {
      expect(await run(id, ref), id).toMatchObject({ pass: true });
    }, 120_000);
  }
});

/** The cause an item names when the reader gives no event for an id. */
const EVENTS_CAUSE = 'scan:events-by-id';

describe('an item that reads the event of each id names the missing observation', () => {
  const MISSING = /does not expose an event for/;
  const families = new Set(['re-anchoring', 'adversarial', 'ids', 'labels']);
  it('the four sampled items name it and pass on a reader that reports the events', async () => {
    for (const id of [
      'adversarial.swap-texts-in-place',
      're-anchoring.file-rename',
      're-anchoring.rewrap',
      're-anchoring.rewrite-similar-to-neighbour',
    ]) {
      expect(item(id).cause, id).toBe(EVENTS_CAUSE);
      expect(await run(id, ref), id).toMatchObject({ pass: true });
      const planted = await run(id, noEventsById());
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(MISSING);
    }
  }, 300_000);
  it('an item fails for the missing event exactly when it names that cause', async () => {
    const wrong: string[] = [];
    for (const x of bank.filter((i) => families.has(i.family))) {
      const out = await run(x.id, noEventsById());
      const missing = !out.pass && MISSING.test(out.detail);
      if (missing !== (x.cause === EVENTS_CAUSE)) wrong.push(`${x.id} (${x.cause}): ${out.detail.slice(0, 80)}`);
    }
    expect(wrong).toEqual([]);
  }, 900_000);
});
