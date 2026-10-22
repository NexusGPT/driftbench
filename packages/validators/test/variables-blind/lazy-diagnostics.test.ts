import { describe, expect, it } from 'vitest';
import { assertRowsSound, makeStore, spaceOf, valueIds } from '../../src/ladders/variables/blind/kit';
import type { Plan } from '../../src/ladders/variables/interface';

/**
 * A failure message must never change what the product is asked, or in what order (review of #1385, run
 * 39851052787): a second row whose id getter gives the first row's id for its first three reads, then its own, must
 * still be refused as a duplicate. The diagnostics are built only after the verdict is decided.
 */
describe('the diagnostics of a converted helper cost the product no read', () => {
  const store = makeStore({ vars: [{ id: 'a', values: valueIds(2) }] });
  const space = spaceOf(store);

  it('refuses a row whose id getter hides a duplicate for its first three reads', () => {
    let reads = 0;
    const second = {
      kind: 'new' as const,
      values: { a: 'v1' },
      logWeight: 0,
      get id(): string {
        reads += 1;
        return reads <= 3 ? 'row.1' : 'row.2';
      },
    };
    const plan = { rows: [{ id: 'row.1', kind: 'new' as const, values: { a: 'v0' }, logWeight: 0 }, second] } as unknown as Plan;
    expect(() => assertRowsSound(space, plan, [])).toThrow();
  });

  it('reads a passing row id exactly as often as before the conversion (three times)', () => {
    let reads = 0;
    const row = {
      kind: 'new' as const,
      values: { a: 'v0' },
      logWeight: 0,
      get id(): string {
        reads += 1;
        return 'row.1';
      },
    };
    assertRowsSound(space, { rows: [row] } as unknown as Plan, []);
    // typeof, length, the duplicate test, and the add: four reads in the original loop.
    expect(reads).toBe(4);
  });
});
