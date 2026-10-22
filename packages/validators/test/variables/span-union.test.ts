import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs tool without declarations
import { orderedFiles, union, VOCABULARY } from '../../../../tools/variables-span-union.mjs';

/** The union of the recordings the ladders legs replay: one label per span text, by a fixed rule. */

const label = (limit: number) => ({ kind: 'numeric', subject: 'a quantity', limit, comparison: 'gt' });
const line = (text: string, limit: number) => `${JSON.stringify({ text, label: label(limit) })}\n`;

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'span-union-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const texts = (out: string) =>
  out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { text: string; label: { limit: number } });

describe('the union of the span recordings', () => {
  const dates: Record<string, number> = { 'b-old.jsonl': 100, 'a-new.jsonl': 200, 'c-newest.jsonl': 300 };
  const dateOf = (name: string) => dates[name] ?? 0;

  it('puts the vocabulary last and the others by date, whatever their names', () => {
    const dir = folder({ [VOCABULARY]: '', 'a-new.jsonl': '', 'b-old.jsonl': '', 'c-newest.jsonl': '' });
    expect(orderedFiles(dir, dateOf)).toEqual(['b-old.jsonl', 'a-new.jsonl', 'c-newest.jsonl', VOCABULARY]);
  });

  it('gives a text of two recordings the label of the newer one, and a text of the vocabulary its label', () => {
    const dir = folder({
      'b-old.jsonl': line('x is over 5', 1) + line('y is over 6', 1) + line('z is over 7', 1),
      'a-new.jsonl': line('x is over 5', 2),
      [VOCABULARY]: line('y is over 6', 9),
    });
    const result = union(dir, dateOf);
    const byText = new Map(texts(result.text).map((row) => [row.text, row.label.limit]));
    expect(byText.get('x is over 5')).toBe(2);
    expect(byText.get('y is over 6')).toBe(9);
    expect(byText.get('z is over 7')).toBe(1);
    expect(result.conflicts).toBe(2);
  });

  it('treats every vocabulary recording as a single source, ordered by name after the dated ones', () => {
    const dir = folder({
      'hidden-vocabulary.jsonl': line('x is over 5', 4),
      [VOCABULARY]: line('x is over 5', 3),
      'a-new.jsonl': line('x is over 5', 2),
    });
    expect(orderedFiles(dir, dateOf)).toEqual(['a-new.jsonl', 'hidden-vocabulary.jsonl', VOCABULARY]);
  });

  it('holds no text twice, with white space folded', () => {
    const dir = folder({
      'b-old.jsonl': line('x  is\nover 5', 1),
      'a-new.jsonl': line('x is over 5', 2),
    });
    const rows = texts(union(dir, dateOf).text);
    expect(rows).toHaveLength(1);
    expect(new Set(rows.map((row) => row.text)).size).toBe(rows.length);
  });

  it('keeps the last line of a recording that labels one text twice, and counts it', () => {
    const dir = folder({ 'b-old.jsonl': line('x is over 5', 1) + line('x is over 5', 2) });
    const result = union(dir, dateOf);
    expect(texts(result.text)).toEqual([{ text: 'x is over 5', label: label(2) }]);
    expect(result.conflicts).toBe(1);
  });

  it('is the same whatever the order the files are listed in', () => {
    const files = {
      'b-old.jsonl': line('x is over 5', 1),
      'a-new.jsonl': line('x is over 5', 2),
      [VOCABULARY]: line('w is over 1', 3),
    };
    expect(union(folder(files), dateOf).text).toBe(union(folder(files), dateOf).text);
    expect(readFileSync(join(folder(files), 'a-new.jsonl'), 'utf8')).toBe(line('x is over 5', 2));
  });
});
