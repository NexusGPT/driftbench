import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pointerBank, pointerFixtures, pointerModuleDir, takeSnapshot, useSnapshot } from './pointer';
import type { Tape } from './tape';
import { replayImpl } from './tape';

export type ChildRecording = {
  items: Array<{ id: string; tape: Tape; loadError?: string }>;
  changed: boolean;
};

const CHILD = fileURLToPath(new URL('./pointer-child-entry.ts', import.meta.url));

/**
 * The Node.js arguments that start the child. From source it is pointer-child-entry.ts, loaded through tsx. A built
 * package has no .ts beside it, so the child is the package's own entry point, which exports the same routine; it
 * still loads tsx when the checkout has it, because the module under audit is TypeScript.
 */
export function childCommand(moduleUrl: string, root: string, rest: readonly string[]): string[] {
  if (moduleUrl.endsWith('.ts')) return ['--import', 'tsx', CHILD, ...rest];
  const entry = new URL('./index.js', moduleUrl).href;
  let loader: string[] = [];
  try {
    loader = ['--import', pathToFileURL(createRequire(join(root, 'package.json')).resolve('tsx')).href];
  } catch {
    // No tsx in this checkout: the child runs on plain Node.js.
  }
  return [
    ...loader,
    '--input-type=module',
    '--eval',
    `import { pointerBankChild } from ${JSON.stringify(entry)}; await pointerBankChild(process.argv.slice(1));`,
    ...rest,
  ];
}

/** Runs the pointer items against the module in a child process with locked built-ins; resolves to the recorded calls. */
export function recordPointerChild(
  seed: number,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  budgetMs = 600_000,
): Promise<ChildRecording> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childCommand(import.meta.url, root, [String(seed), root]), {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const token = randomBytes(16).toString('hex');
    child.stdin.end(token);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the pointer bank did not finish in ${budgetMs} ms`));
    }, budgetMs);
    child.on('error', (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out
        .split('\n')
        .filter((l) => l.startsWith(`${token} `))
        .pop()
        ?.slice(token.length + 1);
      if (code !== 0 || !line) {
        return reject(
          new Error(`the pointer child exited ${code}: ${err.split('\n').slice(0, 6).join(' | ')}`),
        );
      }
      try {
        resolve(JSON.parse(line) as ChildRecording);
      } catch (cause) {
        reject(cause as Error);
      }
    });
  });
}

export type ChildResult = {
  id: string;
  family: string;
  tier: number;
  component: string;
  cause: string;
  misses: string[];
};

/**
 * The verdict of the pointer level on one seed. The module runs in the child and only its answers come back; every
 * item then runs here, in this process, against those recorded answers.
 */
export async function runPointerChild(
  seed: number,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  budgetMs = 600_000,
): Promise<ChildResult[]> {
  const dir = pointerModuleDir(root);
  const before = takeSnapshot(dir);
  useSnapshot(before);
  let recording: ChildRecording;
  try {
    recording = await recordPointerChild(seed, root, env, budgetMs);
  } catch (cause) {
    useSnapshot(undefined);
    throw cause;
  }
  const after = takeSnapshot(dir);
  const rewritten =
    [...before].some(([file, text]) => after.get(file) !== text) || after.size !== before.size;
  const tapes = new Map(recording.items.map((entry) => [entry.id, entry]));
  const fixtures = pointerFixtures(root);
  const rows: ChildResult[] = [];
  for (const item of pointerBank()) {
    const base = {
      id: item.id,
      family: item.family,
      tier: item.tier,
      component: item.component,
      cause: item.cause,
    };
    let misses: string[];
    if (item.id.includes('/source/')) {
      misses = await item.run({} as never, fixtures, seed, root);
    } else {
      const recorded = tapes.get(item.id);
      if (!recorded) misses = ['the module run holds no record of this item'];
      else if (recorded.loadError) misses = [recorded.loadError];
      else {
        const { impl, problems } = replayImpl(recorded.tape);
        try {
          misses = await item.run(impl as never, fixtures, seed, root);
        } catch (cause) {
          misses = [`threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`];
        }
        if (problems.length > 0) misses = [...misses, ...problems.slice(0, 2)];
      }
      if (recording.changed || rewritten)
        misses = [...misses, 'the module changed its own files while it ran'];
    }
    rows.push({ ...base, misses });
  }
  useSnapshot(undefined);
  return rows;
}
