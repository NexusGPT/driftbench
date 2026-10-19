import { createHash } from 'node:crypto';
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
 * the same block cache keys as before it existed. The fixture holds one digest over every example spec,
 * written on main before the key was added (2026-10-18, a5aaf542f). A change that alters any spec hash or
 * any block cache key of the scripted driver changes the digest.
 *
 * To see which file moved, recompute the per-file lines below on both commits and diff them.
 */

const ROOT = resolve(__dirname, '../../..');
const FIXTURE = join(__dirname, 'fixtures', 'simulated-block-compat.json');

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

async function lines(): Promise<{ specs: number; blocks: number; located: number; lines: string[] }> {
  const files = await specFiles(join(ROOT, 'examples'));
  const driver = createScriptedDriver();
  const out: string[] = [];
  let specs = 0;
  let blocks = 0;
  let located = 0;
  for (const file of files) {
    const loaded = await loadSpecFile(file);
    if (!loaded.ok) continue;
    const spec: Spec = loaded.spec;
    // A spec that names a folder of the checkout (a workspace seed read from disk) hashes its absolute path:
    // its hash moves with the checkout, not with this change, so it is left out and counted.
    if (JSON.stringify(spec).includes(ROOT)) {
      located += 1;
      continue;
    }
    specs += 1;
    const { version: _version, ...unlabelled } = specIdentity(spec);
    const cacheSpecHash = contentHash(unlabelled);
    const keys: string[] = [];
    for (let index = 0; index < spec.blocks.length; index += 1) {
      const step = await driver.next({ spec, mode: 'F', blockIndex: index, history: [] });
      if (step.kind !== 'block') continue;
      blocks += 1;
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
    out.push(
      `${relative(ROOT, file)} ${specHash(spec)} ${createHash('sha256').update(keys.join(',')).digest('hex')}`,
    );
  }
  return { specs, blocks, located, lines: out };
}

describe('when.simulated_user is invisible to specs that do not use it', () => {
  it('every example spec keeps its spec hash and its block cache keys', { timeout: 600_000 }, async () => {
    const now = await lines();
    const digest = createHash('sha256').update(now.lines.join('\n')).digest('hex');
    if (process.env.DRIFTBENCH_WRITE_COMPAT === '1') {
      await writeFile(
        FIXTURE,
        `${JSON.stringify({ commit: 'a5aaf542f', specs: now.specs, blocks: now.blocks, located: now.located, digest }, null, 2)}\n`,
      );
    }
    const fixture = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      specs: number;
      blocks: number;
      located: number;
      digest: string;
    };
    expect(now.specs).toBe(fixture.specs);
    expect(now.blocks).toBe(fixture.blocks);
    expect(now.located).toBe(fixture.located);
    expect(digest).toBe(fixture.digest);
  });
});
