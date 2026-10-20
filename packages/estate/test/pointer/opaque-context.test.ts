import { describe, expect, it } from 'vitest';
import { createAnthropicLabeler, cut, type LabelSet, windowLines, windowsOf } from '../../src/pointer';

// Invented text: a fence and a comment between two sentences of a harbour office.
const FILE = [
  '# Harbour',
  '',
  'Hang the lamp before dusk.',
  '',
  '```js',
  'const lamp = "lit";',
  '```',
  '',
  'Close the gate at night.',
  '',
  '<!-- keeper: private note -->',
  '',
  'Lock the shed.',
  '',
].join('\n');

const SET: LabelSet = {
  set: 'rules',
  description: 'Harbour rules',
  labels: [{ name: 'rule', description: 'A rule' }],
};

describe('an opaque unit is shown to the labeler as context', () => {
  const units = cut(FILE).units;
  const [window] = windowsOf('harbour.md', units, 60);

  it('keeps the numbers of the labelable units and adds the opaque lines where they stand', () => {
    expect(window?.units.map((u) => u.n)).toEqual([1, 2, 3, 4]);
    expect(windowLines(window as NonNullable<typeof window>)).toEqual([
      '[1] # Harbour',
      '[2] Hang the lamp before dusk.',
      '(fence, not labelable) ```js',
      '[3] Close the gate at night.',
      '(comment, not labelable) <!-- keeper: private note -->',
      '[4] Lock the shed.',
    ]);
  });

  it('puts those lines in the request the labeler sends', () => {
    const body = createAnthropicLabeler({}).render(SET, window as NonNullable<typeof window>).body as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toContain('(fence, not labelable) ```js\n[3] Close the gate at night.');
  });

  it('sends nothing for a file whose only units are opaque', () => {
    expect(windowsOf('only.md', cut('```js\nx\n```\n').units, 60)).toEqual([]);
    expect(windowsOf('only.md', cut('<!-- note -->\n').units, 60)).toEqual([]);
  });

  it('never makes an opaque unit labelable', () => {
    expect(window?.units.every((u) => !/^(```|<!--)/.test(u.text))).toBe(true);
  });
});
