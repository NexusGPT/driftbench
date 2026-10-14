import type { CheckContext } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  countLengthUnits,
  parseStatedLength,
  preferByStatedLength,
  STATED_LENGTH_DEFAULTS,
  statedLength,
  statedLengthVerdict,
} from '../src/checks/stated_length';
import { observed } from './support/context';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const han = (n: number) => '字'.repeat(n);

describe('parseStatedLength, English', () => {
  it('reads a minimum, a target, a hyphenated target, a range and a maximum', () => {
    expect(parseStatedLength('The essay should be no less than 800 words.')).toMatchObject({
      unit: 'words',
      kind: 'min',
      min: 800,
    });
    expect(parseStatedLength('Use Markdown formatting and write around 1000 words.')).toMatchObject({
      kind: 'about',
      min: 1000,
      max: 1000,
    });
    expect(parseStatedLength('Write a 1,500-word keynote speech for the summit.')).toMatchObject({
      kind: 'about',
      min: 1500,
    });
    expect(parseStatedLength('A story of between 500 and 800 words.')).toMatchObject({
      kind: 'range',
      min: 500,
      max: 800,
    });
    expect(parseStatedLength('Write a slogan. Keep it under 7 words.')).toMatchObject({
      kind: 'max',
      max: 7,
    });
  });

  it('reads no total length from a per-item limit, a line count, or characters in a story', () => {
    expect(parseStatedLength('Write 5 slogans. Each slogan should be between 10-25 words.')).toBeUndefined();
    expect(parseStatedLength('Write a poem of 14 lines.')).toBeUndefined();
    expect(parseStatedLength('A story with 3 characters who meet on a train.')).toBeUndefined();
    expect(parseStatedLength('Write a wedding toast.')).toBeUndefined();
  });
});

describe('parseStatedLength, Chinese', () => {
  it('reads 不少于, 大约, 以内 and Chinese numerals', () => {
    expect(parseStatedLength('采用总分总的形式，字数不少于800字')).toMatchObject({
      unit: 'han',
      kind: 'min',
      min: 800,
    });
    expect(parseStatedLength('全文大约1500字。结尾可以引导读者观察')).toMatchObject({
      kind: 'about',
      min: 1500,
    });
    expect(parseStatedLength('字数控制在300字以内。')).toMatchObject({ kind: 'max', max: 300 });
    expect(parseStatedLength('写一篇两千字左右的散文')).toMatchObject({ kind: 'about', min: 2000 });
    expect(parseStatedLength('不可以少于200字。')).toMatchObject({ kind: 'min', min: 200 });
  });

  it('reads no total length from 每条 limits or a line count', () => {
    expect(parseStatedLength('写3条宣传语，每一条宣传语不少于20字')).toBeUndefined();
    expect(parseStatedLength('每条标语建议字数在 8-20字 之间')).toBeUndefined();
    expect(parseStatedLength('用一些修辞手法来描述，不少于10行。')).toBeUndefined();
  });

  it('counts Han characters for 字 and whitespace words for words', () => {
    expect(countLengthUnits('猫 cat 狗。', 'han')).toBe(2);
    expect(countLengthUnits('one  two\nthree', 'words')).toBe(3);
  });
});

describe('statedLengthVerdict', () => {
  it('fails a draft far under the stated length, in English and in Chinese', () => {
    const en = statedLengthVerdict('The essay should be no less than 800 words.', words(35));
    expect(en.status).toBe('fail');
    expect(en.evidence).toMatch(/35 words.*800/);
    expect(statedLengthVerdict('字数不少于1000字', han(300)).status).toBe('fail');
  });

  it('passes a draft somewhat under the stated length: labels do not punish it', () => {
    expect(statedLengthVerdict('全文大约1500字。', han(990)).status).toBe('pass');
    expect(statedLengthVerdict('The essay should be no less than 800 words.', words(640)).status).toBe(
      'pass',
    );
  });

  it('passes a draft over the stated length: the 2032-word keynote against a 1500-word ask', () => {
    expect(statedLengthVerdict('Write a 1500-word keynote speech.', words(2032)).status).toBe('pass');
    expect(statedLengthVerdict('Write a slogan. Keep it under 7 words.', words(126)).status).toBe('pass');
  });

  it('fails over-length only past an explicit over ceiling', () => {
    expect(statedLengthVerdict('字数控制在300字以内。', han(1000), { overCeiling: 2 }).status).toBe('fail');
    expect(statedLengthVerdict('字数控制在300字以内。', han(500), { overCeiling: 2 }).status).toBe('pass');
  });

  it('says nothing when the request states no length', () => {
    expect(statedLengthVerdict('Write a wedding toast.', words(10)).status).toBe('none');
  });

  it('keeps the measured defaults: under half fails, over-length never fails', () => {
    expect(STATED_LENGTH_DEFAULTS).toEqual({ underFloor: 0.5 });
  });
});

describe('preferByStatedLength', () => {
  it('prefers the draft that meets the stated length when the other is far under', () => {
    expect(preferByStatedLength('no less than 800 words', words(1263), words(35))).toBe('a');
    expect(preferByStatedLength('不少于1000字', han(200), han(1500))).toBe('b');
  });

  it('prefers neither when both pass, both fail, or no length is stated: the old 10 percent rule broke this pair', () => {
    expect(
      preferByStatedLength('Write a 1500-word keynote speech.', words(2032), words(1520)),
    ).toBeUndefined();
    expect(preferByStatedLength('不少于1000字', han(100), han(200))).toBeUndefined();
    expect(preferByStatedLength('Write a wedding toast.', words(10), words(900))).toBeUndefined();
  });
});

describe('statedLength custom check', () => {
  const ctx = (user: string, text: string) =>
    ({ blockIndex: 0, block: { when: { user } }, observed: observed(text) }) as unknown as CheckContext;

  it('reads the request from the block and fails a reply far under it', async () => {
    const verdicts = [
      await statedLength(ctx('Write no less than 800 words on rivers.', words(100)), {}),
    ].flat();
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ id: 'stated_length.reply', outcome: 'fail' });
  });

  it('passes a reply that meets it, takes the request and floor from options, and says nothing without a length', async () => {
    const pass = [await statedLength(ctx('Write no less than 800 words.', words(820)), {})].flat();
    expect(pass[0]?.outcome).toBe('pass');
    const strict = [
      await statedLength(ctx('ignored', words(700)), {
        request: 'Write no less than 1000 words.',
        under_floor: 0.9,
      }),
    ].flat();
    expect(strict[0]?.outcome).toBe('fail');
    expect([await statedLength(ctx('Write a toast.', words(5)), {})].flat()).toEqual([]);
  });
});
