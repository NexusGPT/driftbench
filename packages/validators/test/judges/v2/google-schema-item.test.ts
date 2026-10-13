import * as judges from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import { realApi } from '../../../src/ladders/judges/v2/bank';
import { extraItems } from '../../../src/ladders/judges/v2/families/extra';

/** The bank item google-gives-a-response-schema accepts exactly the Gemini form: non-null types plus nullable: true. */
// biome-ignore lint/suspicious/noExplicitAny: provider bodies differ per client
type Any = any;
const item = extraItems().find((i) => i.id === 'clients/google-gives-a-response-schema');
const mutate =
  (edit: (c: Any) => Any) =>
  (o: Any = {}) =>
    judges.createGoogleJudge({
      ...o,
      fetch: async (u: string, init: Any) => {
        const b = JSON.parse(String(init.body));
        b.generationConfig = edit(b.generationConfig);
        return o.fetch(u, { ...init, body: JSON.stringify(b) });
      },
    });
const row = (c: Any) => c.responseSchema.properties.checks.items.properties;
const cases: [string, (c: Any) => Any][] = [
  ['shipped client', (c) => c],
  [
    'no schema',
    (c) => {
      delete c.responseSchema;
      return c;
    },
  ],
  [
    'met type list',
    (c) => {
      row(c).met.type = ['boolean', 'null'];
      delete row(c).met.nullable;
      return c;
    },
  ],
  [
    'met plain boolean',
    (c) => {
      delete row(c).met.nullable;
      return c;
    },
  ],
  [
    'evidence null member only',
    (c) => {
      row(c).evidence = { anyOf: [{ type: 'string' }, { type: 'null' }] };
      return c;
    },
  ],
  [
    'null member kept beside nullable true (evidence)',
    (c) => {
      row(c).evidence.anyOf.push({ type: 'null' });
      return c;
    },
  ],
  [
    'null member kept beside nullable true (met)',
    (c) => {
      row(c).met = { anyOf: [{ type: 'boolean' }, { type: 'null' }], nullable: true, type: 'boolean' };
      return c;
    },
  ],
  [
    'type list beside nullable true (met)',
    (c) => {
      row(c).met.type = ['boolean', 'null'];
      return c;
    },
  ],
  [
    'no ledger rows',
    (c) => {
      c.responseSchema = { type: 'object' };
      return c;
    },
  ],
];

const run = async (edit: (c: Any) => Any) =>
  item?.run({
    seed: 1,
    root: process.cwd(),
    api: { ...realApi, createGoogleJudge: mutate(edit) } as Any,
    random: () => 0.5,
  });

describe('bank item google-gives-a-response-schema', () => {
  for (const [name, edit] of cases) {
    it(`${name === 'shipped client' ? 'passes' : 'fails'}: ${name}`, async () => {
      expect((await run(edit))?.pass).toBe(name === 'shipped client');
    });
  }
});
