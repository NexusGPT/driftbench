import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, DEFAULT_LABEL_SETS, GATE_FORMS_SET_NAME, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

const FILES = {
  'CLAUDE.md': [
    '# Rules',
    '',
    '- **R1.** Never discard a parcel.',
    '- **R2.** Keep the receipt as R1 asks.',
    '- **R3.** Keep tax form R1 in the archive for ten years.',
    '',
    'Editing a parcel? Read `docs/parcels.md` first.',
    '',
    'Before editing a ledger: read [ledger](docs/ledger.md); before sending one: read `docs/send.md`.',
    '',
  ].join('\n'),
  'docs/parcels.md': '# Parcels\n',
  'docs/ledger.md': '# Ledger\n',
  'docs/send.md': '# Send\n',
};

async function scan() {
  const root = await estate(FILES);
  const { map, raw, pointer } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: load(DEFAULT_LABEL_SETS),
      labelling: singleLabelling(
        plantedDense((window, set) =>
          window.units.map((unit) => {
            const none = { units: String(unit.n), label: 'none' };
            if (set.set === GATE_FORMS_SET_NAME) {
              if (unit.text.startsWith('Editing a parcel')) {
                return {
                  units: String(unit.n),
                  label: 'gate-split',
                  target: unit.n + 1,
                  spans: [{ kind: 'governed-action', from: 0, to: 'Editing a parcel'.length }],
                  links: [{ kind: 'act-tool', to: 'Edit' }],
                };
              }
              if (unit.text.startsWith('Before editing a ledger')) {
                const first = unit.text.indexOf('editing a ledger');
                const second = unit.text.indexOf('sending one');
                return {
                  units: String(unit.n),
                  label: 'gate-each',
                  spans: [
                    { kind: 'governed-action', from: first, to: first + 'editing a ledger'.length },
                    { kind: 'governed-action', from: second, to: second + 'sending one'.length },
                  ],
                  links: [{ kind: 'act-tool', to: 'Edit' }],
                };
              }
              if (unit.text.includes('Keep the receipt')) {
                const at = unit.text.indexOf('R1 asks');
                return {
                  units: String(unit.n),
                  label: 'cites-rule',
                  spans: [{ kind: 'cited-label', from: at, to: at + 2 }],
                };
              }
              return none;
            }
            return unit.text.includes('R1.') || unit.text.includes('R2.') || unit.text.includes('R3.')
              ? { units: String(unit.n), label: 'rule' }
              : none;
          }),
        ),
      ),
      cassette: new Cassette(),
      mode: 'record',
    },
  });
  return { map, raw, refusals: pointer?.refusals ?? [] };
}

describe('the gate-forms set, shipped beside the main set', () => {
  it('builds a gate over two adjacent units (gate-split) and a gate for each file of a unit (gate-each)', async () => {
    const { map, refusals } = await scan();
    expect(refusals).toEqual([]);
    expect(
      map.atoms
        .filter((atom) => atom.kind === 'gate')
        .map((atom) => [atom.fields?.first, atom.fields?.trigger]),
    ).toEqual([
      ['docs/parcels.md', 'Editing a parcel'],
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });

  it('makes a cites edge only from the label the annotation gave, and none for a form number', async () => {
    const { map } = await scan();
    const rules = map.atoms.filter((atom) => atom.kind === 'instruction');
    expect(rules.map((atom) => atom.fields?.cites)).toEqual([undefined, ['R1'], undefined]);
    const cites = map.edges.filter((edge) => edge.kind === 'cites');
    expect(cites).toHaveLength(1);
    expect(cites[0]?.from).toBe(rules[1]?.id);
    expect(cites[0]?.to).toBe(rules[0]?.id);
  });
});
