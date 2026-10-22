import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { QUANTITIES, WORDINGS } from '../../src/ladders/variables/bank/oracle/conditions';
import type { Sources, VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * The span items draw their limits from a continuous range, and the recording labels templates (docs/validators.md 12.9,
 * "The span vocabulary"): a sentence with a `{n}` slot, a label that gives the kind, subject, comparison and unit, and
 * code that reads the number from the span. A product that carries a table of the texts of some seeds fails another seed.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ID = 'sources.estate.numeric-condition.one-rule';
const bank = variablesBank();
const item = bank.find((entry) => entry.id === ID);
if (!item) throw new Error(ID);

/** The number each span of an estate writes, in the order written. */
const NUMBER = /-?\d+(?:\.\d+)?/;

let adapter: Partial<VariablesImpl>;
let spanLabel: (text: string) => unknown;

beforeAll(async () => {
  // A recording of templates only: every quantity with every wording of the four ordered comparisons.
  const rows = QUANTITIES.flatMap((q) =>
    (['gt', 'ge', 'lt', 'le'] as const).flatMap((cls) =>
      Object.keys(WORDINGS[cls]).map((wording) => ({
        text: (WORDINGS[cls][wording] as (n: string, v: string, u: string) => string)(q.noun, '{n}', q.unit),
        label: {
          kind: 'numeric',
          subject: q.noun.replace(/^the /, ''),
          comparison: cls,
          ...(q.unit.trim() === '' ? {} : { unit: q.unit.trim() }),
        },
      })),
    ),
  );
  const dir = mkdtempSync(join(tmpdir(), 'templates-'));
  const file = join(dir, 'templates.jsonl');
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  process.env.DRIFTBENCH_VARIABLES_CASSETTE = file;
  const mod = await import('../../src/ladders/variables/adapter');
  adapter = mod.variablesImpl;
  spanLabel = mod.spanLabel;
});

/** The conditions an item reads in one run. */
async function spansOf(seed: number): Promise<string[]> {
  const seen: string[] = [];
  const spy: Partial<VariablesImpl> = {
    ...adapter,
    buildStore: (sources: Sources) => {
      for (const rule of sources.estate?.rules ?? []) for (const c of rule.conditions) seen.push(c.text);
      return (adapter.buildStore as VariablesImpl['buildStore'])(sources);
    },
  };
  await runItem(item, seed, ROOT, spy);
  return seen;
}

describe('the template labels', () => {
  it('fill the number of the span into the label', () => {
    expect(spanLabel('the wait time is at least 137 minutes')).toMatchObject({
      kind: 'numeric',
      limit: 137,
      comparison: 'ge',
    });
    expect(spanLabel('the wait time is at least 1,500 minutes')).toMatchObject({ limit: 1500 });
    expect(spanLabel('the wait time is at least 0.3 minutes')).toMatchObject({ limit: 0.3 });
    expect(spanLabel('the wait time is at least -5 minutes')).toMatchObject({ limit: -5 });
  });
});

describe('the limits of the span items', () => {
  it('are drawn from a continuous range: many seeds give many different limits, none from a short list', async () => {
    const limits = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const text of await spansOf(seed)) limits.add(Number(NUMBER.exec(text)?.[0]));
    }
    expect(limits.size).toBeGreaterThan(20);
  }, 300_000);

  it('give a seed values that no earlier seed drew', async () => {
    const earlier = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const text of await spansOf(seed)) earlier.add(Number(NUMBER.exec(text)?.[0]));
    }
    const later = (await spansOf(1013)).map((text) => Number(NUMBER.exec(text)?.[0]));
    expect(later.some((value) => !earlier.has(value))).toBe(true);
  }, 300_000);
});

describe('a product that carries a table of the texts of some seeds', () => {
  it('passes the seeds it was built from and fails a hidden seed', async () => {
    const table = new Map<string, unknown>();
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const text of await spansOf(seed)) table.set(text, spanLabel(text));
    }
    const cheat: Partial<VariablesImpl> = {
      ...adapter,
      buildStore: (sources: Sources) =>
        (adapter.buildStore as VariablesImpl['buildStore'])({
          ...sources,
          estate: sources.estate && {
            ...sources.estate,
            rules: sources.estate.rules.map((rule) => ({
              ...rule,
              conditions: rule.conditions.map((condition) => ({
                ...condition,
                label: (condition as { label?: unknown }).label ??
                  table.get(condition.text) ?? { kind: 'none' },
              })) as typeof rule.conditions,
            })),
          },
        }),
    };
    const built = await runItem(item, 3, ROOT, cheat);
    expect(built.detail).toBe('ok');
    expect(built.pass).toBe(true);
    expect((await runItem(item, 1013, ROOT, adapter)).pass).toBe(true);
    const hidden = await runItem(item, 1013, ROOT, cheat);
    expect(hidden.pass).toBe(false);
  }, 300_000);
});
