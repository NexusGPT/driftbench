import type { Atom, AtomKind, EstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { planRelevanceFamily } from '../../src/ladders/estate/bank/plan';
import {
  IDENTITY,
  judgeRelevance,
  type Planted,
  type Relation,
  targetsOf,
} from '../../src/ladders/estate/bank/relevance-typed';
import * as pipeline from '../../src/ladders/estate/pipeline';

// Hand-written observatory estates. Every atom is invented for these tests: none is a bank or generated-estate phrase,
// and the oracle must read none of their words, so each decoy says in words what a lexical reader would take for a
// relation while its typed data says nothing.

const KINDS: AtomKind[] = [
  'instruction',
  'gate',
  'route',
  'skill',
  'reference',
  'script',
  'subagent',
  'guard',
  'tool',
  'setting',
  'stage',
  'register',
  'hazard',
  'invariant',
];

function atom(id: string, kind: AtomKind, quote: string, extra: Partial<Atom> = {}): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: 'OBSERVATORY.md', startLine: 1, endLine: 1, quote, hash: id },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence: [{ type: 'custom', name: 'observatory_policy' }],
    enforcement: [],
    ...extra,
  } as Atom;
}

const mapOf = (atoms: Atom[], edges: EstateMap['edges'] = []) => ({ atoms, edges });

/** Words a lexical reader takes for a relation, on an atom whose typed data holds none. */
const DECOY_WORDS =
  'Dispatch the helper, call a tool, tell the user in their language, require confirmation once, restart, compact, stop.';
const decoy = (kind: AtomKind) => atom(`decoy.${kind}`, kind, DECOY_WORDS);

type Case = {
  key: string;
  dimension: string;
  value: string;
  relation: Relation;
  /** The identified target, of a kind the old kind lists excluded, with the edges and the planted data that make it one. */
  target?: { atoms: Atom[]; edges?: EstateMap['edges']; planted?: Planted };
};

const CASES: Case[] = [
  {
    key: 'dead-helper',
    dimension: 'estate_hazard',
    value: 'dead_helper',
    relation: 'helper',
    target: {
      atoms: [
        atom('t', 'instruction', 'Handle the exposure number.', {
          evidence: [{ type: 'tool_called', label: 'Agent' }],
        }),
      ],
    },
  },
  {
    key: 'helpers-running',
    dimension: 'session_state',
    value: 'helpers_running',
    relation: 'helper',
    target: {
      atoms: [atom('t', 'skill', 'Run the nightly exposure plan.'), atom('h', 'subagent', 'name: analyst')],
      edges: [{ from: 't', to: 'h', kind: 'dispatch' }],
    },
  },
  {
    key: 'stale-tracker',
    dimension: 'estate_hazard',
    value: 'stale_tracker',
    relation: 'stage',
    target: {
      atoms: [
        atom('t', 'instruction', 'Keep the lens cover clean.', {
          evidence: [{ type: 'stage_reached', name: 'note' }],
        }),
      ],
    },
  },
  {
    key: 'language-switch',
    dimension: 'deviation',
    value: 'D5_language_switch',
    relation: 'output',
    target: {
      atoms: [atom('t', 'gate', 'Close the dome.', { evidence: [{ type: 'text', lang: 'EN' }] })],
    },
  },
  {
    key: 'owner-language-switch',
    dimension: 'owner_signal',
    value: 'language_switch',
    relation: 'output',
    target: {
      atoms: [atom('t', 'stage', 'Close the dome.', { evidence: [{ type: 'text', must: ['done'] }] })],
    },
  },
  {
    key: 'tool-failure',
    dimension: 'deviation',
    value: 'D8_tool_failure',
    relation: 'tool',
    target: {
      atoms: [
        atom('t', 'gate', 'Calibrate the mirror.', {
          evidence: [
            { type: 'tool_called', label: 'Read' },
            { type: 'ordered', before: 'Read', after: 'Edit' },
          ],
        }),
      ],
    },
  },
  {
    key: 'instruction-in-data',
    dimension: 'deviation',
    value: 'D6_instruction_in_data',
    relation: 'tool',
    target: {
      atoms: [
        atom('t', 'instruction', 'Summarise the night.', {
          evidence: [{ type: 'tool_called', label: 'Read' }],
        }),
      ],
    },
  },
  {
    key: 'loose-confirmation',
    dimension: 'deviation',
    value: 'D4_loose_confirmation',
    relation: 'confirmation',
    target: { atoms: [atom('t', 'tool', 'Bash(dome:*)', { fields: { effect: 'ask' } })] },
  },
  {
    key: 'rate-wave',
    dimension: 'estate_hazard',
    value: 'rate_wave',
    relation: 'tool',
    target: {
      atoms: [
        atom('t', 'skill', 'Fetch the catalogue.', { evidence: [{ type: 'tool_called', label: 'Bash' }] }),
      ],
    },
  },
  {
    key: 'process-restart',
    dimension: 'estate_hazard',
    value: 'process_restart',
    relation: 'restart',
    target: { atoms: [atom('t', 'hazard', 'Hazard.', { fields: { hazard: 'restart' } })] },
  },
  {
    key: 'compaction',
    dimension: 'estate_hazard',
    value: 'compaction_mid_task',
    relation: 'compaction',
    target: { atoms: [atom('t', 'hazard', 'Hazard.', { fields: { hazard: 'compaction' } })] },
  },
  {
    key: 'after-compaction',
    dimension: 'session_state',
    value: 'after_compaction',
    relation: 'compaction',
    target: { atoms: [atom('t', 'instruction', 'Reload the log.')], planted: { hazard: 'compaction' } },
  },
  {
    key: 'after-restart',
    dimension: 'session_state',
    value: 'after_restart',
    relation: 'restart',
    target: { atoms: [atom('t', 'skill', 'Restore the calibration.')], planted: { scope: 'restart' } },
  },
  {
    key: 'resumed',
    dimension: 'session_state',
    value: 'resumed',
    relation: 'stop',
    target: { atoms: [atom('t', 'instruction', 'Carry on.')], planted: { scope: 'stop' } },
  },
  {
    key: 'stop-signal',
    dimension: 'owner_signal',
    value: 'stop',
    relation: 'stop',
    target: { atoms: [atom('t', 'skill', 'Halt the exposure.')], planted: { behaviour: 'stop_on_word' } },
  },
  {
    key: 'no-questions',
    dimension: 'owner_signal',
    value: 'no_questions',
    relation: 'confirmation',
    target: { atoms: [atom('t', 'tool', 'Bash(dome:*)', { fields: { effect: 'ask' } })] },
  },
  {
    key: 'goal-shift',
    dimension: 'deviation',
    value: 'D2_goal_shift',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'off-topic',
    dimension: 'deviation',
    value: 'D1_off_topic',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'out-of-scope',
    dimension: 'deviation',
    value: 'D9_out_of_scope',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'silence-burst',
    dimension: 'deviation',
    value: 'D7_silence_or_burst',
    relation: 'prompt',
    target: { atoms: [atom('t', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } })] },
  },
];

/** A run holding only what the item reads: the map, the planted standing rules, and the pairwise rows. */
function fakeRun(
  map: ReturnType<typeof mapOf>,
  rows: Array<{ atom?: string; dimension: string; value: string }>,
  planted: Planted = {},
  plantedOn?: string,
) {
  const hidOf = new Map<string, string>();
  const rules: unknown[] = [];
  if (plantedOn !== undefined && Object.keys(planted).length > 0) {
    hidOf.set(plantedOn, 'rule:planted');
    rules.push({
      hid: 'rule:planted',
      scope: planted.scope ?? 'always',
      behaviour: { type: planted.behaviour ?? 'none' },
      ...(planted.hazard ? { hazard: planted.hazard } : {}),
    });
  }
  return {
    estate: { rules },
    scanned: { map, match: { hidOf } },
    plan: {
      plan: {
        rows: rows.map((row, index) => ({
          id: `pairwise.${index}`,
          atomIds: row.atom === undefined ? [] : [row.atom],
          cell: { [row.dimension]: row.value },
        })),
      },
    },
  } as unknown as pipeline.EstateRun;
}

async function verdict(
  key: string,
  map: ReturnType<typeof mapOf>,
  rows: Array<{ atom?: string; dimension: string; value: string }>,
  planted?: Planted,
  plantedOn?: string,
) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(fakeRun(map, rows, planted, plantedOn));
  try {
    return (await planRelevanceFamily().evaluate(1)).get(`plan.relevance.${key}`) as {
      pass: boolean;
      detail: string;
    };
  } finally {
    mock.mockRestore();
  }
}

describe('plan.relevance judges each of its 20 situations from typed data, with no word of the estate read', () => {
  it('has the 20 items', () => {
    expect(planRelevanceFamily().items.map((item) => item.id)).toHaveLength(20);
    expect(CASES.map((c) => `plan.relevance.${c.key}`).sort()).toEqual(
      planRelevanceFamily()
        .items.map((item) => item.id)
        .sort(),
    );
  });

  describe.each(CASES)('$key', ({ key, dimension, value, relation, target }) => {
    const cross = (...ids: string[]) => ids.map((atomId) => ({ atom: atomId, dimension, value }));

    if (target) {
      const plantedOn = target.planted ? 't' : undefined;

      it('accepts a crossing with an identified target of a kind the old kind list excluded', async () => {
        const map = mapOf([...target.atoms, decoy('instruction')], target.edges);
        const out = await verdict(key, map, cross('t'), target.planted, plantedOn);
        expect(out, out.detail).toMatchObject({ pass: true });
      });

      it.each(KINDS.filter((kind) => !IDENTITY[relation].includes(kind)))(
        'rejects a crossing with a %s that holds no relation, whatever its words say',
        async (kind) => {
          const map = mapOf([...target.atoms, decoy(kind)], target.edges);
          const out = await verdict(key, map, cross('t', `decoy.${kind}`), target.planted, plantedOn);
          expect(out.pass).toBe(false);
          expect(out.detail).toContain(`decoy.${kind}`);
        },
      );

      it('rejects a plan that never crosses the situation with a target', async () => {
        const map = mapOf([...target.atoms, decoy('instruction')], target.edges);
        const out = await verdict(key, map, cross('decoy.instruction'), target.planted, plantedOn);
        expect(out.pass).toBe(false);
      });
    }

    it('passes a plan that keeps the situation as an unresolved row with no atom: it carries no crossings', async () => {
      const lonely = KINDS.filter((kind) => !IDENTITY[relation].includes(kind)).map(decoy);
      const out = await verdict(key, mapOf(lonely), [{ dimension, value }]);
      expect(out, out.detail).toMatchObject({ pass: true });
      // The same unresolved row beside one crossing of any atom fails: crossing any atom is wrong.
      const crossed = await verdict(key, mapOf(lonely), [
        { dimension, value },
        ...cross('decoy.instruction'),
      ]);
      expect(crossed.pass).toBe(false);
    });

    it('gives an estate that holds no atom of the relation nothing to cross: any crossing is wrong, no row is not', async () => {
      // No atom holds the relation, whatever its kind and words say.
      const lonely = KINDS.filter((kind) => !IDENTITY[relation].includes(kind)).map(decoy);
      const map = mapOf(lonely);
      const some = await verdict(key, map, cross(...lonely.map((a) => a.id)));
      expect(some.pass, some.detail).toBe(false);
      expect(some.detail).toContain('no atom holds the relation');
      const none = await verdict(key, map, []);
      expect(none, none.detail).toMatchObject({ pass: true });
    });
  });
});

describe('the typed relations', () => {
  it('a helper: the helper, a call of the Agent tool, and the units that reach either by a route or a dispatch', () => {
    const map = mapOf(
      [
        atom('r', 'route', DECOY_WORDS),
        atom('s', 'skill', DECOY_WORDS),
        atom('h', 'subagent', DECOY_WORDS),
        atom('i', 'instruction', DECOY_WORDS, { evidence: [{ type: 'tool_called', label: 'Agent' }] }),
        atom('s2', 'skill', DECOY_WORDS),
        atom('o', 'instruction', DECOY_WORDS),
        atom('x', 'script', DECOY_WORDS),
        atom('k', 'skill', DECOY_WORDS),
      ],
      [
        { from: 'r', to: 's', kind: 'route' },
        { from: 's', to: 'h', kind: 'dispatch' },
        { from: 's2', to: 'i', kind: 'route' },
        { from: 'k', to: 'x', kind: 'script' },
      ],
    );
    expect([...targetsOf('helper', map)].sort()).toEqual(['h', 'i', 'r', 's', 's2']);
  });

  it('a tool call: a tool config, a script, a guard, a typed call or order, and what reaches one', () => {
    const map = mapOf(
      [
        atom('a', 'instruction', DECOY_WORDS, {
          evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
        }),
        atom('b', 'instruction', DECOY_WORDS, {
          evidence: [{ type: 'ordered', before: 'verify', after: 'report' }],
        }),
        atom('c', 'skill', DECOY_WORDS),
        atom('d', 'script', DECOY_WORDS),
        atom('e', 'register', DECOY_WORDS, { evidence: [{ type: 'tool_not_called', label: 'Bash' }] }),
        atom('f', 'stage', DECOY_WORDS),
      ],
      [{ from: 'c', to: 'd', kind: 'script' }],
    );
    // An order is typed evidence whether its ends are tools or not: the evidence type decides, not the labels.
    expect([...targetsOf('tool', map)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a reply: an output rule, a text predicate; a stage or an instruction whose words speak of a reply is neither', () => {
    const map = mapOf([
      atom('a', 'register', 'x'),
      atom('b', 'gate', 'x', { evidence: [{ type: 'text', mustNot: ['simply'] }] }),
      atom('c', 'stage', 'Tell the user what changed.'),
      atom('d', 'instruction', 'Answer in the language of the user.'),
    ]);
    expect([...targetsOf('output', map)].sort()).toEqual(['a', 'b']);
  });

  it('a hazard: the hazard atom of that id and the rule the hidden estate planted for it', () => {
    const map = mapOf([
      atom('a', 'hazard', 'x', { fields: { hazard: 'compaction' } }),
      atom('b', 'hazard', 'x', { fields: { hazard: 'restart' } }),
      atom('c', 'instruction', 'After a compaction, reload the log.'),
      atom('d', 'instruction', 'After a restart, reload the log.'),
    ]);
    const planted = new Map<string, Planted>([['d', { hazard: 'restart' }]]);
    expect([...targetsOf('compaction', map, planted)]).toEqual(['a']);
    expect([...targetsOf('restart', map, planted)].sort()).toEqual(['b', 'd']);
  });

  it('a stop: a rule planted for it, a guard on the prompt event; a guard on a tool event is not', () => {
    const map = mapOf([
      atom('a', 'guard', 'x', { fields: { event: 'UserPromptSubmit' } }),
      atom('b', 'guard', 'x', { fields: { event: 'PreToolUse' } }),
      atom('c', 'instruction', 'On stop, stop all work.'),
      atom('d', 'instruction', 'x'),
    ]);
    const planted = new Map<string, Planted>([['d', { scope: 'stop' }]]);
    expect([...targetsOf('stop', map, planted)].sort()).toEqual(['a', 'd']);
  });

  it('a route: the route and the unit it opens, not a unit of the same kind no route opens', () => {
    const map = mapOf(
      [atom('r', 'route', 'x'), atom('s', 'skill', 'x'), atom('t', 'skill', 'x')],
      [{ from: 'r', to: 's', kind: 'route' }],
    );
    expect([...targetsOf('routing', map)].sort()).toEqual(['r', 's']);
  });

  it('a guard on the prompt: a guard on the prompt event, not one on a tool event', () => {
    const map = mapOf([
      atom('a', 'guard', 'x', { fields: { event: 'UserPromptSubmit' } }),
      atom('b', 'guard', 'x', { fields: { event: 'PreToolUse' } }),
      atom('c', 'instruction', 'Answer when the user says hello.'),
    ]);
    expect([...targetsOf('prompt', map)]).toEqual(['a']);
  });

  it('a confirmation: a permission that asks, not one that allows', () => {
    const map = mapOf([
      atom('a', 'tool', 'x', { fields: { effect: 'ask' } }),
      atom('b', 'tool', 'x', { fields: { effect: 'allow' } }),
      atom('c', 'gate', 'Show the draft and get an explicit yes.'),
    ]);
    expect([...targetsOf('confirmation', map)]).toEqual(['a']);
  });
});

describe('a plan that crosses everything with everything fails all 20 items', { timeout: 600_000 }, () => {
  const holders = [
    atom('h.helper', 'subagent', 'name: analyst'),
    atom('h.tool', 'script', 'scripts/run.py'),
    atom('h.stage', 'stage', 'Report'),
    atom('h.output', 'register', 'Lead with the result.'),
    atom('h.ask', 'tool', 'Bash(dome:*)', { fields: { effect: 'ask' } }),
    atom('h.restart', 'hazard', 'Hazard.', { fields: { hazard: 'restart' } }),
    atom('h.compaction', 'hazard', 'Hazard.', { fields: { hazard: 'compaction' } }),
    atom('h.stop', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } }),
    atom('h.route', 'route', '| observe | exposure |'),
  ];
  const everything = (atoms: Atom[]) =>
    CASES.flatMap(({ dimension, value }) => atoms.map((a) => ({ atom: a.id, dimension, value })));

  it('fails every item on an estate that holds a typed atom for each relation, decoys of every kind among them', async () => {
    const atoms = [...holders, ...KINDS.map(decoy)];
    const rows = everything(atoms);
    for (const { key } of CASES) {
      const out = await verdict(
        key,
        mapOf(atoms, [{ from: 'h.route', to: 'decoy.skill', kind: 'route' }]),
        rows,
        { hazard: 'compaction' },
        'decoy.instruction',
      );
      expect(out.pass, `${key}: ${out.detail}`).toBe(false);
    }
  });

  it('fails every item on an estate that holds almost no typed atom: no atom applies, so any crossing is wrong', async () => {
    const atoms = KINDS.filter((kind) => !['stage', 'subagent', 'register', 'route'].includes(kind)).map(
      decoy,
    );
    const rows = everything(atoms);
    for (const { key } of CASES) {
      const out = await verdict(key, mapOf(atoms), rows);
      expect(out.pass, `${key}: ${out.detail}`).toBe(false);
    }
  });

  it('judges the same plan on the real generated estate: the plan of the main planner fails every item whose relation an atom holds', async () => {
    const run = await pipeline.estateRun(1);
    const rows = run.plan.plan.rows.filter((row) => row.id.startsWith('pairwise.'));
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
    try {
      const out = await planRelevanceFamily().evaluate(1);
      const crossed = CASES.filter(({ dimension, value }) =>
        rows.some((row) => row.cell[dimension] === value),
      );
      expect(crossed.length).toBeGreaterThan(0);
      for (const { key } of crossed) expect(out.get(`plan.relevance.${key}`)?.pass, key).toBe(false);
    } finally {
      mock.mockRestore();
    }
  });
});

describe('plan.relevance on the generated estate', { timeout: 600_000 }, () => {
  it('judges the real plan of seeds 1 and 2: 20 items, each with a verdict and a detail', async () => {
    for (const seed of [1, 2]) {
      const verdicts = await planRelevanceFamily().evaluate(seed);
      expect(verdicts.size, `seed ${seed}`).toBe(20);
      for (const [id, result] of verdicts) expect(typeof result.detail, id).toBe('string');
    }
  });

  it('crosses a real helper-dispatching instruction with a dead helper and rejects a real register with it', async () => {
    const run = await pipeline.estateRun(1);
    const dispatcher = run.scanned.map.atoms.find(
      (a) =>
        a.kind === 'instruction' && a.evidence.some((e) => e.type === 'tool_called' && e.label === 'Agent'),
    );
    const register = run.scanned.map.atoms.find((a) => a.kind === 'register');
    if (!dispatcher || !register) throw new Error('the estate holds no dispatching instruction or register');
    const base = run.plan.plan.rows.find((row) => row.id.startsWith('pairwise.'));
    if (!base) throw new Error('no pairwise row');
    const planted = (atomId: string) => ({
      ...run,
      plan: {
        ...run.plan,
        plan: {
          ...run.plan.plan,
          rows: [
            {
              ...structuredClone(base),
              id: 'pairwise.planted',
              atomIds: [atomId],
              cell: { estate_hazard: 'dead_helper' },
            },
            ...run.plan.plan.rows.filter(
              (row) => row.id.startsWith('pairwise.') && row.cell.estate_hazard !== 'dead_helper',
            ),
          ],
        },
      },
    });
    for (const [atomId, pass] of [
      [dispatcher.id, true],
      [register.id, false],
    ] as const) {
      const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(planted(atomId));
      try {
        const out = (await planRelevanceFamily().evaluate(1)).get('plan.relevance.dead-helper');
        expect(out?.pass, `${atomId}: ${out?.detail}`).toBe(pass);
      } finally {
        mock.mockRestore();
      }
    }
  });
});
