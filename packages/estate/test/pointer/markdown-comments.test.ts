import { describe, expect, it } from 'vitest';
import {
  COMMENT_MARKER,
  commentRanges,
  cut,
  denseUser,
  type LabelSet,
  requestTextOf,
  userRequest,
  windowLines,
  windowsOf,
  yesNoText,
} from '../../src/pointer';
import { requestPathOf, requestShownOf, shownOf } from '../../src/pointer/labels';

// Invented text: a harbour office. A Markdown comment is a link reference definition used to hide a note:
// label `//` or `comment`, destination `#` or `<>`, a title in ( ), " " or ' ' marks, on a line of its own.
// A request carries it as `(comment)`, like a `<!-- -->` comment.

const SET: LabelSet = {
  set: 'rules',
  description: 'Harbour rules',
  labels: [{ name: 'rule', description: 'A rule' }],
};

const masked = (text: string): string => requestTextOf({ text }).text;

const LF = '\n';

/** Lines joined with the line ending given, and closed by one. */
const file = (eol: string, ...lines: string[]): string => `${lines.join(eol)}${eol}`;

/** A file with a first paragraph, a body that holds the comment, and a last paragraph. */
const around = (...body: string[]): string => file(LF, 'Mind the tide.', ...body, '', 'Lock the shed.');

describe('the three Markdown comment forms are masked like <!-- -->', () => {
  const FORMS = [
    ['parentheses', '[//]: # (SECRET_ONE)'],
    ['double quotes', '[//]: # "SECRET_ONE"'],
    ['single quotes', "[//]: # 'SECRET_ONE'"],
    ['comment label', '[comment]: <> (SECRET_ONE)'],
    ['comment label, double quotes', '[comment]: <> "SECRET_ONE"'],
    ['slash label, empty destination', '[//]: <> (SECRET_ONE)'],
    ['comment label, hash destination', "[comment]: # 'SECRET_ONE'"],
    ['upper case label', '[COMMENT]: <> (SECRET_ONE)'],
    ['spaces in the brackets', '[ // ]: # (SECRET_ONE)'],
  ] as const;

  for (const [name, form] of FORMS) {
    it(`replaces a definition alone (${name}) by the marker`, () => {
      expect(commentRanges(form)).toEqual([[0, form.length]]);
      const shown = requestTextOf({ text: form });
      expect(shown.text).toBe(COMMENT_MARKER);
      // The marker maps onto the comment it replaces: its first character to the `[`, its last to the end.
      expect(shown.at[0]).toBe(0);
      expect(shown.at.at(-1)).toBe(form.length - 1);
    });

    it(`replaces it after a paragraph line and keeps the lines around (${name})`, () => {
      for (const eol of ['\n', '\r\n']) {
        const text = ['Mind the tide.', form, 'Lock the shed.'].join(eol);
        const want = ['Mind the tide.', COMMENT_MARKER, 'Lock the shed.'].join(eol);
        expect(masked(text), JSON.stringify(eol)).toBe(want);
      }
    });
  }

  it('replaces it behind block quote marks and list markers, and keeps the marks', () => {
    expect(masked('> [//]: # (SECRET_ONE)')).toBe('> (comment)');
    expect(masked('> > [comment]: <> "SECRET_ONE"')).toBe('> > (comment)');
    expect(masked('- [//]: # (SECRET_ONE)')).toBe('- (comment)');
    expect(masked('12. [//]: # (SECRET_ONE)')).toBe('12. (comment)');
    expect(masked('   [//]: # (SECRET_ONE)')).toBe('   (comment)');
    expect(masked('- Check the rope.\n  [//]: # (SECRET_ONE)')).toBe('- Check the rope.\n  (comment)');
  });

  it('masks every comment of a file, each form, and leaves the text between them', () => {
    const text = [
      'First line.',
      '[//]: # (SECRET_ONE)',
      '',
      'Second line.',
      '[//]: # "SECRET_TWO"',
      '[comment]: <> (SECRET_THREE)',
      '',
      'Third line.',
    ].join('\n');
    const want = 'First line.\n(comment)\n\nSecond line.\n(comment)\n(comment)\n\nThird line.';
    expect(commentRanges(text)).toHaveLength(3);
    expect(masked(text)).toBe(want);
  });
});

describe('what ends a Markdown comment', () => {
  it('runs a title over several lines up to its closing mark', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = ['[//]: # (SECRET_ONE', 'SECRET_TWO', 'SECRET_THREE)', 'After.'].join(eol);
      expect(masked(text), JSON.stringify(eol)).toBe(['(comment)', 'After.'].join(eol));
    }
    expect(masked("[//]: # 'SECRET_ONE\nSECRET_TWO'\nAfter.")).toBe('(comment)\nAfter.');
  });

  it('masks the rest of the line after the closing mark: text after a title is not shown either', () => {
    expect(masked('[//]: # (SECRET_ONE) SECRET_TWO\nAfter.')).toBe('(comment)\nAfter.');
    expect(masked('[//]: # "SECRET_ONE" "SECRET_TWO"\nAfter.')).toBe('(comment)\nAfter.');
  });

  it('skips an escaped closing mark', () => {
    expect(masked('[//]: # (SECRET_ONE \\) SECRET_TWO) tail\nAfter.')).toBe('(comment)\nAfter.');
    expect(masked('[//]: # "SECRET_ONE \\" SECRET_TWO"\nAfter.')).toBe('(comment)\nAfter.');
  });

  it('masks a title that never closes to the end of its paragraph', () => {
    const lf = '[//]: # (SECRET_ONE\nSECRET_TWO\n\nNext paragraph.';
    expect(masked(lf)).toBe('(comment)\n\nNext paragraph.');
    const crlf = '[//]: # (SECRET_ONE\r\nSECRET_TWO\r\n\r\nNext paragraph.';
    expect(masked(crlf)).toBe('(comment)\r\n\r\nNext paragraph.');
    const spaced = '[//]: # (SECRET_ONE\nSECRET_TWO  \n \t \nNext paragraph.';
    expect(masked(spaced)).toBe('(comment)\n \t \nNext paragraph.');
  });

  it('masks a title that never closes in the last paragraph to the end of the text', () => {
    expect(masked('Before.\n\n[//]: # (SECRET_ONE\nSECRET_TWO')).toBe('Before.\n\n(comment)');
    expect(masked('[comment]: <> "SECRET_ONE')).toBe('(comment)');
  });

  it('allows the title on the line after the destination, and not after a blank line', () => {
    expect(masked('[//]: #\n(SECRET_ONE)\nAfter.')).toBe('(comment)\nAfter.');
    expect(masked('[//]: # \r\n"SECRET_ONE"\r\nAfter.')).toBe('(comment)\r\nAfter.');
    expect(masked('[//]: #\n\n(plain words)')).toBe('[//]: #\n\n(plain words)');
  });

  it('keeps a lone carriage return as a line end', () => {
    expect(masked('One.\r[//]: # (SECRET_ONE)\rTwo.')).toBe('One.\r(comment)\rTwo.');
  });
});

describe('what is not a Markdown comment', () => {
  const PLAIN = [
    // Another label: a normal link reference definition.
    '[note]: # (visible words)',
    '[ref]: <> "visible words"',
    // A destination that is not `#` or `<>`, or none, or no title.
    '[//]: https://example.test/page (visible words)',
    '[//]: #anchor (visible words)',
    '[//]: #',
    '[comment]: <>',
    // The form in the middle of a line is text, not a definition.
    'Hang the lamp [//]: # (visible words)',
    // A longer label.
    '[//x]: # (visible words)',
    '[comments]: <> (visible words)',
  ];

  for (const text of PLAIN) {
    it(`leaves ${JSON.stringify(text)} as it is`, () => {
      expect(commentRanges(text)).toEqual([]);
      expect(masked(text)).toBe(text);
    });
  }

  it('does not open a comment inside a fence given as a skip range', () => {
    const text = '```\n[//]: # (SECRET_ONE)\n```';
    expect(commentRanges(text, [[0, text.length]])).toEqual([]);
    expect(commentRanges(text)).toEqual([[4, 24]]);
  });
});

describe('<!-- --> comments are found as before', () => {
  it('keeps the ranges and the masked text of the html comment form', () => {
    const text = 'a <!-- x --> b <!-- y --> c <!-- never closed';
    expect(commentRanges(text)).toEqual([
      [2, 12],
      [15, 25],
      [28, text.length],
    ]);
    expect(masked(text)).toBe('a (comment) b (comment) c (comment)');
    expect(masked('<!--x-->')).toBe('(comment)');
    expect(masked('<!-- one\ntwo -->\r\nthree')).toBe('(comment)\r\nthree');
  });

  it('joins an html comment and a Markdown comment that overlap into one', () => {
    const text = '<!-- SECRET_ONE\n[//]: # (SECRET_TWO) -->\nAfter.';
    expect(commentRanges(text)).toEqual([[0, text.indexOf('\nAfter.')]]);
    expect(masked(text)).toBe('(comment)\nAfter.');
    const inside = 'Before.\n[//]: # (SECRET_ONE <!-- SECRET_TWO --> SECRET_THREE)\nAfter.';
    expect(masked(inside)).toBe('Before.\n(comment)\nAfter.');
  });

  it('keeps an html comment and a Markdown comment that touch as two', () => {
    expect(commentRanges('<!-- a -->\n[//]: # (b)')).toEqual([
      [0, 10],
      [11, 22],
    ]);
  });
});

describe('every place a request carries text masks a Markdown comment', () => {
  it('masks the heading path, a display line and the offsets of the shown text', () => {
    expect(requestPathOf({ headingPath: ['[//]: # (SECRET_ONE)', 'Gate'] })).toEqual(['(comment)', 'Gate']);
    expect(requestShownOf({ after: 1, text: '[comment]: <> "SECRET_ONE"' })).toBe('(comment)');
    const text = 'Mind the tide.\n[//]: # (SECRET_ONE)\nLock the shed.';
    const shown = shownOf({ text });
    expect(shown.text).toBe('Mind the tide. (comment) Lock the shed.');
    const from = text.indexOf('[');
    const to = text.indexOf(')') + 1;
    const marker = shown.text.indexOf(COMMENT_MARKER);
    expect(shown.at[marker]).toBe(from);
    expect(shown.at[marker + COMMENT_MARKER.length - 1]).toBe(to - 1);
    // A character after the comment maps back to the unit's own text.
    expect(text[shown.at[shown.text.indexOf('Lock')] as number]).toBe('L');
  });

  /** Everything a labeler request is built from, for every window of a file. */
  function requestsOf(source: string): string {
    const windows = windowsOf('harbour.md', cut(source).units, 60, source);
    const parts: string[] = [];
    for (const window of windows) {
      parts.push(
        windowLines(window).join('\n'),
        denseUser(SET, window),
        yesNoText(window),
        JSON.stringify(userRequest('system2', SET, window, false)),
        JSON.stringify(userRequest('system1', SET, window, false)),
      );
    }
    return parts.join('\n');
  }

  const FILES: Array<[string, string]> = [
    ['after a paragraph, no blank line', around('[//]: # (SECRET_ONE)')],
    ['after a paragraph, lower case', around('[//]: # (secret_one)')],
    ['between paragraphs', around('', '[comment]: <> "SECRET_ONE"')],
    ['a title over several lines', around('[//]: # (SECRET_ONE', 'SECRET_TWO. SECRET_THREE.)')],
    ['in a list item', file(LF, '- Check the rope.', '  [//]: # (SECRET_ONE)', '', 'Lock the shed.')],
    ['in a block quote', file(LF, '> Check the net.', "> [//]: # 'SECRET_ONE'", '', 'Lock the shed.')],
  ];

  for (const [name, source] of FILES) {
    it(`sends no word of a comment ${name}, in either line ending`, () => {
      for (const eol of ['\n', '\r\n']) {
        const request = requestsOf(source.replaceAll('\n', eol));
        expect(request, JSON.stringify(eol)).not.toMatch(/secret_(one|two|three)/i);
        expect(request, JSON.stringify(eol)).toContain('Lock the shed.');
      }
    });
  }

  it('keeps the real text in the unit: only the request is changed', () => {
    const source = around('[//]: # (SECRET_ONE)');
    const units = cut(source).units;
    expect(units.some((unit) => unit.text.includes('SECRET_ONE'))).toBe(true);
    const windows = windowsOf('harbour.md', units, 60, source);
    const texts = windows.flatMap((window) => window.units.map((unit) => unit.text));
    expect(texts.some((text) => text.includes('SECRET_ONE'))).toBe(true);
    expect(requestsOf(source)).toContain(COMMENT_MARKER);
  });
});

describe('what the cutter does with a link reference definition', () => {
  it('adds no unit for a definition of its own, whatever its label', () => {
    for (const label of ['//', 'comment', 'note']) {
      const source = around('', `[${label}]: # (WORDS_ONE)`);
      const texts = cut(source).units.map((unit) => unit.text);
      expect(texts, label).toEqual(['Mind the tide.', 'Lock the shed.']);
    }
  });

  it('keeps a definition that follows a paragraph line inside the paragraph, as text of a unit', () => {
    const source = around('[//]: # (WORDS_ONE)');
    expect(cut(source).units.some((unit) => unit.text.includes('WORDS_ONE'))).toBe(true);
  });
});
