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

  it('cuts only a very long paragraph, in parts: every unit a slice, every row once, no fence or heading cut', () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => `Row ${from + index}`).join('\n');
    // A four-backtick fence that holds a three-backtick line, between two very long paragraphs.
    const fence = `\`\`\`\`\n${rows(0, 3_000)}\n\`\`\`\n${rows(3_000, 4_000)}\n\`\`\`\``;
    const source = `${rows(0, 12_000)}\n\n${fence}\n\n${rows(12_000, 12_000)}`;
    const cutIt = cut(source, { plain: true });
    for (const unit of cutIt.units) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
    const opaque = cutIt.units.filter((unit) => unit.container === 'opaque');
    expect(opaque).toHaveLength(1);
    expect(opaque[0]?.text).toBe(fence);
    const rowsSeen = cutIt.units
      .filter((unit) => unit.container !== 'opaque')
      .flatMap((unit) => unit.text.match(/Row \d+/g) ?? []);
    expect(rowsSeen).toHaveLength(24_000);
    expect(new Set(rowsSeen).size).toBe(24_000);
  });

  it('keeps a very long block quote and a very long list as the parser gives them', () => {
    const quote = Array.from({ length: 12_000 }, (_, index) => `> Row ${index}`).join('\n');
    for (const plain of [false, true]) {
      const units = cut(quote, { plain }).units;
      expect(units).toHaveLength(1);
      expect(units[0]?.container).toBe('block_quote');
      expect(units[0]?.text.startsWith('Row 0\n> Row 1')).toBe(true);
      expect(units[0]?.text.endsWith('> Row 11999')).toBe(true);
    }
    const list = Array.from({ length: 12_000 }, (_, index) => `- item ${index}`).join('\n');
    expect(cut(list, { plain: false }).units).toHaveLength(12_000);
  }, 120_000);

  it('keeps the heading path after a very long paragraph', () => {
    const rows = Array.from({ length: 12_000 }, (_, index) => `Row ${index}`).join('\n');
    const source = `# Ropes\n\n## Coils\n\n${rows}\n\nNever coil a rope that another skipper holds, note a.\n`;
    for (const plain of [false, true]) {
      const last = cut(source, { plain }).units.at(-1);
      expect(last?.text).toContain('Never coil a rope');
      expect(last?.path).toEqual(['Ropes', 'Coils']);
    }
  });

  it('does not cut a table or a front matter of a very long file', () => {
    const table = Array.from({ length: 6_000 }, (_, index) => `| cell ${index} | b |`);
    const source = `---\nname: ropes\n---\n\n| a | b |\n| - | - |\n${table.join('\n')}\n`;
    const units = cut(source, { plain: false }).units;
    expect(units.filter((unit) => unit.container === 'front_matter_value')).toHaveLength(1);
    expect(units.filter((unit) => unit.container === 'table_cell').length).toBeGreaterThan(12_000);
  });

  // The cost is measured by how it grows, in one process: ten times the lines should cost about ten times the CPU
  // (linear is near 10; one parse of the whole paragraph is far above). A millisecond limit on a shared runner is noise.
  const cpuOf = (source: string, plain: boolean): number => {
    const times = [0, 1].map(() => {
      const before = process.cpuUsage();
      cut(source, { plain });
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    });
    return Math.min(...times);
  };
  const growth = (line: (index: number) => string, plain: boolean) => {
    const text = (count: number) => Array.from({ length: count }, (_, index) => line(index)).join('\n');
    const small = text(6_000);
    const large = text(60_000);
    cut(small, { plain });
    const one = Math.max(cpuOf(small, plain), 20);
    const ten = cpuOf(large, plain);
    return { ratio: ten / one, ten };
  };

  it('reads 60,000 lines of one paragraph with a cost that grows with the lines: ten times the lines, at most 14 times the CPU', () => {
    const result = growth((index) => `Row ${index}`, true);
    expect(result.ratio).toBeLessThanOrEqual(14);
    expect(result.ten).toBeLessThan(30_000);
  }, 240_000);

  it('reads 60,000 lines of one block quote with a cost that grows with the lines, and keeps it one unit', () => {
    const result = growth((index) => `> Row ${index}`, false);
    expect(result.ratio).toBeLessThanOrEqual(14);
    expect(result.ten).toBeLessThan(30_000);
    const quote = Array.from({ length: 60_000 }, (_, index) => `> Row ${index}`).join('\n');
    const units = cut(quote, { plain: false }).units;
    expect(units).toHaveLength(1);
    expect(units[0]?.container).toBe('block_quote');
    expect(quote.slice(units[0]?.start, units[0]?.end)).toBe(units[0]?.text);
  }, 240_000);

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

  describe('a cut paragraph or quote reads as the uncut parse reads it', () => {
    // Lines end with a full stop, so a cut between two lines is also a sentence boundary: the units can be equal.
    const row = (index: number) => `Row ${index}.`;
    const rows = (count: number, mark = '', from = 0) =>
      Array.from({ length: count }, (_, index) => `${mark}${row(from + index)}`);
    const shapes: Record<string, string[]> = {
      paragraph: rows(14),
      'quote followed by lazy lines': [...rows(7, '> '), ...rows(7, '', 7)],
      'quote with a blank quote line': [...rows(6, '> '), '>', ...rows(6, '> ', 6)],
      'nested quote': rows(12, '> > '),
      'fence with a fence inside': ['````', ...rows(5), '```', ...rows(5, '', 5), '````', ...rows(8, '', 10)],
      'list then paragraph': ['- one.', '- two.', '', ...rows(12)],
      'heading then paragraph': ['# Ropes', '', '## Coils', '', ...rows(12)],
      'quote in a list': ['- item.', ...rows(8, '  > ')],
      table: ['| a | b |', '| - | - |', ...rows(10, '| ').map((line) => `${line} | x |`)],
    };

    const flat = (source: string, plain: boolean, slabLines: number) =>
      cut(source, { plain, slabLines }).units.map((unit) => [
        unit.container,
        unit.start,
        unit.end,
        unit.text,
        unit.path,
      ]);

    const same = (name: string, source: string) => {
      for (const plain of [false, true]) {
        const whole = flat(source, plain, Number.POSITIVE_INFINITY);
        const cutUp = flat(source, plain, 3);
        expect(cutUp, `${name} (plain ${plain})`).toEqual(whole);
      }
    };

    it.each(Object.entries(shapes))('is the same for %s', (name, lines) => {
      same(name, lines.join('\n'));
      same(`${name} with CRLF`, lines.join('\r\n'));
    });

    it('is the same for 60 generated documents of lazy lines, nested quotes, fences, lists and CRLF', () => {
      let state = 12_345;
      const next = (limit: number) => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state % limit;
      };
      let counter = 0;
      const block = (): string[] => {
        const size = 3 + next(10);
        const lines = rows(size, '', counter);
        counter += size;
        switch (next(7)) {
          case 0:
            return lines.map((line) => `> ${line}`);
          case 1:
            return lines.map((line, at) => (at > 0 && next(3) === 0 ? line : `> ${line}`));
          case 2:
            return lines.map((line, at) => (at === 2 ? '>' : `> ${line}`));
          case 3:
            return lines.map((line) => `> > ${line}`);
          case 4:
            return ['```', ...lines, '```'];
          case 5:
            return lines.map((line) => `- ${line}`);
          default:
            return lines;
        }
      };
      for (let at = 0; at < 60; at++) {
        const parts: string[] = [];
        for (let count = 1 + next(4); count > 0; count--) parts.push(block().join('\n'));
        const glue = next(2) === 0 ? '\n\n' : '\n';
        const source = parts.join(glue);
        same(`document ${at}`, next(3) === 0 ? source.replace(/\n/g, '\r\n') : source);
      }
    });
  });
});
