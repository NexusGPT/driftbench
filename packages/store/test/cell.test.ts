import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type CellKey, cellId } from '../src/index';
import { SALES, storeError } from './fixtures';

const cell: CellKey = { specHash: 'abc123abc123', target: SALES, mode: 'F', repeat: 0 };

describe('cellId', () => {
  it('is the first 16 hex characters of the SHA-256 of the canonical JSON of the cell', () => {
    const canonical =
      '{"mode":"F","repeat":0,"specHash":"abc123abc123","target":{"adapter":"function","agent":"acme-sales",' +
      '"options":{"region":"acmeville","temperature":0},"variant":"prompt-v2"}}';
    const expected = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    expect(cellId(cell)).toBe(expected);
    expect(cellId(cell)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not change with key order or an absent perturbation', () => {
    const reordered: CellKey = {
      repeat: 0,
      target: {
        options: { region: 'acmeville', temperature: 0 },
        variant: 'prompt-v2',
        agent: 'acme-sales',
        adapter: 'function',
      },
      mode: 'F',
      specHash: 'abc123abc123',
      perturbationId: undefined,
    };
    expect(cellId(reordered)).toBe(cellId(cell));
  });

  it('changes with every field of the cell', () => {
    const ids = new Set([
      cellId(cell),
      cellId({ ...cell, specHash: 'def456def456' }),
      cellId({ ...cell, target: { ...SALES, variant: 'prompt-v3' } }),
      cellId({ ...cell, target: { ...SALES, options: { temperature: 0.2, region: 'acmeville' } } }),
      cellId({ ...cell, mode: 'T' }),
      cellId({ ...cell, repeat: 1 }),
      cellId({ ...cell, mode: 'P', perturbationId: 'off-topic' }),
      cellId({ ...cell, mode: 'P', perturbationId: 'tool-failure' }),
    ]);
    expect(ids.size).toBe(8);
  });

  it('refuses a cell that is not one', async () => {
    expect((await storeError(() => cellId({ ...cell, repeat: -1 }))).code).toBe('INVALID_RECORD');
    expect((await storeError(() => cellId({ ...cell, mode: 'X' as 'F' }))).code).toBe('INVALID_RECORD');
    expect((await storeError(() => cellId({ ...cell, specHash: '' }))).code).toBe('INVALID_RECORD');
  });
});
