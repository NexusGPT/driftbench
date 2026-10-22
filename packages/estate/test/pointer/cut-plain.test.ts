import { describe, expect, it } from 'vitest';
import { cut, isPlainTextPath } from '../../src/pointer';

// Every file below is invented: the harbour office, its ropes and its lamps exist nowhere.
const texts = (source: string, plain = true) => cut(source, { plain }).units.map((unit) => unit.text);

describe('the cutter on a plain text file', () => {
  it('reads a path that ends in .txt as plain text, and no other', () => {
    expect(isPlainTextPath('notes/ropes.txt')).toBe(true);
    expect(isPlainTextPath('notes/ROPES.TXT')).toBe(true);
    expect(isPlainTextPath('notes/ropes.md')).toBe(false);
    expect(isPlainTextPath('notes/ropes.txt.md')).toBe(false);
  });

  it('ends a short title line at its line break, so the rule below it is its own unit', () => {
    const source = 'ROPES\nNever coil a rope that another skipper holds, note a.\n';
    expect(texts(source)).toEqual(['ROPES', 'Never coil a rope that another skipper holds, note a.']);
  });

  it('keeps the markdown reading for a file that is not plain text: a line break is a soft wrap', () => {
    const source = 'ROPES\nNever coil a rope that another skipper holds, note a.\n';
    expect(texts(source, false)).toEqual(['ROPES\nNever coil a rope that another skipper holds, note a.']);
  });

  it('cuts at the title for any text of the shape, whatever its words', () => {
    for (const title of ['Lamps', 'Harbour office duties', 'A1', 'ÉCLUSE'])
      expect(texts(`${title}\nHang the lamp on the red post before dusk comes down.\n`)).toHaveLength(2);
  });

  it('keeps a hard wrapped sentence whole: its lines are long, or continue in lower case', () => {
    const wrapped = [
      'The skipper of every boat that ties up at the quay hangs the lamp on the red',
      'post before dusk comes down, and counts the ropes twice.',
    ].join('\n');
    expect(texts(wrapped)).toEqual([wrapped]);
    const short = 'Hang the lamp\non the red post.\n';
    expect(texts(short)).toEqual(['Hang the lamp\non the red post.']);
  });

  it('does not end a sentence at a short line in its middle, even when a capitalised word follows it', () => {
    const wrapped = [
      'The skipper of every boat that ties up at the quay hangs the lamp on the',
      'Red Post by',
      'Harbour rules and counts the ropes twice before dusk comes down fully.',
    ].join('\n');
    expect(texts(wrapped)).toEqual([wrapped]);
  });

  it('keeps ordinary lines together when one very long line sits among them', () => {
    const lines = ['Coil the rope', 'Hang the lamp', 'Count the boats', `Close the gate ${'x'.repeat(300)}`];
    const source = lines.join('\n');
    expect(texts(source)).toEqual([source]);
  });

  it('cuts a file with a very large paragraph of lines without failing', () => {
    const source = Array.from({ length: 150_000 }, (_, index) => `Row ${index}`).join('\n');
    expect(cut(source, { plain: true }).units.length).toBeGreaterThan(0);
  }, 120_000);

  it('cuts a very long run of lines in slabs at line breaks: every unit a slice, every row once, a fence in the run whole', () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => `Row ${from + index}`).join('\n');
    const fence = `\`\`\`\n${rows(0, 7_000)}\n\`\`\``;
    const source = `${rows(0, 12_000)}\n${fence}\n${rows(12_000, 12_000)}`;
    const cutIt = cut(source, { plain: true });
    for (const unit of cutIt.units) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
    // The fence is one opaque unit over all its lines, even though the run of lines around it is far over a slab.
    const opaque = cutIt.units.filter((unit) => unit.container === 'opaque');
    expect(opaque).toHaveLength(1);
    expect(opaque[0]?.text).toBe(fence);
    // Every row outside the fence is in exactly one unit, in order.
    const rowsSeen = cutIt.units
      .filter((unit) => unit.container !== 'opaque')
      .flatMap((unit) => unit.text.match(/Row \d+/g) ?? []);
    expect(rowsSeen).toHaveLength(24_000);
    expect(new Set(rowsSeen).size).toBe(24_000);
  });

  it('does not read the start of a later slab as a front matter', () => {
    const head = Array.from({ length: 5_000 }, (_, index) => `Row ${index}`).join('\n');
    const source = `${head}\n---\nname: not-front-matter\n---\nRow after.\n`;
    expect(cut(source, { plain: true }).units.some((unit) => unit.container === 'front_matter_value')).toBe(
      false,
    );
  });

  it('reads 60,000 lines of one paragraph in a few seconds of CPU, not the quadratic time of one parse', () => {
    const source = Array.from({ length: 60_000 }, (_, index) => `Row ${index}`).join('\n');
    const before = process.cpuUsage();
    cut(source, { plain: true });
    const used = process.cpuUsage(before);
    expect((used.user + used.system) / 1000).toBeLessThan(8_000);
  }, 120_000);

  it('keeps a second title under a first one together with it: a recall limit, taken so that no sentence is split', () => {
    const source = 'PART 1\nROPES\nNever coil a rope that another skipper holds, note a.\n';
    expect(texts(source)).toEqual([source.trimEnd()]);
  });

  it('keeps the lines of a table of rows together: none is short beside the others', () => {
    const rows =
      'NWX 123 sorted-at-depot 2026-03-04\nNWX 1234 delivered 2026-03-05\nDLV 123 out-for-delivery 2026-03-06';
    expect(texts(rows)).toEqual([rows]);
  });

  it('keeps every unit a slice of the file', () => {
    const source =
      'ROPES\nNever coil a rope that another skipper holds.\n\nLAMPS\nHang the lamp before dusk comes down.\n';
    for (const unit of cut(source, { plain: true }).units)
      expect(source.slice(unit.start, unit.end)).toBe(unit.text);
    expect(texts(source)).toHaveLength(4);
  });

  it('leaves a markdown heading and a list item as they are', () => {
    expect(texts('# Ropes\n\n- Coil the rope\n- Hang the lamp\n')).toEqual([
      '# Ropes',
      'Coil the rope',
      'Hang the lamp',
    ]);
  });
});
