import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInventoryText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { fixtureFiles, MAP_FIXTURES } from '../../src/ladders/map/fixtures';
import { ROOT } from './support';

const SEEDS = [1, 2];

describe('the map fixtures', () => {
  // Set MAP_FIXTURES_WRITE=1 to rewrite the files after a deliberate change to the renderer or the specification.
  if (process.env.MAP_FIXTURES_WRITE === '1') {
    for (const seed of SEEDS) {
      const folder = join(ROOT, MAP_FIXTURES, `seed-${seed}`);
      mkdirSync(folder, { recursive: true });
      for (const [name, text] of Object.entries(fixtureFiles(seed))) writeFileSync(join(folder, name), text);
    }
  }

  it.each(SEEDS)('seed %i renders byte for byte to the files in the fixtures folder', (seed) => {
    for (const [name, text] of Object.entries(fixtureFiles(seed))) {
      expect(
        readFileSync(join(ROOT, MAP_FIXTURES, `seed-${seed}`, name), 'utf8'),
        `seed-${seed}/${name}`,
      ).toBe(text);
    }
  });

  it('holds an inventory the core reader accepts', () => {
    const text = readFileSync(join(ROOT, MAP_FIXTURES, 'seed-1', 'inventory.yaml'), 'utf8');
    expect(parseInventoryText(text, 'yaml').ok).toBe(true);
  });
});
