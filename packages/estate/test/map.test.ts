import { DeviationClass } from '@agent-nexus/driftbench-core';
import { NONE, validateSpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  approveAtoms,
  ClaudeCodeReader,
  ESTATE_AXES,
  EstateMap,
  parseEstateMapText,
  quoteDrift,
  renderEstateMap,
  scanEstate,
  toEstateSpaceMap,
} from '../src/index';
import { FIXTURE, NOW, scanFixture } from './support';

describe('the estate map file', () => {
  it('renders the same text for the same estate, answers and clock, and parses back to the same map', async () => {
    const first = renderEstateMap((await scanFixture()).map);
    const second = renderEstateMap((await scanFixture()).map);
    expect(second).toBe(first);
    expect(first.startsWith('# driftbench estate map (claude-code)')).toBe(true);
    const parsed = parseEstateMapText(first);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.map).toEqual(EstateMap.parse((await scanFixture()).map));
    expect(parsed.map.producedBy).toEqual({
      family: 'jev+anthropic',
      model: 'jev-latest+claude-haiku-5-5',
      at: '2026-10-11T00:00:00.000Z',
    });
  });

  it('refuses a map whose quote was edited, and accepts one whose approval was', async () => {
    const text = renderEstateMap((await scanFixture()).map);
    const quoteEdited = text.replace(
      'quote: "**R1.** Always answer in the language of the user\'s latest message."',
      'quote: "**R1.** Always answer in the language of the user\'s first message."',
    );
    expect(quoteEdited).not.toBe(text);
    const refused = parseEstateMapText(quoteEdited);
    expect(refused.ok ? [] : refused.errors.map((error) => [error.code, error.path])).toEqual([
      [
        'MAP_HASH',
        `atoms.${(await scanFixture()).map.atoms.findIndex((atom) => atom.id === 'register.standing.r1-always-answer-in-the-language')}.provenance`,
      ],
    ]);
    const flagged = text.replace(/approved: false/, 'approved: true');
    expect(parseEstateMapText(flagged).ok).toBe(true);
  });

  it('refuses an edge to an atom the map does not hold, and a duplicate atom id', async () => {
    const { map } = await scanFixture();
    const broken = {
      ...map,
      edges: [...map.edges, { from: 'skill.nowhere.x', to: map.atoms[0]?.id ?? '', kind: 'route' as const }],
    };
    const result = parseEstateMapText(renderEstateMap(broken));
    expect(result.ok ? [] : result.errors.map((error) => [error.code, error.path])).toEqual([
      ['MAP_UNKNOWN_ATOM', `edges.${map.edges.length}.from`],
    ]);
    const twice = { ...map, atoms: [...map.atoms, map.atoms[0] as (typeof map.atoms)[number]] };
    const doubled = parseEstateMapText(renderEstateMap(twice));
    expect(doubled.ok ? [] : doubled.errors.map((error) => error.code)).toContain('MAP_DUPLICATE_ATOM');
  });

  it('lists atoms whose quote moved or whose file is gone', async () => {
    const { map, raw } = await scanFixture();
    const texts = new Map(raw.files.map((file) => [file.path, file.text]));
    expect(quoteDrift(map.atoms, texts)).toEqual([]);
    texts.set(
      'CLAUDE.md',
      (texts.get('CLAUDE.md') ?? '').replace(
        "Always answer in the language of the user's latest message.",
        'Answer freely.',
      ),
    );
    texts.delete('.claude/agents/inbox-triager.md');
    const drift = quoteDrift(map.atoms, texts);
    expect(drift.map((issue) => issue.message.split(':')[0])).toEqual([
      'subagent.inbox-triager.helper-inbox-triager',
      'route.inbox-triager.an-ask-that-fits-inbox-triager',
      'instruction.inbox-triager.you-sort-messages-into-three-folders',
      'instruction.inbox-triager.a-message-that-fits-none-goes',
      'instruction.inbox-triager.never-answer-a-message-yourself-and',
      'register.standing.r1-always-answer-in-the-language',
    ]);
  });
});

describe('approval', () => {
  it('approves the atoms of a kind, keeps the header and touches nothing else', async () => {
    const text = renderEstateMap((await scanFixture()).map);
    const result = approveAtoms(text, { kinds: ['register'] });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.approved).toHaveLength(14);
    expect(result.already).toBe(0);
    expect(result.text.split('\n').slice(0, 6)).toEqual(text.split('\n').slice(0, 6));
    const parsed = parseEstateMapText(result.text);
    if (!parsed.ok) throw new Error('invalid');
    const pending = parsed.map.atoms.filter((atom) => !atom.approved);
    expect(new Set(pending.map((atom) => atom.kind))).toEqual(
      new Set(['instruction', 'gate', 'reference', 'hazard', 'route']),
    );
    expect(pending).toHaveLength(55);
  });

  it('approves named atoms, or all, and counts what was already approved', async () => {
    const text = renderEstateMap((await scanFixture()).map);
    const one = approveAtoms(text, { ids: ['gate.standing.read-before-edit-it'] });
    expect(one.ok ? one.approved : []).toEqual(['gate.standing.read-before-edit-it']);
    const all = approveAtoms(one.ok ? one.text : text, { all: true });
    expect(all.ok ? [all.approved.length, all.already] : []).toEqual([68, 48]);
  });

  it('refuses an unknown kind or atom, and approves nothing', async () => {
    const text = renderEstateMap((await scanFixture()).map);
    const result = approveAtoms(text, { kinds: ['rule'], ids: ['nope'] });
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual([
      'MAP_UNKNOWN_KIND',
      'MAP_UNKNOWN_ATOM',
    ]);
  });
});

describe('the space map of an estate', () => {
  it('exports the situation axes and the approved axis atoms by kind, and validates', async () => {
    const { map } = await scanFixture();
    const space = toEstateSpaceMap(map, { agent: 'northwind' });
    expect(validateSpaceMap(space).ok).toBe(true);
    expect(space.dimensions.map((dimension) => dimension.id)).toEqual([
      'ask_class',
      'ask_shape',
      'session_state',
      'owner_signal',
      'deviation',
      'estate_hazard',
      'atoms.route',
      'atoms.skill',
      'atoms.subagent',
      'atoms.guard',
      'atoms.stage',
    ]);
    expect(
      space.dimensions.find((dimension) => dimension.id === 'deviation')?.values.map((value) => value.id),
    ).toEqual([NONE, ...DeviationClass.options]);
    expect(space.constraints).toHaveLength(3);
    expect(space.version).toBe(map.hash.slice(0, 12));
  });

  it('takes the model atoms once approved, or with approvedOnly false, and never a detail atom', async () => {
    const { map } = await scanFixture();
    const all = toEstateSpaceMap(map, { approvedOnly: false });
    expect(validateSpaceMap(all).ok).toBe(true);
    const sizes = Object.fromEntries(
      all.dimensions.slice(ESTATE_AXES.length).map((d) => [d.id, d.values.length]),
    );
    expect(sizes).toEqual({
      'atoms.instruction': 31,
      'atoms.gate': 6,
      'atoms.route': 13,
      'atoms.skill': 4,
      'atoms.subagent': 3,
      'atoms.guard': 6,
      'atoms.stage': 5,
      'atoms.register': 14,
    });
  });

  it('keeps a code-only scan valid as a space map', async () => {
    const { map } = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    expect(validateSpaceMap(toEstateSpaceMap(map)).ok).toBe(true);
  });
});
