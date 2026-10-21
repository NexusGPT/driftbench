import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

// A test-only set: a unit that holds several gates gives one atom for each file it names, each with its own act.
const SET = `labels:
  - set: each
    description: Several gates in one unit.
    spans:
      - name: act
        description: The act that waits.
    labels:
      - name: gates
        description: A unit that holds several gates, each with its own act and its own file.
        spans: [act]
        atom:
          kind: gate
          locate: each
          spanEach: act
          title: "Read \${named} before \${span.act}"
          situation: "\${span.act}"
          fields: { first: $named, trigger: "\${span.act}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: Edit }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
`;

const LINE = 'Before editing a ledger: read `docs/ledger.md`; before sending one: read `docs/send.md`.';
const FILES = {
  'CLAUDE.md': `# Gates\n\n${LINE}\n`,
  'docs/ledger.md': '# Ledger\n',
  'docs/send.md': '# Send\n',
};

async function gates(acts: string[]) {
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
            unit.text.startsWith('Before editing')
              ? {
                  units: String(unit.n),
                  label: 'gates',
                  spans: acts.map((act) => ({
                    kind: 'act',
                    from: unit.text.indexOf(act),
                    to: unit.text.indexOf(act) + act.length,
                  })),
                }
              : { units: String(unit.n), label: 'none' },
          ),
        ),
      ),
      cassette: new Cassette(),
      mode: 'record',
    },
  });
  return {
    found: map.atoms
      .filter((atom) => atom.kind === 'gate')
      .map((atom) => [atom.fields?.first, atom.fields?.trigger]),
    refusals: pointer?.refusals ?? [],
  };
}

describe('a mapping that takes the nth span for the nth path (spanEach)', () => {
  it('builds a gate for each file the unit names, each with its own act', async () => {
    const { found, refusals } = await gates(['editing a ledger', 'sending one']);
    expect(refusals).toEqual([]);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });

  it('gives a path with no span of its own the first span', async () => {
    const { found } = await gates(['editing a ledger']);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'editing a ledger'],
    ]);
  });
});
