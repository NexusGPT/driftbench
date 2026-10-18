import { pptxReader } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bytesOf, pptx, runCases, type SlideSpec } from './fixtures';

/** A four-slide fictional deck: a cover with a centred title, two titled slides, one without a title. */
const DECK: SlideSpec[] = [
  { title: 'Acme pricing review', titleType: 'ctrTitle', body: ['Fictional figures for October'] },
  { title: 'Mobile plans', body: ['Acme Mobile S: 15 USD a month', 'Acme Mobile M: 25 USD a month'] },
  {
    title: 'Home plans',
    table: [
      ['Plan', 'Monthly price'],
      ['Acme Fiber 300', '40 USD'],
    ],
  },
  { body: ['Questions?'] },
];

const open = async (): Promise<ArtifactDocument> => pptxReader.open(await pptx(DECK), 'out/review.pptx');

runCases(pptxReader, open, {
  slide_count: {
    pass: [
      { check: { slide_count: 4 }, evidence: '4 slides' },
      { check: { slide_count: { min: 3, max: 6 } } },
    ],
    fail: [{ check: { slide_count: 5 }, evidence: '4 slides, expected 5' }],
  },
  titles: {
    pass: [
      {
        check: { titles: ['Acme pricing review', 'Mobile plans', 'Home plans'] },
        evidence: 'titles "Acme pricing review", "Mobile plans", "Home plans", (no title)',
      },
      {
        check: {
          titles: {
            values: ['Acme pricing review', 'Mobile plans', 'Home plans', { absent: true }],
            order: 'exact',
          },
        },
      },
      { check: { titles: { values: ['Home plans', { contains: 'Mobile' }], order: 'any_order' } } },
    ],
    fail: [
      {
        check: { titles: ['Home plans', 'Mobile plans'] },
        evidence: '"Mobile plans" is out of order: expected after "Home plans"',
      },
      {
        check: { titles: { values: ['Acme pricing review', 'Mobile plans', 'Home plans'], order: 'exact' } },
        evidence: '1 more than expected: (no title)',
      },
      { check: { titles: ['Next steps'] }, evidence: 'missing "Next steps"' },
    ],
  },
  slide: {
    pass: [
      {
        check: { slide: { number: 2, title: 'Mobile plans', contains: 'Acme Mobile S: 15 USD' } },
        evidence: 'slide 2 of 4, title "Mobile plans"; found "Acme Mobile S: 15 USD"',
      },
      { check: { slide: { number: 3, contains: ['Acme Fiber 300', '40 USD'], not_contains: 'Mobile S' } } },
      { check: { slide: { number: 1, regex: '^Fictional figures', title: { regex: 'review$' } } } },
    ],
    fail: [
      { check: { slide: { number: 2, contains: 'Acme Fiber' } }, evidence: 'missing "Acme Fiber"' },
      {
        check: { slide: { number: 4, title: 'Questions' } },
        evidence: 'title (no title); expected the title "Questions"',
      },
      { check: { slide: { number: 5 } }, evidence: 'no slide 5: the deck holds 4 slides' },
      { check: { slide: { number: 3, not_contains: '40 USD' } }, evidence: 'found "40 USD"' },
    ],
  },
  contains: {
    pass: [{ check: { contains: ['Acme pricing review', 'Questions?'] } }],
    fail: [{ check: { contains: 'Acme Air 5G' }, evidence: 'missing "Acme Air 5G"' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: ['Lorem', 'TODO'] } }],
    fail: [{ check: { not_contains: 'Fiber' }, evidence: 'found "Fiber" in' }],
  },
  regex: {
    pass: [{ check: { regex: '^\\[slide 4 of 4\\]\\nQuestions\\?$' } }],
    fail: [{ check: { regex: '^\\[slide 5 of' }, evidence: 'no match for /^\\[slide 5 of/' }],
  },
});

describe('pptx reader', () => {
  it('renders each slide under a marker, with its text in document order', async () => {
    const text = (await open()).text();
    expect(text).toBe(
      [
        '[slide 1 of 4]\nAcme pricing review\nFictional figures for October',
        '[slide 2 of 4]\nMobile plans\nAcme Mobile S: 15 USD a month\nAcme Mobile M: 25 USD a month',
        '[slide 3 of 4]\nHome plans\nPlan\nMonthly price\nAcme Fiber 300\n40 USD',
        '[slide 4 of 4]\nQuestions?',
      ].join('\n\n'),
    );
  });

  it('reads slides in the order the presentation lists them, not by file name', async () => {
    const document = await pptxReader.open(await pptx(DECK, [1, 3, 2, 4]), 'reordered.pptx');
    expect(
      document.check({
        titles: { values: ['Acme pricing review', 'Home plans', 'Mobile plans'], order: 'in_order' },
      }).ok,
    ).toBe(true);
    expect(document.check({ slide: { number: 2, title: 'Home plans' } }).ok).toBe(true);
  });

  it('opens an empty deck and a file that is not a deck', async () => {
    const empty = await pptxReader.open(await pptx([]), 'empty.pptx');
    expect(empty.check({ slide_count: 0 })).toMatchObject({ ok: true, evidence: '0 slides' });
    const fake = await pptxReader.open(bytesOf('%PDF-1.4'), 'out/fake.pptx');
    expect(fake.check({ slide_count: 1 }).evidence).toMatch(/^out\/fake\.pptx could not be read as pptx: /);
  });

  it('says how slide is written when its number is missing', async () => {
    expect((await open()).check({ slide: { title: 'Mobile plans' } }).evidence).toBe(
      'slide needs number, counting from 1; write slide: { number: 2, title: Pricing, contains: [...], not_contains: [...], regex: "..." }',
    );
  });
});
