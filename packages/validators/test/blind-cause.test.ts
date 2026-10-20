import { describe, expect, it } from 'vitest';
import type { LadderReport } from '../src/index';
import { blindReport } from '../src/index';
import { causeOf, statsBank } from '../src/ladders/stats/bank/index';
import { findRoot } from '../src/root';

/**
 * `validate <ladder> --blind` must not show the builder's cause (docs/validators.md section 12.7). The cause review
 * of the weights family found `[family, tier N, cause: ...]` at the start of every failing detail. The tag is
 * read by bracket depth, and any other copy of the item's own cause is removed, for every ladder.
 */

const reportOf = (items: Array<{ id: string; detail: string; cause?: string }>): LadderReport =>
  ({
    seeds: [
      {
        rows: [{ items: items.map((item) => ({ component: 'c', ...item })) }],
        failing: { level: 1, id: 'l', name: 'l', items: items.map((item) => ({ component: 'c', ...item })) },
      },
    ],
  }) as unknown as LadderReport;

const shown = (report: LadderReport): string[] => {
  const blind = blindReport(report).seeds[0];
  return [
    ...(blind?.failing?.items ?? []).map((item) => item.detail),
    ...(blind?.rows[0]?.items ?? []).map((item) => item.detail),
  ];
};

describe('the blind view hides the cause', () => {
  it('removes a tag whose cause holds brackets', () => {
    const cause = 'mean([1]) must throw; sum([x]) too';
    const [detail] = shown(
      reportOf([{ id: 'a', cause, detail: `[degenerate, tier 2, cause: ${cause}] it failed` }]),
    );
    expect(detail).toBe('it failed');
  });

  it('removes a copy of the cause written anywhere else in the detail', () => {
    const cause = 'the parser drops the last field';
    const [detail] = shown(reportOf([{ id: 'a', cause, detail: `a3 missed. Then: ${cause} and more` }]));
    expect(detail).not.toContain(cause);
    expect(detail).toContain('a3 missed');
  });

  it('shows no cause text for any real item of the statistics bank', () => {
    const items = statsBank(findRoot(process.cwd()));
    expect(items.length).toBeGreaterThan(100);
    const report = reportOf(
      items.map((item) => ({
        id: item.id,
        cause: causeOf(item),
        detail: `[${item.family}, tier ${item.tier}, cause: ${causeOf(item)}] ${item.id} failed. Fix: ${causeOf(item)}`,
      })),
    );
    const details = shown(report);
    expect(details.filter((detail) => /cause:/.test(detail))).toEqual([]);
    for (const [index, item] of items.entries())
      if (causeOf(item).length >= 6) expect(details[index], item.id).not.toContain(causeOf(item));
  });
});
