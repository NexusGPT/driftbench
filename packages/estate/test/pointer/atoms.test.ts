import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  loadEstateMap,
  parseEstateMapText,
  pointer,
  renderEstateMap,
  scanEstate,
} from '../../src/index';
import { AtomBuilder } from '../../src/scan';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

// An invented harbour office: nothing here names a real estate.
const FILES = {
  'CLAUDE.md': [
    '# Harbour office',
    '',
    'Read `.claude/skills/moorings/SKILL.md` when a boat arrives.',
    '',
    '- Hang the lamp before dusk',
    "- Reply in the skipper's language",
    '- Never leave the gate open',
    '- On foggy nights only',
    '- And never in a gale',
    '',
  ].join('\n'),
  '.claude/skills/moorings/SKILL.md': [
    '---',
    'name: moorings',
    'description: Tie up a boat at the right quay.',
    '---',
    '',
    '# Moorings',
    '',
    'Check the tide table. Then tie the bow line first.',
    '',
  ].join('\n'),
};

const SETS = `labels:
  - set: duty
    description: What the harbour notes ask of a reader.
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: ban
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: pair
        description: A unit that sets one act before another.
        target: required
        atom: { kind: gate }
      - name: wording
        description: A unit that sets how the reader replies.
        atom: { kind: register }
      - name: weather
        description: A unit that only describes the sea.
        atom: { kind: tool }
      - name: remark
        description: A unit that states how things are.
      - name: when
        description: A unit that states when another unit applies.
        target: required
        condition: true
`;

function setsOf(text = SETS) {
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

/** A labeler that says what a table says, window by window; a unit it does not name is none. */
function table(rows: Record<string, pointer.Labelled[]>): pointer.Labeler {
  return plantedDense(
    (window) => rows[window.path] ?? [{ units: `1-${window.units.length}`, label: 'none' }],
  );
}

async function scan(
  rows: Record<string, pointer.Labelled[]>,
  over: Partial<pointer.PointerInput> = {},
  files: Record<string, string> = FILES,
) {
  const root = await estate(files);
  const cassette = new pointer.Cassette();
  const result = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: setsOf(),
      labelling: pointer.singleLabelling(table(rows)),
      cassette,
      mode: 'record',
      ...over,
    },
  });
  return { root, result, cassette };
}

describe('atoms from labels', () => {
  it('builds each atom from the file itself, with the kind and polarity of its label', async () => {
    // Units of CLAUDE.md: 1 heading, 2 sentence, 3-5 items (lamp, language, gate).
    const { result, root } = await scan({
      'CLAUDE.md': [
        { units: '3', label: 'order' },
        { units: '4', label: 'wording' },
        { units: '5', label: 'ban' },
        { units: '1-2', label: 'remark' },
      ],
    });
    const mine = result.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
    expect(mine.map((atom) => [atom.kind, atom.fields?.polarity, atom.provenance.quote])).toEqual([
      ['instruction', 'obligation', 'Hang the lamp before dusk'],
      ['register', undefined, "Reply in the skipper's language"],
      ['instruction', 'prohibition', 'Never leave the gate open'],
    ]);
    const text = (await import('node:fs/promises')).readFile;
    const file = await text(`${root}/CLAUDE.md`, 'utf8');
    for (const atom of mine) {
      expect(file).toContain(atom.provenance.quote);
      expect(atom.producedBy).toBe('model');
      expect(atom.approved).toBe(false);
      expect(atom.evidence).toEqual([
        {
          type: 'custom',
          name: 'prose_pointer',
          options: { reviewRequired: true, unit: atom.fields?.unit, set: 'duty', label: expect.any(String) },
        },
      ]);
      expect(atom.fields).toMatchObject({ labelSet: 'duty', labeler: 'planted' });
    }
    expect(result.map.producedBy).toMatchObject({ family: 'planted', model: 'planted-1' });
  });

  it('writes the lines of the unit, not of the file', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
    const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
    expect(atom?.provenance).toMatchObject({ file: 'CLAUDE.md', startLine: 5, endLine: 5 });
  });

  it('puts a gate over both units, in file order', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'pair', target: 5 }] });
    const atom = result.map.atoms.find(
      (candidate) => candidate.kind === 'gate' && candidate.fields?.extraction === 'pointer',
    );
    expect(atom?.provenance.quote).toBe(
      "Hang the lamp before dusk\n- Reply in the skipper's language\n- Never leave the gate open",
    );
    expect(atom?.provenance.startLine).toBe(5);
    expect(atom?.provenance.endLine).toBe(7);
  });

  it('refuses a label that maps to a kind a pointer cannot build, and lists it', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'weather' }] });
    expect(result.pointer?.atomRefusals).toEqual([
      expect.stringContaining('the label weather maps to the atom kind tool, which a pointer cannot build'),
    ]);
    expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
  });

  it('skips a unit code already read as an atom of that kind, and lists the repeat', () => {
    const text = FILES['CLAUDE.md'];
    const builder = new AtomBuilder(
      new Map([['CLAUDE.md', { path: 'CLAUDE.md', kind: 'standing' as const, text }]]),
    );
    const quote = 'Hang the lamp before dusk';
    builder.add({
      kind: 'instruction',
      title: 'Lamp',
      at: { file: 'CLAUDE.md', startLine: 5, endLine: 5, quote },
      evidence: [{ type: 'text', must: ['lamp'], mustNot: [] }],
    });
    const unit = pointer.cut(text).units.find((candidate) => candidate.text === quote);
    if (!unit) throw new Error('the unit is missing');
    const set = setsOf()[0] as pointer.LabelSet;
    const made = pointer.pointerAtoms(
      [{ path: 'CLAUDE.md', index: 0, unit, id: 'abcdefghij', set, label: 'order', source: 'cassette:x' }],
      new Map([['CLAUDE.md', text]]),
      builder,
      'planted',
    );
    expect(made.accepted).toEqual([]);
    expect(made.duplicates).toHaveLength(1);
  });

  it('gives a label with no atom mapping a ledger entry and no atom', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '1-5', label: 'remark' }] });
    expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
    const labelled = result.pointer?.ledger.entries.filter((entry) => entry.labels.duty?.label === 'remark');
    expect(labelled?.length).toBe(5);
  });

  it('keeps a map the loader accepts, and waits for a person to approve', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
    const parsed = parseEstateMapText(renderEstateMap(result.map));
    expect(parsed.ok).toBe(true);
    expect(
      result.map.atoms
        .filter((atom) => atom.fields?.extraction === 'pointer')
        .every((atom) => !atom.approved),
    ).toBe(true);
    expect(loadEstateMap).toBeDefined();
  });

  it('reads no prose with the model port when the pointer reader runs', async () => {
    const { result } = await scan({});
    expect(result.chunks).toEqual([]);
    expect(result.pointer?.windows).toBeGreaterThan(0);
  });

  describe('conditions', () => {
    // Units of CLAUDE.md: 1 heading, 2 sentence, 3-5 items (lamp, language, gate), 6-7 items (fog, gale).
    it('puts the unit a condition label points from into the situation of the atom of its target', async () => {
      const { result } = await scan({
        'CLAUDE.md': [
          { units: '3', label: 'order' },
          { units: '6', label: 'when', target: 3 },
        ],
      });
      const mine = result.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
      expect(mine).toHaveLength(1);
      const atom = mine[0] as (typeof mine)[number];
      // The quote stays the rule; the condition is the situation, and neither is a word of the labeler.
      expect(atom.provenance.quote).toBe('Hang the lamp before dusk');
      expect(atom.situation).toBe('On foggy nights only');
      const units = result.pointer?.ledger.entries.filter((entry) => entry.quote === 'On foggy nights only');
      expect(atom.fields?.condition).toEqual([units?.[0]?.id]);
      expect(atom.evidence).toEqual([
        {
          type: 'custom',
          name: 'prose_pointer',
          options: {
            reviewRequired: true,
            unit: atom.fields?.unit,
            set: 'duty',
            label: 'order',
            condition: [units?.[0]?.id],
          },
        },
      ]);
    });

    it('builds no atom of its own from a condition', async () => {
      const { result } = await scan({
        'CLAUDE.md': [
          { units: '3', label: 'order' },
          { units: '6', label: 'when', target: 3 },
        ],
      });
      expect(result.map.atoms.filter((atom) => atom.fields?.label === 'when')).toEqual([]);
    });

    it('joins several conditions of one target in file order', async () => {
      const { result } = await scan({
        'CLAUDE.md': [
          { units: '3', label: 'order' },
          { units: '7', label: 'when', target: 3 },
          { units: '6', label: 'when', target: 3 },
        ],
      });
      const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
      expect(atom?.situation).toBe('On foggy nights only And never in a gale');
    });

    it('gives a gate the condition of its first unit', async () => {
      const { result } = await scan({
        'CLAUDE.md': [
          { units: '3', label: 'pair', target: 5 },
          { units: '6', label: 'when', target: 3 },
        ],
      });
      const atom = result.map.atoms.find((candidate) => candidate.kind === 'gate');
      expect(atom?.situation).toBe('On foggy nights only');
    });

    it('lists a condition whose target holds no atom, and builds nothing from it', async () => {
      const { result } = await scan({
        'CLAUDE.md': [
          { units: '2', label: 'remark' },
          { units: '6', label: 'when', target: 2 },
        ],
      });
      expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
      expect(result.pointer?.atomRefusals).toEqual([
        expect.stringContaining('the condition points at a unit that holds no atom'),
      ]);
    });

    it('leaves an atom without a situation when no condition points at it', async () => {
      const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
      const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
      expect(atom?.situation).toBeUndefined();
      expect(atom?.fields).not.toHaveProperty('condition');
    });
  });

  describe('spans and links', () => {
    const SPANNED = `labels:
  - set: duty
    description: What the harbour notes ask of a reader.
    spans:
      - { name: act, description: the clause that says what the reader does, polarity: true }
      - { name: when, description: the clause that says when }
    links:
      - { name: topic, description: the skill this unit is about, to: [skill] }
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        spans: [act, when]
        links: [topic]
        atom: { kind: instruction, polarity: obligation }
      - name: pair
        description: A unit that sets one act before another.
        target: required
        spans: [act]
        atom: { kind: gate }
`;
    const SKILL = 'skill.moorings.skill-moorings';
    const spanned = (rows: Record<string, pointer.Labelled[]>) => scan(rows, { sets: setsOf(SPANNED) });

    it('keeps the spans as offsets into the quote of the atom, each an exact slice of the file', async () => {
      // Unit 3 is "Hang the lamp before dusk": the act is "Hang the lamp", the time "before dusk".
      const { result } = await spanned({
        'CLAUDE.md': [
          {
            units: '3',
            label: 'order',
            spans: [
              { kind: 'act', from: 0, to: 13, polarity: 'obligation' },
              { kind: 'when', from: 14, to: 25 },
            ],
            links: [{ kind: 'topic', to: SKILL }],
          },
        ],
      });
      const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
      const quote = atom?.provenance.quote ?? '';
      const kept = atom?.fields?.labelSpans as Array<{ kind: string; from: number; to: number }>;
      expect(kept.map((span) => [span.kind, quote.slice(span.from, span.to)])).toEqual([
        ['act', 'Hang the lamp'],
        ['when', 'before dusk'],
      ]);
      expect(kept[0]).toMatchObject({ polarity: 'obligation' });
      expect(atom?.fields?.labelLinks).toEqual([{ kind: 'topic', atom: SKILL }]);
      // The name that the code reader gives backticked strings is untouched.
      expect(atom?.fields).not.toHaveProperty('spans');
    });

    it('offsets the spans of the first unit of a gate into the quote that covers both units', async () => {
      const { result } = await spanned({
        'CLAUDE.md': [{ units: '4', label: 'pair', target: 5, spans: [{ kind: 'act', from: 0, to: 5 }] }],
      });
      const gate = result.map.atoms.find((candidate) => candidate.kind === 'gate');
      const spans = gate?.fields?.labelSpans as Array<{ from: number; to: number }> | undefined;
      const span = spans?.[0];
      expect(gate?.provenance.quote.slice(span?.from, span?.to)).toBe('Reply');
    });

    it('gives an atom no field when the unit carries neither spans nor links', async () => {
      const { result } = await spanned({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
      const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
      expect(atom?.fields).not.toHaveProperty('labelSpans');
      expect(atom?.fields).not.toHaveProperty('labelLinks');
    });

    it('refuses an entry whose link names an atom the request did not list, and labels no atom from it', async () => {
      const { result } = await spanned({
        'CLAUDE.md': [{ units: '3', label: 'order', links: [{ kind: 'topic', to: 'skill.zzz.nothing' }] }],
      });
      expect(result.pointer?.refusals).toEqual([
        expect.stringContaining('is not an atom the request listed for topic'),
      ]);
      expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
    });

    it('keeps the spans in the ledger with the label, and replays them from the cassette', async () => {
      const rows = {
        'CLAUDE.md': [{ units: '3', label: 'order', spans: [{ kind: 'act', from: 0, to: 13 }] }],
      };
      const { result, cassette } = await spanned(rows);
      const entry = result.pointer?.ledger.entries.find(
        (candidate) => candidate.quote === 'Hang the lamp before dusk',
      );
      expect(entry?.labels.duty?.spans).toEqual([{ kind: 'act', from: 0, to: 13 }]);
      const replay = await scanEstate({
        root: await estate(FILES),
        reader: new ClaudeCodeReader(),
        now: NOW,
        pointer: {
          sets: setsOf(SPANNED),
          labelling: pointer.singleLabelling(table({})),
          cassette: pointer.Cassette.parse(cassette.render()),
          mode: 'replay',
        },
      });
      const atom = replay.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
      expect(atom?.fields?.labelSpans).toEqual([{ kind: 'act', from: 0, to: 13 }]);
    });
  });
});

describe('the condition label of the shipped set', () => {
  const FOG = {
    'CLAUDE.md': [
      '# Harbour office',
      '',
      '- Hang the lamp before dusk',
      '- On foggy nights only',
      '- Close the gate at night',
      '',
    ].join('\n'),
  };
  const shipped = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  const sets = shipped.ok ? shipped.sets : [];

  it('has a condition label that points at the unit it scopes, and builds no atom of its own', () => {
    const label = sets[0]?.labels.find((candidate) => candidate.condition);
    expect(label?.name).toBe('condition');
    expect(label?.target).toBe('required');
    expect(label?.atom).toBeUndefined();
  });

  it('gives the unit it points at its situation, from planted condition units', async () => {
    // Units of CLAUDE.md: 1 heading, 2-4 items (lamp, fog, gate).
    const { result } = await scan(
      {
        'CLAUDE.md': [
          { units: '2', label: 'rule' },
          { units: '3', label: 'condition', target: 2 },
          { units: '4', label: 'rule' },
        ],
      },
      { sets },
      FOG,
    );
    const lamp = result.map.atoms.find((atom) => atom.provenance.quote === 'Hang the lamp before dusk');
    const gate = result.map.atoms.find((atom) => atom.provenance.quote === 'Close the gate at night');
    expect(lamp?.situation).toBe('On foggy nights only');
    expect(gate?.situation).toBeUndefined();
    expect(result.map.atoms.some((atom) => atom.provenance.quote === 'On foggy nights only')).toBe(false);
  });

  it('lets only system 2 answer it: a yes or no model is not asked about a label with a target', () => {
    const asked = pointer.askedLabels(sets[0] as pointer.LabelSet, true).map((label) => label.name);
    expect(asked).not.toContain('condition');
  });

  it('changes the hash of the set, so an older cassette misses', async () => {
    const without = pointer.parseLabelSets(
      pointer.AGENT_RULES_SET.replace(/ {6}- name: condition[\s\S]*?(?= {6}- name: example)/, ''),
    );
    expect(without.ok && without.sets[0] ? pointer.setHash(without.sets[0]) : '').not.toBe(
      pointer.setHash(sets[0] as pointer.LabelSet),
    );
    const { cassette } = await scan({ 'CLAUDE.md': [{ units: '2', label: 'rule' }] }, { sets }, FOG);
    const older = without.ok ? without.sets : [];
    await expect(
      scan({ 'CLAUDE.md': [{ units: '2', label: 'rule' }] }, { sets: older, cassette, mode: 'replay' }, FOG),
    ).rejects.toThrow(/differs in: .*setHash/);
  });
});
