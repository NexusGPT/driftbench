import { describe, expect, it } from 'vitest';
import { cut, type Ledger, nextLedger } from '../../src/pointer';

// Invented files: a harbour office with ropes and lamps.
const scan = (texts: Record<string, string>, previous?: Ledger) =>
  nextLedger(
    Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text), text })),
    previous,
    'harbour',
  );

const FILLER_A = 'The harbour office opens at six and the gate stays locked until the first boat is tied up.';
const FILLER_B = 'Every skipper signs the log before the lamp is lit, and the log is kept in the red drawer.';
const RULE =
  'Coil every rope on the quay before dusk and hang the wet ones from the second post, never from the lamp.';
const RULE_REWORDED =
  'Coil every rope on the quay before dusk and hang the wet ones from the third post, never from the lamp.';

const files = (first: string[], second: string[]) => ({
  'notes/a.md': `${first.join('\n\n')}\n`,
  'notes/b.md': `${second.join('\n\n')}\n`,
});

describe('re-anchoring across files', () => {
  it('keeps the id of a unit that left one file and came back reworded in another', () => {
    const before = scan(files([FILLER_A, RULE], [FILLER_B]));
    const id = before.ledger.entries.find((entry) => entry.quote === RULE)?.id as string;
    const after = scan(files([FILLER_A], [FILLER_B, RULE_REWORDED]), before.ledger);
    const moved = after.ledger.entries.find((entry) => entry.id === id);
    expect(moved?.path).toBe('notes/b.md');
    expect(moved?.quote).toBe(RULE_REWORDED);
    expect(moved?.status).toBe('live');
    expect(after.eventsById[id]).toBe('changed');
  });

  it('keeps the id of a unit reworded in a renamed file', () => {
    const before = scan(files([FILLER_A, RULE], [FILLER_B]));
    const id = before.ledger.entries.find((entry) => entry.quote === RULE)?.id as string;
    const after = scan(
      { 'notes/renamed.md': `${FILLER_A}\n\n${RULE_REWORDED}\n`, 'notes/b.md': `${FILLER_B}\n` },
      before.ledger,
    );
    const found = after.ledger.entries.find((entry) => entry.id === id);
    expect(found).toMatchObject({ path: 'notes/renamed.md', quote: RULE_REWORDED, status: 'live' });
    expect(after.eventsById[id]).toBe('changed');
  });

  it('follows a unit that left one file and came back as two units in another', () => {
    const whole =
      'Coil every rope on the quay before dusk and hang the wet ones from the second post, and never hang a rope from the lamp or tell the keeper that one is frayed.';
    const [one, two] = [
      whole.slice(0, whole.indexOf(', and never') + 1),
      whole.slice(whole.indexOf('and never')),
    ];
    const before = scan(files([FILLER_A, whole], [FILLER_B]));
    const id = before.ledger.entries.find((entry) => entry.quote === whole)?.id as string;
    const after = scan(files([FILLER_A], [FILLER_B, one, two]), before.ledger);
    expect(after.eventsById[id]).toBe('split');
    expect(after.ledger.entries.find((entry) => entry.id === id)?.path).toBe('notes/b.md');
  });

  it('does not carry an id to an unrelated unit of another file', () => {
    const before = scan(files([FILLER_A, RULE], [FILLER_B]));
    const id = before.ledger.entries.find((entry) => entry.quote === RULE)?.id as string;
    const other = 'Paint the boathouse door green in spring and check the hinges for rust each autumn.';
    const after = scan(files([FILLER_A], [FILLER_B, other]), before.ledger);
    expect(after.eventsById[id]).toBe('deleted');
    expect(after.ledger.entries.find((entry) => entry.quote === other)?.id).not.toBe(id);
  });
});
