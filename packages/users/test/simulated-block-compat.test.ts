import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  blockCacheKey,
  contentHash,
  loadSpecFile,
  type ResolvedGiven,
  type Spec,
  specHash,
  specIdentity,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createScriptedDriver } from '../src/index';

/**
 * Backward compatibility of `when.simulated_user`: a spec that does not use the key loads, hashes and gets
 * the same block cache keys as before it existed. The fixture holds one line per example spec (spec hash and a digest of its block cache keys), written
 * before the key was added. A change that alters any spec hash or any block cache key of the scripted driver
 * moves a line, and the failure names the file. A spec added later is not in the fixture and is not checked.
 */

const ROOT = resolve(__dirname, '../../..');
const FIXTURE = join(__dirname, 'fixtures', 'simulated-block-compat.json');
const FIXTURE_COMMIT = '35bc8cb87';

/** A Given that stays fixed: the key's other parts are what this check is about. */
const GIVEN: ResolvedGiven = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'compat' },
  hash: 'compat',
};

async function specFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await specFiles(path)));
    else if (/\.(ya?ml|json)$/.test(entry.name) && path.includes(`${'/'}specs${'/'}`)) out.push(path);
  }
  return out.sort();
}

async function lines(): Promise<{ lines: { file: string; value: string }[] }> {
  const files = await specFiles(join(ROOT, 'examples'));
  const driver = createScriptedDriver();
  const out: { file: string; value: string }[] = [];
  for (const file of files) {
    const loaded = await loadSpecFile(file);
    if (!loaded.ok) continue;
    const spec: Spec = loaded.spec;
    // A spec that names a folder of the checkout (a workspace seed read from disk) hashes its absolute path:
    // its hash moves with the checkout, not with this change, so it is left out and counted.
    if (JSON.stringify(spec).includes(ROOT)) continue;
    const { version: _version, ...unlabelled } = specIdentity(spec);
    const cacheSpecHash = contentHash(unlabelled);
    const keys: string[] = [];
    for (let index = 0; index < spec.blocks.length; index += 1) {
      const step = await driver.next({ spec, mode: 'F', blockIndex: index, history: [] });
      if (step.kind !== 'block') continue;
      keys.push(
        blockCacheKey({
          specHash: cacheSpecHash,
          repeat: 0,
          position: index,
          given: GIVEN,
          stimulus: step.stimulus,
          target: GIVEN.target,
          adapter: 'compat',
          adapterVersion: '0',
        }),
      );
    }
    out.push({
      file: relative(ROOT, file),
      value: `${specHash(spec)} ${createHash('sha256').update(keys.join(',')).digest('hex')}`,
    });
  }
  return { lines: out };
}

/**
 * The estate generator rewrites its output tree by design (examples/estates/fixture/generated): those specs are
 * generator output, not specs written before the key. Every other file of the fixture is compared, all of them.
 */
const REGENERATED = 'examples/estates/fixture/generated/';
const COMPARABLE = Object.keys(
  (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { files: Record<string, string> }).files,
).filter((file) => !file.startsWith(REGENERATED)).length;

describe('when.simulated_user is invisible to specs that do not use it', () => {
  it(`every example spec of the fixture outside the generator's output (${COMPARABLE} files) keeps its spec hash and its block cache keys`, {
    timeout: 600_000,
  }, async () => {
    const now = await lines();
    const current = Object.fromEntries(now.lines.map((line) => [line.file, line.value]));
    if (process.env.DRIFTBENCH_WRITE_COMPAT === '1') {
      const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => (a < b ? -1 : 1)));
      await writeFile(FIXTURE, `${JSON.stringify({ commit: FIXTURE_COMMIT, files: sorted }, null, 1)}\n`);
    }
    const fixture = JSON.parse(await readFile(FIXTURE, 'utf8')) as { files: Record<string, string> };
    const comparable = Object.entries(fixture.files).filter(([file]) => !file.startsWith(REGENERATED));
    const moved = comparable.filter(([file, value]) => current[file] !== value).map(([file]) => file);
    // The set shrank from 2085 to 733 when #877 regenerated 1352 specs of the estate generator's output, and to
    // 732 when #1062 regenerated the acme specs (18 files left, 17 arrived), and to 728 when #1104 regenerated 167
    // example specs (20 files left, 16 arrived), and to 727 when the reducer read an injection as its class (one acme
    // cover spec fewer); every file of the comparable set must still load with the same hash and keys.
    expect(comparable.length).toBe(727);
    expect(moved).toEqual([]);
  });
});
