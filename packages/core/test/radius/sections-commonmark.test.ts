import { describe, expect, it } from 'vitest';
import { checkSectionRegistry, sectionsFromHeadings } from '../../src/radius/sections';

// Invented lighthouse prompts. Every heading, id and sentence below is made up for these tests.

function built(text: string, level?: number) {
  const result = sectionsFromHeadings(text, {
    promptId: 'lighthouse',
    version: 'v1',
    ...(level ? { level } : {}),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  expect(checkSectionRegistry(result.registry, text)).toEqual([]);
  return result.registry.sections;
}
const ids = (text: string, level?: number) => built(text, level).map((section) => section.id);
const titles = (text: string, level?: number) => built(text, level).map((section) => section.title);

describe('sectionsFromHeadings reads CommonMark headings', () => {
  describe('fenced code blocks', () => {
    it('does not start a section at a # line inside a backtick fence', () => {
      const text =
        '## Tides\nRead the gauge twice.\n```sh\n# log the level\n## copy it\n```\n## Moorings\nTie off fore and aft.\n';
      expect(ids(text)).toEqual(['tides', 'moorings']);
      const tides = built(text)[0];
      expect(text.slice(tides?.span.start, tides?.span.end)).toContain('## copy it');
    });

    it('treats a tilde fence, an indented fence and a longer closing fence the same way', () => {
      expect(ids('## Tides\nRead the gauge.\n~~~\n# one\n~~~\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\nRead the gauge.\n  ```\n  # one\n  ```\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\nRead the gauge.\n```\n# one\n`````\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
    });

    it('keeps a fence open when the closing line is shorter or of the other character', () => {
      const text = '## Tides\nRead the gauge.\n````\n# one\n```\n~~~~\n## two\n````\n## Moorings\nTie off.\n';
      expect(ids(text)).toEqual(['tides', 'moorings']);
    });

    it('lets an unclosed fence run to the end of the prompt', () => {
      expect(ids('## Tides\nRead the gauge.\n```\n# one\n## two\nmore text\n')).toEqual(['tides']);
    });

    it('is not fooled by a backtick fence whose info string holds a backtick', () => {
      expect(ids('## Tides\nUse ``` inline` here.\n## Moorings\nTie off.\n')).toEqual(['tides', 'moorings']);
    });
  });

  describe('setext headings', () => {
    it('starts a section at a paragraph underlined with = or -', () => {
      const text = 'Lamp care\n=========\nTrim the wick.\n\nOil store\n---------\nKeep it cool.\n';
      expect(ids(text)).toEqual(['lamp_care', 'oil_store']);
      expect(titles(text)).toEqual(['Lamp care', 'Oil store']);
    });

    it('takes a multi-line paragraph as one title and keeps the text before it as the preamble', () => {
      const text = 'You keep the light.\n\nFog\nsignals\n---\nSound the horn.\n';
      expect(ids(text)).toEqual(['preamble', 'fog_signals']);
      expect(titles(text)[1]).toBe('Fog signals');
    });

    it('honours the level: = is level 1 and - is level 2', () => {
      const text = 'Lamp care\n=========\nTrim the wick.\n\nOil store\n---------\nKeep it cool.\n';
      expect(ids(text, 1)).toEqual(['lamp_care']);
    });

    it('does not take a thematic break, a bare underline, a list or a quote as a heading', () => {
      const text =
        '## Tides\nRead the gauge.\n\n---\n\nMore on the gauge.\n***\n===\n- keep dry\n---\n> quoted\n---\nEnd.\n';
      expect(ids(text)).toEqual(['tides']);
    });

    it('ends a paragraph at an ATX heading, a fence or a blank line, so a later --- underlines nothing', () => {
      const text =
        '## Tides\nRead the gauge.\n```\ncode\n```\n---\n## Store\nKeep it cool.\n\nNote\n\n---\nEnd.\n';
      expect(titles(text)).toEqual(['Tides', 'Store']);
      expect(titles('## Tides\nRead the gauge.\n\nStore\n---\nKeep it cool.\n')).toEqual(['Tides', 'Store']);
    });
  });

  describe('indented ATX headings', () => {
    it('reads a heading indented one to three spaces', () => {
      const text = ' ## Rope\nCoil it.\n  ### Knots\nTie a bowline.\n   ## Anchor\nSet it.\n';
      expect(ids(text, 3)).toEqual(['rope', 'knots', 'anchor']);
    });

    it('does not read a heading indented four spaces or by a tab', () => {
      const text = '## Rope\nCoil it.\n    ## Knots\nTie a bowline.\n\t## Anchor\nSet it.\n';
      expect(ids(text)).toEqual(['rope']);
    });

    it('starts the section at the # so the anchor is in the body', () => {
      const text = '  ## Rope\nCoil it with care.\n';
      const rope = built(text)[0];
      expect(text.slice(rope?.span.start, rope?.span.start === undefined ? 0 : rope.span.start + 8)).toBe(
        '## Rope\n',
      );
    });
  });

  describe('closing sequence', () => {
    it('drops a closing # sequence from the title', () => {
      expect(titles('## Flares ##\nFire one.\n# Horn #\nBlow it.\n### Chart ####   \nRead it.\n', 3)).toEqual(
        ['Flares', 'Horn', 'Chart'],
      );
    });

    it('keeps a # that is part of the title', () => {
      expect(titles('## C#\nWrite it.\n## Tag \\#\nMark it.\n## Keep # inside\nOk.\n')).toEqual([
        'C#',
        'Tag \\#',
        'Keep # inside',
      ]);
    });

    it('reads a heading with no title and a heading that is only #', () => {
      expect(ids('##\nBody one.\n## ##\nBody two.\n')).toEqual(['section', 'section_2']);
    });

    it('does not read #hashtag as a heading', () => {
      expect(ids('## Tides\n#hashtag stays text.\n')).toEqual(['tides']);
    });
  });

  describe('ids', () => {
    it('numbers repeats _2, _3 in order', () => {
      expect(ids('# T\nOne.\n# T\nTwo.\n# T\nThree.\n')).toEqual(['t', 't_2', 't_3']);
    });

    it('never gives one id to two sections when a repeat suffix meets another title', () => {
      const text = '# T\nOne.\n# T\nTwo.\n# T 2\nThree.\n';
      const found = ids(text);
      expect(found).toEqual(['t', 't_2', 't_2_2']);
      expect(new Set(found).size).toBe(found.length);
    });

    it('skips a taken id when the colliding title comes first', () => {
      const found = ids('# T 2\nOne.\n# T\nTwo.\n# T\nThree.\n# T\nFour.\n');
      expect(found).toEqual(['t_2', 't', 't_3', 't_4']);
    });

    it('does not let a heading titled Preamble take the id of the text before the first heading', () => {
      const found = ids('Intro text.\n\n## Preamble\nBody.\n');
      expect(found).toEqual(['preamble', 'preamble_2']);
    });
  });
});
