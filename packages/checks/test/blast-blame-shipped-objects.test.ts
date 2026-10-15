import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockCacheKey,
  cacheSpecHash,
  canonicalGiven,
  findSpecFiles,
  objectContextFor,
  parseSpecText,
  resolveGiven,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the release tools, with no types.
import { packFiles } from '../../../tools/release/check.mjs';
import { blame } from '../src';

/**
 * Blast radius of PR 447 on what ships: the policy/blame and policy/placement files are data under
 * `packages/checks/objects/`, read at import time by `registerBlameObjects`. They must be in the published
 * package, the built JavaScript must find them beside `dist/`, and registering them must change no example spec
 * hash and no block cache key.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CHECKS = join(ROOT, 'packages/checks');
const SHIPPED = Object.values(blame.SHIPPED_OBJECT_FILES).map((file) => `objects/${file}`);

describe('the published checks package', { timeout: 120_000 }, () => {
  it('packs every shipped object file the registry reads at import', () => {
    const pack = packFiles(CHECKS) as { files: string[] };
    expect(SHIPPED.length).toBeGreaterThanOrEqual(2);
    expect(SHIPPED.filter((file) => !pack.files.includes(file))).toEqual([]);
  });
});

/** Builds the JavaScript of a package with its own tsup command, less the declarations, as built-validate does. */
function buildJavaScript(name: string): void {
  const folder = join(ROOT, 'packages', name);
  const command = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts.build as string;
  const words = command.split(' ').filter((word) => word !== '--dts' && word !== '--clean');
  const built = spawnSync('pnpm', ['exec', ...words, '--silent'], { cwd: folder, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`building ${name} failed\n${built.stdout}\n${built.stderr}`);
}

describe('the built checks package', () => {
  beforeAll(() => {
    for (const name of ['stats', 'core', 'checks']) buildJavaScript(name);
  }, 300_000);

  it('loads with plain Node.js, finds objects/ beside dist/ and resolves both shipped defaults', () => {
    const script = [
      `const checks = await import(${JSON.stringify(join(CHECKS, 'dist/index.js'))});`,
      'const blame = checks.blame.shippedPolicy("policy/blame");',
      'const placement = checks.blame.shippedPolicy("policy/placement");',
      'console.log(JSON.stringify({ dir: checks.blame.objectsDir(), blame: blame.items.length, placement: placement.items.length }));',
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout) as { dir: string; blame: number; placement: number };
    expect(out.dir).toBe(`${join(CHECKS, 'objects')}/`);
    expect(out).toMatchObject({ blame: 32, placement: 13 });
  });
});

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 16);

function keysDigest(spec: Spec, specHash: string): string {
  const target = spec.target ?? { adapter: 'stand-in' };
  return sha(
    spec.blocks
      .map((block, index) => {
        try {
          const canonical = canonicalGiven(spec, index);
          const given = resolveGiven(canonical.state, canonical.prefix, target);
          return blockCacheKey({
            specHash,
            repeat: 0,
            position: index,
            given,
            stimulus: block.when,
            target,
            adapter: 'stand-in',
            adapterVersion: '0',
          });
        } catch (cause) {
          return `error:${cause instanceof Error ? cause.message : String(cause)}`;
        }
      })
      .join('\n'),
  );
}

describe('the registered shipped objects change no hash', () => {
  it('keeps the HF1 baseline spec hash and block cache keys with the checks package loaded', async () => {
    expect(blame.shippedPolicy('policy/blame').items.length).toBe(32);
    const rows = readFileSync(join(ROOT, 'packages/core/test/fixtures/framework/hf1-baseline.tsv'), 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('\t') as [string, string, string, string, string]);
    const files = new Map<string, string>();
    for (const path of await findSpecFiles([join(ROOT, 'examples')]))
      files.set(relative(ROOT, path).split('\\').join('/'), path);
    let compared = 0;
    const changed: string[] = [];
    for (const [file, fileSha, hash, keys] of rows) {
      const path = files.get(file);
      if (path === undefined) continue;
      const bytes = readFileSync(path);
      if (sha(bytes) !== fileSha) continue;
      const format = extname(path).toLowerCase() === '.json' ? 'json' : 'yaml';
      const result = parseSpecText(bytes.toString('utf8'), format, path, {
        objects: () => objectContextFor(path),
      });
      if (!result.ok) continue;
      compared += 1;
      if (result.hash !== hash) changed.push(`${file}: spec hash`);
      if (keysDigest(result.spec, cacheSpecHash(result.spec)) !== keys) changed.push(`${file}: cache keys`);
    }
    expect(changed).toEqual([]);
    expect(compared).toBeGreaterThanOrEqual(1_000);
  }, 180_000);

  it('a spec that uses the shipped blame and placement policies resolves them and keeps its block cache keys', () => {
    const path = join(ROOT, 'examples/acme/specs/conversations/number-porting.yaml');
    const plain = readFileSync(path, 'utf8');
    const parse = (text: string) =>
      parseSpecText(text, 'yaml', path, { objects: () => objectContextFor(path) });
    const before = parse(plain);
    const after = parse(`uses:\n  blame: default\n  placement: default\n${plain}`);
    expect(before.ok).toBe(true);
    expect(after.ok ? [] : after.errors.map((issue) => issue.code)).toEqual([]);
    if (!before.ok || !after.ok) return;
    expect(after.hash).not.toBe(before.hash);
    expect(cacheSpecHash(after.spec)).toBe(cacheSpecHash(before.spec));
    expect(keysDigest(after.spec, cacheSpecHash(after.spec))).toBe(
      keysDigest(before.spec, cacheSpecHash(before.spec)),
    );
  });
});
