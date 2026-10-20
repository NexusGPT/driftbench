import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { blockCacheKey, findSpecFiles, parseSpecText, type ResolvedGiven } from '../../../src/index';

/** One example spec file: the sha of its text, its spec hash, and the digest of every block's cache key. */
export type ExampleKey = [file: string, spec: string, keys: string];

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

const GIVEN = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'probe' },
  hash: 'probe',
} as unknown as ResolvedGiven;

/**
 * The keys of every spec file under `examples/`, by path from the repo root. The block cache keys are taken with
 * a fixed Given, target and adapter, so what moves them is the spec hash and the block's stimulus: the two
 * places an optional key could leak into.
 */
export async function exampleKeys(root: string): Promise<Record<string, ExampleKey>> {
  const out: Record<string, ExampleKey> = {};
  for (const path of await findSpecFiles([join(root, 'examples')])) {
    const text = await readFile(path, 'utf8');
    const loaded = parseSpecText(text, path.endsWith('.json') ? 'json' : 'yaml', path);
    if (!loaded.ok) continue;
    const keys = loaded.spec.blocks.map((block, position) =>
      blockCacheKey({
        specHash: loaded.hash,
        repeat: 1,
        position,
        given: GIVEN,
        stimulus: block.when,
        target: { adapter: 'probe' },
        adapter: 'probe',
        adapterVersion: '1',
      }),
    );
    out[relative(root, path)] = [sha(text), loaded.hash, sha(keys.join('\n'))];
  }
  return out;
}
