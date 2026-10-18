import { expect, it } from 'vitest';
import { responseSchema } from '../src/assessment';

it('exposes string, span-list and null evidence as direct provider-schema alternatives', () => {
  const schema = responseSchema({
    criterion: { name: 'c', rubric: 'r' },
    transcript: [],
  });
  expect(schema).toMatchObject({
    properties: {
      checks: {
        items: {
          properties: {
            evidence: {
              anyOf: expect.arrayContaining([
                { type: 'string', minLength: 1 },
                {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      source: { type: 'string', minLength: 1 },
                      quote: { type: 'string', minLength: 1 },
                    },
                    required: ['source', 'quote'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ]),
            },
          },
        },
      },
    },
  });
});
