import { describe, expect, it } from 'vitest';
import {
  Cassette,
  type Labelled,
  type LedgerEntry,
  type PointerInput,
  pointerScan,
  singleLabelling,
} from '../../src/pointer';
import { load, plantedDense } from './support';

// Invented files: a harbour office with quays, ropes and skippers.
const NOTES = [
  '# Quay',
  '',
  '- Coil the ropes on the red post',
  '- Name the skipper of every boat',
  '- Hang the lamp before dusk',
  '- Count the boats twice',
  '- Close the gate when the quay is empty',
  '- Log each boat at the desk',
  '',
].join('\n');

const SET = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
      - name: remark
        description: A unit that only says how the quay is.
      - name: aside
        description: A unit that only tells a story about the quay.
`;

/** The unit the labeler cannot make up its mind about. */
const NOISY = 'Count the boats twice';

/**
 * Every unit is an order, except the noisy one: its first five draws split two, two and one between three labels,
 * so no label holds three of five; every later draw says order, as a fresh draw of the same window might.
 */
const DRAWS = ['order', 'remark', 'aside', 'order', 'remark'];

function harbour() {
  const windows: string[][] = [];
  let asked = 0;
  const labeler = plantedDense(
    (window) => {
      windows.push(window.units.map((unit) => unit.text));
      return window.units.map(
        (unit): Labelled => ({
          units: String(unit.n),
          label: unit.text.includes(NOISY) ? (DRAWS[asked++] ?? 'order') : 'order',
        }),
      );
    },
    [],
    { runs: 3 },
  );
  return { labeler, windows, asked: () => asked };
}

const input = (
  over: Partial<PointerInput> & Pick<PointerInput, 'files'>,
  labeler: PointerInput['labelling'],
) =>
  ({
    sets: load(SET),
    labelling: labeler,
    cassette: new Cassette(),
    mode: 'record',
    // Three units to a window: the noisy unit sits with the lamp and the gate, away from the top of the file.
    windowUnits: 3,
    keepSections: false,
    ...over,
  }) satisfies PointerInput;

const noisyOf = (entries: readonly LedgerEntry[]): LedgerEntry => {
  const found = entries.find((entry) => entry.quote.includes(NOISY));
  if (!found) throw new Error('the noisy unit is not in the ledger');
  return found;
};

describe('a unit the labelers left unlabeled', () => {
  it('is kept in the ledger with the votes of every run, and holds no label', async () => {
    const { labeler } = harbour();
    const first = await pointerScan(
      input({ files: [{ path: 'quay.md', text: NOTES }] }, singleLabelling(labeler)),
    );
    expect(first.unlabeled).toBe(1);
    const noisy = noisyOf(first.ledger.entries);
    expect(noisy.labels.duty).toBeUndefined();
    expect(noisy.unlabeled?.duty?.votes).toEqual([
      {
        labeler: 'planted',
        runs: DRAWS.map((label) => ({ label, source: expect.any(String) })),
      },
    ]);
    // The other units kept an order and hold no such record.
    const others = first.ledger.entries.filter((entry) => entry !== noisy);
    expect(others.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
    expect(others.every((entry) => entry.unlabeled === undefined)).toBe(true);
  });

  it('is not asked again when the file changes elsewhere, and keeps its votes', async () => {
    const { labeler, windows, asked } = harbour();
    const cassette = new Cassette();
    const first = await pointerScan(
      input({ files: [{ path: 'quay.md', text: NOTES }], cassette }, singleLabelling(labeler)),
    );
    const before = noisyOf(first.ledger.entries);
    expect(asked()).toBe(DRAWS.length);
    windows.length = 0;

    // A new line above the first rope moves every window after it: the window of the noisy unit is another request.
    const edited = NOTES.replace('- Coil the ropes', '- Tie the bow line first\n- Coil the ropes');
    const second = await pointerScan(
      input(
        { files: [{ path: 'quay.md', text: edited }], cassette, previous: first.ledger },
        singleLabelling(labeler),
      ),
    );
    const after = noisyOf(second.ledger.entries);
    expect(after.id).toBe(before.id);
    expect(after.labels.duty).toBeUndefined();
    expect(after.unlabeled).toEqual(before.unlabeled);
    // No request holds the unit, and the labeler drew nothing more for it.
    expect(windows.flat().some((text) => text.includes(NOISY))).toBe(false);
    expect(asked()).toBe(DRAWS.length);
    // The new line was asked, in the one window that holds a unit that needs a label.
    expect(windows.length).toBe(3);
  });
});
