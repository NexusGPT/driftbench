import { describe, expect, it } from 'vitest';
import type { GoldUnit } from '../../../estate/test/gold/gold';
import { referredBy } from './refers';

/** The referred text of a gold estate, from a made-up gold of four units in one file (the standing file of estate A). */
const unit = (n: number, id: string, text: string): GoldUnit => ({
  file: 'A-standing-instructions.md',
  n,
  id,
  container: 'paragraph',
  text,
  section: 's',
  estate: 'A',
  labelAuthor: 'rule',
  labelOpus: 'rule',
  agreed: true,
  label: 'rule',
});
const gold = [
  unit(1, 'u1', 'Heading rows.'),
  unit(2, 'u2', 'Open for at most\nsix hours.'),
  unit(3, 'u3', 'Close after nine hours.'),
  unit(4, 'u4', 'Use the hours above.'),
];
const ledger = [1, 2, 3, 4].map((n) => ({ id: `L${n}`, path: 'CLAUDE.md', index: n - 1 }));

describe('the referred text of a gold estate', () => {
  it('copies the units a pointer refers to, in file order, flattened, for one unit and for a range', () => {
    const referred = referredBy({
      estate: 'A',
      gold,
      ledger,
      truth: {
        refers_to: [
          { unit: 'u4', to: { from: 'u3', to: 'u2' } },
          { unit: 'u1', to: 'u3' },
        ],
      },
    });
    expect(referred({ fields: { unit: 'L4' } })).toBe('Open for at most six hours.\nClose after nine hours.');
    expect(referred({ fields: { unit: 'L1' } })).toBe('Close after nine hours.');
  });

  it('gives nothing to a unit that no refers_to names', () => {
    const referred = referredBy({ estate: 'A', gold, ledger, truth: { refers_to: [{ unit: 'u4', to: 'u2' }] } });
    expect(referred({ fields: { unit: 'L2' } })).toBeUndefined();
    expect(referred({ fields: {} })).toBeUndefined();
  });
});
