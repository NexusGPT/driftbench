import { describe, expect, it } from 'vitest';
import {
  Cassette,
  createAnthropicLabeler,
  cut,
  type LabelSet,
  pointerScan,
  singleLabelling,
  windowLines,
  windowsOf,
} from '../../src/pointer';

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

  it('numbers the opaque lines with the units, where they stand, and says they cannot be labelled', () => {
    expect(window?.units.map((u) => u.n)).toEqual([1, 2, 4, 6]);
    expect(window?.display?.map((line) => [line.n, line.mode])).toEqual([
      [3, 'opaque'],
      [5, 'opaque'],
    ]);
    expect(windowLines(window as NonNullable<typeof window>)).toEqual([
      '[1] # Harbour',
      '[2] Hang the lamp before dusk.',
      '[3] (opaque, not labelable) fence: ```js',
      '[4] Close the gate at night.',
      '[5] (opaque, not labelable) comment: <!-- keeper: private note -->',
      '[6] Lock the shed.',
    ]);
  });

  it('puts those lines in the request the labeler sends', () => {
    const body = createAnthropicLabeler({}).render(SET, window as NonNullable<typeof window>).body as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toContain(
      '[3] (opaque, not labelable) fence: ```js\n[4] Close the gate at night.',
    );
  });

  it('sends nothing for a file whose only units are opaque', () => {
    expect(windowsOf('only.md', cut('```js\nx\n```\n').units, 60)).toEqual([]);
    expect(windowsOf('only.md', cut('<!-- note -->\n').units, 60)).toEqual([]);
  });

  it('never makes an opaque unit labelable', () => {
    expect(window?.units.every((u) => !/^(```|<!--)/.test(u.text))).toBe(true);
  });

  it('shows only the first line of a fence or a comment, whatever the line endings', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const file = [
        'Hang the lamp before dusk.',
        '',
        '```js',
        'HIDDEN_SECOND_ROW',
        '```',
        '',
        '<!-- first',
        'HIDDEN_COMMENT_ROW',
        '-->',
        '',
        'Close the gate at night.',
        '',
      ].join(eol);
      const windows = windowsOf('eol.md', cut(file).units, 60);
      const text = JSON.stringify(windows);
      expect(text, JSON.stringify(eol)).not.toContain('HIDDEN_SECOND_ROW');
      expect(text, JSON.stringify(eol)).not.toContain('HIDDEN_COMMENT_ROW');
      expect(
        windows[0]?.display?.map((line) => line.text),
        JSON.stringify(eol),
      ).toEqual(['fence: ```js', 'comment: <!-- first']);
    }
  });

  it('keeps a trailing opaque unit on a window filled exactly to its cap, for every cap', () => {
    for (const opaque of ['```js\nx\n```', '<!-- note -->']) {
      for (let size = 1; size <= 6; size += 1) {
        const prose = Array.from({ length: size }, (_unused, at) => `Rule number ${at}.`).join('\n\n');
        const windows = windowsOf('cap.md', cut(`${prose}\n\n${opaque}\n`).units, size);
        expect(windows, `${opaque} cap ${size}`).toHaveLength(1);
        expect(windows[0]?.display?.length, `${opaque} cap ${size}`).toBe(1);
        expect(windows[0]?.display?.[0]?.n, `${opaque} cap ${size}`).toBe(size + 1);
      }
    }
  });

  it('keeps an opaque unit between two full windows on the first, and sends nothing for an opaque-only file', () => {
    const file = 'One.\n\nTwo.\n\n```js\nx\n```\n\nThree.\n\nFour.\n';
    const windows = windowsOf('mid.md', cut(file).units, 2);
    expect(windows.map((w) => w.units.length)).toEqual([2, 2]);
    expect(windows[0]?.display?.length).toBe(1);
    expect(windows[1]?.display).toBeUndefined();
    expect(windowsOf('only.md', cut('```js\nx\n```\n').units, 1)).toEqual([]);
  });

  it('never sends the body of a fence or a comment to the model, whatever the line endings of the file', async () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const text = [
        'Hang the lamp before dusk.',
        '',
        '```js',
        'SECRET_IN_FENCE_BODY',
        '```',
        '',
        '<!-- note',
        'SECRET_IN_COMMENT_BODY',
        '-->',
        '',
        'Close the gate at night.',
        '',
      ].join(eol);
      const sent: string[] = [];
      const labeler = createAnthropicLabeler({
        key: 'test-key',
        runs: 1,
        fetch: async (_url, init) => {
          sent.push(String(init.body));
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: '{"labels":[{"units":"1-3","label":"none"}]}' }],
              model: 'm',
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      });
      await pointerScan({
        files: [{ path: 'eol.md', text }],
        sets: [SET],
        labelling: singleLabelling(labeler),
        cassette: new Cassette(),
        mode: 'record',
      });
      expect(sent.length, JSON.stringify(eol)).toBeGreaterThan(0);
      for (const body of sent) {
        expect(body, JSON.stringify(eol)).toContain('(opaque, not labelable) fence: ```js');
        expect(body, JSON.stringify(eol)).not.toContain('SECRET_IN_FENCE_BODY');
        expect(body, JSON.stringify(eol)).not.toContain('SECRET_IN_COMMENT_BODY');
      }
    }
  });
});
