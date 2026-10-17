import { describe, expect, it } from 'vitest';
import { sectionEntry } from '../../src/radius/sections';

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

  it('on random texts of a few letters, lines and headings', () => {
    const next = random(424242);
    const pieces = ['a', 'b', 'a', ' ', '\n', '\n', '## h\n', 'ab', 'line\n', '\t'];
    for (let round = 0; round < 6000; round++) {
      const parts = Math.floor(next() * 90);
      let text = '';
      for (let i = 0; i < parts; i++) text += pieces[Math.floor(next() * pieces.length)];
      const a = Math.floor(next() * (text.length + 1));
      const b = Math.floor(next() * (text.length + 1));
      check(text, Math.min(a, b), Math.max(a, b));
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
    const make = (size: number) => {
      const text = `## Rules\n${'x line\n'.repeat(size)}`;
      return cpuMs(() => entryOf(text, 0, text.length));
    };
    make(2000);
    const small = Math.max(make(10000), 1);
    const large = make(40000);
    expect(large / small).toBeLessThan(16);
  });
});
