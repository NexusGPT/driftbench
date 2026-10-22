import { describe, expect, it } from 'vitest';
import {
  Cassette,
  cut,
  type Labelled,
  type PointerInput,
  pointerScan,
  singleLabelling,
  windowsOf,
} from '../../src/pointer';
import { load, plantedDense } from './support';

// An invented harbour office: one section of ten notes, so a window cap of four cuts it three times.
const NOTES = [
  '# Harbour',
  '',
  '## Night',
  '',
  ...Array.from({ length: 10 }, (_, at) => `- Note ${at + 1} for the night watch`),
  '',
  '## Day',
  '',
  '- Open the gate',
  '- Count the boats',
  '',
].join('\n');

const SETS = `labels:
  - set: duty
    description: What the harbour notes ask.
    labels:
      - name: order
        description: A unit that tells the watch what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: when
        description: A unit that only says when other units apply.
        target: required
        condition: true
`;

describe('a window cap does not cut a section', () => {
  const units = cut(NOTES).units;

  it('keeps a section whole up to twice the cap, and cuts a longer one at that ceiling', () => {
    // 10 night notes (plus the heading units): without the option the cap cuts every 4 units.
    const capped = windowsOf('n.md', units, 4, NOTES).map((window) => window.units.length);
    expect(capped.every((count) => count <= 4)).toBe(true);
    const kept = windowsOf('n.md', units, 4, NOTES, true);
    expect(Math.max(...kept.map((window) => window.units.length))).toBeLessThanOrEqual(8);
    expect(kept.length).toBeLessThan(capped.length);
    // Every unit is in exactly one window, in file order.
    expect(kept.flatMap((window) => window.units.map((unit) => unit.index))).toEqual(
      capped.flatMap((window) => window.units.map((unit) => unit.index)),
    );
  });

  it('never keeps a window open across a heading', () => {
    const kept = windowsOf('n.md', units, 4, NOTES, true);
    for (const window of kept) {
      const paths = new Set(window.units.map((unit) => (units[unit.index]?.path ?? []).join('>')));
      expect(paths.size, window.id).toBeLessThanOrEqual(2);
    }
    const day = kept.find((window) => window.units.some((unit) => units[unit.index]?.text === 'Open the gate'));
    expect(day?.units.some((unit) => units[unit.index]?.text.startsWith('Note'))).toBe(false);
  });
});

describe('a condition keeps a target past the window cap', () => {
  const files = [{ path: 'notes.md', text: NOTES }];
  const answer = (window: { units: Array<{ n: number; text: string }> }): Labelled[] => {
    const at = (text: string) => window.units.find((unit) => unit.text === text)?.n;
    const when = at('Note 1 for the night watch');
    const first = at('Note 2 for the night watch');
    const last = at('Note 6 for the night watch');
    return window.units.flatMap((unit): Labelled[] => {
      if (unit.n === when && first !== undefined) {
        return [
          {
            units: String(unit.n),
            label: 'when',
            target: first,
            ...(last !== undefined ? { scopes: [last] } : {}),
          },
        ];
      }
      return unit.text.startsWith('Note') || unit.text.includes('boats') || unit.text.includes('gate')
        ? [{ units: String(unit.n), label: 'order' }]
        : [];
    });
  };

  it('scopes the second target although the cap of four puts it in a later window', async () => {
    const run = (over: Partial<PointerInput>) =>
      pointerScan({
        files,
        sets: load(SETS),
        labelling: singleLabelling(plantedDense(answer)),
        cassette: new Cassette(),
        mode: 'record',
        windowUnits: 4,
        ...over,
      });
    const kept = await run({});
    const reach = (scan: typeof kept) =>
      scan.labelled
        .filter((item) => item.label === 'when')
        .flatMap((item) => [item.target, ...(item.scopes ?? [])])
        .map((target) => target?.unit.text);
    // The control: with the cap alone the second target sits in another window and the answer loses it.
    expect(reach(await run({ keepSections: false }))).toEqual(['Note 2 for the night watch']);
    expect(reach(kept)).toEqual([
      'Note 2 for the night watch',
      'Note 6 for the night watch',
    ]);
    expect(kept.failed).toEqual([]);
  });
});
