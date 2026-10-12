import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import type { Proposal, ProposalPhrase, ProposalRelation } from '../../src/extract/proposal';
import type { Pick } from '../../src/seed/assemble';
import { TOOL_FAILURE_ERROR } from '../../src/seed/deviation';
import { type PreparedMap, prepareMap, type ToolSchema } from '../../src/seed/map';
import { rngFor } from '../../src/seed/random';
import { fillText, recoveryFor } from '../../src/seed/relations';
import { buildScenario } from '../../src/seed/scenario';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

/**
 * The scenario builder on a small fictional map: the Zed Bank balance flow passes greet, verify and help;
 * the lookup tool is called at verify with the account the cell binds; an unknown account keeps the
 * conversation at verify. Every Then below comes from the relations; nothing reads an agent.
 */

const evidence = { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' };
const by = { evidence, produced_by: 'model' as const, approved: true };

function phrase(
  dimension: string,
  value: string,
  text: string,
  extra: Partial<ProposalPhrase> = {},
): ProposalPhrase {
  return { dimension, value, text, lang: 'en', produced_by: 'model', approved: true, ...extra };
}

const TOOLS: ToolSchema[] = [
  ...ZED_TOOLS,
  { name: 'notify', slug: 'notify', input: { type: 'object', properties: { reason: { type: 'string' } } } },
];

function relations(): ProposalRelation[] {
  return [
    {
      kind: 'path',
      id: 'balance-found',
      flow: 'balance',
      when: { account_state: ['found'] },
      stages: ['greet', 'verify', 'help'],
      end_state: { source: 'tool:lookup', mode: 'subset', expect: { account: '{account}' } },
      ...by,
    },
    {
      kind: 'path',
      id: 'balance-missing',
      flow: 'balance',
      when: { account_state: ['missing'] },
      stages: ['greet', 'verify', 'verify'],
      ...by,
    },
    { kind: 'path', id: 'card-lost', flow: 'card', stages: ['greet', 'lost'], ...by },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool: 'lookup',
      stage: 'verify',
      input: { account: '{account}' },
      ...by,
    },
    {
      kind: 'binds',
      subject: { dimension: 'account_state', value: 'found' },
      slots: { account: '4' },
      ...by,
    },
    {
      kind: 'binds',
      subject: { dimension: 'account_state', value: 'missing' },
      slots: { account: '9' },
      ...by,
    },
    {
      kind: 'recovery',
      class: 'D1_off_topic',
      flows: ['balance'],
      stage_after: 'pending',
      must: ['open {day}', 'a.b'],
      ...by,
    },
    {
      kind: 'recovery',
      class: 'D8_tool_failure',
      flows: ['balance'],
      tool: 'lookup',
      stage_after: 'verify',
      tools: [{ tool: 'lookup', count: 2 }],
      ...by,
    },
    { kind: 'reply_language', subject: { dimension: 'rule', value: 'english-only' }, lang: 'en', ...by },
  ];
}

function proposal(change: (draft: Proposal) => void = () => {}): Proposal {
  const base = zedProposal({
    phrases: [
      phrase('stage_transition', 'greet-to-verify', 'Hi, I need help with my account.'),
      phrase('stage_transition', 'verify-to-help', 'My account number is {account}.'),
      phrase('stage_transition', 'verify-to-verify', 'It is account {account}.'),
      phrase('deviation', 'D1_off_topic', 'Are you open on Sunday?', {
        when: { stage: ['verify'] },
        binds: { day: 'Sunday' },
      }),
      phrase('deviation', 'D5_language_switch', 'Hallo, kunt u mij helpen?', { lang: 'nl' }),
    ],
    extra: [
      {
        id: 'account_state',
        title: 'What the lookup finds',
        kind: 'data',
        role: 'detail',
        produced_by: 'model',
        approved: true,
        values: [
          { id: 'found', title: 'An account', evidence, produced_by: 'model' },
          { id: 'missing', title: 'No account', evidence, produced_by: 'model' },
        ],
      },
      {
        id: 'rule',
        title: 'Rules',
        kind: 'behaviour',
        role: 'detail',
        produced_by: 'model',
        approved: true,
        values: [{ id: 'english-only', title: 'English only', evidence, produced_by: 'model' }],
      },
    ],
  });
  base.relations = relations();
  change(base);
  return base;
}

const prepare = (change?: (draft: Proposal) => void): PreparedMap =>
  prepareMap(proposal(change), { tools: TOOLS });

function path(prepared: PreparedMap, id: string) {
  const found = prepared.relations.paths.find((entry) => entry.id === id);
  if (!found) throw new Error(`no path ${id}`);
  return found;
}

function pickOf(prepared: PreparedMap, dimension: string, value: string): Pick {
  const index = prepared.space.dimensions.findIndex((entry) => entry.id === dimension);
  return [index, prepared.space.dimensions[index]?.index.get(value) ?? -1];
}

const texts = (blocks: Array<{ stimulus: { kind: string; phrase?: { text: string } } }>) =>
  blocks.map((block) => (block.stimulus.kind === 'phrase' ? block.stimulus.phrase?.text : '(placeholder)'));

describe('buildScenario', () => {
  it('walks the path: each block expects the next stage, the call the map links to it with its input filled', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(texts(built.blocks)).toEqual(['Hi, I need help with my account.', 'My account number is 4.']);
    expect(built.blocks.map((block) => block.stage)).toEqual(['verify', 'help']);
    expect(built.blocks.map((block) => block.tools)).toEqual([
      [{ label: 'lookup', count: 0 }],
      [{ label: 'lookup', count: 1, input: { account: '4' } }],
    ]);
    expect(built.blocks.every((block) => block.lang === 'EN')).toBe(true);
    expect(built.endState).toEqual({ source: 'tool:lookup', mode: 'subset', expect: { account: '4' } });
    expect(built.rules).toEqual({ forbidden_tools: ['notify'] });
    // The path's when chose the data value; the block that reads its slot records it.
    const cell = Object.fromEntries(
      built.cell.map(([d, v]) => [
        prepared.space.dimensions[d]?.id,
        prepared.space.dimensions[d]?.values[v]?.id,
      ]),
    );
    expect(cell).toMatchObject({ flow: 'balance', account_state: 'found' });
    expect(built.blocks[1]?.carries.map(([d]) => prepared.space.dimensions[d]?.id)).toEqual([
      'stage_transition',
      'account_state',
    ]);
  });

  it('takes the branch the cell holds, and refuses a path whose when the cell contradicts', () => {
    const prepared = prepare();
    const missing = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-missing'),
      fixed: [pickOf(prepared, 'account_state', 'missing')],
    });
    if (!missing.ok) throw new Error(missing.reason);
    expect(texts(missing.blocks)).toEqual(['Hi, I need help with my account.', 'It is account 9.']);
    expect(missing.blocks.map((block) => block.stage)).toEqual(['verify', 'verify']);
    expect(missing.endState).toBeUndefined();

    const refused = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [pickOf(prepared, 'account_state', 'missing')],
    });
    expect(refused).toEqual({
      ok: false,
      reason: 'path balance-found: it needs account_state in found; the cell holds missing',
    });
  });

  it('refuses a path the constraints forbid, a stage pair with no transition, and an unbound slot', () => {
    const prepared = prepare();
    expect(
      buildScenario(prepared, rngFor(1, 't'), {
        path: path(prepared, 'card-lost'),
        fixed: [pickOf(prepared, 'channel', 'email')],
      }),
    ).toEqual({ ok: false, reason: 'path card-lost: the constraints forbid its values with this cell' });
    expect(buildScenario(prepared, rngFor(1, 't'), { path: path(prepared, 'card-lost'), fixed: [] })).toEqual(
      {
        ok: false,
        reason: 'path card-lost: the map has no stage transition greet-to-lost',
      },
    );
    const unbound = prepare((draft) => {
      draft.relations = draft.relations?.filter((relation) => relation.kind !== 'binds');
    });
    const built = buildScenario(unbound, rngFor(1, 't'), { path: path(unbound, 'balance-found'), fixed: [] });
    expect(built.ok).toBe(false);
    if (!built.ok)
      expect(built.reason).toBe('path balance-found: lookup at verify reads unbound slots account');
  });

  it('writes a placeholder when no approved phrase fits, so the spec stays incomplete', () => {
    const prepared = prepare((draft) => {
      draft.phrases = draft.phrases.filter((entry) => entry.value !== 'verify-to-help');
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks[1]?.stimulus).toEqual({
      kind: 'placeholder',
      dimension: 'stage_transition',
      value: 'verify-to-help',
    });
  });

  it('injects a probe at a stage its phrase fits, with the recovery the map states', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D1_off_topic' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.probe).toEqual({ classId: 'D1_off_topic', stage: 'verify' });
    const probe = built.blocks[1];
    expect(probe).toMatchObject({
      id: 'b2-D1_off_topic',
      injection: 'D1_off_topic',
      stage: 'verify',
      tools: [{ label: 'lookup', count: 0 }],
      lang: 'EN',
      // The slot the phrase binds fills the pattern, as a literal; the pattern's own regex stays.
      must: ['open Sunday', 'a.b'],
    });
    expect(built.blocks.map((block) => block.stage)).toEqual(['verify', 'verify', 'help']);
    expect(built.endState).toBeDefined();
  });

  it('refuses a probe the map gives no recovery for, or no phrase at a stage it allows', () => {
    const prepared = prepare();
    expect(
      buildScenario(prepared, rngFor(1, 't'), {
        path: path(prepared, 'balance-found'),
        fixed: [],
        probe: { classId: 'D5_language_switch' },
      }),
    ).toEqual({
      ok: false,
      reason: 'path balance-found: the map gives no recovery from D5_language_switch in the flow balance',
    });
    expect(
      buildScenario(prepared, rngFor(1, 't'), {
        path: path(prepared, 'balance-found'),
        fixed: [],
        probe: { classId: 'D1_off_topic', stage: 'greet' },
      }),
    ).toEqual({
      ok: false,
      reason:
        'path balance-found: no stage of the path takes D1_off_topic: none its recovery allows has an approved phrase',
    });
  });

  it('fails a tool in the Given of the turn that calls it, expects the recovery, and stops there', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D8_tool_failure' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks).toHaveLength(2);
    expect(built.blocks[1]).toMatchObject({
      id: 'b2-D8_tool_failure',
      injection: 'D8_tool_failure',
      stage: 'verify',
      given: { world: { tools: { lookup: { error: TOOL_FAILURE_ERROR } } } },
      // The agent sends the same arguments to a failing tool: the input assertion stays.
      tools: [{ label: 'lookup', count: 2, input: { account: '4' } }],
    });
    expect(built.endState).toBeUndefined();
    expect(built.probe).toEqual({ classId: 'D8_tool_failure', stage: 'verify', tool: 'lookup' });
  });

  it('stops the conversation at the failing turn, and expects no call after the failing tool in it', () => {
    const prepared = prepare((draft) => {
      draft.phrases.push(phrase('stage_transition', 'help-to-verify', 'One more question about {account}.'));
      draft.relations?.push(
        {
          kind: 'path',
          id: 'balance-again',
          flow: 'balance',
          when: { account_state: ['found'] },
          stages: ['greet', 'verify', 'help', 'verify'],
          ...by,
        },
        {
          kind: 'uses_tool',
          subject: { dimension: 'flow', value: 'balance' },
          tool: 'notify',
          stage: 'verify',
          to: 'help',
          input: { reason: 'checked' },
          ...by,
        },
      );
    });
    const walked = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-again'),
      fixed: [],
    });
    if (!walked.ok) throw new Error(walked.reason);
    expect(walked.blocks.map((block) => block.stage)).toEqual(['verify', 'help', 'verify']);
    expect(walked.blocks[1]?.tools).toEqual([
      { label: 'lookup', count: 1, input: { account: '4' } },
      { label: 'notify', count: 1, input: { reason: 'checked' } },
    ]);
    const failed = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-again'),
      fixed: [],
      probe: { classId: 'D8_tool_failure' },
    });
    if (!failed.ok) throw new Error(failed.reason);
    // The lookup fails at verify: the turn never reaches notify, and the third turn is never said.
    expect(failed.blocks).toHaveLength(2);
    expect(failed.blocks[1]?.tools).toEqual([
      { label: 'lookup', count: 2, input: { account: '4' } },
      { label: 'notify', count: 0 },
    ]);
  });

  it('forces one phrasing where its value is said, and draws everything else the same', () => {
    const prepared = prepare((draft) => {
      draft.phrases.push(phrase('stage_transition', 'greet-to-verify', 'Hello, my account please.'));
    });
    const forced = prepared.phrases.find((entry) => entry.text === 'Hello, my account please.');
    const a = buildScenario(prepared, rngFor(1, 'family'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      ...(forced ? { force: forced } : {}),
    });
    const b = buildScenario(prepared, rngFor(1, 'family'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      ...(forced ? { force: forced } : {}),
    });
    if (!a.ok || !b.ok) throw new Error('unbuilt');
    expect(texts(a.blocks)[0]).toBe('Hello, my account please.');
    expect(a).toEqual(b);
  });
});

describe('relations helpers', () => {
  it('fills slots, as literal patterns when asked, and names the missing ones', () => {
    expect(fillText('It is {account}.', { account: '4' })).toEqual({ ok: true, value: 'It is 4.' });
    expect(fillText('{plan}', { plan: 'Acme Air 5G (new)' }, true)).toEqual({
      ok: true,
      value: 'Acme Air 5G \\(new\\)',
    });
    expect(fillText('{a} and {b} and {a}', {})).toEqual({ ok: false, missing: ['a', 'b'] });
    expect(fillText('ORD-[0-9A-F]{6}', {})).toEqual({ ok: true, value: 'ORD-[0-9A-F]{6}' });
  });

  it('merges every recovery entry of a class in a flow: the first stage after, the probe stages they share', () => {
    const prepared = prepare((draft) => {
      draft.relations?.push(
        {
          kind: 'recovery',
          class: 'D1_off_topic',
          flows: ['balance', 'card'],
          at: ['verify', 'help'],
          must_not: ['free'],
          ...by,
        },
        {
          kind: 'recovery',
          class: 'D1_off_topic',
          flows: ['balance'],
          at: ['verify'],
          stage_after: 'help',
          ...by,
        },
        {
          ...by,
          kind: 'recovery',
          class: 'D1_off_topic',
          flows: ['balance'],
          approved: false,
          must: ['never'],
        },
      );
    });
    expect(recoveryFor(prepared.relations, 'D1_off_topic', 'balance')).toEqual({
      stageAfter: 'pending',
      at: ['verify'],
      must: ['open {day}', 'a.b'],
      mustNot: ['free'],
      guards: [],
      tools: [],
      entries: 3,
    });
    expect(recoveryFor(prepared.relations, 'D1_off_topic', 'card')?.entries).toBe(1);
    expect(recoveryFor(prepared.relations, 'D8_tool_failure', 'balance')).toBeUndefined();
    expect(recoveryFor(prepared.relations, 'D8_tool_failure', 'balance', 'lookup')?.stageAfter).toBe(
      'verify',
    );
  });

  it('reads approved relations only, and hashes them into the map hash', () => {
    const all = prepare();
    const none = prepare((draft) => {
      for (const relation of draft.relations ?? []) relation.approved = false;
    });
    expect(none.relations).toMatchObject({
      paths: [],
      usesTools: [],
      recoveries: [],
      replyLanguage: undefined,
    });
    expect(none.relations.binds.size).toBe(0);
    expect(all.relations.paths).toHaveLength(3);
    expect(all.hash).not.toBe(none.hash);
  });
});

describe('generateSuite on a map with paths', () => {
  const prepared = prepare();
  const result = generateSuite(prepared, { mapPath: '../map.yaml' });

  it('builds every complete spec on a path, every block with a machine Then', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    expect(result.complete.length).toBeGreaterThan(0);
    for (const spec of result.complete) {
      expect((spec.metadata as { generated: { path?: string } }).generated.path, spec.id).toBeDefined();
      for (const block of spec.blocks) {
        expect(block.expect?.stage !== undefined || (block.expect?.tools?.length ?? 0) > 0, spec.id).toBe(
          true,
        );
      }
    }
  });

  it('sends a t-wise row no path can walk to incomplete/, with the reason', () => {
    const card = result.report.no_then.filter((entry) =>
      entry.reasons.some((reason) => reason.includes('path card-lost')),
    );
    expect(card.length).toBeGreaterThan(0);
    for (const entry of card) expect(entry.blocks.length).toBeGreaterThan(0);
  });

  it('walks the stage graph along the paths and names the edges none takes, and the paths it cannot walk', () => {
    expect(result.report.graph).toMatchObject({ edges: 5, covered: 3, paths: 2 });
    expect(result.report.graph.blocked).toEqual(['help-to-verify', 'lost-to-help']);
    expect(result.report.graph.unwalked).toEqual([
      { path: 'card-lost', reasons: ['path card-lost: the map has no stage transition greet-to-lost'] },
    ]);
  });
});

describe('pilot iteration 3: a recovery that moves the conversation', () => {
  it('ends the walk after the probe instead of playing turns from a stage the conversation left', () => {
    const prepared = prepare((draft) => {
      draft.relations = [
        ...(draft.relations ?? []),
        { kind: 'recovery', class: 'D5_language_switch', flows: ['balance'], stage_after: 'greet', ...by },
      ];
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D5_language_switch', stage: 'verify' },
    });
    if (!built.ok) throw new Error(built.reason);
    const at = built.blocks.findIndex((block) => block.injection === 'D5_language_switch');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(built.blocks[at]?.stage).toBe('greet');
    expect(built.blocks).toHaveLength(at + 1);
    expect(built.endState).toBeUndefined();
  });
});

describe('pilot iteration 4: boundary values of a side-effecting tool', () => {
  it('never expect the tool on a request alone: a path carries the value, or the call is forbidden', () => {
    const prepared = prepare();
    const result = generateSuite(prepared, { seed: 1, mapPath: 'map.yaml', t: 2 });
    const boundary = result.all.filter(
      (spec) => (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === 'boundary',
    );
    const direct = boundary.filter(
      (spec) =>
        spec.blocks.length === 1 &&
        (spec.blocks[0]?.expect?.tools ?? []).some((tool) => tool.label === 'lookup' && tool.count !== 0),
    );
    expect(direct.map((spec) => spec.id)).toEqual([]);
  });
});

describe('pilot iteration 5: a boundary block asks for one tool', () => {
  it('expects every other tool of the map 0 times', () => {
    const prepared = prepare();
    const result = generateSuite(prepared, { seed: 1, mapPath: 'map.yaml', t: 2 });
    const asking = result.all.flatMap((spec) =>
      (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === 'boundary'
        ? spec.blocks
            .filter(
              (block) =>
                block.id?.endsWith('-value') &&
                (block.expect?.tools ?? []).some((tool) => tool.label === 'lookup'),
            )
            .map((block) => ({ id: spec.id, block }))
        : [],
    );
    expect(asking.length).toBeGreaterThan(0);
    for (const { id, block } of asking) {
      expect(
        (block.expect?.tools ?? []).find((tool) => tool.label === 'notify'),
        id,
      ).toEqual({
        label: 'notify',
        count: 0,
      });
    }
  });
});

describe('pilot iteration 6: a tool failure carries the words of its recovery', () => {
  it('expects the honest report the recovery names', () => {
    const prepared = prepare((draft) => {
      draft.relations = (draft.relations ?? []).map((relation) =>
        relation.kind === 'recovery' && relation.class === 'D8_tool_failure'
          ? { ...relation, must: ['not available'] }
          : relation,
      );
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D8_tool_failure' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks.at(-1)?.must).toEqual(['not available']);
  });
});

describe('pilot iteration 7: invariance families over the context axes', () => {
  it('walks one path with the same values under each persona and each channel, expecting the same', () => {
    const prepared = prepare();
    const result = generateSuite(prepared, { seed: 1, mapPath: 'map.yaml', t: 2 });
    const families = new Map<string, Array<{ title: string; expects: string }>>();
    for (const spec of result.complete) {
      const meta = spec.metadata?.generated as { metamorphic?: { family: string } } | undefined;
      if (!meta?.metamorphic || !(spec.title ?? '').includes(' over ')) continue;
      const list = families.get(meta.metamorphic.family) ?? [];
      list.push({
        title: spec.title ?? '',
        expects: JSON.stringify(spec.blocks.map((block) => block.expect)),
      });
      families.set(meta.metamorphic.family, list);
    }
    const titles = [...families.values()].map((list) => list[0]?.title ?? '');
    expect(titles.some((title) => title.includes(' over user,'))).toBe(true);
    expect(titles.some((title) => title.includes(' over channel,'))).toBe(true);
    for (const list of families.values()) {
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(new Set(list.map((entry) => entry.expects)).size).toBe(1);
    }
  });
});

describe('pilot iteration 8: a boundary value carried by a path', () => {
  it('records its concrete value like every boundary spec', () => {
    // The found path reads the account the lookup is sent: its tool input value is on a path.
    const prepared = prepare((draft) => {
      draft.relations = (draft.relations ?? []).map((relation) =>
        relation.kind === 'path' && relation.id === 'balance-found'
          ? {
              ...relation,
              when: { ...relation.when, 'lookup.in.account': ['lookup.in.account.at-min-length'] },
            }
          : relation,
      );
    });
    const result = generateSuite(prepared, { seed: 1, mapPath: 'map.yaml', t: 2 });
    const onPath = result.all.filter((spec) => {
      const meta = spec.metadata?.generated as { seeder?: string } | undefined;
      return (
        meta?.seeder === 'boundary' &&
        /Path \S+ of /.test(spec.title ?? '') &&
        (spec.title ?? '').includes('lookup.in.')
      );
    });
    expect(onPath.length).toBeGreaterThan(0);
    for (const spec of onPath) {
      const concrete = (spec.metadata?.generated as { concrete?: Record<string, unknown> } | undefined)
        ?.concrete;
      expect(Object.keys(concrete ?? {}), spec.id).toHaveLength(1);
    }
  });
});

describe('pilot iteration 9: a clean walk declares a perturbation for mode P', () => {
  it('injects a deviation whose recovery stays on the stage, with the recovery as its Then', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.perturbations).toEqual([
      {
        id: 'p1-D1_off_topic',
        class: 'D1_off_topic',
        inject_at: 1,
        user: 'Are you open on Sunday?',
        expect: {
          stage: 'verify',
          tools: [{ label: 'lookup', count: 0 }],
          must: ['open Sunday', 'a.b'],
          lang: 'EN',
        },
        recovery: { within_blocks: 0, stage_after: 'verify' },
      },
    ]);
    // The walk itself is unchanged: the end state still holds after the perturbation.
    expect(built.endState).toEqual({ source: 'tool:lookup', mode: 'subset', expect: { account: '4' } });
  });

  it('declares none on a walk that already probes a deviation', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D1_off_topic' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.perturbations).toBeUndefined();
  });
});

describe('pilot iteration 10: a deviation on the first turn', () => {
  it('probes the start stage when the recovery keeps the conversation there and asks for a call', () => {
    const prepared = prepare((draft) => {
      draft.relations = [
        ...(draft.relations ?? []),
        {
          kind: 'recovery',
          class: 'D5_language_switch',
          flows: ['balance'],
          stage_after: 'pending',
          tools: [{ tool: 'lookup', count: 1 }],
          ...by,
        },
      ];
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D5_language_switch', stage: 'greet' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks[0]).toMatchObject({ id: 'b1-D5_language_switch', stage: 'greet' });
    expect(built.blocks.map((block) => block.stage)).toEqual(['greet', 'verify', 'help']);
    expect(built.probe).toEqual({ classId: 'D5_language_switch', stage: 'greet' });
  });
});

describe('pilot iteration 10: a class that needs an earlier turn', () => {
  it('never probes the start stage with a silence or a burst', () => {
    const prepared = prepare((draft) => {
      draft.phrases = [...(draft.phrases ?? []), phrase('deviation', 'D7_silence_or_burst', 'hello?')];
      draft.relations = [
        ...(draft.relations ?? []),
        { kind: 'recovery', class: 'D7_silence_or_burst', flows: ['balance'], stage_after: 'pending', ...by },
      ];
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D7_silence_or_burst', stage: 'greet' },
    });
    expect(built.ok).toBe(false);
  });
});

describe('closing the Acme suite gaps', () => {
  it('makes a turn state what the map says its reply states, read from the bound values', () => {
    const prepared = prepare((draft) => {
      draft.relations = [
        ...(draft.relations ?? []),
        {
          kind: 'states',
          subject: { dimension: 'flow', value: 'balance' },
          stage: 'verify',
          to: 'help',
          must: ['account \\d+ ends in {account}'],
          ...by,
        },
      ];
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks.map((block) => block.must)).toEqual([undefined, ['account \\d+ ends in 4']]);
  });

  it('probes after the last stage when the recovery keeps the conversation there', () => {
    const prepared = prepare((draft) => {
      draft.phrases = (draft.phrases ?? []).map((entry) =>
        entry.value === 'D1_off_topic' ? { ...entry, when: { stage: ['help'] } } : entry,
      );
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D1_off_topic', stage: 'help' },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks.map((block) => block.stage)).toEqual(['verify', 'help', 'help']);
    expect(built.blocks.at(-1)?.injection).toBe('D1_off_topic');
    expect(built.endState).toBeDefined();
  });

  it('fails a tool of the turn said at the stage a tool-failure probe asks for, or refuses', () => {
    const prepared = prepare();
    const atVerify = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D8_tool_failure', stage: 'verify' },
    });
    expect(atVerify.ok && atVerify.probe).toMatchObject({ classId: 'D8_tool_failure', stage: 'verify' });
    const atGreet = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D8_tool_failure', stage: 'greet' },
    });
    expect(atGreet.ok).toBe(false);
  });
});

describe('the pairs the relations rule out', () => {
  it('forbids a stage no path of a flow passes with that flow, and a class at a stage its recovery rules out', async () => {
    const { derivedConstraints } = await import('../../src/extract/derive');
    const draft = proposal((change) => {
      change.relations = [
        ...(change.relations ?? []),
        {
          kind: 'recovery',
          class: 'D5_language_switch',
          flows: ['balance'],
          at: ['verify'],
          stage_after: 'pending',
          ...by,
        },
      ];
    });
    for (const dimension of draft.dimensions) dimension.approved = true;
    for (const constraint of draft.constraints) constraint.approved = true;
    for (const phrase of draft.phrases ?? []) phrase.approved = true;
    const prepared = prepareMap(draft, { tools: TOOLS });
    const axes = prepared.axisMap.dimensions.map((dimension) => ({
      id: dimension.id,
      kind: dimension.kind,
      values: dimension.values.map((value) => value.id),
    }));
    const forbids = derivedConstraints(draft, axes).map((entry) => entry.forbid);
    const stage = axes.find((axis) => axis.kind === 'stage')?.id as string;
    const deviation = axes.find((axis) => axis.kind === 'deviation')?.id as string;
    // D5 may be said only at verify, so D5 at help (after every move of the paths) is ruled out.
    expect(forbids).toContainEqual({ [deviation]: 'D5_language_switch', [stage]: 'help' });
    expect(forbids).not.toContainEqual({ [deviation]: 'D5_language_switch', [stage]: 'verify' });
    // No path of the card flow is walkable here, so "lost" is never reached with no deviation.
    expect(forbids).toContainEqual({ [deviation]: 'none', [stage]: 'greet' });
  });
});

describe('a probe the constraints forbid', () => {
  it('is never said at a stage where the map forbids its class', () => {
    const prepared = prepare((draft) => {
      draft.phrases = (draft.phrases ?? []).map((entry) =>
        entry.value === 'D1_off_topic' ? { ...entry, when: { stage: ['help'] } } : entry,
      );
      draft.constraints = [
        ...draft.constraints,
        {
          forbid: { deviation: 'D1_off_topic', stage: 'help' },
          reason: 'The conversation is over at help',
          ...by,
        },
      ];
    });
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      probe: { classId: 'D1_off_topic', stage: 'help' },
    });
    expect(built.ok).toBe(false);
  });
});

describe('the task seeder and the task family relation', () => {
  it('places a task spec by the values its family holds and declares a planted file as a perturbation', async () => {
    const { taskSpecs } = await import('../../src/seed/tasks');
    const prepared = prepare();
    const relation = {
      kind: 'task_family' as const,
      flow: 'card',
      family: '../families/x',
      stages: ['lost'],
      holds: { account_state: ['found'] },
      deviations: ['D6_instruction_in_data' as const],
      ...by,
    };
    const spec = {
      id: 't-1',
      kind: 'task',
      tags: ['flow:card'],
      workspace_seed: { files: { 'NOTES.txt': 'planted' } },
      blocks: [{ id: 'b', user: 'do it', expect: { stage: 'lost' } }],
    };
    const [placed] = taskSpecs(prepared, [{ relation, variants: [{ spec, planted: true }] }], {
      seed: 1,
      mapPath: 'map.yaml',
    });
    expect(placed?.spec.tags).toEqual(['flow:card', 'data:found']);
    expect(placed?.spec.perturbations).toEqual([
      {
        id: 'planted-instruction',
        class: 'D6_instruction_in_data',
        inject_at: 0,
        world: { workspace: { files: { 'NOTES.txt': 'planted' } } },
        expect: { stage: 'lost' },
        recovery: { within_blocks: 0 },
      },
    ]);
    expect((placed?.spec.metadata as { generated?: { seeder: string } } | undefined)?.generated?.seeder).toBe(
      'task',
    );
  });

  it('makes the stages and the classes of a task family possible, and keeps a task value off a conversation', async () => {
    const { derivedConstraints } = await import('../../src/extract/derive');
    const draft = proposal((change) => {
      change.relations = [
        ...(change.relations ?? []),
        {
          kind: 'task_family',
          flow: 'card',
          family: '../families/x',
          stages: ['lost'],
          deviations: ['D5_language_switch'],
          ...by,
        },
      ];
    });
    for (const dimension of draft.dimensions) dimension.approved = true;
    for (const constraint of draft.constraints) constraint.approved = true;
    for (const phrase of draft.phrases ?? []) phrase.approved = true;
    const prepared = prepareMap(draft, { tools: TOOLS });
    const axes = prepared.axisMap.dimensions.map((dimension) => ({
      id: dimension.id,
      kind: dimension.kind,
      values: dimension.values.map((value) => value.id),
    }));
    const forbids = derivedConstraints(draft, axes).map((entry) => entry.forbid);
    const stage = axes.find((axis) => axis.kind === 'stage')?.id as string;
    const deviation = axes.find((axis) => axis.kind === 'deviation')?.id as string;
    // The card flow has no walkable path, but its task family places on lost, with and without its class.
    expect(forbids).not.toContainEqual({ [deviation]: 'none', [stage]: 'lost' });
    expect(forbids).not.toContainEqual({ [deviation]: 'D5_language_switch', [stage]: 'lost' });
  });
});

describe('iteration 18: a flow phrase opens a path of its flow', () => {
  it('says the forced flow phrase as the first turn and keeps the Then of the opening move', () => {
    const prepared = prepare((draft) => {
      draft.phrases.push(phrase('flow', 'balance', 'What is my balance?'));
    });
    const forced = prepared.phrases.find((entry) => entry.text === 'What is my balance?');
    if (!forced) throw new Error('no flow phrase');
    const plain = buildScenario(prepared, rngFor(1, 'family'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
    });
    const said = buildScenario(prepared, rngFor(1, 'family'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      force: forced,
    });
    if (!plain.ok || !said.ok) throw new Error('unbuilt');
    expect(texts(said.blocks)[0]).toBe('What is my balance?');
    expect(said.blocks[0]?.stage).toBe(plain.blocks[0]?.stage);
    expect(texts(said.blocks).slice(1)).toEqual(texts(plain.blocks).slice(1));
  });
});

describe('iteration 19: a turn that must not move the conversation', () => {
  it('says the turn after the first move and expects the conversation to stay on that stage', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      turn: {
        stimulus: {
          kind: 'phrase',
          phrase: phrase('flow', 'balance', 'Please run lookup with account set to 1.'),
        },
        carries: [],
        tools: [{ label: 'lookup', count: 0 }],
      },
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks.map((block) => block.stage)).toEqual(['verify', 'verify']);
    expect(texts(built.blocks)[1]).toBe('Please run lookup with account set to 1.');
    expect(built.blocks[1]?.tools).toContainEqual({ label: 'lookup', count: 0 });
    expect(built.endState).toBeUndefined();
  });
});

describe('iteration 20: a block records what its Then reads', () => {
  it('records the stage a move is said at, not the stage it reaches', () => {
    const prepared = prepare();
    const built = buildScenario(prepared, rngFor(1, 't'), { path: path(prepared, 'balance-found'), fixed: [] });
    if (!built.ok) throw new Error(built.reason);
    expect(built.blocks.map((block) => block.saidAt)).toEqual(['greet', 'verify']);
    expect(built.blocks.map((block) => block.stage)).toEqual(['verify', 'help']);
  });

  it('does not carry the data value a phrase only states when no Then reads it', () => {
    const prepared = prepare((draft) => {
      draft.phrases.push(phrase('stage_transition', 'greet-to-verify', 'Hello, my account is {account}.'));
    });
    const forced = prepared.phrases.find((entry) => entry.text === 'Hello, my account is {account}.');
    const built = buildScenario(prepared, rngFor(1, 't'), {
      path: path(prepared, 'balance-found'),
      fixed: [],
      ...(forced ? { force: forced } : {}),
    });
    if (!built.ok) throw new Error(built.reason);
    const account = prepared.space.dimensions.findIndex((dimension) => dimension.id === 'account_state');
    expect(texts(built.blocks)[0]).toBe('Hello, my account is 4.');
    expect(built.blocks[0]?.carries.some(([dimension]) => dimension === account)).toBe(false);
    // The lookup at verify reads the value: the block that calls it carries it.
    expect(built.blocks[1]?.carries.some(([dimension]) => dimension === account)).toBe(true);
  });
});
