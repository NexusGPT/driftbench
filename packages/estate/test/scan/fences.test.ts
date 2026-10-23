import { describe, expect, it } from 'vitest';
import { blankFences } from '../../src/scan/text';

/** The lines of a text that stay visible after the fenced blocks are blanked, as written. */
const visible = (lines: string[]) =>
  blankFences(lines.join('\n'))
    .split('\n')
    .filter((line) => line !== '');

describe('blankFences follows CommonMark', () => {
  it('closes a fence only on a fence of the same character, at least as long, with nothing after it', () => {
    expect(visible(['a', '```', 'x', '```', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '````', 'x', '```', 'y', '````', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '```', 'x', '````', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '```', 'x', '~~~', 'y', '```', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '~~~~', 'x', '~~~', 'y', '~~~~', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '```', 'x', '```text', 'y', '```', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps a block open when the only fence after it is shorter, of the other character or has text', () => {
    expect(visible(['a', '````', 'x', '```', 'y'])).toEqual(['a']);
    expect(visible(['a', '```', 'x', '~~~', 'y'])).toEqual(['a']);
    expect(visible(['a', '```', 'x', '```js', 'y'])).toEqual(['a']);
  });

  it('allows an indent of up to three spaces and trailing space on the closing fence', () => {
    expect(visible(['a', '```', 'x', '   ```   ', 'b'])).toEqual(['a', 'b']);
  });

  it('opens a block with an info string, and not with a backtick line that holds a code span', () => {
    expect(visible(['a', '```text', 'x', '```', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '~~~ with `ticks` in the info', 'x', '~~~', 'b'])).toEqual(['a', 'b']);
    expect(visible(['a', '```text with `ticks`', 'b'])).toEqual(['a', '```text with `ticks`', 'b']);
  });

  it('keeps the line count and blanks the fence lines', () => {
    const text = ['a', '````', '```', 'x', '````', 'b'].join('\n');
    expect(blankFences(text).split('\n')).toEqual(['a', '', '', '', '', 'b']);
  });
});
