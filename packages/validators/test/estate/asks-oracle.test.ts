import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { ASK_TEMPLATES } from '../../src/ladders/estate/reference-ask';

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

describe('the ask templates of the validator', () => {
  it('are the templates of docs/estate.md section 5, in the same order', async () => {
    const text = await readFile(new URL('../../../../docs/estate.md', import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('### The ask templates'));
    const end = section.indexOf('\n## ');
    const rows = (end < 0 ? section : section.slice(0, end))
      .split('\n')
      .map((line) => /^\| (ask|fixed|act|situation) \| `([^`]+)` \|(.*)\|\s*([^|]*?)\s*\|$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => {
        // The Tools column: tool names when it lists them; a row whose tools come from its own slots lists none.
        const tools = String(match[4])
          .split(',')
          .map((tool) => tool.trim())
          .filter((tool) => tool !== '');
        const named = tools.length > 0 && tools.every((tool) => /^[A-Z][A-Za-z]+$/.test(tool));
        return { kind: match[1], template: match[2], ...(named ? { tools } : {}) };
      });
    expect(rows.length).toBeGreaterThan(0);
    expect(ASK_TEMPLATES).toEqual(rows);
  });
});
