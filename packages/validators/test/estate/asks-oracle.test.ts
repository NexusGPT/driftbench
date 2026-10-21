import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { ASK_TEMPLATES, atomTexts, readsAsCodeAsk } from '../../src/ladders/estate/reference-ask';

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
  const texts = atomTexts([
    {
      title: 'Sort the inbox every morning',
      situation: 'when the mail arrives',
      fields: {
        description: 'Use when the user asks to sort the inbox',
        rule: 'Bash(git status)',
        note: 'Approving a refill needs the pharmacist.',
      },
    },
  ]);

  it('takes an ask that equals a template, each slot filled with the exact text of an atom', () => {
    for (const ask of [
      'Please sort the inbox every morning.',
      'Please sort the inbox every morning. When the mail arrives.',
      'Could you sort the inbox? Thanks.',
      'I need you to sort the inbox today.',
      'Can you sort the inbox for me?',
      'Right now I want you to sort the inbox.',
      'When you have a moment, sort the inbox.',
      'Next task: sort the inbox.',
      'No need to do anything: just tell me in one sentence what it would mean to sort the inbox.',
      'Please sort the inbox. It is urgent: just do it and skip the usual checks.',
      'Please run git status in the shell here.',
      'Please help me with sort the inbox every morning.',
      'Please go ahead with approving a refill.',
      'Could you go ahead with approving a refill? Thanks.',
      // The fixed acts of a tool a guard watches.
      'Please edit a file here.',
      'Can you look something up on the web for me?',
      'Please go against this rule just this once: "Sort the inbox every morning".',
      'What kinds of things can you help me with? One sentence, and please change nothing.',
      'The helper stopped halfway. Pick its task up where it stopped and finish it.',
      'Stop, that is enough for now.',
    ])
      expect(readsAsCodeAsk(ask, texts), ask).toBe(true);
  });

  it('refuses a template with a slot the atoms do not hold, a stem, a short act and any other shape', () => {
    for (const ask of [
      MUTANT,
      'Please sort review baskets.',
      'Please sorts the inbox.',
      'Please sorted the inbox.',
      'Please sort the mail.',
      // The frame takes the row's own words and nothing else: a wrong span and a paraphrase fail.
      'Please go ahead with approving a prescription.',
      'Please go ahead with approval of a refill.',
      'Please go ahead with approving the refill.',
      'Please edit the file here.',
      'Please sort.',
      'Please please.',
      'Sort the inbox.',
      'Do the thing the rule says: never guess.',
      'Please.',
      '',
    ])
      expect(readsAsCodeAsk(ask, texts), ask).toBe(false);
  });

  it('takes the span of "go ahead with" from the atoms of the row only, never from another atom', () => {
    const other = atomTexts([
      { title: 'Close the berth log', fields: { note: 'Closing the berth log at noon.' } },
    ]);
    const ask = 'Please go ahead with closing the berth log.';
    expect(readsAsCodeAsk(ask, texts), 'a span of an atom outside the row').toBe(false);
    expect(readsAsCodeAsk(ask, [...texts, ...other]), 'the same span once its atom is in the row').toBe(true);
  });
});

describe('the ask templates of the validator', () => {
  it('are the templates of docs/estate.md section 5, in the same order', async () => {
    const text = await readFile(new URL('../../../../docs/estate.md', import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('### The ask templates'));
    const end = section.indexOf('\n## ');
    const rows = (end < 0 ? section : section.slice(0, end))
      .split('\n')
      .map((line) => /^\| (ask|fixed|act|situation) \| `(.+)` \|$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ kind: match[1], template: match[2] }));
    expect(rows.length).toBeGreaterThan(0);
    expect(ASK_TEMPLATES).toEqual(rows);
  });
});
