import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { ASK_VOICE_AXES } from '../../src/estate/generate-types';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

/**
 * The rules under test, stated over structure and not over any one estate:
 *
 *  1. An ask written by code is never cut from a unit's description. A description is written to the runtime's
 *     router, about the unit; an owner's request is a route's request cell. So a unit's task exists exactly when a
 *     route with a request cell (one not read from a description) is routed to it.
 *  2. A spec whose ask was written by code claims no more than its text says: the plan axes whose values only the
 *     words of an ask can carry (ASK_VOICE_AXES) that its row names are listed under `metadata.estate.unexpressed`,
 *     and the row's cell stays as it is. A spec asked by an approved phrase lists none.
 *
 * The expected values below follow from those two sentences, written before the product ran. The descriptions are
 * invented, in several voices and a second language, to show that no word is read.
 */

const DESCRIPTIONS = [
  'Keeps the berth ledger for the harbour office.',
  'Use when the user asks about berth fees at the harbour.',
  'Verwaltet die Liegeplatzliste des Hafens.',
  'berth ledger helper',
];
const REQUESTS = ['Add a late fee to the berth ledger', 'Close the quay for the night'];
const CELL = { ask_shape: 'correction', owner_signal: 'frustration' };

type Variant = {
  kind: 'skill' | 'subagent';
  description: string;
  /** A route with a request cell routed to the unit, or none. */
  request?: string;
  /** A route read from the description, with the description as its situation. */
  describedRoute: boolean;
  /** An approved phrase in the bank for the row. */
  phrase: boolean;
};

function build(variant: Variant, order: 'forward' | 'reversed' = 'forward') {
  const name = 'ledger';
  const unit: EstateAtom = {
    id: `${variant.kind}.${name}`,
    kind: variant.kind,
    title: name,
    approved: true,
    fields: { name, description: variant.description },
    provenance: {
      file: variant.kind === 'skill' ? `.claude/skills/${name}/SKILL.md` : `.claude/agents/${name}.md`,
      quote: variant.description,
    },
    evidence: [],
  };
  const reference: EstateAtom = {
    id: 'reference.ledger.fees',
    kind: 'reference',
    title: 'Read the fee table',
    approved: true,
    fields: { path: `.claude/skills/${name}/references/fees.md`, readWhen: 'When a fee is disputed' },
    provenance: { file: unit.provenance?.file, quote: 'See fees.md' },
    evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: 'fees.md' } } }],
  };
  const route = (id: string, fields: Record<string, unknown>, situation?: string): EstateAtom => ({
    id,
    kind: 'route',
    title: id,
    approved: true,
    fields,
    ...(situation ? { situation } : {}),
    evidence: [],
  });
  const routes: EstateAtom[] = [];
  if (variant.request) routes.push(route('route.ledger.request', { ask: variant.request, target: name }));
  if (variant.describedRoute)
    routes.push(
      route(
        'route.ledger.description',
        { via: 'description', target: name, targetKind: variant.kind },
        variant.description,
      ),
    );
  const atoms = order === 'forward' ? [unit, reference, ...routes] : [...routes, reference, unit].reverse();
  const edges = routes.map((each) => ({ from: each.id, to: unit.id, kind: 'route' }));
  const rowDef: EstatePlanRow = {
    id: 'read_when.fees',
    atomIds: [reference.id, unit.id],
    cell: { ...CELL },
    testType: 'read_when',
    mode: 'live',
    status: 'approved',
  };
  const map = { runtime: 'claude-code', hash: 'ledger', atoms, edges };
  const bank = PhraseBank.parse({
    version: 1,
    estate: 'ledger',
    mapHash: map.hash,
    situations: variant.phrase
      ? [
          {
            id: 'fees',
            title: 'A fee is disputed',
            use: 'trigger',
            atoms: [reference.id, unit.id],
            phrases: [{ text: 'Please check the disputed fee on this berth.', lang: 'en', approved: true }],
          },
        ]
      : [],
  });
  return generateEstateSuite(
    { map, plan: { mapHash: map.hash, rows: [rowDef] }, bank },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}

function specOf(suite: ReturnType<typeof build>) {
  const file = suite.files.find((entry) => entry.path.endsWith('.yaml'));
  const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const meta = parsed.spec.metadata?.estate as
    | { ask?: string; cell?: Record<string, string>; unexpressed?: string[] }
    | undefined;
  const when = parsed.spec.blocks[0]?.when;
  return {
    ask: when && 'user' in when ? when.user : undefined,
    meta,
    complete: suite.report.summary.complete,
  };
}

const variants: Variant[] = [];
for (const kind of ['skill', 'subagent'] as const)
  for (const description of DESCRIPTIONS)
    for (const request of [undefined, ...REQUESTS])
      for (const describedRoute of [true, false])
        for (const phrase of [false, true])
          variants.push({ kind, description, request, describedRoute, phrase });

describe('a code-written ask is made of a routed request, never of a description', () => {
  it('holds across kinds, description voices, requests, description routes and phrases', () => {
    for (const variant of variants) {
      const label = JSON.stringify(variant);
      const found = specOf(build(variant));
      if (variant.phrase) {
        // An approved phrase of the row's situation always wins, and a spec asked by one lists nothing unexpressed.
        expect(found.ask, label).toBe('Please check the disputed fee on this berth.');
        expect(found.meta?.ask, label).toBe('bank');
        expect(found.meta?.unexpressed, label).toBeUndefined();
        continue;
      }
      if (variant.request === undefined) {
        // No routed request: the description is not a task, so the row waits.
        expect(found.complete, label).toBe(0);
        continue;
      }
      expect(found.complete, label).toBe(1);
      expect(found.ask, label).toBe(`Please ${variant.request}.`);
      expect(found.ask?.includes(variant.description.replace(/\.$/, '')), label).toBe(false);
      expect(found.meta?.ask, label).toBe('code');
      // The claim stops where the text does: the row's cell is kept, the axes the words cannot carry are listed.
      expect(found.meta?.cell, label).toEqual(CELL);
      expect(found.meta?.unexpressed, label).toEqual([...ASK_VOICE_AXES]);
    }
  }, 120_000);

  it('lists only the voice axes a row names', () => {
    const variant: Variant = {
      kind: 'skill',
      description: DESCRIPTIONS[0] as string,
      request: REQUESTS[0],
      describedRoute: false,
      phrase: false,
    };
    const suite = build(variant);
    expect(specOf(suite).meta?.unexpressed).toEqual(['ask_shape', 'owner_signal']);
  });
});

describe('metamorphic: what must not change the specs, and what must', () => {
  const base: Variant = {
    kind: 'skill',
    description: DESCRIPTIONS[0] as string,
    request: REQUESTS[0],
    describedRoute: true,
    phrase: false,
  };
  const bytes = (suite: ReturnType<typeof build>) => suite.files.map((file) => `${file.path}\n${file.text}`);

  it('does not change when the description is rewritten, or when the atoms come in another order', () => {
    const reference = bytes(build(base));
    for (const description of DESCRIPTIONS.slice(1))
      expect(bytes(build({ ...base, description })), description).toEqual(reference);
    expect(bytes(build(base, 'reversed'))).toEqual(reference);
  });

  it('does not change when the unit is a helper rather than a skill, apart from its own name and place', () => {
    const skill = specOf(build(base));
    const helper = specOf(build({ ...base, kind: 'subagent' }));
    expect(helper.ask).toBe(skill.ask);
    expect(helper.meta?.unexpressed).toEqual(skill.meta?.unexpressed);
  });

  it('changes when the routed request is removed: the row waits for a phrase', () => {
    const before = specOf(build(base));
    const after = specOf(build({ ...base, request: undefined }));
    expect(before.complete).toBe(1);
    expect(after.complete).toBe(0);
  });

  it('changes when an approved phrase is added: the phrase is the ask and nothing is unexpressed', () => {
    const after = specOf(build({ ...base, phrase: true }));
    expect(after.meta?.ask).toBe('bank');
    expect(after.meta?.unexpressed).toBeUndefined();
  });

  it('changes when the request changes: the ask follows it', () => {
    expect(specOf(build({ ...base, request: REQUESTS[1] })).ask).toBe(`Please ${REQUESTS[1]}.`);
  });
});
