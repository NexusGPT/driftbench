import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { loadEstateMap } from '../../src/map';
import { estateToVariables, ledgerResolver, renderVariableStore } from '../../src/variables';

/** The three invented estates of examples/estates that hold a map file: Northwind, Northwind after a change, and the reader cases. */
const ESTATES = [
  { dir: 'fixture', map: 'approved.yaml' },
  { dir: 'fixture-v2', map: 'map.yaml' },
  { dir: 'reader-cases', map: 'approved.yaml' },
] as const;
const ROOT = fileURLToPath(new URL('../../../../examples/estates/', import.meta.url));

async function feed(dir: string, mapFile: string) {
  const folder = join(ROOT, dir);
  const loaded = await loadEstateMap(join(folder, mapFile));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const files = [...new Set(loaded.map.atoms.map((a) => a.provenance.file))];
  const texts = new Map<string, string>();
  for (const file of files) texts.set(file, await readFile(join(folder, file), 'utf8'));
  return {
    folder,
    result: estateToVariables(loaded.map, ledgerResolver(texts), {
      agent: dir === 'reader-cases' ? 'reader-cases' : 'northwind',
    }),
  };
}

describe.each(ESTATES)('the variable store of the $dir estate', ({ dir, map }) => {
  it('validates against the store schema, and every quote is in its file', async () => {
    const { folder, result } = await feed(dir, map);
    const loaded = validateVariableStore(result.store);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors.slice(0, 5))).toBe(true);
    expect(result.store.variables.length).toBeGreaterThan(0);
    expect(await verifyVariableQuotes(result.store, folder)).toEqual([]);
  });

  it('gives every value a quote that resolves to a ledger id, and names every atom it refused', async () => {
    const { result } = await feed(dir, map);
    const values = result.store.variables.flatMap((variable) => variable.values);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const quote = value.provenance?.find((entry) => entry.kind === 'quote');
      expect(quote, value.id).toBeDefined();
      expect(quote && 'ledger' in quote ? quote.ledger : undefined, value.id).toMatch(/^[a-z2-7]{10}$/);
    }
    for (const entry of result.refused) expect(entry.reason.length, entry.atom).toBeGreaterThan(0);
  });

  it('is byte for byte the store committed beside the estate', async () => {
    const { folder, result } = await feed(dir, map);
    const text = renderVariableStore(result.store);
    if (process.env.UPDATE_VARIABLES === '1') await writeFile(join(folder, 'variables.yaml'), text);
    expect(text).toBe(await readFile(join(folder, 'variables.yaml'), 'utf8'));
    expect(renderVariableStore((await feed(dir, map)).result.store)).toBe(text);
  });
});

describe('the conditions the Northwind estates state', () => {
  it('reads the two credit-note situations of the second version as one condition with both quotes', async () => {
    const { result } = await feed('fixture-v2', 'map.yaml');
    const credit = result.store.variables.filter((v) => v.id === 'condition.a_credit_note_above_500_00_eur');
    expect(credit).toHaveLength(1);
    expect(credit[0]?.boundaries?.[0]).toMatchObject({ limit: 500, comparison: 'gt', unit: 'eur' });
    expect(credit[0]?.boundaries?.[0]?.provenance).toHaveLength(2);
  });

  it('reads the two credit-note situations of the second version as one condition with both quotes', async () => {
    const { result } = await feed('fixture-v2', 'map.yaml');
    const credit = result.store.variables.filter((v) => v.id === 'condition.a_credit_note_above_500_00_eur');
    expect(credit).toHaveLength(1);
    expect(credit[0]?.boundaries?.[0]).toMatchObject({ limit: 500, comparison: 'gt', unit: 'eur' });
    expect(credit[0]?.boundaries?.[0]?.provenance).toHaveLength(2);
  });

  it('reads the limit of the late shipment in the first version, and its change in the second', async () => {
    const first = (await feed('fixture', 'approved.yaml')).result.store.variables;
    const second = (await feed('fixture-v2', 'map.yaml')).result.store.variables;
    const late = (variables: typeof first) =>
      variables.find(
        (v) =>
          v.id === 'condition.a_shipment_is_late_by_more_than_two_days' ||
          v.id === 'condition.a_shipment_is_late_by_more_than_one_day',
      );
    expect(late(first)?.boundaries?.[0]).toMatchObject({ limit: 2, comparison: 'gt', unit: 'days' });
    expect(late(second)?.boundaries?.[0]).toMatchObject({ limit: 1, comparison: 'gt', unit: 'day' });
    const money = first.find((v) => v.id.startsWith('condition.the_total_difference'));
    expect(money?.boundaries?.[0]).toMatchObject({ limit: 50, comparison: 'gt', unit: 'eur' });
  });
});
