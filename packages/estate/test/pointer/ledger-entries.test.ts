import { describe, expect, it } from 'vitest';
import {
  carryOf,
  checkLedger,
  cut,
  type Ledger,
  nextLedger,
  parseLedger,
  recordLabel,
  renderLedger,
} from '../../src/pointer';

// Invented files: a depot with crates and keepers.
const depot = (extra = ''): string =>
  [
    '# Depot',
    '',
    'Count the  crates\ttwice before noon.',
    '',
    '> Name the keeper',
    '> of every crate.',
    '',
    `Lock the gate when the yard is empty.${extra}`,
    '',
  ].join('\n');

const scan = (texts: Record<string, string>, previous?: Ledger) =>
  nextLedger(
    Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text), text })),
    previous,
    'depot',
  );

describe('a ledger entry', () => {
  it('quotes the unit as the file holds it, between the characters around it', () => {
    const text = depot();
    const { ledger } = scan({ 'depot.md': text });
    expect(ledger.entries.length).toBeGreaterThan(3);
    for (const entry of ledger.entries) {
      expect(text.slice(entry.hint.start, entry.hint.end)).toBe(entry.quote);
      expect(text.includes(`${entry.prefix}${entry.quote}${entry.suffix}`)).toBe(true);
    }
    expect(ledger.entries.map((entry) => entry.quote)).toContain('Count the  crates\ttwice before noon.');
  });

  it('starts a lineage at the first scan and extends it only when a scan changes something', () => {
    const first = scan({ 'depot.md': depot() });
    expect(first.ledger.entries.every((entry) => entry.lineage.length === 1)).toBe(true);
    expect(first.ledger.entries.every((entry) => entry.lineage[0]?.event === 'new')).toBe(true);
    const second = scan({ 'depot.md': depot() }, first.ledger);
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
    expect(Object.values(second.eventsById).every((event) => event === 'unchanged')).toBe(true);
    const edited = scan({ 'depot.md': depot().replace('Lock the gate', 'Lock the main gate') }, first.ledger);
    const touched = edited.ledger.entries.filter((entry) => entry.lineage.length > 1);
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((entry) => entry.lineage.at(-1)?.scan === 2)).toBe(true);
  });

  it('records a deletion once', () => {
    const first = scan({ 'depot.md': depot(), 'spare.md': 'Keep the spare keys in the tin box.\n' });
    const second = scan({ 'depot.md': depot() }, first.ledger);
    const gone = second.ledger.entries.filter((entry) => entry.status === 'deleted');
    expect(gone).toHaveLength(1);
    expect(gone[0]?.lineage.at(-1)).toEqual({ scan: 2, event: 'deleted' });
    const third = scan({ 'depot.md': depot() }, second.ledger);
    expect(third.ledger.entries.find((entry) => entry.id === gone[0]?.id)?.lineage).toEqual(gone[0]?.lineage);
  });

  it('marks the copy of identical boilerplate in a later file, and only that', () => {
    const shared = 'Close every window before you leave the hall.\n';
    const { ledger } = scan({
      'a.md': `${shared}\nA unit that only a holds.\n`,
      'b.md': `${shared}\nA unit that only b holds.\n`,
      'c.md': `${shared}`,
    });
    const live = ledger.entries.filter((entry) => entry.quote === shared.trim());
    expect(live.map((entry) => entry.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(live[0]?.twinOf).toBeNull();
    expect(live[1]?.twinOf).toBe(live[0]?.id);
    expect(live[2]?.twinOf).toBe(live[0]?.id);
    expect(ledger.entries.filter((entry) => entry.twinOf !== null)).toHaveLength(2);
  });

  it('keeps a label under a set named like an object property', () => {
    const first = scan({ 'depot.md': depot() });
    const entry = first.ledger.entries[0];
    expect(entry).toBeDefined();
    const label = { label: 'rule', setHash: 'h', labeler: 'l', source: 'none' };
    for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
      expect(Object.hasOwn((entry as { labels: object }).labels, name)).toBe(false);
      (entry as { labels: Record<string, unknown> }).labels[name] = label;
    }
    const round = parseLedger(renderLedger(first.ledger));
    const stored = round?.entries[0]?.labels as Record<string, unknown>;
    for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
      expect(Object.hasOwn(stored, name)).toBe(true);
    }
    expect(({} as Record<string, unknown>).label).toBeUndefined();
  });
});

describe('checking a ledger', () => {
  it('accepts a rescan of the same files and names the file that changed', () => {
    const first = scan({ 'depot.md': depot(), 'spare.md': 'Keep the spare keys in the tin box.\n' });
    const raw = renderLedger(first.ledger);
    const same = scan(
      { 'depot.md': depot(), 'spare.md': 'Keep the spare keys in the tin box.\n' },
      first.ledger,
    );
    expect(checkLedger(raw, same.ledger)).toEqual({ ok: true });
    const edited = scan(
      { 'depot.md': depot(' Check it twice.'), 'spare.md': 'Keep the spare keys in the tin box.\n' },
      first.ledger,
    );
    const verdict = checkLedger(raw, edited.ledger);
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain('depot.md');
    expect(verdict.error).not.toContain('spare.md');
  });

  it('refuses when there is no committed ledger', () => {
    const first = scan({ 'depot.md': depot() });
    expect(checkLedger(undefined, first.ledger).ok).toBe(false);
  });
});

describe('following a reworded unit', () => {
  const frame = (text: string, mark: string) =>
    `# ${mark.repeat(40)}\n\n${mark.repeat(80)}.\n\n${text}\n\n${mark.repeat(80)}.\n`;
  const reword = (kept: number, mark: string) => {
    const old = `M${'b'.repeat(120)}.`;
    const next = `M${'b'.repeat(kept)}${'q'.repeat(120 - kept)}.`;
    const first = scan({ 'score.md': frame(old, 'A') });
    const second = scan({ 'score.md': frame(next, mark) }, first.ledger);
    const before = first.ledger.entries.find((entry) => entry.quote === old);
    const now = second.ledger.entries.find((entry) => entry.quote === next);
    return before?.id === now?.id;
  };

  it('weighs the text at 0.6 and the 24 characters around it with the heading path at 0.4', () => {
    // Text similarity 0.74 with the same context: score 0.84, kept.
    expect(reword(89, 'A')).toBe(true);
    // Text similarity 0.74 with another context: score 0.56, kept.
    expect(reword(89, 'Z')).toBe(true);
    // Text similarity 0.53 with the same context: score 0.72, kept.
    expect(reword(64, 'A')).toBe(true);
    // Text similarity 0.30 is under the floor, whatever the context.
    expect(reword(36, 'A')).toBe(false);
  });
});

describe('carrying labels to the next scan', () => {
  const before = { fp: 'a', ctxFp: 'x', labels: { tone: 'curt', duty: 'none' } };

  it('carries every label of an unchanged unit, none included', () => {
    expect(carryOf(before, { fp: 'a', ctxFp: 'x' }, ['tone', 'duty'])).toEqual({
      carried: [
        { set: 'tone', label: 'curt' },
        { set: 'duty', label: 'none' },
      ],
      dirty: [],
    });
  });

  it('asks again for every set when the text or the context changed, and for a set it never had', () => {
    for (const after of [
      { fp: 'b', ctxFp: 'x' },
      { fp: 'a', ctxFp: 'y' },
    ]) {
      expect(carryOf(before, after, ['tone', 'duty'])).toEqual({ carried: [], dirty: ['tone', 'duty'] });
    }
    expect(carryOf(before, { fp: 'a', ctxFp: 'x' }, ['tone', 'extra'])).toEqual({
      carried: [{ set: 'tone', label: 'curt' }],
      dirty: ['extra'],
    });
  });
});

describe('recording the label of one set', () => {
  const label = (name: string) => ({ label: name, setHash: 'h', labeler: 'l', source: 'none' });

  it('replaces one set and reports a flip when a selected label changes or stops', () => {
    const entry = { id: 'u1', labels: { a: label('rule'), b: label('note') } };
    expect(recordLabel(entry, 'a', label('rule'))).toBeUndefined();
    expect(recordLabel(entry, 'a', label('none'))).toEqual({
      unit: 'u1',
      set: 'a',
      from: 'rule',
      to: 'none',
    });
    expect(entry.labels.b.label).toBe('note');
    expect(recordLabel(entry, 'a', label('rule'))).toBeUndefined();
    expect(recordLabel(entry, 'a', label('prohibition'))).toEqual({
      unit: 'u1',
      set: 'a',
      from: 'rule',
      to: 'prohibition',
    });
    expect(recordLabel(entry, 'b', undefined)).toEqual({ unit: 'u1', set: 'b', from: 'note' });
    expect(Object.keys(entry.labels)).toEqual(['a']);
  });
});

describe('a text that matches in several places', () => {
  it('lists every place, and the id sits on the first', () => {
    const text = 'Return every key before you leave the depot.';
    const first = scan({ 'one.md': `${text}\n` });
    const second = nextLedger(
      [
        { path: 'a.md', cut: cut(`${text}\n`), text: `${text}\n` },
        { path: 'b.md', cut: cut(`${text}\n`), text: `${text}\n` },
      ],
      first.ledger,
      'depot',
    );
    const [id] = first.ledger.entries.map((entry) => entry.id);
    expect(second.eventsById[id as string]).toBe('ambiguous');
    expect(second.candidates[id as string]).toEqual([
      { path: 'a.md', quote: text },
      { path: 'b.md', quote: text },
    ]);
  });
});

describe('a unit split in two or two units joined', () => {
  const whole =
    'Count every compass promptly, then tighten the polished register behind the barrow overnight, and a valve from the cellar hangs together while the numbered gallery shifts beneath the crate, and seal each rake firmly.';
  const head =
    'Count every compass promptly, then tighten the polished register behind the barrow overnight, and a valve from the cellar hangs together while the numbered gallery shifts beneath the crate.';
  const tail = 'Seal each rake firmly.';

  it('is a split even when one piece is almost the whole unit', () => {
    const first = scan({ 'a.md': `${whole}\n` });
    const second = scan({ 'a.md': `${head}\n\n${tail}\n` }, first.ledger);
    expect(second.events.split).toBe(1);
    expect(second.events.changed).toBe(0);
    const [id] = first.ledger.entries.map((entry) => entry.id);
    expect(second.eventsById[id as string]).toBe('split');
  });

  it('is a merge even when one unit was almost the whole joined text', () => {
    const first = scan({ 'a.md': `${head}\n\n${tail}\n` });
    const second = scan({ 'a.md': `${whole}\n` }, first.ledger);
    expect(second.events.merged).toBe(1);
    expect(second.events.deleted).toBe(1);
    expect(second.events.changed).toBe(0);
  });

  it('is a plain change when the neighbour adds nothing', () => {
    const first = scan({ 'a.md': `${head}\n\nLock the gate when the yard is empty.\n` });
    const second = scan(
      { 'a.md': `${head.replace('crate', 'cart')}\n\nLock the gate when the yard is empty.\n` },
      first.ledger,
    );
    expect(second.events.changed).toBe(1);
    expect(second.events.split).toBe(0);
    expect(second.events.merged).toBe(0);
  });
});
