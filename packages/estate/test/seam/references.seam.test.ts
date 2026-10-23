// The rule of fix 2, stated over parts and links:
//
//   A path a part's text writes (a code span, a link destination, a table cell, a quoted name) is a `references`
//   link from that part to the file it leads to. A path that leads to no file is an unresolved link, and the
//   references check fails on it, when it is sure to be a path: it has a file type, it is a link destination, or
//   its first folder is one the estate holds. A delimited name with a separator and nothing more (`yes/no`) is kept
//   apart and listed by the check as skipped, with its reason, never dropped. Text that only looks like a path (an
//   example in a fence, a URL, a glob, a placeholder, a version, a command) is no link. A fenced block closes as
//   CommonMark says. Nothing but the syntax of a path decides.
//
// Expectations come from that rule and from the way a person reads a path (relative to the naming file, or from the
// root of the estate), never from what the product printed. They are red on release/next today: a scan with no
// model reads no reference at all.
import { describe, expect, it } from 'vitest';
import { from, orphans, outcome, resolvedLink, shape, unresolvedLinks } from './links';
import { observe } from './observe';
import {
  behaviour,
  CASINGS,
  DECOYS,
  decoyEstate,
  type RefAxes,
  type RefMods,
  referenceEstate,
  referenceMatrix,
} from './variants';
import { MENTION_LINK } from './vocabulary';

const MATRIX = referenceMatrix();
const ids = ['namer', 'target'];

async function read(axes: RefAxes, mods: RefMods = {}) {
  const built = referenceEstate(axes, mods);
  return { built, observed: await observe(built.files, built.parts, built.nest ? { nest: built.nest } : {}) };
}

describe('a path a part writes is a reference, over the whole matrix', () => {
  for (const axes of MATRIX) {
    const expected = behaviour(axes);
    const label = referenceEstate(axes).label;
    it(label, async () => {
      const { built, observed } = await read(axes);
      const references = outcome(observed, 'references');
      if (axes.exists) {
        if (expected.exists === 'none') {
          expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
          return;
        }
        expect(resolvedLink(observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(references.status).toBe('pass');
        if (built.orphanObservable) expect(orphans(observed)).not.toContain('target');
      } else if (expected.missing === 'fails') {
        expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(1);
        expect(references.status).toBe('fail');
      } else if (expected.missing === 'listed') {
        // Kept apart, never dropped: no link, no finding, and the check says what it could not judge.
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
        expect(references.coverage.skipped.map((entry) => entry.reason)).toContain('path-not-in-estate');
      } else {
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
      }
      // The naming part is read by the model: it instructs.
      if (axes.namer !== 'skill-doc') expect(observed.aspects.get('namer')).toContain('instructs');
    });
  }
});

describe('text that looks like a path and is none gives no reference', () => {
  for (const decoy of DECOYS) {
    it(decoy.key, async () => {
      const built = decoyEstate(decoy.lines);
      const observed = await observe(built.files, built.parts);
      expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
      expect(outcome(observed, 'references').status).not.toBe('fail');
    });
  }
});

// Metamorphic: a change that must not alter what the read finds. One variant in six, so every place, syntax and
// value of each axis is met.
const SAMPLE = MATRIX.filter(
  (axes, index) =>
    index % 6 === 0 && behaviour(axes).exists === 'link' && behaviour(axes).missing !== 'silent',
);

describe('a change that must not alter the links', () => {
  const same = (name: string, mods: (axes: RefAxes) => RefMods | undefined) => {
    describe(name, () => {
      for (const axes of SAMPLE) {
        const modified = mods(axes);
        if (modified === undefined) continue;
        it(referenceEstate(axes).label, async () => {
          const before = await read(axes);
          const after = await read(axes, modified);
          expect(shape(after.observed, ids)).toEqual(shape(before.observed, ids));
          expect(shape(before.observed, ids).length).toBeGreaterThan(0);
        });
      }
    });
  };
  same('moving the root of the estate to another folder', () => ({ nest: ['alpha', 'beta', 'gamma'] }));
  same('adding unrelated parts', () => ({ size: 25 }));
  same('adding text above the naming line', () => ({ preamble: true }));
  same('changing the line ending', (axes) => ({ eol: axes.eol === 'lf' ? 'crlf' : 'lf' }));
  same('writing the name in every case, in the file and in the mention', (axes) => {
    const other = CASINGS[(CASINGS.indexOf(axes.casing) + 1) % CASINGS.length];
    return other === undefined ? undefined : { casing: other };
  });
  same('naming the file twice', () => ({ duplicate: true }));
  same('writing the path in another syntax', (axes) => {
    const swap = {
      'code-span': 'link',
      link: 'table-cell',
      'link-anchor': 'quoted',
      'table-cell': 'code-span',
      quoted: 'link',
    } as const;
    const syntax = swap[axes.syntax as keyof typeof swap];
    if (syntax === undefined || behaviour({ ...axes, syntax }).exists !== 'link') return undefined;
    return { syntax };
  });
});

describe('a change that must alter the links', () => {
  const REACHED = SAMPLE.filter((axes) => axes.exists);

  describe('deleting the named file turns the reference into a missing one and nothing else', () => {
    for (const axes of REACHED.filter((entry) => behaviour(entry).missing === 'fails')) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const after = await read(axes, { exists: false });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(unresolvedLinks(after.observed, MENTION_LINK, 'namer')).toHaveLength(1);
        expect(outcome(before.observed, 'references').status).toBe('pass');
        expect(outcome(after.observed, 'references').status).toBe('fail');
      });
    }
  });

  describe('deleting the line that names the file removes the link, and the file is then unreferenced', () => {
    for (const axes of REACHED) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const { built, observed } = await read(axes, { omitNaming: true });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
        if (built.orphanObservable) expect(orphans(observed)).toContain('target');
      });
    }
  });

  describe('putting the line in a fenced block removes the link', () => {
    for (const axes of REACHED) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const { observed } = await read(axes, { fenced: true });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
      });
    }
  });
});

describe('a path with no file type', () => {
  const NAMER = '.claude/skills/neutra/SKILL.md';
  const skill = (body: string[]) =>
    ['---', 'name: neutra', 'description: Handles neutral work.', '---', '', ...body, ''].join('\n');
  const estateOf = async (body: string[], extra: Record<string, string> = {}) => {
    const files = { 'CLAUDE.md': '# Rules\n\nKeep replies short.\n', [NAMER]: skill(body), ...extra };
    const parts = [
      { id: 'namer', path: NAMER },
      ...Object.keys(extra).map((path, index) => ({ id: `t${index}`, path })),
    ];
    return observe(files, parts);
  };

  it('is found when it exists: a link destination, a code span and a quoted name, beside the part and below it', async () => {
    const observed = await estateOf(
      [
        'Read [the entry](references/leaf) first.',
        'Then `references/second` and "references/third".',
        'Last is [the sibling](tool).',
      ],
      {
        '.claude/skills/neutra/references/leaf': 'leaf\n',
        '.claude/skills/neutra/references/second': 'second\n',
        '.claude/skills/neutra/references/third': 'third\n',
        '.claude/skills/neutra/tool': 'tool\n',
      },
    );
    for (const id of ['t0', 't1', 't2', 't3'])
      expect(resolvedLink(observed, MENTION_LINK, 'namer', id)).toBe(true);
    expect(outcome(observed, 'references').status).toBe('pass');
  });

  it('is a missing reference when it is a link destination, or its first folder is one the estate holds', async () => {
    const observed = await estateOf(
      ['Read [the entry](references/leaf) first.', 'Then `references/second`.', 'And [the other](tool).'],
      { '.claude/skills/neutra/references/kept.md': '# Kept\n' },
    );
    expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(3);
    expect(outcome(observed, 'references').status).toBe('fail');
  });

  it('is kept apart and listed when nothing says it names a file: a pair of words in a code span', async () => {
    const observed = await estateOf(['Answer `yes/no` and `owner/repo`, then "read/write".']);
    expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
    const references = outcome(observed, 'references');
    expect(references.status).not.toBe('fail');
    expect(references.coverage.skipped.map((entry) => entry.reason)).toEqual(
      Array(3).fill('path-not-in-estate'),
    );
    expect(
      references.coverage.skipped.map((entry) => entry.what.split(' ').slice(1).join(' ')).sort(),
    ).toEqual(['owner/repo', 'read/write', 'yes/no']);
  });

  it('is no reference when it names a folder, a section of the page, a mail address or a loose pair', async () => {
    const observed = await estateOf(
      [
        'See [the folder](references) and [the same](references/) and [the top](#top).',
        'Write to [us](mailto:team@example.org) or follow [it](https://example.org/guide).',
        'Use and/or when it helps.',
      ],
      { '.claude/skills/neutra/references/kept.md': '# Kept\n' },
    );
    expect(from(observed, 'namer', MENTION_LINK).filter((link) => link.kind === MENTION_LINK)).toEqual([]);
    const references = outcome(observed, 'references');
    expect(references.status).not.toBe('fail');
    expect(references.coverage.skipped).toEqual([]);
  });

  it('is found outside the layout of the runtime, from the root of the estate', async () => {
    const observed = await observe(
      {
        'CLAUDE.md': '# Rules\n\nRun `bin/tool` and read [the notes](notes/guide).\n',
        'bin/tool': '#!/bin/sh\n',
        'notes/guide': 'guide\n',
      },
      [
        { id: 'namer', path: 'CLAUDE.md' },
        { id: 'tool', path: 'bin/tool' },
        { id: 'guide', path: 'notes/guide' },
      ],
    );
    expect(resolvedLink(observed, MENTION_LINK, 'namer', 'tool')).toBe(true);
    expect(resolvedLink(observed, MENTION_LINK, 'namer', 'guide')).toBe(true);
  });
});

// CommonMark fenced blocks: a fence closes only on a fence of the same character that is at least as long as the
// one that opened it, with nothing after it. Whatever lies between is the block's text, a path in it included.
describe('a fenced block closes as CommonMark says', () => {
  const NAMER = 'CLAUDE.md';
  type Case = { key: string; open: string; between: string[]; close: string; closes: boolean };
  const CASES: Case[] = [
    { key: 'three backticks, plain close', open: '```', between: [], close: '```', closes: true },
    {
      key: 'four backticks, a shorter fence inside',
      open: '````',
      between: ['```'],
      close: '````',
      closes: true,
    },
    { key: 'four backticks, only a shorter fence', open: '````', between: [], close: '```', closes: false },
    { key: 'three backticks, a longer fence closes', open: '```', between: [], close: '`````', closes: true },
    { key: 'backticks, a tilde fence inside', open: '```', between: ['~~~'], close: '```', closes: true },
    { key: 'backticks, only a tilde fence', open: '```', between: [], close: '~~~', closes: false },
    { key: 'tildes, a backtick fence inside', open: '~~~', between: ['```'], close: '~~~', closes: true },
    { key: 'tildes, only a shorter tilde fence', open: '~~~~', between: [], close: '~~~', closes: false },
    { key: 'tildes, a longer fence closes', open: '~~~', between: [], close: '~~~~~', closes: true },
    {
      key: 'an info string after the closing fence',
      open: '```',
      between: [],
      close: '```text',
      closes: false,
    },
    {
      key: 'a closing fence indented by three spaces',
      open: '```',
      between: [],
      close: '   ```',
      closes: true,
    },
    { key: 'a closing fence with trailing spaces', open: '```', between: [], close: '```   ', closes: true },
    {
      key: 'five tildes, two shorter fences inside',
      open: '~~~~~',
      between: ['~~~', '~~~~'],
      close: '~~~~~',
      closes: true,
    },
  ];
  const named = 'Neutral text `notes/absent.md`.';
  const estateOf = (c: Case, place: 'inside' | 'after') =>
    observe(
      {
        'CLAUDE.md': [
          '# Rules',
          '',
          `${c.open}text`,
          ...(place === 'inside' ? [named] : []),
          ...c.between,
          ...(place === 'inside' && c.between.length > 0 ? [named] : []),
          c.close,
          ...(place === 'after' ? [named] : []),
          '',
        ].join('\n'),
      },
      [{ id: 'namer', path: NAMER }],
    );

  for (const c of CASES) {
    it(c.key, async () => {
      // A line inside the block is the block's text: it names nothing, whether it comes before or after a shorter fence.
      const inside = await estateOf(c, 'inside');
      const afterwards = await estateOf(c, 'after');
      if (c.closes) {
        expect(from(inside, 'namer', MENTION_LINK)).toEqual([]);
        expect(unresolvedLinks(afterwards, MENTION_LINK, 'namer')).toHaveLength(1);
      } else {
        // The block is still open at the line that follows the fence that did not close it.
        expect(from(inside, 'namer', MENTION_LINK)).toEqual([]);
        expect(from(afterwards, 'namer', MENTION_LINK)).toEqual([]);
      }
    });
  }

  it('a block that never closes holds the rest of the page', async () => {
    const observed = await observe(
      { 'CLAUDE.md': ['# Rules', '', '````text', '```', 'Neutral text `notes/absent.md`.', ''].join('\n') },
      [{ id: 'namer', path: NAMER }],
    );
    expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
  });
});
