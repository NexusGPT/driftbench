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
    const capped = windowsOf('n.md', units, 4, NOTES);
    expect(capped.every((window) => window.units.length <= 4)).toBe(true);
    const kept = windowsOf('n.md', units, 4, NOTES, true);
    expect(Math.max(...kept.map((window) => window.units.length))).toBeLessThanOrEqual(8);
    expect(Math.max(...kept.map((window) => window.units.length))).toBeGreaterThan(4);
    expect(kept.length).toBeLessThan(capped.length);
    // Every unit is in exactly one window, in file order.
    const indexes = (windows: typeof kept) =>
      windows.flatMap((window) => window.units.map((unit) => unit.index));
    expect(indexes(kept)).toEqual(indexes(capped));
  });

  it('runs a window past the cap only inside one section', () => {
    const kept = windowsOf('n.md', units, 4, NOTES, true);
    for (const window of kept.filter((each) => each.units.length > 4)) {
      // The headings that open the window are not part of a section's run: the cap waits on its sentences.
      const body = window.units.filter((unit) => units[unit.index]?.container !== 'heading');
      const paths = new Set(body.map((unit) => (units[unit.index]?.path ?? []).join('>')));
      expect(paths.size, window.id).toBe(1);
    }
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

describe('a section longer than twice the cap is a named failure, never a quiet cut', () => {
  const run = (text: string) =>
    pointerScan({
      files: [{ path: 'notes.md', text }],
      sets: load(SETS),
      labelling: singleLabelling(plantedDense((window) => window.units.map((unit) => ({ units: String(unit.n), label: 'order' })))),
      cassette: new Cassette(),
      mode: 'record',
      windowUnits: 4,
    });

  it('marks the window that ends at its ceiling inside a section, and no other', () => {
    const units = cut(NOTES).units;
    const windows = windowsOf('n.md', units, 4, NOTES, true);
    expect(windows.filter((window) => window.cutsSection).map((window) => window.id)).toEqual(['n.md#1']);
    expect(windowsOf('n.md', units, 4, NOTES).some((window) => window.cutsSection)).toBe(false);
  });

  it('lists the cut in the scan result with its window and section', async () => {
    const result = await run(NOTES);
    expect(result.sectionCuts).toEqual([
      expect.stringContaining('notes.md#1: the window ends at its ceiling of 8 units inside the section'),
    ]);
    expect(result.sectionCuts[0]).toContain('Night');
  });

  it('lists nothing when every section fits in twice the cap', async () => {
    const short = ['# Harbour', '', '## Night', '', '- One', '- Two', '- Three', '- Four', ''].join('\n');
    expect((await run(short)).sectionCuts).toEqual([]);
  });
});
