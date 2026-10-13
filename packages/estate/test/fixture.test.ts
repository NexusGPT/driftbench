import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { approveAtoms, loadEstateMap, toEstateSpaceMap } from '../src/index';
import { FIXTURE, scanFixture } from './support';

describe('the committed fixture outputs', () => {
  it('map.yaml is what a scan with the recorded answers gives today', async () => {
    const committed = await loadEstateMap(join(FIXTURE, 'map.yaml'));
    if (!committed.ok) throw new Error(JSON.stringify(committed.errors));
    const fresh = (await scanFixture()).map;
    expect(committed.map.hash).toBe(fresh.hash);
    expect(committed.map.atoms).toEqual(fresh.atoms);
    expect(committed.map.edges).toEqual(fresh.edges);
    expect(committed.map.root).toBe('.');
  });

  it('approved.yaml is map.yaml with every atom approved, and space.yaml is its space map', async () => {
    const text = await readFile(join(FIXTURE, 'map.yaml'), 'utf8');
    const approved = approveAtoms(text, { all: true });
    if (!approved.ok) throw new Error('invalid');
    expect(await readFile(join(FIXTURE, 'approved.yaml'), 'utf8')).toBe(approved.text);
    const map = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    const space = await loadSpaceMap(join(FIXTURE, 'space.yaml'));
    if (!map.ok || !space.ok) throw new Error('invalid');
    expect(space.map).toEqual(toEstateSpaceMap(map.map, { agent: 'northwind' }));
  });
});
