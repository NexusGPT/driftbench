import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BankItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import { findRoot } from '../../src/root';

/**
 * The variables bank under the frame (docs/validators.md section 12.9). The cheater audit of the second variables
 * bank (head bd2510d2d) wrote products around the real adapter that raised the score of the bank without being
 * right: one read the bank's own table of what the spans mean, one rewrote the report lines of the bank's child
 * process, one did its work in a child process the processor time did not count, and four broke the product above
 * the sizes and on the inputs the bank did not send (coverage above 10,000 rows, a file over 3 MB, a quote with an
 * emoji, a pattern written for the wording of the fixtures). Each runs here as the product of the bank child, and
 * none may pass an item that the adapter itself fails; the ones that break a component must fail the item that asks.
 */

vi.setConfig({ testTimeout: 1_800_000, hookTimeout: 1_800_000 });

const ROOT = findRoot(process.cwd());
const SEED = 1;
const CHEATS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cheats');

/** The items the cheats are measured on: the items added after the audit, and the ones the cheats aimed at. */
const NEW_STEMS = [
  'blind.weights.interval-refuses.',
  'blind.counter.many-rows.',
  'blind.counter.constraints.',
  'blind.quotes.large-file.',
  'blind.quotes.emoji.',
  'blind.plan.rules.',
];
const AIMED = [
  'scale.estate-spans.two-hundred',
  'blind.scale.readers.spans-200',
  'scale.pairwise-binary.n100',
  'blind.reach.weight-interval.mapped',
  'blind.reach.coverage.mapped',
  'blind.reach.quotes.mapped',
  'blind.reach.plan.mapped',
  'values.input-not-mutated.estate',
  'values.input-not-mutated.conversations',
  'values.input-not-mutated.owner',
];
const items: BankItem[] = variablesBank().filter(
  (item) => NEW_STEMS.some((stem) => item.id.startsWith(stem)) || AIMED.includes(item.id),
);

type Outcome = Map<string, { pass: boolean; detail: string }>;

const before = process.env.DRIFTBENCH_VARIABLES_IMPL;
afterEach(() => {
  if (before === undefined) delete process.env.DRIFTBENCH_VARIABLES_IMPL;
  else process.env.DRIFTBENCH_VARIABLES_IMPL = before;
});

const runs = new Map<string, Promise<Outcome>>();
/** The outcome of every item when the bank child tests the product module `name` of the fixtures. */
function outcomes(name: string): Promise<Outcome> {
  let run = runs.get(name);
  if (!run) {
    process.env.DRIFTBENCH_VARIABLES_IMPL = join(CHEATS, `${name}.ts`);
    run = runIsolated(items, SEED, ROOT, undefined, 1).then((got) => got as Outcome);
    runs.set(name, run);
  }
  return run;
}

const passing = (got: Outcome): Set<string> =>
  new Set(items.filter((item) => got.get(item.id)?.pass).map((item) => item.id));

describe('the cheating products of the variables audit', () => {
  it('the adapter passes the items added after the audit', async () => {
    const got = await outcomes('honest');
    const failed = items
      .filter((item) => NEW_STEMS.some((stem) => item.id.startsWith(stem)))
      .filter((item) => !got.get(item.id)?.pass)
      .map((item) => `${item.id}: ${got.get(item.id)?.detail}`);
    expect(failed).toEqual([]);
  });

  it.each([
    'oracle',
    'symbol-regex',
    'phrase-regex',
    'stdout',
    'child-burn',
    'coverage-big',
    'quotes-big',
    'quotes-emoji',
    'write-restore',
  ])('%s passes no item that the adapter fails', async (name) => {
    const honest = passing(await outcomes('honest'));
    const cheat = passing(await outcomes(name));
    expect([...cheat].filter((id) => !honest.has(id))).toEqual([]);
  });

  it('a product that imports the bank to read its table of spans does not load', async () => {
    const got = await outcomes('oracle');
    expect(passing(got).size).toBe(0);
    expect(got.get('blind.scale.readers.spans-200')?.detail).toMatch(/blind\/spans\.ts/);
  });

  it('a pattern written for one wording of the spans reads no scale estate', async () => {
    for (const name of ['symbol-regex', 'phrase-regex']) {
      const got = await outcomes(name);
      expect(got.get('scale.estate-spans.two-hundred')?.pass, name).toBe(false);
      expect(got.get('blind.scale.readers.spans-200')?.pass, name).toBe(false);
    }
  });

  it('report lines a product prints for itself pass no item', async () => {
    const got = await outcomes('stdout');
    expect(got.get('scale.estate-spans.two-hundred')?.pass).toBe(false);
    expect(got.get('blind.scale.readers.spans-200')?.pass).toBe(false);
  });

  it('a product that starts a child process for its work fails the scale item that sends it 100 variables', async () => {
    const honest = await outcomes('honest');
    const got = await outcomes('child-burn');
    expect(honest.get('scale.pairwise-binary.n100')?.pass).toBe(true);
    expect(got.get('scale.pairwise-binary.n100')?.pass).toBe(false);
  });

  it.each([
    ['write-restore', 'values.input-not-mutated.estate'],
    ['write-restore', 'values.input-not-mutated.owner'],
    ['coverage-big', 'blind.counter.many-rows.twenty-thousand-full-rows'],
    ['coverage-big', 'blind.counter.many-rows.twenty-thousand-partial-rows'],
    ['quotes-big', 'blind.quotes.large-file.wrong-quote-at-the-end-of-five-megabytes-is-reported'],
    ['quotes-big', 'blind.quotes.large-file.wrong-quote-in-ten-megabytes-is-reported'],
    ['quotes-emoji', 'blind.quotes.emoji.wrong-quote-with-a-rocket-is-reported'],
    ['quotes-emoji', 'blind.quotes.emoji.wrong-quote-with-a-check-mark-is-reported'],
  ])('%s fails %s', async (name, id) => {
    const got = await outcomes(name);
    expect(got.get(id)?.pass, got.get(id)?.detail).toBe(false);
  });
});
