import { describe, expect, it } from 'vitest';
import {
  createAnthropicLabeler,
  cut,
  denseUser,
  type LabelSet,
  userRequest,
  windowLines,
  windowsOf,
  yesNoText,
} from '../../src/pointer';
import { shownOf } from '../../src/pointer/labels';

// Invented text: a harbour office. Every comment holds a SECRET_ word that must never leave in a request.
const SET: LabelSet = {
  set: 'rules',
  description: 'Harbour rules',
  labels: [{ name: 'rule', description: 'A rule' }],
};

/** Everything a labeler request is built from, for every window of a file: each builder, as one string. */
function requestsOf(file: string, size = 60): { lines: string; all: string } {
  const windows = windowsOf('harbour.md', cut(file).units, size, file);
  const parts: string[] = [];
  const lines: string[] = [];
  for (const window of windows) {
    lines.push(...windowLines(window));
    parts.push(
      windowLines(window).join('\n'),
      denseUser(SET, window),
      yesNoText(window),
      JSON.stringify(userRequest('system2', SET, window, false)),
      JSON.stringify(userRequest('system1', SET, window, false)),
      JSON.stringify(createAnthropicLabeler({}).render(SET, window).body),
    );
  }
  return { lines: lines.join('\n'), all: parts.join('\n') };
}

const EOLS = ['\n', '\r\n'];

describe('a comment inside a unit never reaches a labeler request', () => {
  it('replaces a comment inline in a sentence by (comment) and sends the rest of the sentence', () => {
    for (const eol of EOLS) {
      const file = ['Hang the lamp <!-- SECRET_INLINE --> before dusk.', '', 'Lock the shed.', ''].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_INLINE');
      expect(lines, JSON.stringify(eol)).toBe('[1] Hang the lamp (comment) before dusk.\n[2] Lock the shed.');
    }
  });

  it('replaces a comment in a heading and after its marker, in the unit and in the path', () => {
    for (const eol of EOLS) {
      const file = [
        '# Harbour <!-- SECRET_HEADING -->',
        '',
        'Hang the lamp.',
        '',
        '## <!-- SECRET_MARKER --> Gate',
        '',
        'Close the gate.',
        '',
      ].join(eol);
      const { lines, all } = requestsOf(file, 1);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_HEADING');
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_MARKER');
      expect(lines, JSON.stringify(eol)).toContain('# Harbour (comment)');
      expect(lines, JSON.stringify(eol)).toContain('## (comment) Gate');
      expect(all, JSON.stringify(eol)).toContain('path: Harbour (comment) > (comment) Gate');
    }
  });

  it('replaces a comment inside a table cell and keeps the rest of the cell', () => {
    for (const eol of EOLS) {
      const file = [
        '| Item | Rule |',
        '| --- | --- |',
        '| Lamp | Hang it <!-- SECRET_CELL --> early. |',
        '',
      ].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_CELL');
      expect(lines, JSON.stringify(eol)).toContain('Hang it (comment) early.');
    }
  });

  it('replaces a comment at the end of a line after text', () => {
    for (const eol of EOLS) {
      const file = ['Hang the lamp before dusk. <!-- SECRET_EOL -->', '', 'Lock the shed.', ''].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_EOL');
      expect(lines, JSON.stringify(eol)).toContain('Hang the lamp before dusk.');
      expect(lines, JSON.stringify(eol)).toContain('(comment)');
    }
  });

  it('replaces a comment in a list item and in a block quote', () => {
    for (const eol of EOLS) {
      const file = [
        '- Hang the lamp <!-- SECRET_ITEM --> early.',
        '',
        '> Lock <!-- SECRET_QUOTE --> the shed.',
        '',
      ].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_ITEM');
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_QUOTE');
      expect(lines, JSON.stringify(eol)).toContain('Hang the lamp (comment) early.');
      expect(lines, JSON.stringify(eol)).toContain('Lock (comment) the shed.');
    }
  });

  it('replaces a comment of several lines, and several comments in one unit, each by one marker', () => {
    for (const eol of EOLS) {
      const file = [
        'Hang <!-- SECRET_ONE_A',
        'SECRET_ONE_B --> the lamp <!-- SECRET_TWO --> before dusk.',
        '',
      ].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_ONE');
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_TWO');
      // With CRLF the cutter itself splits this sentence at the line end; the comments are replaced all the same.
      if (eol === '\n') expect(lines).toBe('[1] Hang (comment) the lamp (comment) before dusk.');
      expect(lines.split('(comment)').length - 1, JSON.stringify(eol)).toBeGreaterThanOrEqual(2);
    }
  });

  it('treats a comment that never closes as a comment to the end of the file', () => {
    for (const eol of EOLS) {
      const file = ['Hang the lamp.', '', 'Lock the shed <!-- SECRET_OPEN before dusk.', ''].join(eol);
      const { lines, all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_OPEN');
      expect(lines, JSON.stringify(eol)).toBe('[1] Hang the lamp.\n[2] Lock the shed (comment)');
    }
  });

  it('strips a comment the cutter splits across several units', () => {
    for (const eol of EOLS) {
      const file = [
        'Close the gate. <!-- Private SECRET_SPLIT_A. Second SECRET_SPLIT_B. Third SECRET_SPLIT_C. --> Lock the shed.',
        '',
        'Hang <!-- SECRET_BLANK_A',
        '',
        'SECRET_BLANK_B --> the lamp.',
        '',
      ].join(eol);
      const { all } = requestsOf(file);
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_SPLIT');
      expect(all, JSON.stringify(eol)).not.toContain('SECRET_BLANK');
    }
  });

  it('does not take a comment opened inside a fence for a comment', () => {
    const file = ['```md', '<!-- not a comment', '```', '', 'Later sentence stays.', ''].join('\n');
    const { lines } = requestsOf(file);
    expect(lines).toBe('(fence, not labelable) ```md\n[1] Later sentence stays.');
  });

  it('keeps an opaque comment shown by its kind only, and the fence by its kind and first line', () => {
    const file = ['Hang the lamp.', '', '<!-- SECRET_OPAQUE -->', '', 'Lock the shed.', ''].join('\n');
    const { lines, all } = requestsOf(file);
    expect(all).not.toContain('SECRET_OPAQUE');
    expect(lines).toBe('[1] Hang the lamp.\n(comment, not labelable)\n[2] Lock the shed.');
  });

  it('keeps the unit text of the window whole: ids, ledger and atoms read it, not the request', () => {
    const file = 'Hang the lamp <!-- SECRET_KEPT --> before dusk.\n';
    const [window] = windowsOf('harbour.md', cut(file).units, 60, file);
    expect(window?.units[0]?.text).toBe('Hang the lamp <!-- SECRET_KEPT --> before dusk.');
  });

  it('carries an offset on the shown text back to the unit own text', () => {
    const unit = { text: 'Hang <!-- SECRET_AT --> the lamp <!-- X --> before dusk.' };
    const shown = shownOf(unit);
    expect(shown.text).toBe('Hang (comment) the lamp (comment) before dusk.');
    const from = shown.text.indexOf('the lamp');
    const to = from + 'the lamp'.length;
    expect(unit.text.slice(shown.at[from], (shown.at[to - 1] as number) + 1)).toBe('the lamp');
  });
});
