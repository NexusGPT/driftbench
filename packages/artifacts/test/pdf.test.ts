import { pdfReader } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bytesOf, pdf, runCases } from './fixtures';

const PAGES = ['Acme quarterly price review', 'Acme Mobile S costs 15 USD per month (fictional)'];

const open = async (): Promise<ArtifactDocument> => pdfReader.open(pdf(PAGES), 'out/review.pdf');

runCases(pdfReader, open, {
  page_count: {
    pass: [{ check: { page_count: 2 }, evidence: '2 pages' }, { check: { page_count: { max: 3 } } }],
    fail: [
      { check: { page_count: 1 }, evidence: '2 pages, expected 1' },
      { check: { page_count: { min: 3 } } },
    ],
  },
  contains: {
    pass: [
      { check: { contains: 'Acme Mobile S costs 15 USD' }, evidence: 'found "Acme Mobile S costs 15 USD"' },
    ],
    fail: [{ check: { contains: 'Acme Fiber 300' }, evidence: 'missing "Acme Fiber 300"' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: 'Acme Fiber 300' } }],
    fail: [{ check: { not_contains: 'quarterly' }, evidence: 'found "quarterly"' }],
  },
  regex: {
    pass: [{ check: { regex: '^\\[page 2 of 2\\]$' } }],
    fail: [{ check: { regex: '^\\[page 3 of' }, evidence: 'no match' }],
  },
});

describe('pdf reader', () => {
  it('gives a judge each page under a marker', async () => {
    expect((await open()).text()).toBe(
      '[page 1 of 2]\nAcme quarterly price review\n\n[page 2 of 2]\nAcme Mobile S costs 15 USD per month (fictional)',
    );
  });

  it('leaves the caller bytes untouched', async () => {
    const bytes = pdf(PAGES);
    const copy = bytes.slice();
    await pdfReader.open(bytes, 'review.pdf');
    expect(bytes).toEqual(copy);
  });

  it('opens a file that is not a PDF as a document whose every check fails and says why', async () => {
    const document = await pdfReader.open(bytesOf('not a pdf'), 'out/fake.pdf');
    expect(document.check({ page_count: 1 })).toMatchObject({ ok: false });
    expect(document.check({ contains: 'pdf' }).evidence).toMatch(
      /^out\/fake\.pdf could not be read as pdf: /,
    );
  });
});
