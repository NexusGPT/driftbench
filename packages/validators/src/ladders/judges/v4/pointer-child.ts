/**
 * What the pointer level runs in: a child process whose built-in objects are read-only before the module under
 * test is imported (`lock.ts`), so the module cannot change the way the bank counts its misses. The child runs
 * every item of the pointer bank on one seed and prints one JSON line. Usage: <seed> <root>, with
 * DRIFTBENCH_POINTER_IMPL naming a copy of the module, as in `loadPointerImpl`.
 */
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as module_ from 'node:module';
import { dirname, join, resolve } from 'node:path';
import * as vm from 'node:vm';
import * as workerThreads from 'node:worker_threads';
import { disableProcessControl, lockIntrinsics, lockProcess } from './lock';

// The token comes on stdin and is read before any module under audit is imported: only a line that starts with it
// is believed by the parent, so a module cannot print a verdict of its own.
const TOKEN = fs.readFileSync(0, 'utf8').trim();
const write = process.stdout.write.bind(process.stdout);
const realExit = disableProcessControl();
lockIntrinsics();
lockProcess([fs, fsPromises, childProcess, crypto, module_, vm, workerThreads]);

/** A hash of every file under a folder (node_modules included), so a module that rewrites itself is seen. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(`${path.slice(dir.length)}\0`).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function moduleTree(): string | undefined {
  const impl = process.env.DRIFTBENCH_POINTER_IMPL;
  return impl ? dirname(dirname(resolve(impl))) : undefined;
}

async function main(): Promise<void> {
  const [seedText, root] = process.argv.slice(2);
  const seed = Number(seedText);
  const tree = moduleTree();
  const before = tree ? treeHash(tree) : undefined;
  const { loadPointerImpl, pointerBank, pointerFixtures } = await import('./pointer');
  const fixtures = pointerFixtures(root as string);
  let impl: Awaited<ReturnType<typeof loadPointerImpl>> | undefined;
  let loadError: string | undefined;
  try {
    impl = await loadPointerImpl();
  } catch (cause) {
    loadError = `the module under audit did not load: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
  }
  const results: Array<{
    id: string;
    family: string;
    tier: number;
    component: string;
    cause: string;
    misses: string[];
  }> = [];
  for (const item of pointerBank()) {
    let misses: string[];
    if (!impl) misses = [loadError ?? 'the module under audit did not load'];
    else {
      try {
        misses = await item.run(impl, fixtures, seed, root as string);
      } catch (cause) {
        misses = [`threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`];
      }
    }
    results.push({
      id: item.id,
      family: item.family,
      tier: item.tier,
      component: item.component,
      cause: item.cause,
      misses,
    });
  }
  if (tree && treeHash(tree) !== before) {
    for (const row of results) row.misses.push('the module changed its own files while it ran');
  }
  write(`${TOKEN} ${JSON.stringify(results)}\n`, () => realExit());
}

main().catch((cause) => {
  process.stderr.write(`pointer child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
  realExit();
});
