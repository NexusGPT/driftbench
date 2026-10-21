import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { AGENT_RULES_SET, Cassette, parseLabelSets, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

const FILES = {
  'CLAUDE.md': [
    '# Gates',
    '',
    'Editing a parcel? Read `docs/parcels.md` first.',
    '',
    'Before editing a ledger: read `docs/ledger.md`; before sending one: read `docs/send.md`.',
    '',
  ].join('\n'),
  'docs/parcels.md': '# Parcels\n',
  'docs/ledger.md': '# Ledger\n',
  'docs/send.md': '# Send\n',
};

async function gates(answer: Parameters<typeof plantedDense>[0]) {
  const sets = parseLabelSets(AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const root = await estate(FILES);
  const { map, pointer } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: sets.sets,
      labelling: singleLabelling(plantedDense(answer)),
      cassette: new Cassette(),
      mode: 'record',
    },
  });
  return { gates: map.atoms.filter((atom) => atom.kind === 'gate'), refusals: pointer?.refusals ?? [] };
}

describe('a gate that spans two units or holds two orders', () => {
  it('builds one gate from an act asked in one unit and the file named in the next (gate-split)', async () => {
    const { gates: found, refusals } = await gates((window) =>
      window.units.map((unit) => {
        if (unit.text.startsWith('Editing a parcel')) {
          const act = 'Editing a parcel';
          return {
            units: String(unit.n),
            label: 'gate-split',
            target: unit.n + 1,
            spans: [{ kind: 'governed-action', from: 0, to: act.length }],
            links: [{ kind: 'act-tool', to: 'Edit' }],
          };
        }
        return { units: String(unit.n), label: 'none' };
      }),
    );
    expect(refusals).toEqual([]);
    expect(found.map((atom) => [atom.fields?.first, atom.fields?.trigger])).toEqual([
      ['docs/parcels.md', 'Editing a parcel'],
    ]);
  });

  it('builds a gate for each file a unit names, each with its own act (gate-each)', async () => {
    const { gates: found, refusals } = await gates((window) =>
      window.units.map((unit) => {
        if (!unit.text.startsWith('Before editing a ledger')) return { units: String(unit.n), label: 'none' };
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
      }),
    );
    expect(refusals).toEqual([]);
    expect(found.map((atom) => [atom.fields?.first, atom.fields?.trigger])).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });
});
