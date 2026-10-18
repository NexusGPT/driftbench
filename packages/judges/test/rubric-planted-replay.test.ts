import { expect, it } from 'vitest';
import { replay } from '../../../research/caller-owned-rubric-ids/replay';

it('replays every archived extra-row failure with verified identity mapping and unchanged numeric grades', () => {
  const result = replay();
  expect(result.modelCalls).toBe(0);
  expect(result.mapped).toEqual({
    pairs: 17,
    cleanAccepted: 17,
    defectsRejected: 16,
    unresolvedIds: ['rb-bank-036'],
  });
  expect(result.blindId1.defectsRejected).toBe(14);
  expect(result.ignoredRows).toBe(22);
  for (const id of ['rb-bank-025', 'rb-bank-046']) {
    const row = result.cases.find((item) => item.id === id);
    expect(row?.mapped.selectedLegacyRowId).toBe(2);
    expect(row?.mapped.defectRejected).toBe(true);
    expect(row?.blindId1.defectRejected).toBe(false);
  }
  expect(result.cases.find((row) => row.id === 'rb-bank-036')?.mapped.winner).toBe('tie');
});
