import type { ArtifactReader } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { artifacts } from '../src/checks/artifacts';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';
import { fakeXlsx, files, PRICE_SHEET, registry } from './support/readers';

const task = acme('acme-price-sheet');
const book = 'out/acme-price-sheet.xlsx';
const built = 'I wrote out/acme-price-sheet.xlsx with the sheets Mobile and Home.';

describe('artifacts', () => {
  it('passes block 0 of acme-price-sheet: the workbook opens and every declared check holds', async () => {
    const ctx = context(task, 0, observed(built), {
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: PRICE_SHEET }),
    });
    const verdicts = await run(artifacts, ctx);
    expect(outcomes(verdicts)).toEqual({
      [`artifacts.${book}`]: 'pass',
      [`artifacts.${book}.0.sheets`]: 'pass',
      [`artifacts.${book}.1.header`]: 'pass',
      [`artifacts.${book}.2.rows`]: 'pass',
      [`artifacts.${book}.3.rows`]: 'pass',
      [`artifacts.${book}.4.cells`]: 'pass',
      [`artifacts.${book}.5.cells`]: 'pass',
      [`artifacts.${book}.6.formula`]: 'pass',
      [`artifacts.${book}.7.no_error_cells`]: 'pass',
    });
    expect(verdict(verdicts, `artifacts.${book}`).evidence).toMatch(
      /^out\/acme-price-sheet\.xlsx opened as xlsx \(\d+ bytes\)$/,
    );
  });

  it('mutation: the Home sheet is missing; the sheets check fails with the reader evidence', async () => {
    const { Home: _home, ...mobileOnly } = PRICE_SHEET;
    const ctx = context(task, 0, observed(built), {
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: mobileOnly }),
    });
    const verdicts = await run(artifacts, ctx);
    expect(failing(verdicts)).toEqual([
      `artifacts.${book}.0.sheets`,
      `artifacts.${book}.3.rows`,
      `artifacts.${book}.5.cells`,
    ]);
    expect(verdict(verdicts, `artifacts.${book}.0.sheets`).evidence).toBe(`${book} sheets: sheets Mobile`);
  });

  it('mutation: a yearly price typed as a number, not a formula, fails the formula check', async () => {
    const typed = {
      ...PRICE_SHEET,
      Mobile: PRICE_SHEET.Mobile?.map((row, index) => (index === 1 ? [...row.slice(0, 3), 180] : row)),
    };
    const ctx = context(task, 0, observed(built), {
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: typed }),
    });
    expect(failing(await run(artifacts, ctx))).toEqual([`artifacts.${book}.6.formula`]);
  });

  it('fails once, naming it, on a missing file, a missing reader, no reader package or no workspace', async () => {
    const missing = await run(
      artifacts,
      context(task, 0, observed(built), { artifacts: registry(fakeXlsx), readArtifact: files({}) }),
    );
    expect(missing.map((item) => [item.id, item.outcome, item.evidence])).toEqual([
      [`artifacts.${book}`, 'fail', `${book} is missing or unreadable: ENOENT: no such file, ${book}`],
    ]);
    const noReader = await run(
      artifacts,
      context(task, 0, observed(built), {
        artifacts: registry(),
        readArtifact: files({ [book]: PRICE_SHEET }),
      }),
    );
    expect(noReader[0]?.evidence).toBe(`no reader for kind xlsx is registered, so ${book} cannot be opened`);
    const noPackage = await run(
      artifacts,
      context(task, 0, observed(built), { readArtifact: files({ [book]: PRICE_SHEET }) }),
    );
    expect(noPackage[0]?.evidence).toBe(`no artifact reader package is loaded, so ${book} cannot be opened`);
    const noWorkspace = await run(
      artifacts,
      context(task, 0, observed(built), { artifacts: registry(fakeXlsx) }),
    );
    expect(noWorkspace[0]?.evidence).toBe(
      `cannot read ${book}: the adapter gives no workspace to read files from`,
    );
  });

  it('picks the reader from the extension when the spec names no kind, and reports a file that does not open', async () => {
    const noKind = context(task, 0, observed(built), {
      expect: { artifacts: [{ path: book, checks: [{ sheets: ['Mobile', 'Home'] }] }] },
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: PRICE_SHEET }),
    });
    expect(failing(await run(artifacts, noKind))).toEqual([]);
    const broken: ArtifactReader = {
      kind: 'xlsx',
      open: async () => {
        throw new Error('end of central directory not found');
      },
    };
    const corrupt = await run(artifacts, { ...noKind, artifacts: registry(broken) });
    expect(corrupt[0]?.evidence).toBe(`${book} does not open as xlsx: end of central directory not found`);
  });
});
