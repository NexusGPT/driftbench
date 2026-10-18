import { describe, expect, it } from 'vitest';
import { declaredMisroute } from '../../src/ladders/estate/bank/loop';

/**
 * A misroute ask names another primitive: the phrase bank declares which phrases do (a situation of use
 * `misroute` that lists the route under test), so the check reads the record of the ask, never its words.
 * The situations below belong to a plant nursery; none is a phrase of a bank.
 */
const situations = [
  { id: 'watering-misroute', use: 'misroute', atoms: ['route.watering'] },
  { id: 'watering-trigger', use: 'trigger', atoms: ['route.watering'] },
  { id: 'seeds-misroute', use: 'misroute', atoms: ['route.seeds'] },
];

describe('a misroute ask is a bank phrase declared to name another primitive', () => {
  it('accepts a phrase of a misroute situation that lists the route', () => {
    expect(declaredMisroute({ bank: 'watering-misroute' }, situations, 'route.watering')).toBe(true);
  });

  it('refuses a phrase of a situation of another use, whatever words it holds', () => {
    expect(declaredMisroute({ bank: 'watering-trigger' }, situations, 'route.watering')).toBe(false);
  });

  it('refuses a misroute situation of another route', () => {
    expect(declaredMisroute({ bank: 'seeds-misroute' }, situations, 'route.watering')).toBe(false);
  });

  it('refuses an ask the generator wrote, a session ask and a record without a situation', () => {
    expect(
      declaredMisroute(
        { frame: 'misroute', pieces: ['water the bed'] } as never,
        situations,
        'route.watering',
      ),
    ).toBe(false);
    expect(declaredMisroute({ session: 'abc' } as never, situations, 'route.watering')).toBe(false);
    expect(declaredMisroute(undefined, situations, 'route.watering')).toBe(false);
    expect(declaredMisroute({ bank: 'gone' }, situations, 'route.watering')).toBe(false);
  });
});
