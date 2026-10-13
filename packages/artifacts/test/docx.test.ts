import { docxReader } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bytesOf, docx, para, runCases, STYLES, table } from './fixtures';

/**
 * A short fictional report. Its headings come four ways: the Title style, a style named "heading 1",
 * a French style id whose name says "heading 2", an outline level set on the paragraph, and a custom
 * style based on a heading. "Terms" has nothing below it.
 */
const BODY = [
  para('Acme network report', { style: 'Title' }),
  para('Scope', { style: 'Heading1' }),
  para('This report covers the Acme mobile and home plans.'),
  para('Pricing', { style: 'Heading1' }),
  para('Prices are monthly, in USD.'),
  table([
    ['Plan', 'Monthly price (USD)'],
    ['Acme Mobile S', '15'],
    ['Acme Mobile M', '25'],
    ['Acme Fiber 300', '40'],
  ]),
  para('Mobile', { style: 'Titre2' }),
  para('Mobile plans renew each month.'),
  para('Contents', { style: 'TOCHeading' }),
  para('Terms', { outline: 0 }),
  para('Contact', { style: 'AcmeHeading' }),
  para('Write to the sales desk at sales@example.com.'),
  table([
    ['Channel', 'Hours'],
    ['Chat', 'Always open'],
  ]),
].join('');

const open = async (): Promise<ArtifactDocument> =>
  docxReader.open(await docx(BODY, { styles: STYLES }), 'out/report.docx');

runCases(docxReader, open, {
  headings: {
    pass: [
      {
        check: { headings: ['Scope', 'Pricing', 'Contact'] },
        evidence:
          'headings: "Acme network report" (title), "Scope" (level 1), "Pricing" (level 1), "Mobile" (level 2), "Terms" (level 1), "Contact" (level 1)',
      },
      { check: { headings: { values: ['Scope', 'Pricing', 'Terms', 'Contact'], order: 'exact', level: 1 } } },
      {
        check: { headings: { values: [{ regex: '^Mob' }], level: 2 } },
        evidence: 'headings at level 2: "Mobile" (level 2)',
      },
      { check: { headings: { values: ['Contact', 'Scope'], order: 'any_order' } } },
    ],
    fail: [
      {
        check: { headings: ['Pricing', 'Scope'] },
        evidence: '"Scope" is out of order: expected after "Pricing"',
      },
      { check: { headings: ['Scope', 'Appendix'] }, evidence: 'missing "Appendix"' },
      {
        check: { headings: { values: ['Scope', 'Pricing'], order: 'exact', level: 1 } },
        evidence: '2 more than expected: "Terms", "Contact"',
      },
    ],
  },
  sections: {
    pass: [
      {
        check: { sections: ['Scope', 'Pricing'] },
        evidence: 'sections "Scope" (9 words), "Pricing" (27 words, 1 table)',
      },
      { check: { sections: { values: ['Contact'], level: 1 } } },
    ],
    fail: [
      { check: { sections: ['Scope', 'Terms'] }, evidence: '"Terms" has nothing below its heading' },
      {
        check: { sections: ['Appendix'] },
        evidence: 'no heading "Appendix"; the headings are "Acme network report", "Scope"',
      },
      { check: { sections: { values: ['Mobile'], level: 1 } }, evidence: 'no heading "Mobile"' },
    ],
  },
  tables: {
    pass: [
      {
        check: { tables: 2 },
        evidence:
          '2 tables: table 1 (4 rows, header "Plan" | "Monthly price (USD)"), table 2 (2 rows, header "Channel" | "Hours")',
      },
      { check: { tables: { min: 1 } } },
    ],
    fail: [{ check: { tables: 3 }, evidence: '2 tables: ' }],
  },
  table: {
    pass: [
      {
        check: { table: { number: 1, header: ['Plan', 'Monthly price (USD)'], rows: 3 } },
        evidence: 'table 1 of 2: header "Plan" | "Monthly price (USD)", 3 rows below it',
      },
      { check: { table: { number: 2, header: ['Channel', { regex: '^Hour' }], rows: { min: 1 } } } },
    ],
    fail: [
      {
        check: { table: { number: 1, header: ['Plan', 'Price'] } },
        evidence: 'header item 2 is "Monthly price (USD)", expected "Price"',
      },
      {
        check: { table: { number: 2, rows: 5 } },
        evidence: '1 row below it; expected 5 rows below the header',
      },
      { check: { table: { number: 3 } }, evidence: 'no table 3: the document holds 2 top-level tables' },
    ],
  },
  contains: {
    pass: [{ check: { contains: ['Prices are monthly, in USD.', 'Acme Fiber 300'] } }],
    fail: [{ check: { contains: 'Annual prices' }, evidence: 'missing "Annual prices"' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: 'lorem ipsum' } }],
    fail: [{ check: { not_contains: 'Acme Mobile S' }, evidence: 'found "Acme Mobile S"' }],
  },
  regex: {
    pass: [{ check: { regex: '^Scope$' }, evidence: '/^Scope$/ matched "Scope"' }],
    fail: [{ check: { regex: '^Appendix$' }, evidence: 'no match for /^Appendix$/' }],
  },
});

describe('docx reader', () => {
  it('gives a judge the text mammoth extracts, tables included', async () => {
    const text = (await open()).text();
    expect(
      text.startsWith('Acme network report\n\nScope\n\nThis report covers the Acme mobile and home plans.'),
    ).toBe(true);
    expect(text).toContain('Acme Fiber 300');
    expect(text).toContain('Write to the sales desk at sales@example.com.');
  });

  it('finds the main part through the package relationships, whatever its name', async () => {
    const document = await docxReader.open(
      await docx([para('Summary', { style: 'Heading1' }), para('One line.')].join(''), {
        styles: STYLES,
        main: 'word/main.xml',
      }),
      'renamed.docx',
    );
    expect(document.check({ headings: ['Summary'] }).ok).toBe(true);
    expect(document.text()).toContain('One line.');
  });

  it('reads headings when the producer picked another namespace prefix', async () => {
    const document = await docxReader.open(
      await docx([para('Overview', { outline: 1 }), para('Text.')].join(''), { prefix: 'ns0' }),
      'prefixed.docx',
    );
    expect(document.check({ headings: { values: ['Overview'], level: 2 } })).toMatchObject({
      ok: true,
      evidence: 'headings at level 2: "Overview" (level 2)',
    });
  });

  it('reads heading levels from style ids when the file has no styles part', async () => {
    const document = await docxReader.open(
      await docx(
        [para('Plan', { style: 'Heading2' }), para('Body.'), para('Quote', { style: 'Quote' })].join(''),
      ),
      'bare.docx',
    );
    expect(document.check({ headings: { values: ['Plan'], order: 'exact' } })).toMatchObject({
      ok: true,
      evidence: 'headings: "Plan" (level 2)',
    });
  });

  it('opens a file that is not a docx as a document whose every check fails and says why', async () => {
    const document = await docxReader.open(bytesOf('plain text'), 'out/fake.docx');
    expect(document.check({ headings: ['Scope'] }).ok).toBe(false);
    expect(document.check({ contains: 'plain' }).evidence).toMatch(
      /^out\/fake\.docx could not be read as docx: /,
    );
  });
});
