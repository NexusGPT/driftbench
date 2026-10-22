import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

// A test-only set: a label that takes a unit naming no file, and one that takes a unit naming at least two.
const SET = `labels:
  - set: counted
    description: Labels with a number of files.
    labels:
      - name: none-named
        description: A unit that names no file.
        paths: { max: 0 }
        atom: { kind: instruction, polarity: obligation }
      - name: many-named
        description: A unit that names several files.
        paths: { min: 2 }
        atom: { kind: instruction, polarity: obligation }
`;

const FILES = {
  'CLAUDE.md': [
    '# Rules',
    '',
    'Keep the totals.',
    '',
    'Read `docs/a.md` for the totals.',
    '',
    'Read `docs/a.md` and `docs/b.md` for the totals.',
    '',
  ].join('\n'),
  'docs/a.md': '# A\n',
  'docs/b.md': '# B\n',
};

async function run(label: string) {
  const root = await estate(FILES);
  const { map, pointer } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: load(SET),
      labelling: singleLabelling(
        plantedDense((window) =>
          window.units.map((unit) =>
            unit.text.includes('totals')
              ? { units: String(unit.n), label }
              : { units: String(unit.n), label: 'none' },
          ),
        ),
      ),
      cassette: new Cassette(),
      mode: 'record',
    },
  });
  return {
    quotes: map.atoms.filter((atom) => atom.kind === 'instruction').map((atom) => atom.provenance.quote),
    refusals: pointer?.atomRefusals ?? [],
  };
}

describe('a label that takes a number of files (paths)', () => {
  it('builds an atom only for a unit that names no file, and refuses the others with the count', async () => {
    const { quotes, refusals } = await run('none-named');
    expect(quotes).toEqual(['Keep the totals.']);
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toContain('names 1 files and the label none-named takes 0 to 0');
  });

  it('builds an atom only for a unit that names at least two files', async () => {
    const { quotes, refusals } = await run('many-named');
    expect(quotes).toEqual(['Read `docs/a.md` and `docs/b.md` for the totals.']);
    expect(refusals).toHaveLength(2);
  });
});
