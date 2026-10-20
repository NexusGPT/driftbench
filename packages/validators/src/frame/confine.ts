import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/** The source tree of a product: the folder of its module. More folders are named in `sources`. */
export function productTree(module: string): string {
  return dirname(resolve(module));
}

const under = (path: string, folder: string): boolean => path === folder || path.startsWith(folder + sep);

export type Sealed = {
  file: string;
  /** The source tree of the product. */
  tree: string;
};

/**
 * Bundles the product module with all it imports into `${into}/${name}.mjs`. The folder holds nothing else of the
 * project, so a run that may read only this folder has the product and nothing around it. The bundle is built only
 * from code of the product's own source tree, the extra trees named in `sources`, and the packages in a
 * node_modules folder; a data file is bundled only when it is granted in `reads`. Any other import (a file of the
 * validator, a file of expected values) is refused: bundled, it would reach every run as the product's own code.
 * `import.meta.url` of the product is the URL of its original module, so a data file granted in `reads` is read from
 * where it is.
 */
export function seal(
  module: string,
  into: string,
  name: string,
  grants: { sources?: readonly string[]; reads?: readonly string[] } = {},
): Sealed {
  if (!SOURCE.has(extname(module)))
    throw new FrameError(`the product ${module} is not a script the frame can bundle`);
  mkdirSync(into, { recursive: true });
  const outfile = join(realOf(into), `${name}.mjs`);
  const base = findRoot(dirname(module));
  // The project's tsconfig maps the workspace packages to their sources, as the tsx loader reads it from the root.
  const tsconfig = join(base, 'tsconfig.json');
  const original = pathToFileURL(resolve(module)).href;
  let built: unknown;
  try {
    built = bundler().buildSync({
      metafile: true,
      absWorkingDir: base,
      ...(existsSync(tsconfig) ? { tsconfig } : {}),
      entryPoints: [module],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      define: {
        'import.meta.url': JSON.stringify(original),
        'import.meta.dirname': JSON.stringify(dirname(fileURLToPath(original))),
        'import.meta.filename': JSON.stringify(fileURLToPath(original)),
      },
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
    .map((path) => resolve(base, path))
    .filter((path) => existsSync(path))
    .map(realOf);
  const tree = realOf(productTree(module));
  const trees = [tree, ...(grants.sources ?? []).map((path) => realOf(resolve(path)))];
  const granted = (grants.reads ?? []).map((path) => realOf(resolve(path)));
  for (const input of inputs) {
    // A package of node_modules is a dependency; the project's cache folder inside it is not.
    if (/[\\/]node_modules[\\/](?!\.cache[\\/])/.test(input)) continue;
    const isGranted = granted.some((folder) => under(input, folder));
    if (!isGranted && !trees.some((folder) => under(input, folder)))
      throw new FrameError(
        `the product imports ${input}, a file outside its source tree ${tree}: name its folder in \`sources\` if it is part of the product`,
      );
    if (!isGranted && !SOURCE.has(extname(input)))
      throw new FrameError(
        `the product imports ${input}, a data file: grant it in \`reads\`, or the file of expected values it may be is bundled into the product`,
      );
  }
  return { file: outfile, tree };
}

/**
 * The environment of run C. Run C is the user-shaped run: unconfined for reads, so it can read the expected values and
 * a product that does is told apart from the confined runs. It must not be able to write, though: anything it wrote
 * (a stamp in the product's files, a new file in a granted folder, a nearer node_modules) would reach the confined
 * runs of the next frame. So run C starts under the Node.js permission model with every read allowed and writes
 * allowed only in `writes` (its own folder). The options go through NODE_OPTIONS, so `process.execArgv` is empty as
 * for a user; the prelude of the entry puts NODE_OPTIONS back and hides `process.permission`.
 */
export function plainEnv(
  env: Record<string, string>,
  writes: readonly string[],
): { env: Record<string, string>; original: string | null } {
  const original = env.NODE_OPTIONS ?? null;
  const ours = [
    permissionFlag(),
    '--allow-fs-read=*',
    ...writes.map((path) => `--allow-fs-write=${quote(realOf(path))}`),
  ];
  return {
    env: {
      ...env,
      NODE_OPTIONS: [original, ...ours].filter((part) => part !== null && part !== '').join(' '),
    },
    original,
  };
}

/** The folder of a sealed bundle. */
export const sealedDir = (file: string): string => dirname(file);
