import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { Cassette, singleLabelling } from '../../src/pointer';
import { estate, NOW } from '../support';
import { load, plantedDense } from './support';

// A test-only set: the label lists the act span and the file span of each gate in the same order. The gate's file is
// the one its file span names; nothing is bound by position.
const SET = `labels:
  - set: each
    description: Several gates in one unit.
    spans:
      - name: act
        description: The act that waits.
      - name: file
        description: The file to read first.
    labels:
      - name: gates
        description: A unit that holds several gates, each with its own act and file.
        spans: [act, file]
        atom:
          kind: gate
          spanEach: act
          spanFile: file
          title: "Read \${named} before \${span.act}"
          situation: "\${span.act}"
          fields: { first: $named, trigger: "\${span.act}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: Edit }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
`;

type Gate = { act: string; file?: string; at?: number };

async function gates(line: string, answer: Gate[], extra: string[] = ['docs/ledger.md', 'docs/send.md']) {
  const root = await estate({
    'CLAUDE.md': `# Gates\n\n${line}\n`,
    ...Object.fromEntries(extra.map((path) => [path, '# File\n'])),
  });
  const { map, pointer } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: load(SET),
      labelling: singleLabelling(
        plantedDense((window) =>
          window.units.map((unit) => {
            if (!unit.text.includes('read')) return { units: String(unit.n), label: 'none' };
            const at = (text: string, from = 0) => {
              const i =
                unit.text.indexOf(text, from) >= 0 ? unit.text.indexOf(text, from) : unit.text.indexOf(text);
              return { from: i, to: i + text.length };
            };
            // The answer lists the act and the file of one gate, then of the next.
            let cursor = 0;
            const spans = answer.flatMap((gate) => {
              const act = at(gate.act);
              const out: Array<{ kind: string; from: number; to: number }> = [{ kind: 'act', ...act }];
              if (gate.file !== undefined) {
                const file = at(gate.file, cursor);
                cursor = file.to;
                out.push({ kind: 'file', ...file });
              }
              return out;
            });
            return { units: String(unit.n), label: 'gates', spans };
          }),
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
    atomRefusals: pointer?.atomRefusals ?? [],
  };
}

describe('a mapping that builds one atom for each act span, with the file span listed with it (spanEach)', () => {
  it('builds a gate for each act with the file of its own span', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: read `docs/ledger.md`; before sending one: read `docs/send.md`.',
      [
        { act: 'editing a ledger', file: '`docs/ledger.md`' },
        { act: 'sending one', file: '`docs/send.md`' },
      ],
    );
    expect(atomRefusals).toEqual([]);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });

  it('keeps one gate for each act when both name one file, with both paths before the second act', async () => {
    const { found, atomRefusals } = await gates(
      'Read `docs/ledger.md` before editing a ledger; read `docs/ledger.md` before sending one.',
      [
        { act: 'editing a ledger', file: '`docs/ledger.md`' },
        { act: 'sending one', file: '`docs/ledger.md`' },
      ],
      ['docs/ledger.md'],
    );
    expect(atomRefusals).toEqual([]);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/ledger.md', 'sending one'],
    ]);
  });

  it('finds a file written as a link in its span', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: read [ledger](docs/ledger.md); before sending one: read `docs/send.md`.',
      [
        { act: 'editing a ledger', file: '[ledger](docs/ledger.md)' },
        { act: 'sending one', file: '`docs/send.md`' },
      ],
    );
    expect(atomRefusals).toEqual([]);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });

  it('refuses the gate whose own file span is missing, and moves no other gate (first file span absent)', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: ask first; before sending one: read `docs/send.md`.',
      [{ act: 'editing a ledger' }, { act: 'sending one', file: '`docs/send.md`' }],
    );
    expect(found).toEqual([['docs/send.md', 'sending one']]);
    expect(atomRefusals.join(' ')).toContain('gate 1');
  });

  it('keeps the pairs the label declares when the files stand in another order than the acts', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger and sending one, read the matching file: `docs/send.md` for sending one, `docs/ledger.md` for editing a ledger.',
      [
        { act: 'editing a ledger', file: '`docs/ledger.md`' },
        { act: 'sending one', file: '`docs/send.md`' },
      ],
    );
    expect(atomRefusals).toEqual([]);
    expect(found).toEqual([
      ['docs/ledger.md', 'editing a ledger'],
      ['docs/send.md', 'sending one'],
    ]);
  });

  it('refuses a file span that holds only the start of a path', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: read `docs/ledger.md`.',
      [{ act: 'editing a ledger', file: '`docs/' }],
      ['docs/ledger.md'],
    );
    expect(found).toEqual([]);
    expect(atomRefusals.length).toBeGreaterThan(0);
  });

  it('refuses a gate with no file span, and keeps the others', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: read `docs/ledger.md`; before sending one: ask first.',
      [{ act: 'editing a ledger', file: '`docs/ledger.md`' }, { act: 'sending one' }],
    );
    expect(found).toEqual([['docs/ledger.md', 'editing a ledger']]);
    expect(atomRefusals.join('\n')).toContain(
      'the gate 2 of the label gates has no file span that names a file',
    );
  });

  it('refuses a file span that names no file', async () => {
    const { found, atomRefusals } = await gates(
      'Before editing a ledger: read `docs/ledger.md`; before sending one: ask first.',
      [
        { act: 'editing a ledger', file: '`docs/ledger.md`' },
        { act: 'sending one', file: 'ask first' },
      ],
    );
    expect(found).toEqual([['docs/ledger.md', 'editing a ledger']]);
    expect(atomRefusals.join('\n')).toContain('the gate 2');
  });

  it('builds no gate from a label that gives no span', async () => {
    const { found, refusals } = await gates('Before editing a ledger: read `docs/ledger.md`.', []);
    expect(found).toEqual([]);
    expect(refusals.join('\n')).toContain('spans are a non-empty');
  });
});
