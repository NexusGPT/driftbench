import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/ladders/variables/bank/util';
import * as f from '../../src/ladders/variables/blind/folds';

/**
 * A folding item must hold, on every seed, every character the fold it tests has to handle. A draw that leaves one
 * out lets a product that skips that one character pass the item on that seed (the selective faults of the review of
 * the draws: a zero-width mark, a tab, a newline, one accent). These checks read the drawn texts, not a product.
 */

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const each = (make: (rng: ReturnType<typeof makeRng>) => f.Pair, check: (pair: f.Pair, seed: number) => void) => {
  for (const seed of SEEDS) check(make(makeRng(seed)), seed);
};

describe('every folding draw holds all the characters its fold handles', () => {
  it('white space: a run of spaces, a tab and a newline in the longer text', () => {
    for (const make of [f.whiteSpaceInTheQuote, f.whiteSpaceInTheFile])
      each(make, ({ inFile, inQuote }, seed) => {
        const long = inFile.length > inQuote.length ? inFile : inQuote;
        expect(/ {2,}/.test(long), `seed ${seed} spaces`).toBe(true);
        expect(long.includes('\t'), `seed ${seed} tab`).toBe(true);
        expect(long.includes('\n'), `seed ${seed} newline`).toBe(true);
      });
  });

  it('zero width: the four marks in the file, or those and the byte order mark in the quote', () => {
    const four = ['​', '‌', '‍', '⁠'];
    each(f.zeroWidthInTheFile, ({ inFile }, seed) => {
      for (const mark of four) expect(inFile.includes(mark), `seed ${seed} U+${mark.codePointAt(0)?.toString(16)}`).toBe(true);
    });
    each(f.zeroWidthInTheQuote, ({ inQuote }, seed) => {
      for (const mark of [...four, '﻿']) expect(inQuote.includes(mark), `seed ${seed} U+${mark.codePointAt(0)?.toString(16)}`).toBe(true);
    });
  });

  it('soft hyphen, typographic quotes and markdown backslashes are always there', () => {
    each(f.softHyphen, ({ inFile }, seed) => expect(inFile.includes('­'), `seed ${seed}`).toBe(true));
    each(f.doubleQuotesInTheFile, ({ inFile }, seed) => {
      expect(inFile.includes('“') && inFile.includes('”'), `seed ${seed}`).toBe(true);
    });
    each(f.singleQuotesInTheFile, ({ inFile }, seed) => {
      expect(inFile.includes('‘') && inFile.includes('’'), `seed ${seed}`).toBe(true);
    });
    each(f.typographicQuotesInTheQuote, ({ inQuote }, seed) => {
      expect(inQuote.includes('“') && inQuote.includes('”') && inQuote.includes('’'), `seed ${seed}`).toBe(true);
    });
    each(f.backslashBeforeAsterisk, ({ inFile }, seed) => expect(inFile.includes('\\*'), `seed ${seed}`).toBe(true));
    each(f.backslashBeforeUnderscore, ({ inFile }, seed) => expect(inFile.includes('\\_'), `seed ${seed}`).toBe(true));
  });

  it('accents: an acute and a grave accent, composed on one side and decomposed on the other', () => {
    for (const make of [f.composedInTheFile, f.decomposedInTheFile])
      each(make, ({ inFile, inQuote }, seed) => {
        const composed = inFile.normalize('NFC') === inFile ? inFile : inQuote;
        const decomposed = composed === inFile ? inQuote : inFile;
        expect(composed.includes('é') && composed.includes('è'), `seed ${seed} composed`).toBe(true);
        expect(decomposed.includes('é') && decomposed.includes('è'), `seed ${seed} decomposed`).toBe(true);
      });
  });
});
