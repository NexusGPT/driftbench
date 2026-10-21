import { describe, expect, it } from 'vitest';
import { createDefaultJudge } from '../src/default-judge';
import v7 from './fixtures/default-v7-identity.json';
import expected from './fixtures/default-writing-sequence-hashes.json';
import fixtures from './fixtures/default-writing-sequences.json';
import { writingSequence } from './support/writing-sequence';

describe('undeclared writing metrics retain the pre-intent model program', () => {
  it.each(fixtures)('sends the identical request sequence for $id', async (fixture) => {
    const actual = await writingSequence(createDefaultJudge, fixture);
    const old = (expected as Array<{ id: string; hashes: string[]; sequenceHash: string }>).find(
      (row) => row.id === fixture.id,
    );
    expect(old, 'the independently captured pre-intent sequence must exist').toBeDefined();
    console.log(JSON.stringify({ id: fixture.id, old: old?.sequenceHash, final: actual.sequenceHash }));
    expect(actual.requests[0]?.system).toBe(v7.router);
    expect(actual.route).toBe(fixture.route);
    expect(actual.hashes).toEqual(old?.hashes);
    expect(actual.sequenceHash).toBe(old?.sequenceHash);
    expect(
      actual.requests.every((request) => !JSON.stringify(request.schema).includes('request-fulfillment')),
    ).toBe(true);
  });
});
