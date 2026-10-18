import { type BlockLink, parseSpecText, type Spec, specHash } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as writer from '../../src/blocks/writer';
import { generateSuite } from '../../src/enumerate/generate';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';
import { zedPrepared, zedProposal } from '../enumerate/support';
import { fixtureInputs, HAND_PATHS } from '../estate/support';

// Fictional data only: Zed Bank and the Northwind estate.

vi.mock('../../src/blocks/writer', async (original) => {
  const real = await original<typeof import('../../src/blocks/writer')>();
  return { ...real, writeBlocks: vi.fn(real.writeBlocks) };
});

const { linksOf, turnOfSource, writeBlocks } = writer;

function parsed(files: ReadonlyArray<{ path: string; text: string }>): Spec[] {
  return files
    .filter((file) => file.path.endsWith('.yaml'))
    .map((file) => {
      const loaded = parseSpecText(file.text, 'yaml', file.path);
      if (!loaded.ok) throw new Error(`${file.path}: ${JSON.stringify(loaded.errors)}`);
      return loaded.spec;
    });
}

const linksOfSpec = (spec: Spec): BlockLink[] => (spec.metadata?.links ?? []) as BlockLink[];
const blockLinks = (spec: Spec, block: string) => linksOfSpec(spec).filter((link) => link.block === block);

describe('the block writer', () => {
  it('writes each block as the generator gave it and its links: rules once each, the row, the turn', () => {
    const ask = { id: 'ask', when: { user: 'Hello' }, expect: { stage: 'verify' } };
    const next = { id: 'next', when: { user: 'Thanks' }, expect: {} };
    const written = writeBlocks(
      [
        {
          block: ask,
          origin: {
            rules: [
              { rule: 'instruction.standing.reply', ledger: 'abcdefghij' },
              { rule: 'instruction.standing.reply' },
            ],
            row: { id: 'p1', values: { session_state: 'fresh' } },
            turn: { conversation: 'weekly-clean', turn: 2 },
          },
        },
        { block: next, origin: { rules: [{ rule: 'flow=card' }], row: { id: 'p1', values: {} } } },
      ],
      'v1',
    );
    expect(written.blocks).toEqual([ask, next]);
    expect(written.blocks[0]).toBe(ask);
    expect(Object.keys(written.blocks[0] as object)).toEqual(['id', 'when', 'expect']);
    expect(written.links).toEqual([
      {
        block: 'ask',
        to: { kind: 'rule', rule: 'instruction.standing.reply', ledger: 'abcdefghij' },
        relation: 'verifies',
        status: 'declared',
        created_by: 'generator',
        at_version: 'v1',
      },
      {
        block: 'ask',
        to: { kind: 'plan_row', row: 'p1', values: { session_state: 'fresh' } },
        relation: 'derived_from',
        status: 'declared',
        created_by: 'generator',
        at_version: 'v1',
      },
      {
        block: 'ask',
        to: { kind: 'source_turn', conversation: 'weekly-clean', turn: 2 },
        relation: 'derived_from',
        status: 'declared',
        created_by: 'generator',
      },
      {
        block: 'next',
        to: { kind: 'rule', rule: 'flow=card' },
        relation: 'verifies',
        status: 'declared',
        created_by: 'generator',
        at_version: 'v1',
      },
      {
        block: 'next',
        to: { kind: 'plan_row', row: 'p1', values: {} },
        relation: 'derived_from',
        status: 'declared',
        created_by: 'generator',
        at_version: 'v1',
      },
    ]);
  });

  it('copies the row values, so a later change of the row does not move a written link', () => {
    const values = { channel: 'chat' };
    const [, row] = linksOf('b1', { rules: [{ rule: 'flow=card' }], row: { id: 'r', values } }, 'v');
    values.channel = 'email';
    expect(row?.to).toEqual({ kind: 'plan_row', row: 'r', values: { channel: 'chat' } });
  });

  it('reads a recorded turn only from the conversation#turn id of a kept user turn', () => {
    expect(turnOfSource('conv-0007#3')).toEqual({ conversation: 'conv-0007', turn: 3 });
    expect(turnOfSource('prompts/zed.md')).toBeUndefined();
    expect(turnOfSource('conv#x')).toBeUndefined();
    expect(turnOfSource('#3')).toBeUndefined();
    expect(turnOfSource('a b#3')).toBeUndefined();
    expect(turnOfSource(undefined)).toBeUndefined();
  });

  it('writes links the spec format accepts, outside the spec hash', () => {
    const text = [
      'id: zed-linked',
      'kind: conversation',
      'blocks:',
      '  - id: b1',
      '    when: { user: Hello }',
      '    expect: { stage: verify }',
    ].join('\n');
    const plain = parseSpecText(text, 'yaml', 'plain.yaml');
    const { links } = writeBlocks(
      [
        {
          block: { id: 'b1' },
          origin: {
            rules: [{ rule: 'flow=card', ledger: 'k2mz7q4wxa' }],
            row: { id: 'gen-twise-001', values: { flow: 'card' } },
            turn: { conversation: 'conv-0007', turn: 0 },
          },
        },
      ],
      'd9ebb9472c64',
    );
    const linked = parseSpecText(
      `${text}\nmetadata:\n  links: ${JSON.stringify(links)}\n`,
      'yaml',
      'linked.yaml',
    );
    if (!plain.ok || !linked.ok) throw new Error(JSON.stringify({ plain, linked }));
    expect(linksOfSpec(linked.spec)).toEqual(links);
    expect(specHash(linked.spec)).toBe(specHash(plain.spec));
  });

  it('refuses a rule or plan_row target with an unknown key or a missing field', () => {
    const base =
      'id: zed-bad\nkind: conversation\nblocks:\n  - id: b1\n    when: { user: Hi }\n    expect: { stage: verify }\n';
    const bad = [
      { block: 'b1', to: { kind: 'rule', rule: 'flow=card', extra: 1 }, status: 'declared' },
      { block: 'b1', to: { kind: 'rule' }, status: 'declared' },
      { block: 'b1', to: { kind: 'plan_row', row: 'r1' }, status: 'declared' },
      { block: 'b1', to: { kind: 'plan_row', row: 'r1', values: { flow: 3 } }, status: 'declared' },
    ];
    for (const link of bad) {
      const loaded = parseSpecText(
        `${base}metadata:\n  links: [${JSON.stringify(link)}]\n`,
        'yaml',
        'bad.yaml',
      );
      expect(loaded.ok, JSON.stringify(link)).toBe(false);
    }
  });
});

describe('one block writer for the prompt map and the estate map', () => {
  let estateInput: EstateGenerateInput;

  beforeAll(async () => {
    estateInput = await fixtureInputs();
  });

  it('writes every spec of both generators through writeBlocks, and its links are those it returned', () => {
    const spy = vi.mocked(writeBlocks);
    spy.mockClear();
    const prompt = generateSuite(zedPrepared(), { mapPath: '../map.yaml' });
    const promptSpecs = parsed(prompt.files);
    expect(spy).toHaveBeenCalledTimes(promptSpecs.length);
    const promptLinks = spy.mock.results.map((result) => (result.value as writer.WrittenBlocks).links);
    expect(promptSpecs.map(linksOfSpec)).toEqual(promptLinks);

    spy.mockClear();
    const estate = generateEstateSuite(estateInput, { paths: HAND_PATHS });
    const estateSpecs = parsed(estate.files);
    // Static tests are JSON records with no block; every spec file is written through the writer.
    expect(estateSpecs.length).toBe(estate.specs.filter((record) => record.path.endsWith('.yaml')).length);
    expect(spy).toHaveBeenCalledTimes(estateSpecs.length);
    const estateLinks = new Set(
      spy.mock.results.map((result) => JSON.stringify((result.value as writer.WrittenBlocks).links)),
    );
    for (const spec of estateSpecs)
      expect(estateLinks.has(JSON.stringify(linksOfSpec(spec))), spec.id).toBe(true);
  });

  it('prompt map: each block links the values it carries and its row with the cell, declared at the map hash', () => {
    const prepared = zedPrepared();
    const specs = parsed(generateSuite(prepared, { mapPath: '../map.yaml' }).files);
    expect(specs.length).toBeGreaterThan(10);
    for (const spec of specs) {
      const generated = spec.metadata?.generated as {
        cell: Record<string, string>;
        blocks: Array<{ block: string; cell: Record<string, string> }>;
        metamorphic?: { family: string };
      };
      for (const block of spec.blocks) {
        const mine = blockLinks(spec, block.id as string);
        const record = generated.blocks.find((entry) => entry.block === block.id);
        const { spec: _pointer, ...added } = record?.cell ?? {};
        const rules = mine.filter((link) => link.to.kind === 'rule');
        expect(rules.length, `${spec.id} ${block.id}`).toBeGreaterThan(0);
        for (const link of mine) {
          expect(link.status).toBe('declared');
          expect(link.created_by).toBe('generator');
        }
        const row = mine.filter((link) => link.to.kind === 'plan_row');
        expect(row).toHaveLength(1);
        expect(row[0]?.to).toEqual({
          kind: 'plan_row',
          row: generated.metamorphic?.family ?? spec.id,
          values: { ...generated.cell, ...added },
        });
        expect(row[0]?.at_version).toBe(prepared.hash);
        // Every value the block itself adds that is not its stage is a rule it tests.
        for (const [dimension, value] of Object.entries(added)) {
          if (dimension === 'stage') continue;
          expect(
            rules.map((link) => link.to),
            `${spec.id} ${block.id}`,
          ).toContainEqual({
            kind: 'rule',
            rule: `${dimension}=${value}`,
          });
        }
      }
    }
  });

  it('prompt map: the members of a metamorphic family share their row, so only the phrasing differs', () => {
    const specs = parsed(generateSuite(zedPrepared(), { mapPath: '../map.yaml' }).files);
    const family = specs.filter((spec) => spec.id.startsWith('gen-metamorphic-001-'));
    expect(family).toHaveLength(2);
    const rows = family.map((spec) => linksOfSpec(spec).filter((link) => link.to.kind === 'plan_row'));
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0]?.[0]?.to).toMatchObject({ row: 'gen-metamorphic-001' });
  });

  it('prompt map: a phrase copied from a kept conversation turn links that turn', () => {
    const proposal = zedProposal();
    const phrases = proposal.phrases.map((phrase) =>
      phrase.dimension === 'flow' && phrase.value === 'balance'
        ? { ...phrase, evidence: { source: 'conv-0042#1', quote: 'What is my balance?' } }
        : phrase,
    );
    const specs = parsed(generateSuite(zedPrepared({ phrases }), { mapPath: '../map.yaml' }).files);
    const turns = specs.flatMap((spec) =>
      spec.blocks.flatMap((block) =>
        'user' in block.when && block.when.user === 'What is my balance?'
          ? blockLinks(spec, block.id as string).filter((link) => link.to.kind === 'source_turn')
          : [],
      ),
    );
    expect(turns.length).toBeGreaterThan(0);
    for (const link of turns)
      expect(link.to).toEqual({ kind: 'source_turn', conversation: 'conv-0042', turn: 1 });
    const others = specs.flatMap((spec) =>
      spec.blocks.flatMap((block) =>
        'user' in block.when && block.when.user !== 'What is my balance?'
          ? blockLinks(spec, block.id as string).filter((link) => link.to.kind === 'source_turn')
          : [],
      ),
    );
    expect(others).toEqual([]);
  });

  it("estate map: each block links every atom of its row, the row with its cell, and a replay's session turn", () => {
    const result = generateEstateSuite(estateInput, { paths: HAND_PATHS });
    const specs = parsed(result.files);
    let replays = 0;
    for (const spec of specs) {
      const estate = spec.metadata?.estate as {
        atoms: string[];
        planRow: string;
        cell: Record<string, string>;
      };
      const replay = spec.metadata?.replay as { session: string; from_block: number } | undefined;
      spec.blocks.forEach((block, index) => {
        const mine = blockLinks(spec, block.id as string);
        expect(
          mine.filter((link) => link.to.kind === 'rule').map((link) => link.to),
          spec.id,
        ).toEqual(estate.atoms.map((rule) => ({ kind: 'rule', rule })));
        expect(mine.filter((link) => link.to.kind === 'plan_row').map((link) => link.to)).toEqual([
          { kind: 'plan_row', row: estate.planRow, values: estate.cell },
        ]);
        const turns = mine.filter((link) => link.to.kind === 'source_turn').map((link) => link.to);
        if (replay && index === 0) {
          replays++;
          expect(turns).toEqual([
            { kind: 'source_turn', conversation: replay.session, turn: replay.from_block },
          ]);
        } else expect(turns).toEqual([]);
        const negative = ['outside_trigger', 'route_near_miss', 'guard_negative'].includes(
          (spec.metadata?.estate as { testType: string }).testType,
        );
        for (const link of mine.filter((each) => each.to.kind === 'rule'))
          expect(link.relation, spec.id).toBe(negative ? 'exercises' : 'verifies');
        for (const link of mine) {
          expect(link.status).toBe('declared');
          if (link.to.kind !== 'source_turn') expect(link.at_version).toBe(spec.version);
        }
      });
    }
    expect(replays).toBeGreaterThan(0);
  });

  it('estate map: an atom the pointer reader built carries the ledger id of its unit; others carry none', () => {
    const input = structuredClone(estateInput);
    const instruction = input.map.atoms.find((atom) => atom.kind === 'instruction');
    if (!instruction) throw new Error('no instruction atom');
    instruction.fields = { ...instruction.fields, extraction: 'pointer', unit: 'q7c2m4xk9a' };
    const decoy = input.map.atoms.find((atom) => atom.kind === 'instruction' && atom !== instruction);
    if (decoy) decoy.fields = { ...decoy.fields, unit: 'notpointer' };
    const specs = parsed(generateEstateSuite(input, { paths: HAND_PATHS }).files);
    const rules = specs.flatMap((spec) =>
      linksOfSpec(spec).flatMap((link) => (link.to.kind === 'rule' ? [link.to] : [])),
    );
    const own = rules.filter((rule) => rule.rule === instruction.id);
    expect(own.length).toBeGreaterThan(0);
    for (const rule of own)
      expect(rule).toEqual({ kind: 'rule', rule: instruction.id, ledger: 'q7c2m4xk9a' });
    for (const rule of rules.filter((each) => each.rule !== instruction.id))
      expect(rule).not.toHaveProperty('ledger');
  });
});
