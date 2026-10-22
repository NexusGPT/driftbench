import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EstateReport } from '../../src/estate/generate-types';
import { renderEstateSummary } from '../../src/estate/summary';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DOC = readFileSync(`${ROOT}docs/estate.md`, 'utf8').split('\n');
const REPORT = JSON.parse(
  readFileSync(`${ROOT}examples/estates/fixture/generated/estate-generate-report.json`, 'utf8'),
) as EstateReport;

describe('the generate transcript of docs/estate.md', () => {
  it('matches the summary the committed report prints', () => {
    // The command prints the summary from the report, so the block under the generate command in docs/estate.md
    // is that same text. The first four lines carry paths that depend on where the command ran, so the check starts at
    // the seed line and covers the table, every count and the replay line.
    const printed = renderEstateSummary(REPORT).split('\n');
    const from = printed.findIndex((line) => line.startsWith('Seed '));
    const tail = printed.slice(from).filter((_, i, all) => i < all.length - 1 || all[i] !== '');
    expect(from).toBeGreaterThan(0);
    const start = DOC.findIndex((line) => line === tail[0]);
    expect(start, 'the seed line of the report is in docs/estate.md').toBeGreaterThanOrEqual(0);
    expect(DOC.slice(start, start + tail.length)).toEqual(tail);
  });

  it('states the plan and phrase counts of the report', () => {
    const printed = renderEstateSummary(REPORT).split('\n');
    const counts = (prefix: string) => {
      const line = printed.find((l) => l.startsWith(prefix)) ?? '';
      return line.slice(line.indexOf(': ') + 2);
    };
    const doc = (prefix: string) => {
      const line = DOC.find((l) => l.startsWith(prefix)) ?? '';
      return line.slice(line.indexOf(': ') + 2);
    };
    expect(doc('Plan ')).toBe(counts('Plan '));
    expect(doc('Phrases ')).toBe(counts('Phrases '));
  });
});
