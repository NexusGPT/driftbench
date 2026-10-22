import { describe, expect, it } from 'vitest';
import { type PointerAdapter, pointerBank, runItem } from '../../src/ladders/pointer/blind/bank';
import { blindBinding } from '../../src/ladders/pointer/sut/blind-binding/index';

/**
 * Three blind links items declared a per-rule sub-rule of one module. The independent review found the same
 * missing module for all three: the classify step (layer C) is absent from the reader. Only the cause tag changed.
 */

const TAG = 'links:layer-c-classify-missing';
const bank = pointerBank();
const byId = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

/** Item id, then the planted state of each link in the first probe and in the contrasting probe (seed 1). */
const RETAGGED: Array<[string, string[], string[]]> = [
  ['pointer.links.move-with-same-context', ['ok'], ['suspect']],
  ['pointer.links.changed-next-to-unchanged', ['suspect', 'ok'], ['ok', 'suspect']],
  ['pointer.links.merged-next-to-deleted', ['suspect', 'suspect'], ['ok', 'ok']],
];

const unused = async (): Promise<never> => {
  throw new Error('the links operation does not resolve a reader port');
};

/** The scripted reference: it answers each probe with its own planted truth. */
function reference(id: string): PointerAdapter {
  const probes = byId(id).generate(1).probes;
  let at = 0;
  return {
    async execute() {
      const found = probes[at++];
      if (!found) throw new Error('missing scripted probe');
      return structuredClone(found.expected);
    },
  };
}

describe('the three layer C classify items carry the missing module as their cause', () => {
  it('carry the new tag and no longer declare a per-rule sub-rule', () => {
    for (const [id] of RETAGGED) expect(byId(id).cause, id).toBe(TAG);
    const old = [
      'track-links-by-ledger-id',
      'classify-each-link-independently',
      'preserve-every-suspect-link',
    ];
    for (const [id] of RETAGGED) expect(old, id).not.toContain(byId(id).cause);
  });

  it('keep their ids and their planted truth, link state by link state', () => {
    for (const [id, first, second] of RETAGGED) {
      const probes = byId(id).generate(1).probes;
      expect(probes, id).toHaveLength(2);
      const states = probes.map((probe) =>
        (probe.expected as { links: Array<{ state: string }> }).links.map((link) => link.state),
      );
      expect(states[0], id).toEqual(first);
      expect(states[1], id).toEqual(second);
    }
  });

  it('count the same ids in the bank: no item is added or removed', () => {
    const ids = bank.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id] of RETAGGED) expect(ids).toContain(id);
  });

  it('are green on the scripted reference', async () => {
    for (const [id] of RETAGGED) expect((await runItem(byId(id), 1, reference(id))).pass, id).toBe(true);
  });

  it('stay red on the real reader, as before: the links call is unsupported there', async () => {
    const binding = blindBinding(unused);
    for (const [id] of RETAGGED) expect((await runItem(byId(id), 1, binding)).pass, id).toBe(false);
  });
});
