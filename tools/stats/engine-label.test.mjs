import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWN_ENGINE_ITEM, labelFailures } from './engine-label.mjs';

const SCRIPT = fileURLToPath(new URL('./engine-label.mjs', import.meta.url));
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const report = (...ids) => ({
  level: 6,
  seeds: [{ seed: 1, level: 6 }],
  failingItems: ids.map((id) => ({ id, seeds: ['1'], detail: `${id} failed` })),
});

describe('the label of the known Node 24 engine issue', () => {
  it('labels the shifted bootstrap item on Node 24 as the known engine issue and does not fail the run', () => {
    const got = labelFailures(report(KNOWN_ENGINE_ITEM), 24);
    expect(got.known).toEqual([KNOWN_ENGINE_ITEM]);
    expect(got.unexpected).toEqual([]);
    expect(got.lines.join('\n')).toContain('known engine issue');
    expect(got.lines.join('\n')).toContain('validators/stats/GATE.md');
  });

  it('fails the run on any other failing item on Node 24', () => {
    const got = labelFailures(report(KNOWN_ENGINE_ITEM, 'stability.mean-shift-1000000'), 24);
    expect(got.known).toEqual([KNOWN_ENGINE_ITEM]);
    expect(got.unexpected).toEqual(['stability.mean-shift-1000000']);
  });

  it('labels nothing on Node 22: the same failure is a plain failure there, as the gate reads it', () => {
    const got = labelFailures(report(KNOWN_ENGINE_ITEM), 22);
    expect(got.known).toEqual([]);
    expect(got.unexpected).toEqual([KNOWN_ENGINE_ITEM]);
    expect(got.lines.join('\n')).not.toContain('known engine issue');
  });

  it('prints a clean run as clean', () => {
    const got = labelFailures(report(), 24);
    expect(got.unexpected).toEqual([]);
    expect(got.known).toEqual([]);
    expect(got.lines.join('\n')).toContain('no failing item');
  });

  it('exits 0 on the known item on Node 24, and 1 on it on Node 22', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-label-'));
    dirs.push(dir);
    const file = join(dir, 'report.json');
    writeFileSync(file, JSON.stringify(report(KNOWN_ENGINE_ITEM)));
    expect(execFileSync('node', [SCRIPT, file, '24'], { encoding: 'utf8' })).toContain('known engine issue');
    const on22 = spawnSync('node', [SCRIPT, file, '22'], { encoding: 'utf8' });
    expect(on22.status).toBe(1);
    expect(readFileSync(file, 'utf8')).toContain(KNOWN_ENGINE_ITEM);
  });
});
