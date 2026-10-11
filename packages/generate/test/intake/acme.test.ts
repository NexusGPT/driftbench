import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  detectPass1,
  fromInterview,
  loadIntakeMap,
  loadTurnRecording,
  parseApproval,
  parseInterview,
  planCells,
  type ReferenceSet,
  renderApproval,
  renderReferenceSet,
  turnRecordingPort,
} from '../../src/intake';
import { ACME } from './support';

const DIR = `${ACME}reference/`;

async function inputs() {
  const loaded = await loadIntakeMap(`${ACME}map/approved.yaml`);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const parsed = parseInterview(await readFile(`${DIR}answers.yaml`, 'utf8'), loaded.map);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { map: loaded.map, interview: parsed.interview };
}

describe('the Acme reference set (path ii)', () => {
  it('has answers that match the approved map', async () => {
    const { interview } = await inputs();
    expect(interview.personas.map((persona) => persona.id)).toEqual(['upgrader', 'home-mover', 'switcher']);
  });

  it('regenerates byte for byte from the answers and the recording', async () => {
    const { map, interview } = await inputs();
    const committed = await readFile(`${DIR}reference.yaml`, 'utf8');
    const at = (parseYaml(committed) as ReferenceSet).produced_by.at;
    const recording = await loadTurnRecording(`${DIR}recorded.yaml`);
    if (!recording.ok) throw new Error(recording.message);
    const plan = planCells(interview, map, { total: 30, minPerCell: 1 });
    const result = await fromInterview(interview, map, plan, {
      port: turnRecordingPort(recording.recording),
      paths: { interview: 'answers.yaml', map: '../map/approved.yaml' },
      now: () => new Date(at),
    });
    expect(result.runs.every((run) => run.status === 'done')).toBe(true);
    expect(renderReferenceSet(result.set)).toBe(committed);
    expect(renderApproval(result.set, 'reference.yaml')).toBe(await readFile(`${DIR}approval.yaml`, 'utf8'));
  });

  it('is committed unapproved: a person approves each turn', async () => {
    const approval = parseApproval(await readFile(`${DIR}approval.yaml`, 'utf8'));
    expect(approval.ok).toBe(true);
    if (!approval.ok) return;
    expect(approval.approval.turns.length).toBeGreaterThan(0);
    expect(approval.approval.turns.every((turn) => turn.approved === false)).toBe(true);
  });

  it('places every turn on approved map values, with weights that sum to 1', async () => {
    const { map } = await inputs();
    const set = parseYaml(await readFile(`${DIR}reference.yaml`, 'utf8')) as ReferenceSet;
    for (const turn of set.turns) {
      for (const [dimension, value] of Object.entries(turn.cell)) {
        if (dimension === 'persona' || dimension === 'lang') continue;
        const values = map.dimensions
          .find((entry) => entry.id === dimension)
          ?.values.map((entry) => entry.id);
        expect(values, `${turn.id} ${dimension}`).toContain(value);
      }
    }
    expect(set.cells.reduce((sum, cell) => sum + cell.weight, 0)).toBeCloseTo(1, 4);
  });

  it('holds reserved fictional data only', async () => {
    const set = parseYaml(await readFile(`${DIR}reference.yaml`, 'utf8')) as ReferenceSet;
    const real = set.turns.flatMap((turn) =>
      detectPass1(turn.text).filter((finding) => finding.type !== 'address' && !finding.fictional),
    );
    expect(real).toEqual([]);
  });
});
