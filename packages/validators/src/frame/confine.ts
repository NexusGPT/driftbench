import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { findRoot } from '../root';
import { FrameError } from './tape';
import type { TwinPlan } from './twins';

/**
 * The confinement of the frame's runs (docs/validators.md section 12.9). A source guard or a stack check can be
 * dodged by a product written to dodge it (a destructured error stack, a string built from pieces, a read handed
 * to `Array.map`), so neither is the defence. The defence is that the product cannot read the expected values at
 * all. The expected values stay in the parent. A confined run (A, B and D) is a child process that Node.js starts
 * with its permission model on: it reads only the folders listed for it, writes nowhere (a command may write its
 * working folder), starts no process, no worker and no native addon. The model is enforced by the runtime below
 * every call, so no wrapper, bound function or native frame goes around it. The product module is first bundled
 * into a folder of its own (`seal`), so that folder is the product's whole working copy and no loader (which would
 * start a compiler process) runs inside the confined runs.
 *
 * Run C is not confined: it is the user-shaped run. A product that answers differently when it is confined (it
 * reads the permission object, or it reads a file and finds it) answers differently in run C, and the frame
 * reports that call as a divergence.
 */

/** The flag that turns the permission model on: `--permission` from Node.js 23.5, `--experimental-permission` before. */
function permissionFlag(): string {
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags.has('--permission')) return '--permission';
  if (flags.has('--experimental-permission')) return '--experimental-permission';
  throw new FrameError(
    `this Node.js (${process.version}) has no permission model, so the product cannot be confined; use Node.js 22.13 or later`,
  );
}

/** A path as the runtime sees it: links resolved, because a permission is checked on the resolved path. */
export function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const quote = (path: string): string => {
  if (path.includes(','))
    throw new FrameError(`the folder ${path} has a comma in its name and cannot be granted`);
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

export type Grants = {
  /** The folders and files the run may read, besides its own folder and the sealed product. */
  reads: readonly string[];
  /** The folders the run may write. */
  writes?: readonly string[];
};

/**
 * The plan with its confinement: its folders made, its node options set to the permission model with the grants,
 * and its setup told to put the node options back to what the validator had before it loads the product, so the
 * product sees the same `process.env` as an unconfined run.
 */
export function confine(plan: TwinPlan, grants: Grants): TwinPlan {
  const flag = permissionFlag();
  for (const dir of [plan.driverDir, plan.cwd, plan.home]) if (dir) mkdirSync(dir, { recursive: true });
  // The run starts from the real path of its folders: a permission is checked on the resolved path, and the entry
  // file is read through the path the run was started with.
  const driverDir = realOf(plan.driverDir);
  const cwd = plan.cwd ? realOf(plan.cwd) : undefined;
  const reads = [driverDir, ...grants.reads].map(realOf);
  const writes = (grants.writes ?? []).map((path) => join(driverDir, relative(plan.driverDir, path)));
  const env = { ...(plan.env ?? process.env) } as Record<string, string>;
  const before = env.NODE_OPTIONS;
  const ours = [
    flag,
    ...reads.map((path) => `--allow-fs-read=${quote(path)}`),
    ...writes.map((path) => `--allow-fs-write=${quote(path)}`),
  ];
  env.NODE_OPTIONS = [before, ...ours].filter((part) => part !== undefined && part !== '').join(' ');
  return {
    ...plan,
    driverDir,
    ...(cwd ? { cwd } : {}),
    env,
    setup: { ...plan.setup, loader: null, nodeOptions: before ?? null },
  };
}

const SOURCE = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

/** The bundler of the project: the one the tsx loader is built on, found through tsx so no dependency is added. */
function bundler(): { buildSync(options: Record<string, unknown>): unknown } {
  try {
    const tsx = createRequire(import.meta.url).resolve('tsx');
    return createRequire(tsx)('esbuild');
  } catch {
    throw new FrameError(
      'the product cannot be confined: the bundler (esbuild, a dependency of tsx) is not installed',
    );
  }
}

/**
 * Bundles the product module with all it imports into `${into}/${name}.mjs` and returns that file. The folder holds
 * nothing else of the project, so a run that may read only this folder has the product and nothing around it. A
 * product that reads a file of its own through `import.meta.url` must be given that file in the run's grants.
 */
export function seal(module: string, into: string, name: string): { file: string; inputs: string[] } {
  if (!SOURCE.has(extname(module)))
    throw new FrameError(`the product ${module} is not a script the frame can bundle`);
  mkdirSync(into, { recursive: true });
  const outfile = join(realOf(into), `${name}.mjs`);
  // The project's tsconfig maps the workspace packages to their sources, as the tsx loader reads it from the root.
  const tsconfig = join(findRoot(dirname(module)), 'tsconfig.json');
  let built: unknown;
  try {
    built = bundler().buildSync({
      metafile: true,
      ...(existsSync(tsconfig) ? { tsconfig } : {}),
      entryPoints: [module],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      // A bundled CommonJS dependency calls require; the bundle is an ES module.
      banner: {
        js: "import { createRequire as __sealRequire } from 'node:module'; const require = __sealRequire(import.meta.url);",
      },
    });
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause);
    throw new FrameError(`the product ${module} did not bundle: ${text.split('\n').slice(0, 4).join(' ')}`);
  }
  const meta = (built as { metafile?: { inputs: Record<string, unknown> } }).metafile;
  const inputs = Object.keys(meta?.inputs ?? {})
    .map((path) => resolve(findRoot(dirname(module)), path))
    .filter((path) => existsSync(path));
  return { file: outfile, inputs: [...new Set([resolve(module), ...inputs])] };
}

/**
 * A guard on files the unconfined run C could write: the product's source and the files it is granted. Run C is
 * the user-shaped run and may read the expected values, so it must not be able to carry them to a later frame or a
 * later run by writing them into a file the confined runs read. The guard keeps the bytes at the start of the frame;
 * after each unconfined run `check` puts back any file that changed, and says which.
 */
export class SourceGuard {
  private readonly saved = new Map<string, Buffer>();

  constructor(paths: readonly string[]) {
    for (const path of paths) this.add(path);
  }

  private add(path: string): void {
    try {
      const stat = statSync(path);
      if (stat.isDirectory()) {
        for (const name of readdirSync(path)) if (name !== 'node_modules') this.add(join(path, name));
      } else if (stat.isFile() && this.saved.size < 5000) this.saved.set(path, readFileSync(path));
    } catch {
      // a path that does not exist holds nothing to keep
    }
  }

  /** The files that differ from the start, put back as they were. */
  check(): string[] {
    const changed: string[] = [];
    for (const [path, bytes] of this.saved) {
      let now: Buffer | undefined;
      try {
        now = readFileSync(path);
      } catch {
        now = undefined;
      }
      if (now === undefined || !now.equals(bytes)) {
        changed.push(path);
        writeFileSync(path, bytes);
      }
    }
    return changed;
  }
}

/** The folder of a sealed bundle. */
export const sealedDir = (file: string): string => dirname(file);
