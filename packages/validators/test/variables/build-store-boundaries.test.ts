import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { variablesImpl } from '../../src/ladders/variables/adapter';

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

const sources = {
  estate: {
    files: { 'RULES.md': text },
    rules: [{ id: 'R2', source: 'RULES.md', tools: [], conditions: [{ text }] }],
  },
};

it('buildStore forwards the numeric boundary of a labelled clause', () => {
  const store = variablesImpl.buildStore?.(sources as never);
  const variable = store?.variables[0];
  expect(variable?.values.map((v) => v.sample)).toEqual([19, 20, 21]);
  expect(variable?.boundaries).toHaveLength(1);
  expect(variable?.boundaries?.[0]).toMatchObject({ limit: 20, comparison: 'gt' });
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
