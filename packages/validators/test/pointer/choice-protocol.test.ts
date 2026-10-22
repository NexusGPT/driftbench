import { describe, expect, it } from 'vitest';
import { tally } from './helpers';
import { referenceSut } from './reference/index';

/**
 * The items that speak the system 1 choice protocol: one question per unit with every label and none as options,
 * answered with a probability vector, and a stack that decides by margin cut or probability bounds. Both directions:
 * the honest reference passes every one, the earlier yes or no reference fails every one, and a reference with one
 * planted fault fails the item that fault belongs to.
 */
const FAULTS: Array<[item: string, fault: string]> = [
  ['labels.jev-threshold-window', 'margin-ignored'],
  ['labels.jev-threshold-unit', 'bounds-ignored'],
  ['labels.jev-highest-not-first', 'first-above'],
  ['labels.jev-none-below-threshold', 'ignore-none'],
  ['labels.jev-threshold-is-a-replay-setting', 'settings-ignored'],
  ['labels.jev-question-keys', 'drop-none-option'],
  ['labels.jev-window-cap', 'cap-too-big'],
  ['labels.jev-halve-on-refusal', 'no-halving'],
  ['labels.jev-unit-state-one-call-per-unit', 'unit-state-batches'],
  ['labels.jev-probabilities-recorded', 'probabilities-dropped'],
  ['replay.key-ignores-threshold', 'settings-in-key'],
];
const ITEMS = FAULTS.map(([item]) => item);
const only = (item: { id: string }) => ITEMS.includes(item.id);

describe('the choice protocol items', { timeout: 600_000 }, () => {
  it('the honest reference passes all eleven', async () => {
    const out = await tally(referenceSut(), only);
    expect(out.total).toBe(ITEMS.length);
    expect(out.failed).toEqual([]);
  });

  it('the earlier yes or no reference fails all eleven', async () => {
    const out = await tally(referenceSut({ protocol: 'yesno' }), only);
    expect(out.total).toBe(ITEMS.length);
    expect(out.failed.map((f) => f.id).sort()).toEqual([...ITEMS].sort());
  });

  for (const [item, fault] of FAULTS) {
    it(`${item} fails a reference with the fault ${fault}`, async () => {
      const out = await tally(referenceSut({ fault }), (i) => i.id === item);
      expect(out.total).toBe(1);
      expect(out.failed.map((f) => f.id)).toEqual([item]);
    });
  }
});
