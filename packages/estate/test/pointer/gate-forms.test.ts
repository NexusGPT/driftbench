import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import {
  AGENT_RULES_SET,
  Cassette,
  GATE_FORMS_SET_NAME,
  SHIPPED_LABEL_SETS,
  singleLabelling,
} from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

const FILES = {
  'CLAUDE.md': [
    '# Rules',
    '',
    '- **R1.** Never discard a parcel.',
    '- **R2.** Keep the receipt as R1 asks.',
    '- **R3.** Keep tax form R1 in the archive for ten years.',
    '- **R4.** File article R2 of the customs sheet with every export.',
    '- **R5.** Print version R3 of the label on each crate.',
    '',
    'Editing a parcel? Read `docs/parcels.md` first.',
    '',
    'Before editing a ledger: read [ledger](docs/ledger.md); before sending one: read `docs/send.md`.',
    '',
    'Read `docs/ledger.md` before editing a ledger; read `docs/ledger.md` before sending one.',
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
      sets: load(SHIPPED_LABEL_SETS(AGENT_RULES_SET)),
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
              const gates = unit.text.startsWith('Before editing a ledger')
                ? [
                    ['editing a ledger', '[ledger](docs/ledger.md)'],
                    ['sending one', '`docs/send.md`'],
                  ]
                : unit.text.startsWith('Read `docs/ledger.md` before editing')
                  ? [
                      ['editing a ledger', '`docs/ledger.md`'],
                      ['sending one', '`docs/ledger.md`'],
                    ]
                  : undefined;
              if (gates) {
                let cursor = 0;
                const spans = gates.flatMap(([act, file]) => {
                  const actAt = unit.text.indexOf(act as string);
                  const fileAt = unit.text.indexOf(file as string, cursor);
                  cursor = fileAt + (file as string).length;
                  return [
                    { kind: 'governed-action', from: actAt, to: actAt + (act as string).length },
                    { kind: 'gate-file', from: fileAt, to: cursor },
                  ];
                });
                return {
                  units: String(unit.n),
                  label: 'gate-each',
                  spans,
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
            return ['R1.', 'R2.', 'R3.', 'R4.', 'R5.'].some((mark) => unit.text.includes(mark))
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
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/ledger.md', 'sending one'],
    ]);
  });

  it('makes a cites edge only from the label the annotation gave, and none for a form number', async () => {
    const { map } = await scan();
    const rules = map.atoms.filter((atom) => atom.kind === 'instruction');
    // The form (R3), the article (R4) and the version (R5) decoys carry a rule label and are no citation.
    expect(rules.map((atom) => atom.fields?.cites)).toEqual([
      undefined,
      ['R1'],
      undefined,
      undefined,
      undefined,
    ]);
    const cites = map.edges.filter((edge) => edge.kind === 'cites');
    expect(cites).toHaveLength(1);
    expect(cites[0]?.from).toBe(rules[1]?.id);
    expect(cites[0]?.to).toBe(rules[0]?.id);
  });
});
