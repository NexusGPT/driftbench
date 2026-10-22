import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { withLabels } from '../../src/ladders/variables/impl';

const text = 'Escalate when amount is above 20.';
let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'variables-build-store-'));
  const file = join(scratch, 'labels.jsonl');
  const label = { kind: 'numeric', subject: 'amount', limit: 20, comparison: 'gt' };
  writeFileSync(file, `${JSON.stringify({ text, label })}\n`);
  process.env.DRIFTBENCH_VARIABLES_CASSETTE = file;
});

afterAll(() => {
  delete process.env.DRIFTBENCH_VARIABLES_CASSETTE;
  rmSync(scratch, { recursive: true, force: true });
});

/** The labels of a reader are put on the spans by the validator, not read by the adapter (impl.ts, labels.ts). */
const labelled = withLabels(variablesImpl);

const sources = {
  estate: {
    files: { 'RULES.md': text },
    rules: [{ id: 'R2', source: 'RULES.md', tools: [], conditions: [{ text }] }],
  },
};

it('the adapter itself reads no label: a clause the validator did not label gives no variable', () => {
  expect(variablesImpl.buildStore?.(sources as never).variables).toEqual([]);
});

it('buildStore forwards the numeric boundary of a labelled clause', () => {
  const store = labelled.buildStore?.(sources as never);
  const variable = store?.variables[0];
  expect(variable?.values.map((v) => v.sample)).toEqual([19, 20, 21]);
  expect(variable?.boundaries).toHaveLength(1);
  expect(variable?.boundaries?.[0]).toMatchObject({ limit: 20, comparison: 'gt' });
});

it('buildStore gives one label to a clause written with different white space', () => {
  const spaced = 'Escalate  when\namount is\tabove 20.';
  const input = {
    estate: {
      files: { 'RULES.md': spaced },
      rules: [{ id: 'R2', source: 'RULES.md', tools: [], conditions: [{ text: spaced }] }],
    },
  };
  const store = labelled.buildStore?.(input as never);
  expect(store?.variables).toHaveLength(1);
  expect(store?.variables[0]?.values.map((v) => v.sample)).toEqual([19, 20, 21]);
});

it('buildStore does not throw on a pair of two values of one variable', () => {
  const stamp = { words: 'The owner approves these fictional choices.', date: '2026-10-21' };
  const input = {
    estate: {
      files: { 'TOOLS.md': 'A payable invoice. A refund invoice.' },
      rules: [
        {
          id: 'R1',
          source: 'TOOLS.md',
          conditions: [],
          tools: [
            {
              tool: 'ledger',
              field: 'account',
              source: 'TOOLS.md',
              values: [
                { id: 'payable', quote: 'A payable invoice.' },
                { id: 'refund', quote: 'A refund invoice.' },
              ],
            },
          ],
        },
      ],
    },
    owner: {
      impossible: [
        {
          a: { variable: 'ledger.account', value: 'payable' },
          b: { variable: 'ledger.account', value: 'refund' },
          ...stamp,
        },
      ],
    },
  };
  expect(() => variablesImpl.buildStore?.(input as never)).not.toThrow();
  expect(variablesImpl.buildStore?.(input as never).impossible).toEqual([]);
});
