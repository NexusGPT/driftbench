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

// Run 39707388146 (Node 24, the frame of #986): in a confined run, bootstrapCI answered a 3-field interval that it
// never returns (a result has clusters, iterations, method and seed too), the user-shaped run C answered a full
// one, and the frame tainted seed 12: every item of the seed failed with the same message.
const taintDetail = (call, ranA, seed = 12) =>
  `[reference, tier 1, cause: x differs from the reference values] the product's answer depends on how it is run, so no item of seed ${seed} counts: ${call}([[1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,0,1,1,1,0,0,1,0,0,1,1,0,1,1,1...): run A (confined: the validator folder and environment) answered ${ranA}, run C (user-shaped: a plain entry file per call under the tsx loader, the user's environment) answered {"clusters":80,"estimate":0.7421875,"iterations":2000,"lower":0.690625,"metho...`;
const IMPOSSIBLE = '{"estimate":0.5,"lower":0.2992980081982123,"upper":0.7007019918017877}';
const FULL =
  '{"clusters":80,"estimate":0.5,"iterations":2000,"lower":0.29,"method":"percentile","seed":1,"upper":0.70}';
const tainted = (detail, ids = ['reference.a.a', 'reference.b.b', 'scale.mean']) => ({
  level: 0,
  seeds: [{ seed: 12, level: 0 }],
  failingItems: ids.map((id) => ({ id, seeds: ['12'], detail })),
});

describe('the label of a seed tainted by the same engine issue in the frame', () => {
  it('labels a taint whose confined answer has a shape bootstrapCI never returns, once per seed', () => {
    const got = labelFailures(tainted(taintDetail('bootstrapCI', IMPOSSIBLE)), 24);
    expect(got.unexpected).toEqual([]);
    expect(got.known).toEqual(['seed 12 tainted by the frame']);
    const text = got.lines.join('\n');
    expect(text).toContain('known engine issue');
    expect(text).toContain('seed 12');
    expect(text).toContain('3 items');
  });

  it('fails the run on a taint with a full result of the right shape (a product that answers by how it is run)', () => {
    const got = labelFailures(tainted(taintDetail('bootstrapCI', FULL)), 24);
    expect(got.known).toEqual([]);
    expect(got.unexpected.length).toBeGreaterThan(0);
  });

  it('fails the run on a taint on another call, whatever the shape', () => {
    const got = labelFailures(tainted(taintDetail('wilsonInterval', IMPOSSIBLE)), 24);
    expect(got.known).toEqual([]);
    expect(got.unexpected.length).toBeGreaterThan(0);
  });

  it('fails the run on an item of the same seed that failed for another reason', () => {
    const run = tainted(taintDetail('bootstrapCI', IMPOSSIBLE));
    run.failingItems.push({ id: 'scale.quantile', seeds: ['12'], detail: 'got 3, expected 4' });
    const got = labelFailures(run, 24);
    expect(got.known).toEqual(['seed 12 tainted by the frame']);
    expect(got.unexpected).toEqual(['scale.quantile']);
  });

  it('keeps an item that failed on another seed too in the failures', () => {
    const run = tainted(taintDetail('bootstrapCI', IMPOSSIBLE));
    run.failingItems.push({ ...run.failingItems[0], id: 'reference.c.c', seeds: ['3', '12'] });
    expect(labelFailures(run, 24).unexpected).toEqual(['reference.c.c']);
  });

  it('labels nothing on Node 22: the same taint fails the gate there', () => {
    const got = labelFailures(tainted(taintDetail('bootstrapCI', IMPOSSIBLE)), 22);
    expect(got.known).toEqual([]);
    expect(got.unexpected).toEqual(['reference.a.a', 'reference.b.b', 'scale.mean']);
    expect(got.lines.join('\n')).not.toContain('known engine issue');
  });

  it('exits 0 on the taint on Node 24 and 1 on it on Node 22', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-label-'));
    dirs.push(dir);
    const file = join(dir, 'report.json');
    writeFileSync(file, JSON.stringify(tainted(taintDetail('bootstrapCI', IMPOSSIBLE))));
    expect(execFileSync('node', [SCRIPT, file, '24'], { encoding: 'utf8' })).toContain('seed 12');
    expect(spawnSync('node', [SCRIPT, file, '22'], { encoding: 'utf8' }).status).toBe(1);
  });
});
