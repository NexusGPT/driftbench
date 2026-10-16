import type { SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type Atom, buildPlan, type EstateMap } from '../../src/index';
import { situationSpace } from '../../src/plan/relevance';

function atom(
  id: string,
  kind: Atom['kind'],
  quote: string,
  evidence: Atom['evidence'],
  fields?: Atom['fields'],
  line = 1,
): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: 'POLICY.md', startLine: line, endLine: line, quote, hash: id },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence,
    enforcement: [],
    ...(fields ? { fields } : {}),
  };
}
function estate(atoms: Atom[], edges: EstateMap['edges'] = []): EstateMap {
  return {
    version: 1,
    runtime: 'fictional',
    root: '.',
    readAt: '2026-01-01T00:00:00Z',
    hash: 'handwritten',
    atoms,
    edges,
  };
}
const samples = () =>
  estate([
    atom('a', 'instruction', 'Run the spectrometer and save its reading.', [
      { type: 'tool_called', label: 'Measure' },
    ]),
    atom('b', 'instruction', 'Answer in the language of the customer.', [{ type: 'text', lang: 'FR' }]),
    atom('c', 'instruction', 'Dispatch the mineral analyst with the specimen number.', [
      { type: 'tool_called', label: 'Agent' },
    ]),
    atom('d', 'stage', 'Update the tracker with the specimen result.', [
      { type: 'stage_reached', name: 'record' },
    ]),
    atom('e', 'instruction', 'After a restart, read the laboratory notebook.', [
      { type: 'tool_called', label: 'Read' },
    ]),
  ]);
const cells = (map: EstateMap) => buildPlan(map).plan.rows.filter((row) => row.id.startsWith('pairwise.'));

const crossed = (map: EstateMap, id: string, dimension: string, value: string) =>
  cells(map).some((row) => row.atomIds[0] === id && row.cell[dimension] === value);
const rowsOf = (map: EstateMap, dimension: string, value: string) =>
  cells(map).filter((row) => row.cell[dimension] === value);

describe('situation relevance follows typed relations, never words', () => {
  it('crosses a language event only with an output rule: a text predicate, not a tool call', () => {
    const map = samples();
    expect(crossed(map, 'b', 'deviation', 'D5_language_switch')).toBe(true);
    for (const id of ['a', 'c', 'd', 'e'])
      expect(crossed(map, id, 'deviation', 'D5_language_switch')).toBe(false);
  });

  it('crosses a step failure only with a stage, whatever the words of an instruction say', () => {
    const map = samples();
    map.atoms.push(
      atom('f', 'instruction', 'Reconcile the tracker before continuing.', [{ type: 'custom', name: 'x' }]),
    );
    expect(crossed(map, 'd', 'estate_hazard', 'stale_tracker')).toBe(true);
    expect(crossed(map, 'f', 'estate_hazard', 'stale_tracker')).toBe(false);
  });

  it('crosses a failed helper with a helper and the route to it, and nothing else', () => {
    const map = samples();
    map.atoms.push(atom('unit', 'subagent', 'Mineral analyst', [{ type: 'tool_called', label: 'Agent' }]));
    map.atoms.push(
      atom('route', 'route', 'Send specimens for mineral analysis.', [{ type: 'custom', name: 'choose' }]),
    );
    map.edges.push({ from: 'route', to: 'unit', kind: 'route' });
    for (const id of ['unit', 'route']) expect(crossed(map, id, 'estate_hazard', 'dead_helper')).toBe(true);
    // An instruction that dispatches by its words or evidence is not a helper.
    for (const id of ['a', 'b', 'c', 'd', 'e'])
      expect(crossed(map, id, 'estate_hazard', 'dead_helper')).toBe(false);
    expect(crossed(map, 'route', 'deviation', 'D5_language_switch')).toBe(false);
  });

  it('crosses a tool failure with a tool, a script, a guard or a unit that declares tools, and the route to one', () => {
    const map = samples();
    map.atoms.push(atom('tool', 'tool', 'Bash is allowed', [], { tool: 'Bash' }));
    map.atoms.push(atom('skill', 'skill', 'Measure things', [], { tools: ['Measure'] }));
    map.atoms.push(atom('plain', 'skill', 'Describe things', [], {}));
    map.atoms.push(atom('route', 'route', 'Measure on request', []));
    map.edges.push({ from: 'route', to: 'skill', kind: 'route' });
    for (const id of ['tool', 'skill', 'route'])
      expect(crossed(map, id, 'deviation', 'D8_tool_failure')).toBe(true);
    for (const id of ['plain', 'a', 'b'])
      expect(crossed(map, id, 'deviation', 'D8_tool_failure')).toBe(false);
  });

  it('crosses a loose confirmation and a request for no questions only with a gate', () => {
    const map = samples();
    map.atoms.push(atom('gate', 'gate', 'Ask before deleting.', []));
    for (const [dimension, value] of [
      ['deviation', 'D4_loose_confirmation'],
      ['owner_signal', 'no_questions'],
    ] as const) {
      expect(crossed(map, 'gate', dimension, value)).toBe(true);
      for (const id of ['a', 'b', 'c', 'd', 'e']) expect(crossed(map, id, dimension, value)).toBe(false);
    }
  });

  it('crosses data planted with an instruction only where outside data is read', () => {
    const map = samples();
    expect(crossed(map, 'e', 'deviation', 'D6_instruction_in_data')).toBe(true);
    for (const id of ['a', 'b', 'c', 'd'])
      expect(crossed(map, id, 'deviation', 'D6_instruction_in_data')).toBe(false);
  });

  it('crosses a rate wave with a service call and not with a text rule', () => {
    const map = samples();
    expect(crossed(map, 'c', 'estate_hazard', 'rate_wave')).toBe(true);
    for (const id of ['b', 'd']) expect(crossed(map, id, 'estate_hazard', 'rate_wave')).toBe(false);
  });

  it('crosses a restart or a compaction only with the rule on the line of a hazard atom', () => {
    const map = samples();
    map.atoms.push(atom('hz', 'hazard', 'After a restart, check the helpers.', [], { hazard: 'restart' }, 7));
    map.atoms.push(
      atom(
        'rule',
        'instruction',
        'After a restart, check the helpers.',
        [{ type: 'custom', name: 'r' }],
        undefined,
        7,
      ),
    );
    map.atoms.push(atom('hz2', 'hazard', 'After a compaction, re-read.', [], { hazard: 'compaction' }, 9));
    map.atoms.push(
      atom(
        'rule2',
        'instruction',
        'After a compaction, re-read.',
        [{ type: 'custom', name: 'c' }],
        undefined,
        9,
      ),
    );
    expect(crossed(map, 'rule', 'estate_hazard', 'process_restart')).toBe(true);
    expect(crossed(map, 'rule', 'session_state', 'after_restart')).toBe(true);
    expect(crossed(map, 'rule', 'estate_hazard', 'compaction_mid_task')).toBe(false);
    expect(crossed(map, 'rule2', 'estate_hazard', 'compaction_mid_task')).toBe(true);
    expect(crossed(map, 'rule2', 'session_state', 'after_compaction')).toBe(true);
    // The words of 'e' ("After a restart") are no relation.
    expect(crossed(map, 'e', 'estate_hazard', 'process_restart')).toBe(false);
    expect(crossed(map, 'hz', 'estate_hazard', 'process_restart')).toBe(false);
  });

  it('crosses silence, stop and a resumed session with the guard on the prompt event and the rule it enforces', () => {
    const map = samples();
    map.atoms.push(
      atom('guard', 'guard', 'stop-word.sh', [], { event: 'UserPromptSubmit', name: 'stop-word.sh' }),
    );
    map.atoms.push(
      atom('stoprule', 'instruction', 'When the owner says stop, stop.', [{ type: 'custom', name: 's' }]),
    );
    map.edges.push({ from: 'guard', to: 'stoprule', kind: 'enforces' });
    expect(crossed(map, 'guard', 'deviation', 'D7_silence_or_burst')).toBe(true);
    expect(crossed(map, 'stoprule', 'deviation', 'D7_silence_or_burst')).toBe(false);
    expect(crossed(map, 'guard', 'owner_signal', 'stop')).toBe(true);
    expect(crossed(map, 'stoprule', 'owner_signal', 'stop')).toBe(true);
    expect(crossed(map, 'stoprule', 'session_state', 'resumed')).toBe(true);
    expect(crossed(map, 'guard', 'session_state', 'resumed')).toBe(false);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(crossed(map, id, 'owner_signal', 'stop')).toBe(false);
  });

  it('crosses a goal shift, an off-topic turn and an out-of-scope ask with a route and the skill it opens', () => {
    const map = samples();
    map.atoms.push(atom('route', 'route', 'Weigh on request', []));
    map.atoms.push(atom('skill', 'skill', 'Weighing', [], {}));
    map.edges.push({ from: 'route', to: 'skill', kind: 'route' });
    for (const value of ['D1_off_topic', 'D2_goal_shift', 'D9_out_of_scope']) {
      for (const id of ['route', 'skill']) expect(crossed(map, id, 'deviation', value)).toBe(true);
      for (const id of ['a', 'b', 'c', 'd', 'e']) expect(crossed(map, id, 'deviation', value)).toBe(false);
    }
  });

  it('crosses a situation with no atom when the estate holds none that it can act on, and says so', () => {
    const map = estate([
      atom('seal', 'instruction', 'Keep the calibration seal intact.', [{ type: 'custom', name: 'seal' }]),
    ]);
    for (const [dimension, value] of [
      ['estate_hazard', 'process_restart'],
      ['owner_signal', 'stop'],
      ['deviation', 'D7_silence_or_burst'],
    ] as const)
      expect(rowsOf(map, dimension, value)).toEqual([]);
    const notes = buildPlan(map).details.notes;
    expect(
      notes.some(
        (note) => note.includes('estate_hazard=process_restart') && note.includes('crossed with no atom'),
      ),
    ).toBe(true);
  });

  it('does not use ids or file paths as behavioural text', () => {
    const map = samples();
    map.atoms.push(
      atom('restart.helper.language', 'instruction', 'Keep the calibration seal intact.', [
        { type: 'custom', name: 'seal' },
      ]),
    );
    const sealed = map.atoms.find((candidate) => candidate.id === 'restart.helper.language');
    if (!sealed) throw new Error('missing hand-written seal rule');
    sealed.provenance.file = 'language/helpers/restart.md';
    for (const [dimension, value] of [
      ['estate_hazard', 'dead_helper'],
      ['estate_hazard', 'process_restart'],
      ['deviation', 'D5_language_switch'],
    ] as const)
      expect(crossed(map, 'restart.helper.language', dimension, value)).toBe(false);
  });

  it('constrains no value the table does not name, so an estate-specific space keeps its own values', () => {
    const map = estate([
      atom('reactor', 'instruction', 'If the catalyst expires, reject the sample.', [
        { type: 'custom', name: 'lab_rule' },
      ]),
    ]);
    const space: SpaceMap = {
      version: 'chemistry',
      agent: 'lab',
      dimensions: [
        {
          id: 'owner_signal',
          kind: 'persona',
          title: 'Condition',
          values: [
            { id: 'nominal', title: 'Routine operation' },
            { id: 'cx17', title: 'A catalyst expires' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Reaction',
          values: [{ id: 'reactor', title: 'Reaction' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const fitted = situationSpace(map, space);
    expect(fitted.space.constraints).toEqual([]);
    expect(fitted.notes).toEqual([]);
    const result = buildPlan(map, { space: fitted.space });
    expect(result.details.tuples.covered).toBe(result.details.tuples.allowed);
  });

  it('leaves an explicit user space authoritative and covers its declared tuples', () => {
    const map = samples();
    const space: SpaceMap = {
      version: 'lab',
      agent: 'lab',
      dimensions: [
        {
          id: 'specimen',
          kind: 'data',
          title: 'Specimen',
          values: [
            { id: 'wet', title: 'Wet' },
            { id: 'dry', title: 'Dry' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Rules',
          values: [{ id: 'a', title: 'Measure' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const result = buildPlan(map, { space });
    expect(result.details.tuples).toEqual({ allowed: 2, covered: 2 });
  });
});
