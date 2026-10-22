import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEstateMapText } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { askGrammar } from '../../src/ladders/estate/ask-grammar';
import type { MapAtom } from '../../src/ladders/estate/reference-ask';

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

/** The grammar the fixture's approved map generates, as ask-grammar.ts builds it. */
function expectedGrammar(): string {
  const parsed = parseEstateMapText(readFileSync(join(FIXTURE, 'approved.yaml'), 'utf8'));
  if (!parsed.ok) throw new Error('the fixture map does not load');
  return JSON.stringify(askGrammar(parsed.map.atoms as unknown as MapAtom[]));
}

/** The env entries with the grammar file, a path of the run, replaced by the grammar it holds. */
function resolved(env: readonly string[]): string[] {
  return env.map((entry) =>
    entry.startsWith('FAKE_GRAMMAR=')
      ? `FAKE_GRAMMAR:${readFileSync(entry.slice('FAKE_GRAMMAR='.length), 'utf8')}`
      : entry,
  );
}

describe('the kill.fake cells hand the fake the map, the phrase bank and the grammar of the fixture', () => {
  it('on the original estate and on a mutant copy alike', () => {
    for (const estate of [FIXTURE, '/tmp/a-mutant-copy']) {
      calls.length = 0;
      runOnFakeDetailed(estate, ['spec.yaml'], '/tmp/store.db', undefined);
      expect(resolved(envOf(calls[0] ?? []))).toEqual([
        `FAKE_MAP=${join(FIXTURE, 'approved.yaml')}`,
        `FAKE_PHRASES=${join(FIXTURE, 'phrases.yaml')}`,
        `FAKE_GRAMMAR:${expectedGrammar()}`,
      ]);
    }
  });

  it('keeps the map pin of the run apart from the map the fake reads', () => {
    calls.length = 0;
    runOnFakeDetailed(FIXTURE, ['spec.yaml'], '/tmp/store.db', join(FIXTURE, 'approved.yaml'));
    const args = calls[0] ?? [];
    expect(args[args.indexOf('--map') + 1]).toBe(join(FIXTURE, 'approved.yaml'));
    expect(envOf(args).map((entry) => entry.split('=')[0])).toEqual([
      'FAKE_MAP',
      'FAKE_PHRASES',
      'FAKE_GRAMMAR',
    ]);
  });
});
