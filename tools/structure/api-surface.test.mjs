// The public API gate: the names every package exports are frozen in tools/structure/api-surface.json.
// A pull request that adds or removes a public name fails here until it regenerates that file
// (node tools/structure/api-surface.mjs --write), which puts the change in front of a reviewer.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TOOL = fileURLToPath(new URL('./api-surface.mjs', import.meta.url));
const SNAPSHOT = fileURLToPath(new URL('./api-surface.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

describe('public API', () => {
  it('matches the frozen list of exports', () => {
    const check = run('--check');
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  }, 120_000);

  it('names an export that was added and one that was removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'driftbench-api-'));
    try {
      const frozen = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
      const removed = frozen.packages.stats.values.pop();
      frozen.packages.stats.values.push('zzNeverExported');
      const altered = join(dir, 'api-surface.json');
      writeFileSync(altered, JSON.stringify(frozen));
      const check = run('--check', '--snapshot', altered);
      expect(check.status).toBe(1);
      expect(check.stderr).toContain(`  added    stats: value ${removed}`);
      expect(check.stderr).toContain('  removed  stats: value zzNeverExported');
      expect(check.stderr).toContain('node tools/structure/api-surface.mjs --write');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('no package entry re-exports a whole module: every public name is written out', () => {
    const packages = fileURLToPath(new URL('../../packages', import.meta.url));
    const starred = readdirSync(packages)
      .map((name) => join(packages, name, 'src/index.ts'))
      .filter((file) => existsSync(file) && /^export \* from /m.test(readFileSync(file, 'utf8')));
    expect(starred, 'write the names out: export { a, type B } from "./module"').toEqual([]);
  });

  it('the frozen list is sorted and holds every package', () => {
    const frozen = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    expect(Object.keys(frozen.packages).length).toBeGreaterThan(10);
    for (const kinds of Object.values(frozen.packages)) {
      expect(kinds.values).toEqual([...kinds.values].sort());
      expect(kinds.types).toEqual([...kinds.types].sort());
    }
  });
});
