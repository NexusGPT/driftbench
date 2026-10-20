import { describe, expect, it } from 'vitest';
import { sectionEntry, sectionsFromHeadings } from '../../src/radius/sections';

/** The search the section anchor used before it became linear, kept here as the reference for equal quotes. */
function count(text: string, quote: string): number[] {
  const at: number[] = [];
  if (quote === '') return at;
  for (let from = text.indexOf(quote); from >= 0; from = text.indexOf(quote, from + 1)) at.push(from);
  return at;
}

function oldUniqueQuote(text: string, start: number, end: number): { quote: string; at: number } | undefined {
  let from = start;
  const newline = text.indexOf('\n', start);
  if (newline >= 0 && newline + 1 < end && /^#{1,6}\s/.test(text.slice(start, newline))) from = newline + 1;
  while (from < end && /\s/.test(text[from] ?? '')) from++;
  for (const origin of from < end ? [from, start] : [start]) {
    for (let length = Math.min(24, end - origin); origin + length <= end; length++) {
      const quote = text.slice(origin, origin + length);
      if (quote.trim() !== '' && count(text, quote).length === 1) return { quote, at: origin };
    }
  }
  return undefined;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function entryOf(text: string, start: number, end: number) {
  return sectionEntry(text, start, end, { id: 's', title: 's', scope: 'global' });
}

function cpuMs<T>(run: () => T): number {
  const before = process.cpuUsage();
  run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

/**
 * The growth of CPU time from the small input to the large one. Both inputs run once before they are timed. Then
 * five rounds time one run of each, and the fastest run of each size counts: a loaded machine slows both sides alike,
 * and the fastest run is the one it disturbed least. A slow algorithm is slow in every round.
 */
function growth(small: () => unknown, large: () => unknown, rounds = 5): number {
  cpuMs(small);
  cpuMs(large);
  let least = Number.POSITIVE_INFINITY;
  let most = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    least = Math.min(least, cpuMs(small));
    most = Math.min(most, cpuMs(large));
  }
  return most / Math.max(least, 1);
}

describe('the section anchor quote is the one the search found before', () => {
  function check(text: string, start: number, end: number): void {
    const old = oldUniqueQuote(text, start, end);
    const entry = entryOf(text, start, end);
    const label = JSON.stringify({ text, start, end });
    if (old === undefined) {
      expect(entry, label).toBeUndefined();
      return;
    }
    expect(entry?.anchor.quote, label).toBe(old.quote);
    expect(entry?.anchor.prefix, label).toBe(text.slice(Math.max(0, old.at - 32), old.at));
  }

  it('on random texts of a few letters, lines and headings, many sections of one text', () => {
    const next = random(424242);
    const pieces = ['a', 'b', 'a', ' ', '\n', '\n', '## h\n', 'ab', 'line\n', '\t'];
    for (let round = 0; round < 1500; round++) {
      const parts = Math.floor(next() * 90);
      let text = '';
      for (let i = 0; i < parts; i++) text += pieces[Math.floor(next() * pieces.length)];
      // Twelve sections of one text: the first eight scan, the rest read the suffix index.
      for (let section = 0; section < 12; section++) {
        const a = Math.floor(next() * (text.length + 1));
        const b = Math.floor(next() * (text.length + 1));
        check(text, Math.min(a, b), Math.max(a, b));
      }
    }
  });

  it('on repeated lines, the case that took minutes', () => {
    for (const lines of [1, 2, 3, 5, 9, 30]) {
      const text = `## Rules\n${'the same line again\n'.repeat(lines)}`;
      check(text, 0, text.length);
      check(text, 0, text.length - 1);
    }
  });

  it('with a quote of 24 units or fewer, whitespace first, and nothing unique', () => {
    check('   \n  x', 0, 7);
    check('abc', 0, 3);
    check('aaaa', 0, 4);
    check('ab ab', 0, 5);
    check('', 0, 0);
    check('   ', 0, 3);
    check('## Title\n\nBody that is long enough to stand alone as an anchor.', 0, 60);
  });
});

describe('the section anchor takes linear CPU time on repeated lines', () => {
  const BUDGET_MS = 1000;
  it.each([2700, 10500, 41700, 160000])('a section of %d characters', (size) => {
    const line = 'the same line again and again\n';
    const body = line.repeat(Math.ceil(size / line.length)).slice(0, size);
    const text = `## Rules\n${body}`;
    expect(cpuMs(() => entryOf(text, 0, text.length))).toBeLessThan(BUDGET_MS);
  });

  it('four times the text takes about four times the time', () => {
    const run = (size: number) => {
      const text = `## Rules\n${'x line\n'.repeat(size)}`;
      return () => entryOf(text, 0, text.length);
    };
    expect(growth(run(10000), run(40000))).toBeLessThan(16);
  });
});

describe('a registry of many sections takes CPU time near linear in the sections', () => {
  const BUDGET_MS = 3000;
  const distinct = (count: number) =>
    Array.from(
      { length: count },
      (_, at) => `## Section ${at}\nThe rule for case ${at} says that item ${at * 7919} stays.\n`,
    ).join('\n');
  const identical = (count: number) =>
    Array.from({ length: count }, () => '## Same\nThe same rule says that the same item stays.\n').join('\n');

  it.each([2000, 8000])('%d distinct sections, each with a quote of its own', (count) => {
    let ok = false;
    const ms = cpuMs(() => {
      ok = sectionsFromHeadings(distinct(count), { promptId: 'p', version: '1' }).ok;
    });
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // Two sections with the same text are neither folded nor refused (docs/concepts/blast-radius.md): each keeps an
  // entry, numbered by its occurrence, so identical sections stay apart one by one.
  it.each([2000, 8000])('%d identical sections keep an entry each, numbered by occurrence', (count) => {
    const text = identical(count);
    const result = sectionsFromHeadings(text, { promptId: 'p', version: '1' });
    if (!result.ok) throw new Error(`refused: ${result.errors.join('; ')}`);
    const sections = result.registry.sections;
    expect(sections).toHaveLength(count);
    expect(new Set(sections.map((each) => each.id)).size).toBe(count);
    expect(sections.map((each) => each.anchor.occurrence)).toEqual(
      Array.from({ length: count }, (_, index) => index + 1),
    );
    expect(sections[0]?.span.start).toBe(0);
    expect(text.slice(sections[count - 1]?.span.end).trim()).toBe('');
  });

  // Each identical section is numbered by its occurrence. The time is compared, not budgeted: the fastest of five CPU runs
  // at each size, so a loaded machine slows both sides of the ratio alike.
  it('four times the identical sections take about four times the time to keep apart', () => {
    const run = (count: number) => {
      const text = identical(count);
      return () => sectionsFromHeadings(text, { promptId: 'p', version: '1' });
    };
    expect(growth(run(2000), run(8000))).toBeLessThan(10);
  });

  it('four times the distinct sections take about four times the time', () => {
    const run = (count: number) => {
      const text = distinct(count);
      return () => sectionsFromHeadings(text, { promptId: 'p', version: '1' });
    };
    expect(growth(run(2000), run(8000))).toBeLessThan(10);
  });
});
