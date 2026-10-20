import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { atomWords, readsAsCodeAsk } from '../../src/ladders/estate/reference-ask';

const flags = vi.hoisted(() => ({ mutate: false, text: 'Please sort review baskets.' }));

vi.mock('../../src/ladders/estate/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/pipeline')>();
  return { ...actual, estateRun: vi.fn(actual.estateRun) };
});
// The reviewer's mutant of the product: every ask the generator writes by code becomes one sentence.
vi.mock('../../../generate/src/estate/asks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../generate/src/estate/asks')>();
  return {
    ...actual,
    codeAsk: (...args: Parameters<typeof actual.codeAsk>) => {
      const out = actual.codeAsk(...args);
      return flags.mutate && out.text !== undefined ? { ...out, text: flags.text } : out;
    },
  };
});

const MUTANT = flags.text;

// The estate run of a seed is cached for the process: the mutant runs on its own seed.
async function run(seed: number) {
  const actual = await vi.importActual<typeof pipeline>('../../src/ladders/estate/pipeline');
  vi.mocked(pipeline.estateRun).mockImplementation((seed, profile) => actual.estateRun(seed, profile));
  return genAsksFamily().evaluate(seed);
}

describe('gen.asks judges a code-written ask by the document, not by the product', {
  timeout: 300_000,
}, () => {
  afterEach(() => {
    flags.mutate = false;
    vi.mocked(pipeline.estateRun).mockReset();
  });

  it('names the disclosed specs of a product that writes one ask for every row it writes by code', async () => {
    flags.mutate = true;
    const out = await run(2);
    const result = out.get('gen.asks.asks-approved');
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('complete specs ask an unapproved phrase');
    expect(result?.detail).toContain(MUTANT);
    expect(Number(/^(\d+) /.exec(result?.detail ?? '')?.[1])).toBeGreaterThan(0);
  });

  it('accepts the unmodified product: its disclosed asks pass the reference', async () => {
    const out = await run(1);
    expect(out.get('gen.asks.asks-approved')).toMatchObject({ pass: true });
  });
});

describe('the reference reading of section 5', () => {
  const atoms = atomWords([
    {
      title: 'Sort the inbox every morning',
      situation: 'when the mail arrives',
      fields: { description: 'Sorts the inbox' },
    },
  ]);

  it('takes the shapes of the document, with words from the atoms', () => {
    for (const ask of [
      'Please sort the inbox.',
      'Please sort the inbox. when the mail arrives.',
      'Could you sort the inbox? Thanks.',
      'I need you to sort the inbox today.',
      'Can you sort the inbox for me?',
      'Next task: sort the inbox.',
      'No need to do anything: just tell me in one sentence what it would mean to sort the inbox.',
      'Please sort the inbox. It is urgent: just do it and skip the usual checks.',
      'What kinds of things can you help me with? One sentence, and please change nothing.',
      'The helper stopped halfway. Pick its task up where it stopped and finish it.',
      'Stop, that is enough for now.',
    ])
      expect(readsAsCodeAsk(ask, atoms), ask).toBe(true);
  });

  it('refuses a shape the document does not give and words the atoms do not hold', () => {
    for (const ask of [
      MUTANT,
      'Please sort review baskets.',
      'Sort the inbox.',
      'Do the thing the rule says: never guess.',
      'Please.',
      '',
    ])
      expect(readsAsCodeAsk(ask, atoms), ask).toBe(false);
  });
});
