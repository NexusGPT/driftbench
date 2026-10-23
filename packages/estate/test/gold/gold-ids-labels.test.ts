import { describe, expect, it } from 'vitest';
import { ESTATE_NAMES, type EstateName } from './gold';
import { idsProblems, labelsProblems } from './steps';

/**
 * Steps 1 and 2 of the gold chain: the ids and the labels of the three gold estates. No model call. The ids are
 * the ledger ids of gold5.json, minted by the same recipe; a unit the release cutter splits or words differently
 * is listed with both texts. The labels are those the planted labeller answers from the gold file, read back
 * from the ledger of a scan.
 */

const SHOWN = 12;

function report(step: string, problems: string[]): string {
  const more = problems.length > SHOWN ? ['...'] : [];
  return [`${step}: ${problems.length} problems`, ...problems.slice(0, SHOWN), ...more].join('\n');
}

describe.each(ESTATE_NAMES)('gold estate %s', (estate: EstateName) => {
  it('step 1 ids: the cut and the ledger reproduce the gold unit for unit', async () => {
    const problems = await idsProblems(estate);
    expect(problems, report('ids', problems)).toEqual([]);
  });

  it('step 2 labels: the scan with the planted labeller gives every agreed unit its gold label', async () => {
    const problems = await labelsProblems(estate);
    expect(problems, report('labels', problems)).toEqual([]);
  });
});
