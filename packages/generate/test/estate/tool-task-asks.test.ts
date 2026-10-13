import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';

describe('tool boundary asks name concrete work', () => {
  it.each([
    ['Read', 'Please read a file here with the Read tool.'],
    ['Glob', 'Please find files here with the Glob tool.'],
    ['Grep', 'Please find matching text in the files here with the Grep tool.'],
  ])('asks for the operation of %s', (rule, expected) => {
    const ask = codeAsk(
      'trigger',
      [
        {
          id: 'tool.fixture',
          kind: 'tool',
          title: 'Allowed tool',
          approved: true,
          fields: { rule },
          evidence: [],
        },
      ],
      [],
    );
    expect(ask.text).toBe(expected);
  });
});
