import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

// A test-only set: the unit that asks the act is the gate, its target unit names the file to read first.
const SET = `labels:
  - set: split
    description: Gates asked over two units.
    spans:
      - name: act
        description: The act that waits.
    labels:
      - name: gate-over-two
        description: A unit that asks the act that waits, while the next unit names the file to read first.
        target: required
        spans: [act]
        atom:
          kind: gate
          title: "Read \${named} before \${span.act}"
          situation: "\${span.act}"
          fields: { first: $named, trigger: "\${span.act}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: Edit }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
`;

const FILES = {
  'CLAUDE.md': '# Gates\n\nEditing a parcel? Read `docs/parcels.md` first.\n',
  'docs/parcels.md': '# Parcels\n',
};

describe('a unit with a target that names no file of its own', () => {
  it('takes the file from the code spans of its target unit', async () => {
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
              unit.text.startsWith('Editing a parcel')
                ? {
                    units: String(unit.n),
                    label: 'gate-over-two',
                    target: unit.n + 1,
                    spans: [{ kind: 'act', from: 0, to: 'Editing a parcel'.length }],
                  }
                : { units: String(unit.n), label: 'none' },
            ),
          ),
        ),
        cassette: new Cassette(),
        mode: 'record',
      },
    });
    expect(pointer?.refusals).toEqual([]);
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    expect(gates.map((atom) => [atom.fields?.first, atom.fields?.trigger])).toEqual([
      ['docs/parcels.md', 'Editing a parcel'],
    ]);
    // The quote runs over both units.
    expect(gates[0]?.provenance.quote).toBe('Editing a parcel? Read `docs/parcels.md` first.');
  });
});
