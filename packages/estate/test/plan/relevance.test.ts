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
): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: 'POLICY.md', startLine: 1, endLine: 1, quote, hash: id },
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
const cells = (map: EstateMap) => buildPlan(map).plan.rows.filter((row) => row.id.startsWith('pairwise.'));
const crosses = (rows: ReturnType<typeof cells>, id: string, dimension: string, value: string) =>
  rows.some((row) => row.atomIds[0] === id && row.cell[dimension] === value);

/** One atom of every kind a situation value can name, with words that say nothing about the situation. */
const samples = () =>
  estate(
    [
      atom('rule', 'instruction', 'Keep the calibration seal intact.', [{ type: 'custom', name: 'seal' }]),
      atom('gate', 'gate', 'Weigh the sample before dosing.', [
        { type: 'ordered', before: 'Read', after: 'Bash' },
      ]),
      atom('voice', 'register', 'Keep replies concise.', [{ type: 'text', mustNot: ['verbose'] }]),
      atom('step', 'stage', 'Update the tracker.', [{ type: 'stage_reached', name: 'record' }]),
      atom('skill', 'skill', 'Unused identifier', [{ type: 'skill_loaded', name: 'skill' }], {
        description: 'Analyze the specimen.',
      }),
      atom('helper', 'subagent', 'Unused identifier', [{ type: 'tool_called', label: 'Agent' }]),
      atom('to-helper', 'route', 'Send specimens for analysis.', [{ type: 'custom', name: 'choose' }]),
      atom('to-skill', 'route', 'Send readings for the skill.', [{ type: 'custom', name: 'choose_skill' }]),
      atom('tool', 'tool', 'Measure', [{ type: 'tool_called', label: 'Measure' }]),
      atom('guard', 'guard', 'Seal guard', [{ type: 'guard', name: 'seal.sh' }]),
      atom('script', 'script', 'Calibrate', [{ type: 'tool_called', label: 'Bash' }]),
    ],
    [
      { from: 'to-helper', to: 'helper', kind: 'route' },
      { from: 'to-skill', to: 'skill', kind: 'route' },
    ],
  );

describe('situation relevance follows the kinds a situation acts on and the links of the map', () => {
  it('crosses a language switch with output rules and instructions only', () => {
    const rows = cells(samples());
    for (const id of ['voice', 'rule'])
      expect(crosses(rows, id, 'deviation', 'D5_language_switch')).toBe(true);
    for (const id of ['step', 'tool', 'guard', 'script', 'helper', 'skill', 'to-helper', 'gate'])
      expect(crosses(rows, id, 'deviation', 'D5_language_switch'), id).toBe(false);
  });

  it('crosses a tool failure with tools, scripts, guards, helpers, skills and routes, not with a rule that mentions a tool', () => {
    const rows = cells(samples());
    for (const id of ['tool', 'script', 'guard', 'helper', 'skill', 'to-skill'])
      expect(crosses(rows, id, 'deviation', 'D8_tool_failure'), id).toBe(true);
    for (const id of ['rule', 'voice', 'step', 'gate'])
      expect(crosses(rows, id, 'deviation', 'D8_tool_failure'), id).toBe(false);
  });

  it('crosses a dead helper with helpers and the routes the map links to a helper, not with other routes', () => {
    const rows = cells(samples());
    expect(crosses(rows, 'helper', 'estate_hazard', 'dead_helper')).toBe(true);
    expect(crosses(rows, 'to-helper', 'estate_hazard', 'dead_helper')).toBe(true);
    for (const id of ['to-skill', 'rule', 'tool'])
      expect(crosses(rows, id, 'estate_hazard', 'dead_helper'), id).toBe(false);
  });

  it('reads no word of an atom: a rule that names a restart, a language or a helper gains nothing from it', () => {
    const map = samples();
    map.atoms.push(
      atom('talky', 'script', 'After a restart, answer in the language of the helper agent and restart.', [
        { type: 'custom', name: 'talky' },
      ]),
    );
    const rows = cells(map);
    for (const [dimension, value] of [
      ['estate_hazard', 'process_restart'],
      ['deviation', 'D5_language_switch'],
      ['estate_hazard', 'dead_helper'],
    ] as const)
      expect(crosses(rows, 'talky', dimension, value), value).toBe(false);
  });

  it('reads no id or path: an atom named and filed after a helper, a tracker and a tool is still an instruction', () => {
    const map = samples();
    map.atoms.push(
      atom('dead.helper.tracker.tool', 'instruction', 'Keep the calibration seal intact.', [
        { type: 'custom', name: 'seal' },
      ]),
    );
    const named = map.atoms.at(-1);
    if (named) named.provenance.file = 'helpers/tracker/tool-failure.md';
    const rows = cells(map);
    for (const [dimension, value] of [
      ['estate_hazard', 'dead_helper'],
      ['session_state', 'helpers_running'],
      ['estate_hazard', 'stale_tracker'],
      ['deviation', 'D8_tool_failure'],
    ] as const)
      expect(crosses(rows, 'dead.helper.tracker.tool', dimension, value), value).toBe(false);
    expect(rows.some((row) => row.atomIds[0] === 'dead.helper.tracker.tool')).toBe(true);
  });

  it('retains a situation value no table names, with a note, instead of reporting vacuous coverage', () => {
    const map = estate([
      atom('seal', 'instruction', 'Keep the seal intact.', [{ type: 'custom', name: 'seal' }]),
    ]);
    const built = buildPlan(map);
    expect(cells(map).some((row) => row.cell.owner_signal === 'frustration')).toBe(true);
    expect(
      built.details.notes.some((note) => note.includes('no relevant target') && note.includes('retained')),
    ).toBe(true);
  });

  it('infers nothing for a space the user wrote: its own values and constraints stand', () => {
    const map = estate([
      atom('reactor', 'instruction', 'If the catalyst expires, reject the sample.', [
        { type: 'custom', name: 'lab_rule' },
      ]),
      atom('voice', 'register', 'Keep replies concise.', [{ type: 'text', mustNot: ['verbose'] }]),
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
        {
          id: 'atoms.register',
          kind: 'behaviour',
          title: 'Voice',
          values: [{ id: 'voice', title: 'Voice' }],
        },
      ],
      constraints: [
        { forbid: { owner_signal: 'cx17', 'atoms.register': 'voice' }, reason: 'declared by the owner' },
      ],
      prior: { kind: 'declared' },
    };
    const fitted = situationSpace(map, space);
    expect(fitted.space.constraints).toEqual(space.constraints);
    const result = buildPlan(map, { space: fitted.space });
    expect(result.details.tuples.covered).toBe(result.details.tuples.allowed);
    expect(
      result.plan.rows.some(
        (row) =>
          row.id.startsWith('pairwise.') && row.atomIds[0] === 'voice' && row.cell.owner_signal === 'cx17',
      ),
    ).toBe(false);
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
          values: [{ id: 'rule', title: 'Seal' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const result = buildPlan(map, { space });
    expect(result.details.tuples).toEqual({ allowed: 2, covered: 2 });
  });
});
