import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';

describe('asks about a topic use the concrete task in the unit description', () => {
  it('uses the declared lookup task instead of a generic request for help', () => {
    const ask = codeAsk(
      'trigger',
      [
        {
          id: 'skill.parcel',
          kind: 'skill',
          title: 'Parcel lookup',
          approved: true,
          evidence: [],
          fields: {
            description:
              'Look up where a parcel is and whether it is late. Use when the user asks about a delivery.',
          },
        },
      ],
      [],
    );
    expect(ask.text).toBe('Please look up where a parcel is and whether it is late.');
  });
  it('retains an explicit action named by the trigger', () => {
    const ask = codeAsk(
      'trigger',
      [
        {
          id: 'skill.parcel',
          kind: 'skill',
          title: 'Parcel lookup',
          approved: true,
          evidence: [],
          fields: { description: 'Look up where a parcel is. Use when the user asks to track the parcel.' },
        },
      ],
      [],
    );
    expect(ask.text).toBe('Please track the parcel.');
  });
});
