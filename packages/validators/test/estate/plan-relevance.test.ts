import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { planRelevanceFamily } from '../../src/ladders/estate/bank/plan';
import { type Signal, showsSignal } from '../../src/ladders/estate/bank/relevance-signals';
import * as pipeline from '../../src/ladders/estate/pipeline';

function atom(
  id: string,
  kind: Atom['kind'],
  quote: string,
  evidence: Atom['evidence'],
  extra: Partial<Atom> = {},
): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: extra.provenance?.file ?? 'CLAUDE.md', startLine: 1, endLine: 1, quote, hash: id },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence,
    enforcement: [],
    ...extra,
  } as Atom;
}

const REPAIR = '.claude/skills/repair-ticket/SKILL.md';
const call = (label: string): Atom['evidence'] => [{ type: 'tool_called', label }];
const text: Atom['evidence'] = [{ type: 'custom', name: 'x' }];

/** A small hand-written estate: a skill that dispatches a helper and closes a ticket once it is confirmed. */
const ATOMS = {
  helper: atom('subagent.auditor', 'subagent', 'name: auditor', call('Agent'), {
    provenance: {
      file: '.claude/agents/auditor.md',
      startLine: 1,
      endLine: 1,
      quote: 'name: auditor',
      hash: 'h',
    },
  }),
  dispatch: atom(
    'instruction.repair.dispatch',
    'instruction',
    'When the part is new, dispatch the `auditor` agent.',
    call('Agent'),
    { provenance: { file: REPAIR, startLine: 9, endLine: 9, quote: 'dispatch', hash: 'd' } },
  ),
  runScript: atom('instruction.repair.run', 'instruction', 'Run `python3 scripts/list.py`.', call('Bash'), {
    provenance: { file: REPAIR, startLine: 11, endLine: 11, quote: 'run', hash: 'r' },
  }),
  readBeforeEdit: atom('gate.standing.read', 'gate', 'Read a file before you edit it.', [
    { type: 'ordered', before: 'Read', after: 'Edit' },
  ]),
  stageOrder: atom('gate.standing.verify', 'gate', 'Never report done before verify passed.', [
    { type: 'ordered', before: 'verify', after: 'report' },
  ]),
  helperRule: atom(
    'instruction.standing.helpers',
    'instruction',
    'After a restart, check which helpers are still running.',
    [{ type: 'custom', name: 'helper_state' }],
  ),
  skill: atom(
    'skill.repair',
    'skill',
    'name: repair-ticket',
    [{ type: 'skill_loaded', name: 'repair-ticket' }],
    {
      provenance: { file: REPAIR, startLine: 2, endLine: 2, quote: 'name: repair-ticket', hash: 's' },
      fields: { description: 'Close a repair ticket once the repair is confirmed.' },
    },
  ),
  route: atom(
    'route.standing.repair',
    'route',
    '| close a repair ticket | `repair-ticket` |',
    [{ type: 'skill_loaded', name: 'repair-ticket' }],
    { fields: { targetKind: 'skill' } },
  ),
  otherSkill: atom(
    'skill.shipments',
    'skill',
    'name: shipment-update',
    [{ type: 'skill_loaded', name: 'shipment-update' }],
    {
      provenance: {
        file: '.claude/skills/shipment-update/SKILL.md',
        startLine: 2,
        endLine: 2,
        quote: 'name: shipment-update',
        hash: 'o',
      },
      fields: { description: 'Update the status of a shipment from the carrier record.' },
    },
  ),
  otherRoute: atom(
    'route.standing.shipments',
    'route',
    '| update a shipment | `shipment-update` |',
    [{ type: 'skill_loaded', name: 'shipment-update' }],
    { fields: { targetKind: 'skill' } },
  ),
  reportStage: atom('stage.steps.report', 'stage', 'Tell the user what changed and what is next', [
    { type: 'stage_reached', name: 'report' },
  ]),
  noteStage: atom('stage.steps.note', 'stage', 'Write a tracker note', [
    { type: 'stage_reached', name: 'note' },
  ]),
  verifyStage: atom('stage.steps.verify', 'stage', 'Run the check that proves the change', [
    { type: 'stage_reached', name: 'verify' },
  ]),
  supplierRule: atom(
    'instruction.standing.supplier',
    'instruction',
    'Answer the supplier in their language.',
    text,
  ),
  register: atom('register.standing.lead', 'register', 'Lead with the result in the first line.', text),
};

const MAP = {
  version: 1,
  runtime: 'claude-code',
  root: '.',
  readAt: 'now',
  atoms: Object.values(ATOMS),
  edges: [
    { from: ATOMS.route.id, to: ATOMS.skill.id, kind: 'route' },
    { from: ATOMS.otherRoute.id, to: ATOMS.otherSkill.id, kind: 'route' },
  ],
  hash: 'x',
} as unknown as EstateMap;

const shows = (signal: Signal, name: keyof typeof ATOMS) => showsSignal(signal, ATOMS[name], MAP);

describe('what an atom shows about the situations it can act on', () => {
  it('helper activity: a helper, a dispatch, a mention of helpers, and the skill and route that lead to one', () => {
    for (const name of ['helper', 'dispatch', 'helperRule', 'skill', 'route'] as const)
      expect(shows('helper-activity', name), name).toBe(true);
    for (const name of [
      'register',
      'noteStage',
      'runScript',
      'readBeforeEdit',
      'otherSkill',
      'otherRoute',
    ] as const)
      expect(shows('helper-activity', name), name).toBe(false);
  });

  it('a tool call: a call of a tool, an order between tool calls, and the units that reach one', () => {
    for (const name of ['dispatch', 'runScript', 'readBeforeEdit', 'skill', 'route'] as const)
      expect(shows('tool-call', name), name).toBe(true);
    // An order between stages is no tool call; neither is a rule shown only in words, nor a step.
    for (const name of ['stageOrder', 'register', 'helperRule', 'noteStage', 'otherSkill'] as const)
      expect(shows('tool-call', name), name).toBe(false);
  });

  it('output to a person: a step that tells the user, not one that writes a note', () => {
    for (const name of ['reportStage', 'supplierRule'] as const)
      expect(shows('output-to-person', name), name).toBe(true);
    for (const name of ['noteStage', 'verifyStage', 'runScript', 'helper'] as const)
      expect(shows('output-to-person', name), name).toBe(false);
  });

  it('a confirmation: a skill whose words condition on it and the route that opens it, not another skill', () => {
    for (const name of ['skill', 'route'] as const) expect(shows('confirmation', name), name).toBe(true);
    for (const name of ['otherSkill', 'otherRoute', 'register', 'reportStage'] as const)
      expect(shows('confirmation', name), name).toBe(false);
  });
});

describe('plan.relevance on the generated estate with a row planted', { timeout: 300_000 }, () => {
  async function verdicts(plant: (run: pipeline.EstateRun) => pipeline.EstateRun['plan']['plan']['rows']) {
    const run = await pipeline.estateRun(1);
    const clone = structuredClone(run.plan);
    clone.plan.rows = plant(run);
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue({ ...run, plan: clone });
    try {
      return await planRelevanceFamily().evaluate(1);
    } finally {
      mock.mockRestore();
    }
  }

  /** Only the pairwise rows that cross one situation value with one atom, so the item judges that cell alone. */
  function cell(run: pipeline.EstateRun, dimension: string, value: string, atomId: string) {
    const base = run.plan.plan.rows.find((row) => row.id.startsWith('pairwise.'));
    if (!base) throw new Error('no pairwise row');
    return [
      { ...structuredClone(base), id: 'pairwise.planted', atomIds: [atomId], cell: { [dimension]: value } },
    ];
  }

  const find = (run: pipeline.EstateRun, test: (atom: Atom) => boolean) => {
    const found = run.scanned.map.atoms.find(test);
    if (!found) throw new Error('no such atom');
    return found;
  };

  it('keeps an instruction that dispatches a helper with a dead helper, and the report stage with a language switch', async () => {
    const out = await verdicts((run) => [
      ...cell(
        run,
        'estate_hazard',
        'dead_helper',
        find(
          run,
          (a) =>
            a.kind === 'instruction' &&
            a.evidence.some((e) => e.type === 'tool_called' && e.label === 'Agent'),
        ).id,
      ),
    ]);
    expect(out.get('plan.relevance.dead-helper')).toEqual({ pass: true, detail: 'holds' });
    const lang = await verdicts((run) =>
      cell(
        run,
        'deviation',
        'D5_language_switch',
        find(run, (a) => a.kind === 'stage' && /tell the user/i.test(a.provenance.quote)).id,
      ),
    );
    expect(lang.get('plan.relevance.language-switch')).toEqual({ pass: true, detail: 'holds' });
  });

  it('still excludes an atom that shows nothing: a register with a dead helper, a note step with a language switch', async () => {
    const dead = await verdicts((run) =>
      cell(run, 'estate_hazard', 'dead_helper', find(run, (a) => a.kind === 'register').id),
    );
    expect(dead.get('plan.relevance.dead-helper')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('1 rows cross it with atoms it cannot act on'),
    });
    const lang = await verdicts((run) =>
      cell(
        run,
        'deviation',
        'D5_language_switch',
        find(run, (a) => a.kind === 'stage' && /tracker note/i.test(a.provenance.quote)).id,
      ),
    );
    expect(lang.get('plan.relevance.language-switch')).toMatchObject({ pass: false });
    const tool = await verdicts((run) =>
      cell(run, 'deviation', 'D8_tool_failure', find(run, (a) => a.kind === 'stage').id),
    );
    expect(tool.get('plan.relevance.tool-failure')).toMatchObject({ pass: false });
  });
});
