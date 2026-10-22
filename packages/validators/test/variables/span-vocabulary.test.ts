import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { variablesImpl as adapter } from '../../src/ladders/variables/adapter';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import {
  nounNumber,
  numericSpan,
  type Quantity,
  VOCABULARY_SIZE,
  vocabularyOf,
  WORDINGS,
} from '../../src/ladders/variables/bank/oracle/conditions';
import type { Sources, VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * The span vocabulary of the scale items (docs/validators.md 12.9): the text of a span is a function of its index, so the
 * labels of the 10,000 texts, recorded once, cover every seed. The seed picks which spans, their order and their files.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const bank = variablesBank();
const item = (id: string) => {
  const found = bank.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
};

const textOf = (index: number): string => {
  const v = vocabularyOf(index);
  const q: Quantity = { noun: nounNumber(index), unit: ' euros', kind: 'money' };
  return numericSpan(v.cls, v.wording, q, v.limit).text;
};

/** The texts an implementation is given: the spans a scale item reads. */
function spansRead(id: string, seed: number): string[] {
  const seen: string[] = [];
  const impl: Partial<VariablesImpl> = {
    ...adapter,
    buildStore: (sources: Sources) => {
      for (const rule of sources.estate?.rules ?? []) for (const c of rule.conditions) seen.push(c.text);
      return (adapter.buildStore as VariablesImpl['buildStore'])(sources);
    },
  };
  return runItem(item(id), seed, ROOT, impl).then((outcome) => {
    if (seen.length === 0) throw new Error(`no span read: ${outcome.detail}`);
    return seen;
  }) as unknown as string[];
}

describe('the span vocabulary of the first bank', () => {
  const all = Array.from({ length: VOCABULARY_SIZE }, (_, i) => textOf(i));
  it('holds 10,000 distinct texts', () => {
    expect(new Set(all).size).toBe(VOCABULARY_SIZE);
  });

  it('uses every wording of the four ordered comparisons', () => {
    const wanted = (['gt', 'ge', 'lt', 'le'] as const).flatMap((cls) =>
      Object.keys(WORDINGS[cls]).map((key) => `${cls}.${key}`),
    );
    const used = new Set(
      Array.from({ length: VOCABULARY_SIZE }, (_, i) => {
        const v = vocabularyOf(i);
        return `${v.cls}.${v.wording}`;
      }),
    );
    expect([...used].sort()).toEqual(wanted.sort());
    const first200 = new Set(
      Array.from({ length: 200 }, (_, i) => {
        const v = vocabularyOf(i);
        return `${v.cls}.${v.wording}`;
      }),
    );
    expect(first200.size).toBe(wanted.length);
  });

  it.each([1, 2, 3, 820020691, 360920726])(
    'seed %i reads only texts of the vocabulary',
    async (seed) => {
      const vocabulary = new Set(all);
      for (const id of ['scale.estate-spans.two-hundred', 'scale.estate-spans.two-thousand']) {
        const read = await (spansRead(id, seed) as unknown as Promise<string[]>);
        expect(read.length).toBeGreaterThan(0);
        expect(read.filter((text) => !vocabulary.has(text))).toEqual([]);
      }
    },
    300_000,
  );

  it('lets the seed pick other spans in another order', async () => {
    const a = await (spansRead('scale.estate-spans.two-hundred', 1) as unknown as Promise<string[]>);
    const b = await (spansRead('scale.estate-spans.two-hundred', 2) as unknown as Promise<string[]>);
    expect(new Set(a)).not.toEqual(new Set(b));
    expect(a).not.toEqual(b);
  }, 300_000);
});

/**
 * A product that carries the span vocabulary (here as the rule that builds it: a table of the texts is the same data) reads
 * the text of every condition itself and drops the label the validator put on it. The scale items cannot tell it from an
 * honest product, because the recorded labels and the table agree; the labelled-condition item can, because its label
 * disagrees with its text.
 */
const SYMBOL = /^(.+?) (?:is )?(?:more than|over|exceeds|greater than|>) (\d+)(.*)$/;
const tableCheat: Partial<VariablesImpl> = {
  ...adapter,
  buildStore: (sources: Sources) =>
    (adapter.buildStore as VariablesImpl['buildStore'])({
      ...sources,
      estate: sources.estate && {
        ...sources.estate,
        rules: sources.estate.rules.map((rule) => ({
          ...rule,
          conditions: rule.conditions.map((condition) => {
            const m = SYMBOL.exec(condition.text);
            const own = m && { kind: 'numeric', subject: m[1], limit: Number(m[2]), comparison: 'gt' };
            return (own ? { ...condition, label: own } : condition) as typeof condition;
          }),
        })),
      },
    }),
};

describe('a product that labels the spans itself from a table of the vocabulary', () => {
  const ID = 'blind.sources.labelled-condition.the-label-decides-not-the-text';
  it('the honest adapter passes the labelled-condition item', async () => {
    expect((await runItem(item(ID), 1, ROOT, adapter)).pass).toBe(true);
  });

  it('the table product fails it: it follows its own reading of the text, not the label', async () => {
    const outcome = await runItem(item(ID), 1, ROOT, tableCheat);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/read the text, not the label|label gives the limit 9/);
  });
});
