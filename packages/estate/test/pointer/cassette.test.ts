import { describe, expect, it } from 'vitest';
import { Cassette, CassetteMiss, readableOf, requestKey, type Wire } from '../../src/pointer';

const WIRE: Wire = {
  labeler: 'planted',
  body: { model: 'm-1', system: 'Label the units.', user: 'SET a\n[1] Lock the door.', max_tokens: 100 },
};
const META = {
  path: 'hall.md',
  window: 'hall.md#1',
  promptVersion: 'p1',
  schemaVersion: 's1',
  set: 'a',
  setHash: 'h1',
  model: 'm-1',
  cutDigest: 'cd1',
  cls: 'system2',
  run: '1',
};
const ANSWER = {
  labels: [{ units: '1', label: 'x' }],
  returnedModel: 'm-1',
  stopReason: 'end_turn',
  usage: { input: 10, output: 5 },
};

function recorded(): Cassette {
  const cassette = new Cassette();
  cassette.put(WIRE, readableOf(WIRE, META), ANSWER);
  return cassette;
}

describe('the cassette', () => {
  it('answers the request it recorded', () => {
    expect(recorded().get(WIRE, readableOf(WIRE, META)).answer).toEqual(ANSWER);
  });

  it('dumps the same bytes for the same content, and reads them back', () => {
    const text = recorded().render();
    expect(recorded().render()).toBe(text);
    expect(Cassette.parse(text).render()).toBe(text);
  });

  it('stores no text of the file, only the answer and the readable fields', () => {
    expect(recorded().render()).not.toContain('Lock the door');
  });

  it('misses on any one field of the request and names that field', () => {
    const cassette = recorded();
    const perturbed: Array<[string, Wire, Partial<typeof META>]> = [
      ['part.system', { ...WIRE, body: { ...WIRE.body, system: 'Label the units well.' } }, {}],
      ['part.user', { ...WIRE, body: { ...WIRE.body, user: 'SET a\n[1] Lock the gate.' } }, {}],
      ['part.model', { ...WIRE, body: { ...WIRE.body, model: 'm-2' } }, { model: 'm-2' }],
      ['part.max_tokens', { ...WIRE, body: { ...WIRE.body, max_tokens: 200 } }, {}],
      ['setHash', WIRE, { setHash: 'h2' }],
    ];
    for (const [field, wire, meta] of perturbed) {
      const readable = readableOf(wire, { ...META, ...meta });
      let miss: CassetteMiss | undefined;
      try {
        // The set hash is in the request in real use; here a changed hash alone is read through the key of a changed body.
        cassette.get(
          field === 'setHash' ? { ...WIRE, body: { ...WIRE.body, user: 'other' } } : wire,
          readable,
        );
      } catch (cause) {
        miss = cause as CassetteMiss;
      }
      expect(miss, field).toBeInstanceOf(CassetteMiss);
      expect(miss?.differs, field).toContain(field === 'setHash' ? 'setHash' : field);
    }
  });

  it('names no nearest entry for a file, window and set it has never seen', () => {
    const readable = readableOf(WIRE, { ...META, window: 'other.md#1', path: 'other.md' });
    expect(() => recorded().get({ ...WIRE, body: { ...WIRE.body, user: 'x' } }, readable)).toThrow(
      /no entry of the labeler planted for the same file, window and set/,
    );
  });

  it('names the labeler id of a request no entry of that labeler answers, as a token', () => {
    // One labeler's cassette, asked for the same file, window and set by another: it names the id asked.
    const asked: Wire = { ...WIRE, labeler: 'system2-b7' };
    let miss: CassetteMiss | undefined;
    try {
      recorded().get(asked, readableOf(asked, META));
    } catch (cause) {
      miss = cause as CassetteMiss;
    }
    expect(miss).toBeInstanceOf(CassetteMiss);
    expect(miss?.nearest).toBeUndefined();
    expect(miss?.labeler).toBe('system2-b7');
    expect(miss?.message).toMatch(/(^|[^\w-])system2-b7([^\w-]|$)/);
    expect(miss?.message).not.toMatch(/(^|[^\w-])planted([^\w-]|$)/);
  });

  it('refuses a hit whose cut digest differs: the cutter changed under the same request', () => {
    const cassette = recorded();
    expect(() => cassette.get(WIRE, readableOf(WIRE, { ...META, cutDigest: 'cd2' }))).toThrow(
      /differs in: cutDigest/,
    );
  });

  it('names the Node and ICU versions of this run when the cut digest is what differs', () => {
    const cassette = recorded();
    let message = '';
    try {
      cassette.get(WIRE, readableOf(WIRE, { ...META, cutDigest: 'cd2' }));
    } catch (cause) {
      message = (cause as Error).message;
    }
    expect(message).toContain(`Node ${process.versions.node}`);
    expect(message).toContain(`ICU ${process.versions.icu}`);
  });

  it('names no version when the cut digest is not what differs', () => {
    const cassette = recorded();
    expect(() => cassette.get(WIRE, readableOf(WIRE, { ...META, setHash: 'h2' }))).not.toThrow(/ICU/);
  });

  it('keys the whole request and everything that identifies it, labeler id included', () => {
    const key = (wire: Wire, meta: Partial<typeof META> = {}) =>
      requestKey(wire, readableOf(wire, { ...META, ...meta }));
    expect(key(WIRE)).not.toBe(key({ ...WIRE, labeler: 'other' }));
    expect(key({ labeler: 'a', body: { x: 1, y: 2 } })).toBe(key({ labeler: 'a', body: { y: 2, x: 1 } }));
  });

  it('misses when only what the body does not hold differs: the model, the set hash, the run, the prompt', () => {
    const cassette = recorded();
    const others: Array<[string, Partial<typeof META>]> = [
      ['model', { model: 'm-2' }],
      ['setHash', { setHash: 'h2' }],
      ['run', { run: '2' }],
      ['promptVersion', { promptVersion: 'p2' }],
      ['schemaVersion', { schemaVersion: 's2' }],
      ['cls', { cls: 'system1' }],
    ];
    for (const [field, meta] of others) {
      let miss: CassetteMiss | undefined;
      try {
        cassette.get(WIRE, readableOf(WIRE, { ...META, ...meta }));
      } catch (cause) {
        miss = cause as CassetteMiss;
      }
      expect(miss, field).toBeInstanceOf(CassetteMiss);
      expect(miss?.differs, field).toEqual([field]);
    }
  });

  it('keeps two answers that differ only by what the body does not hold', () => {
    const cassette = recorded();
    cassette.put(WIRE, readableOf(WIRE, { ...META, run: '2' }), { ...ANSWER, returnedModel: 'second' });
    expect(cassette.entries.size).toBe(2);
    expect(cassette.get(WIRE, readableOf(WIRE, { ...META, run: '2' })).answer.returnedModel).toBe('second');
    expect(cassette.get(WIRE, readableOf(WIRE, META)).answer.returnedModel).toBe('m-1');
  });

  it('refuses a file that is not JSON lines', () => {
    expect(() => Cassette.parse('not json\n')).toThrow(/line 1/);
    expect(() => Cassette.parse('{"a":1}\n')).toThrow(/not an entry/);
  });
});
