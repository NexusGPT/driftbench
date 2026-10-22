import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

// Two test-only sets over the same units: one builds the rule, the other only adds the labels it cites.
const SETS = `labels:
  - set: rules
    description: The rules.
    labels:
      - name: rule
        description: A unit that tells the reader to do something.
        atom:
          kind: instruction
          polarity: obligation
  - set: citations
    description: The labels a rule cites.
    spans:
      - name: cited
        description: The label of another rule that the unit cites as a rule.
    labels:
      - name: cites-rule
        description: A unit that cites another rule by its label.
        annotate: true
        spans: [cited]
        atom:
          kind: instruction
          fields: { "cites?": $spans.cited }
`;

const FILES = {
  'CLAUDE.md': '# Rules\n\n- **R1.** Never discard a parcel.\n- **R2.** Keep the receipt as R1 asks.\n',
};

async function run(cited: string | undefined) {
  const root = await estate(FILES);
  const { map, pointer } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: load(SETS),
      labelling: singleLabelling(
        plantedDense((window, set) =>
          window.units.map((unit) => {
            if (!unit.text.includes('R2.') && !unit.text.includes('Never discard'))
              return { units: String(unit.n), label: 'none' };
            if (set.set === 'rules') return { units: String(unit.n), label: 'rule' };
            const at = unit.text.indexOf('R1 asks');
            if (!unit.text.includes('Keep the receipt') || cited === undefined)
              return { units: String(unit.n), label: 'none' };
            return {
              units: String(unit.n),
              label: 'cites-rule',
              spans: [{ kind: 'cited', from: at, to: at + 2 }],
            };
          }),
        ),
      ),
      cassette: new Cassette(),
      mode: 'record',
    },
  });
  return {
    atoms: map.atoms.filter((atom) => atom.kind === 'instruction'),
    refusals: pointer?.refusals ?? [],
  };
}

describe('an annotation label (annotate: true)', () => {
  it('adds its fields to the atom another set built for the same unit, and builds no atom of its own', async () => {
    const { atoms, refusals } = await run('R1');
    expect(refusals).toEqual([]);
    expect(atoms).toHaveLength(2);
    expect(atoms.map((atom) => atom.fields?.cites)).toEqual([undefined, ['R1']]);
  });

  it('adds nothing when the unit gets no annotation', async () => {
    const { atoms } = await run(undefined);
    expect(atoms).toHaveLength(2);
    expect(atoms.map((atom) => atom.fields?.cites)).toEqual([undefined, undefined]);
  });
});
