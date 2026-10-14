import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DiskArray, writeDiskJson } from '../../src/enumerate/stream-storage';

it('replays buffered, oversized and multibyte records in exact JSON order', () => {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-spool-'));
  try {
    const rows = new DiskArray<{ text: string }>(root, 'rows.jsonl');
    const expected = Array.from({ length: 300 }, (_, index) => ({
      text: `${index}: ${'é🙂'.repeat(index)}`,
    }));
    expected.splice(123, 0, { text: 'large'.repeat(20_000) });
    for (const value of expected) rows.push(value);
    const mutable = { text: 'before mutation' };
    rows.push(mutable);
    mutable.text = 'after mutation';
    expected.push({ text: 'before mutation' });
    expect(rows.length).toBe(expected.length);
    expect([...rows]).toEqual(expected);
    expect([...rows]).toEqual(expected);
    rows.push({ text: 'after replay' });
    expected.push({ text: 'after replay' });
    const output = join(root, 'report.json');
    writeDiskJson(output, { rows });
    expect(readFileSync(output, 'utf8')).toBe(`${JSON.stringify({ rows: expected })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
