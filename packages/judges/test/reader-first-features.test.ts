import { describe, expect, it } from 'vitest';
import { readerFeatures } from '../src/reader-first-features';

describe('readerFeatures', () => {
  it('returns finite zero observations and a null grade for empty input', () => {
    const features = readerFeatures(' \n\t');
    expect(features.language).toBe('en');
    expect(features.readabilityGrade).toBeNull();
    for (const [name, value] of Object.entries(features)) {
      if (name !== 'language' && name !== 'readabilityGrade') expect(value, name).toBe(0);
    }
    expect(readerFeatures('', 'zh').language).toBe('zh');
  });

  it('counts whitespace units for English and Han code points for Chinese', () => {
    expect(readerFeatures('one two\nthree').length).toBe(3);
    const chinese = readerFeatures('你好，世界！\n\n再见。');
    expect(chinese.language).toBe('zh');
    expect(chinese.hanCharacters).toBe(6);
    expect(chinese.length).toBe(6);
    expect(chinese.paragraphs).toBe(2);
    expect(chinese.meanParagraphLength).toBe(3);
    expect(chinese.readabilityGrade).toBeNull();
    expect(readerFeatures('𠀀好', 'zh').hanCharacters).toBe(2);
    expect(readerFeatures('hello 你好', 'en').length).toBe(2);
  });

  it('keeps blank-line paragraph boundaries and recognizes headings and lists', () => {
    const features = readerFeatures(
      '# Start\n\nFirst paragraph.\nStill the first.\n\n- Red\n- Blue\n\n1. Open\n2. Close\n\nFinish\n===',
    );
    expect(features.headings).toBe(2);
    expect(features.listItems).toBe(4);
    expect(features.paragraphs).toBe(5);
    expect(features.meanParagraphLength).toBe(features.length / 5);
    expect(readerFeatures('一、开始\n二、结束', 'zh').listItems).toBe(2);
  });

  it('measures duplicate sentence occurrences and 4-gram redundancy', () => {
    const repeated = readerFeatures('Open the blue door. Open the blue door. Close the red gate.');
    expect(repeated.sentences).toBe(3);
    expect(repeated.repeatedSentenceRatio).toBeCloseTo(1 / 3);
    expect(repeated.ngramRedundancy).toBeGreaterThan(0);
    expect(readerFeatures('Open the blue door. Close the red gate.').ngramRedundancy).toBe(0);
    expect(readerFeatures('你好世界。你好世界。').repeatedSentenceRatio).toBe(0.5);
    expect(readerFeatures('Now here. Nowhere.').repeatedSentenceRatio).toBe(0);
  });

  it('counts litotes without treating a direct negative as double negation', () => {
    const indirect = readerFeatures(
      'It is not bad. This is not unimportant. It is no small task and not without merit.',
    );
    expect(indirect.litotesDensity).toBeCloseTo((4 * 1000) / indirect.length);
    expect(
      readerFeatures('It is good. This is important. It is a large task. Do not run.').litotesDensity,
    ).toBe(0);
    const chinese = readerFeatures('这个办法并非没有价值，也不是不重要。');
    expect(chinese.litotesDensity).toBeCloseTo((2 * 1000) / chinese.length);
    expect(readerFeatures('这个办法很重要。不要跑。').litotesDensity).toBe(0);
  });

  it('recognizes both directions of first-use acronym expansions', () => {
    expect(readerFeatures('The API works. API calls return data.').undefinedAcronymDensity).toBeGreaterThan(
      0,
    );
    expect(
      readerFeatures('Application programming interface (API) calls return data. The API works.')
        .undefinedAcronymDensity,
    ).toBe(0);
    expect(
      readerFeatures('API (application programming interface) calls return data.').undefinedAcronymDensity,
    ).toBe(0);
    expect(
      readerFeatures('National Aeronautics and Space Administration (NASA) launches rockets.')
        .undefinedAcronymDensity,
    ).toBe(0);
    expect(readerFeatures('应用程序接口（API）用于交换数据。API返回结果。').undefinedAcronymDensity).toBe(0);
    expect(
      readerFeatures('Use API now. Application programming interface (API) is its full name.')
        .undefinedAcronymDensity,
    ).toBeGreaterThan(0);
    expect(readerFeatures('API (a useful tool) returns data.').undefinedAcronymDensity).toBeGreaterThan(0);
  });

  it('discounts locally explained jargon and retains unexplained usages', () => {
    expect(readerFeatures('Use an idempotent operation.').jargonDensity).toBeGreaterThan(0);
    expect(
      readerFeatures('Idempotent means repeating the operation does not change its result.').jargonDensity,
    ).toBe(0);
    expect(readerFeatures('Use idempotent (safe to repeat) operations.').jargonDensity).toBe(0);
    expect(readerFeatures('幂等是指重复执行不会改变结果。').jargonDensity).toBe(0);
    expect(readerFeatures('我们通过赋能实现闭环。').jargonDensity).toBeGreaterThan(0);
  });

  it('flags assumed shared history without claiming semantic antecedent resolution', () => {
    expect(readerFeatures('As you know, use the same as before.').contextReferenceDensity).toBeGreaterThan(0);
    expect(readerFeatures('As mentioned above, open the door.').contextReferenceDensity).toBeGreaterThan(0);
    expect(
      readerFeatures('Open the door. As mentioned above, the door is open.').contextReferenceDensity,
    ).toBe(0);
    expect(readerFeatures('如上所述，请执行。').contextReferenceDensity).toBeGreaterThan(0);
    expect(readerFeatures('Open the door to enter the room.').contextReferenceDensity).toBe(0);
  });

  it('uses occurrence densities with word boundaries in English and phrases in Chinese', () => {
    const padded = readerFeatures('It is worth noting that perhaps this may work.');
    expect(padded.fillerDensity).toBeCloseTo(1000 / padded.length);
    expect(padded.hedgeDensity).toBeCloseTo(2000 / padded.length);
    expect(readerFeatures('The maypole stands.').hedgeDensity).toBe(0);
    const chinese = readerFeatures('值得注意的是，这也许可能有效。');
    expect(chinese.fillerDensity).toBeCloseTo(1000 / chinese.length);
    expect(chinese.hedgeDensity).toBeCloseTo(2000 / chinese.length);
  });

  it('separates sentence length and English readability on contrasting fixtures', () => {
    const simple = readerFeatures('Open the box. Take the key. Shut the door.');
    const complex = readerFeatures(
      'The multidisciplinary organizational transformation necessitates comprehensive methodological implementation while simultaneously facilitating unprecedented institutional interoperability and administrative optimization.',
    );
    expect(complex.meanSentenceLength).toBeGreaterThan(simple.meanSentenceLength);
    expect(complex.readabilityGrade).toBeGreaterThan(simple.readabilityGrade ?? 0);
    expect(readerFeatures('你可以打开箱子。', 'zh').readabilityGrade).toBeNull();
  });

  it('is deterministic and bounds repetition ratios on mixed and punctuated input', () => {
    const text = '## API\n\n你好。你好。\n\n3.14 is a number. Perhaps it works!';
    expect(readerFeatures(text)).toEqual(readerFeatures(text));
    for (const language of ['en', 'zh'] as const) {
      const features = readerFeatures(text, language);
      expect(features.repeatedSentenceRatio).toBeGreaterThanOrEqual(0);
      expect(features.repeatedSentenceRatio).toBeLessThanOrEqual(1);
      expect(features.ngramRedundancy).toBeGreaterThanOrEqual(0);
      expect(features.ngramRedundancy).toBeLessThanOrEqual(1);
    }
  });
});
