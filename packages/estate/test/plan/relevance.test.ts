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

describe('situation relevance is not read from the words of the estate', () => {
  it('crosses every situation with every target whatever their words share: no word decides relevance', () => {
    // "restart" in the quote of e and in the title of process_restart, "language" in b and in D5: a word reader would
    // keep those pairs and drop the measurement instruction a from both.
    const rows = cells(samples());
    for (const id of ['a', 'b', 'e']) {
      expect(
        rows.some((row) => row.atomIds[0] === id && row.cell.estate_hazard === 'process_restart'),
        id,
      ).toBe(true);
      expect(
        rows.some((row) => row.atomIds[0] === id && row.cell.deviation === 'D5_language_switch'),
        id,
      ).toBe(true);
    }
  });

  it('adds no constraint to the declared space and names each event value it leaves unresolved', () => {
    const map = samples();
    const space: SpaceMap = {
      version: 'lab',
      agent: 'lab',
      dimensions: [
        {
          id: 'estate_hazard',
          kind: 'data',
          title: 'A hazard',
          values: [
            { id: 'no_hazard', title: 'No hazard' },
            { id: 'process_restart', title: 'The process restarts' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Rules',
          values: [
            { id: 'a', title: 'Measure' },
            { id: 'e', title: 'After a restart, read the laboratory notebook.' },
          ],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const out = situationSpace(map, space);
    expect(out.space.constraints).toEqual([]);
    expect(out.notes).toEqual([
      'estate_hazard=process_restart: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.',
    ]);
  });

  it('retains situations with unresolved relevance instead of reporting vacuous coverage', () => {
    const map = estate([
      atom('seal', 'instruction', 'Keep the calibration seal intact.', [{ type: 'custom', name: 'seal' }]),
    ]);
    expect(cells(map).some((row) => row.cell.estate_hazard === 'process_restart')).toBe(true);
    expect(
      buildPlan(map).details.notes.some(
        (note) => note.includes('relevance is unresolved') && note.includes('retained'),
      ),
    ).toBe(true);
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
