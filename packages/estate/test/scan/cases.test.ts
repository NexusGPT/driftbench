import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approveAtoms,
  ClaudeCodeReader,
  INFORMATION,
  lintEstate,
  loadEstateMap,
  scanEstate,
} from '../../src/index';
import { NOW, replayPointer } from '../support';
import { CASES } from './cases';

async function scanCases() {
  return scanEstate({
    root: CASES,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: await replayPointer(CASES),
  });
}

describe('the committed reader-cases outputs', () => {
  it('map.yaml is what a scan with the recorded labels gives today, with no refusal', async () => {
    const committed = await loadEstateMap(join(CASES, 'map.yaml'));
    if (!committed.ok) throw new Error(JSON.stringify(committed.errors));
    const fresh = await scanCases();
    expect(fresh.refusals).toEqual([]);
    expect(fresh.chunks.every((run) => run.status === 'done')).toBe(true);
    expect(committed.map.hash).toBe(fresh.map.hash);
    expect(committed.map.atoms).toEqual(fresh.map.atoms);
    expect(committed.map.edges).toEqual(fresh.map.edges);
  });

  it('approved.yaml is map.yaml with every atom approved', async () => {
    const approved = approveAtoms(await readFile(join(CASES, 'map.yaml'), 'utf8'), { all: true });
    if (!approved.ok) throw new Error('invalid');
    expect(await readFile(join(CASES, 'approved.yaml'), 'utf8')).toBe(approved.text);
  });

  it('lints cleanly when a shared bare name has one local match', async () => {
    const { map, raw } = await scanCases();
    const result = lintEstate(map, raw);
    expect(
      result.findings
        .filter((finding) => !INFORMATION.has(finding.code))
        .map((finding) => [finding.code, finding.subject]),
    ).toEqual([]);
    expect(
      map.atoms.find((atom) => atom.id === 'reference.shipment-tracker.read-notes-md')?.fields,
    ).toMatchObject({
      path: '.claude/skills/shipment-tracker/references/notes.md',
      exists: true,
      resolvedBy: 'suffix',
    });
    expect(raw.notes.map((note) => note.file)).toEqual(['.claude/skills/parcel-claims/SKILL.md']);
  });
});
