import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import { IMPL_ENV } from '../../src/ladders/variables/impl';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ITEMS = variablesBank().filter((item) => item.stem === 'values.ids.variable-grammar');

it.each(['stdout-flip-impl', 'process/bank-import'])(
  'scores the actual answers of %s despite attempted verdict rewriting',
  async (name) => {
    const before = process.env[IMPL_ENV];
    process.env[IMPL_ENV] = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
    try {
      expect(ITEMS).toHaveLength(4);
      const run = await runIsolated(ITEMS, 1, ROOT, undefined, 1);
      const passing = ITEMS.filter((item) => run.get(item.id)?.pass === true).length;
      console.log(JSON.stringify({ kind: 'variables-cheat-evidence', product: name, size: ITEMS.length, passing }));
      expect(run.size).toBe(ITEMS.length);
      expect(passing).toBe(0);
    } finally {
      if (before === undefined) delete process.env[IMPL_ENV];
      else process.env[IMPL_ENV] = before;
    }
  },
  180_000,
);
