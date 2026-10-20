import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const calls: string[][] = [];
vi.mock('../../src/ladders/estate/bank/bench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/bank/bench')>();
  return {
    ...actual,
    cli: (args: string[]) => {
      calls.push(args);
      return { code: 0, out: '{"runs":[]}' };
    },
  };
});

const { FIXTURE, runOnFakeDetailed } = await import('../../src/ladders/estate/bank/fixture-suite');

/** The values of every `--set-env` option of a call. */
const envOf = (args: readonly string[]): string[] =>
  args.flatMap((arg, at) => (args[at - 1] === '--set-env' ? [arg] : []));

describe('the kill.fake cells hand the fake the map and the phrase bank of the fixture', () => {
  it('on the original estate and on a mutant copy alike', () => {
    for (const estate of [FIXTURE, '/tmp/a-mutant-copy']) {
      calls.length = 0;
      runOnFakeDetailed(estate, ['spec.yaml'], '/tmp/store.db', undefined);
      expect(envOf(calls[0] ?? [])).toEqual([
        `FAKE_MAP=${join(FIXTURE, 'approved.yaml')}`,
        `FAKE_PHRASES=${join(FIXTURE, 'phrases.yaml')}`,
      ]);
    }
  });

  it('keeps the map pin of the run apart from the map the fake reads', () => {
    calls.length = 0;
    runOnFakeDetailed(FIXTURE, ['spec.yaml'], '/tmp/store.db', join(FIXTURE, 'approved.yaml'));
    const args = calls[0] ?? [];
    expect(args[args.indexOf('--map') + 1]).toBe(join(FIXTURE, 'approved.yaml'));
    expect(envOf(args)).toHaveLength(2);
  });
});
