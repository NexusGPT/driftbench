import { describe, expect, it } from 'vitest';
import { declaredMisroute } from '../../src/ladders/estate/bank/loop';

/**
 * A misroute ask names another primitive: the phrase bank declares which phrases do (a situation of use
 * `misroute` that lists the route under test), so the check reads the record of the ask, never its words.
 * The situations below belong to a plant nursery; none is a phrase of a bank.
 */
const situations = [
  { id: 'watering-misroute', use: 'misroute', atoms: ['route.watering'], names: 'seed-order' },
  { id: 'watering-trigger', use: 'trigger', atoms: ['route.watering'], names: 'seed-order' },
  { id: 'seeds-misroute', use: 'misroute', atoms: ['route.seeds'], names: 'bed-watering' },
  { id: 'undeclared-misroute', use: 'misroute', atoms: ['route.watering'] },
];
const ask = 'Use the seed-order skill to water the north bed.';

describe('a misroute ask is a bank phrase that holds the name its misroute situation declares', () => {
  it('accepts a phrase of a misroute situation that lists the route and holds its declared name', () => {
    expect(declaredMisroute({ bank: 'watering-misroute' }, situations, 'route.watering', ask)).toBe(true);
  });

  it('refuses a phrase that does not hold the declared name, whatever words it holds', () => {
    expect(
      declaredMisroute(
        { bank: 'watering-misroute' },
        situations,
        'route.watering',
        'Use the right skill to water.',
      ),
    ).toBe(false);
  });

  it('refuses a misroute situation that declares no name', () => {
    expect(declaredMisroute({ bank: 'undeclared-misroute' }, situations, 'route.watering', ask)).toBe(false);
  });

  it('refuses a situation of another use or of another route', () => {
    expect(declaredMisroute({ bank: 'watering-trigger' }, situations, 'route.watering', ask)).toBe(false);
    expect(declaredMisroute({ bank: 'seeds-misroute' }, situations, 'route.watering', ask)).toBe(false);
  });

  it('refuses an ask the generator wrote, a session ask and a record without a situation', () => {
    const wrote = { frame: 'misroute', pieces: ['water the bed'] } as never;
    expect(declaredMisroute(wrote, situations, 'route.watering', ask)).toBe(false);
    expect(declaredMisroute({ session: 'abc' } as never, situations, 'route.watering', ask)).toBe(false);
    expect(declaredMisroute(undefined, situations, 'route.watering', ask)).toBe(false);
    expect(declaredMisroute({ bank: 'gone' }, situations, 'route.watering', ask)).toBe(false);
  });
});
