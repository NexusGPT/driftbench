import { createHash } from 'node:crypto';
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
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
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

/** The files an extends chain of tsconfig files reads, the first being `tsconfig` itself. */
function tsconfigChain(tsconfig: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const real = realOf(file);
    if (seen.has(real) || !existsSync(real)) return;
    seen.add(real);
    chain.push(real);
    let text = '';
    try {
      text = readFileSync(real, 'utf8');
    } catch {
      return;
    }
    // "extends": "./x.json" or ["./x.json", ...]; a comment or a trailing comma does not stop this reading.
    const found = /"extends"\s*:\s*(\[[^\]]*\]|"[^"]*")/.exec(text);
    if (!found) return;
    for (const each of [...(found[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string)) {
      if (!each.startsWith('.') && !each.startsWith('/')) continue;
      const target = resolve(dirname(real), each);
      visit(target.endsWith('.json') ? target : `${target}.json`);
    }
  };
  visit(tsconfig);
  return chain;
}

/** The folder of the package a file of a node_modules belongs to, or undefined for a file outside any. */
function packageOf(file: string): string | undefined {
  const parts = file.split(sep);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return undefined;
  // The project's cache folder lives in a node_modules but is not a package: other frames write in it all the time.
  if (parts[at + 1] === '.cache') return undefined;
  const scoped = (parts[at + 1] as string).startsWith('@') ? 2 : 1;
  if (at + scoped >= parts.length) return undefined;
  return parts.slice(0, at + 1 + scoped).join(sep);
}

/**
 * What decides which files a later bundle takes, besides the files themselves (reviews of PR 969: run C rewrote the
 * `main` of a package.json, and the `paths` of a tsconfig.json). Everything here is watched like the product: if it
 * is not the same after run C as before, the frame is marked.
 */
export function bundleInfluences(
  inputs: readonly string[],
  tsconfig: string | undefined,
): { files: string[]; packages: string[] } {
  const files = new Set<string>(tsconfig ? tsconfigChain(tsconfig) : []);
  const packages = new Set<string>();
  for (const input of inputs) {
    const owner = packageOf(input);
    if (owner) packages.add(owner);
    for (let dir = dirname(input); ; ) {
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest)) files.add(realOf(manifest));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return { files: [...files], packages: [...packages] };
}

export type Sealed = {
  file: string;
  /** Every file the bundle was built from. */
  inputs: string[];
  /** The source tree of the product, which the unconfined run must not change. */
  tree: string;
  /**
   * Everything besides the inputs that decided what was bundled: the tsconfig files read, the package.json files on
   * the path of each input, and the folder of each package of a node_modules the bundle took files from.
   */
  influences: { files: string[]; packages: string[] };
  /**
   * The workspace source trees the bundle took files from (besides the product's own tree). The whole tree is watched:
   * a new file there can shadow a file of the bundle in the next one (x.tsx beside x.ts).
   */
  workspace: string[];
};

/**
 * The source folders of the workspace packages the project root declares in its pnpm-workspace.yaml (`dir/*` or a
 * folder): a product of the repository imports its sibling packages (`planV2` imports core), and they are part of it.
 * Only the `src` folder of each is taken, and never the validators' own package, which holds the expected values.
 */
function workspaceSources(base: string): string[] {
  const file = join(base, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return [];
  const own = realOf(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let patterns: string[] = [];
  try {
    const parsed = parseYaml(readFileSync(file, 'utf8')) as { packages?: unknown };
    patterns = Array.isArray(parsed?.packages)
      ? parsed.packages.filter((each): each is string => typeof each === 'string')
      : [];
  } catch {
    return [];
  }
  const packages: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!') || pattern.includes('**')) continue;
    if (pattern.endsWith('/*')) {
      const parent = join(base, pattern.slice(0, -2));
      let names: string[] = [];
      try {
        names = readdirSync(parent);
      } catch {
        names = [];
      }
      for (const name of names) packages.push(join(parent, name));
    } else if (!pattern.includes('*')) packages.push(join(base, pattern));
  }
  return packages
    .filter((dir) => existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src')))
    .map((dir) => realOf(dir))
    .filter((dir) => dir !== own)
    .map((dir) => join(dir, 'src'));
}

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
  const workspace = workspaceSources(base);
  const trees = [tree, ...(grants.sources ?? []).map((path) => realOf(resolve(path))), ...workspace];
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
  const all = [...new Set([realOf(resolve(module)), ...inputs])];
  const used = workspace.filter((folder) => all.some((input) => under(input, folder)));
  return {
    file: outfile,
    inputs: all,
    tree,
    influences: bundleInfluences(all, existsSync(tsconfig) ? tsconfig : undefined),
    workspace: used,
  };
}

/** What a bundle is, for the child processes of one invocation: the file, its hash, and what it was built from. */
export type SealDescriptor = {
  file: string;
  sha256: string;
  tree: string;
  inputs: string[];
  influences: Sealed['influences'];
  workspace: string[];
  /** Writes the bundle bytes back to `file` (the invocation keeps them in memory); not sent to children. */
  refresh?: () => void;
};

type SealRecord = Sealed & { bytes: Buffer; sha256: string };
const SEALS = new Map<string, SealRecord>();

const sealKey = (
  module: string,
  grants: { sources?: readonly string[]; reads?: readonly string[] },
): string =>
  [
    realOf(resolve(module)),
    ...(grants.sources ?? []).map((path) => resolve(path)),
    '|',
    ...(grants.reads ?? []).map((path) => resolve(path)),
  ].join('\0');

/** Forgets every sealed product of this process: a test that rewrites a product and wants the new code bundled. */
export function forgetSealedProducts(): void {
  SEALS.clear();
  WATCHED.clear();
}

/**
 * The names whose presence or content decides how a bundle is resolved or built, looked for in the folder of the
 * product and in every folder above it up to the filesystem root: package.json (Node.js and esbuild), tsconfig.json,
 * every tsconfig.*.json and jsconfig.json (esbuild), pnpm-workspace.yaml (the project root the frame finds),
 * .npmrc, .yarnrc and .yarnrc.yml (package manager settings), .pnp.cjs and .pnp.loader.mjs (Plug'n'Play
 * resolution). docs/validators.md section 12.9 names the same list.
 */
export const RESOLUTION_CONFIG_NAMES: readonly (string | RegExp)[] = [
  'package.json',
  'jsconfig.json',
  /^tsconfig(\..+)?\.json$/,
  'pnpm-workspace.yaml',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnp.cjs',
  '.pnp.loader.mjs',
];

/** The hash of each resolution-config file in the folder of a module and above it, to the filesystem root. */
function configSnapshot(start: string): Map<string, string> {
  const found = new Map<string, string>();
  for (let dir = realOf(start); ; ) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (
        !RESOLUTION_CONFIG_NAMES.some((each) => (typeof each === 'string' ? each === name : each.test(name)))
      )
        continue;
      try {
        found.set(
          join(dir, name),
          createHash('sha256')
            .update(readFileSync(join(dir, name)))
            .digest('hex'),
        );
      } catch {
        // not a readable file: it decides nothing
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

type Watched = {
  tree: string;
  mark: string;
  watch: TreeWatch;
  config: Map<string, string>;
  module: string;
};
const WATCHED = new Map<string, Watched>();

/**
 * The end of an invocation: compares each sealed product's tree, resolution files and the resolution-config names
 * above it with their state when the product was sealed, and marks every tree that changed (a later invocation then
 * refuses to start on it). Nobody edits a product in the middle of a validation, so a change is a write of run C.
 * Returns a message for the user, or undefined when nothing changed. The validator writes nothing in the tree.
 */
export function finishInvocation(): string | undefined {
  const messages: string[] = [];
  for (const each of WATCHED.values()) {
    const changed = each.watch.diff();
    const now = configSnapshot(dirname(each.module));
    for (const [file, hash] of now) {
      const was = each.config.get(file);
      if (was === undefined) changed.push(`${file} (added)`);
      else if (was !== hash) changed.push(`${file} (changed)`);
    }
    for (const file of each.config.keys()) if (!now.has(file)) changed.push(`${file} (removed)`);
    if (changed.length === 0) continue;
    const what = `${changed.slice(0, 4).join(', ')}${changed.length > 4 ? `, and ${changed.length - 4} more` : ''}`;
    setMark(each.mark, `changed during the run: ${what}`);
    messages.push(
      `the product ${each.module} changed during this run (${what}); its tree is marked and no later run starts on it until you restore it and delete ${each.mark}`,
    );
  }
  WATCHED.clear();
  return messages.length > 0 ? messages.join('\n') : undefined;
}

/**
 * The bundle of a product, built once per invocation of the validator and never again (reviews of PR 969: run C is
 * unconfined and can write anything a later bundle reads, and no list of the files a bundle reads is complete). The
 * first frame bundles the tree; the bytes stay in this process's memory; every later frame of the invocation writes
 * those bytes into its own folder and runs them, whatever the tree has become. A child process of the invocation is
 * given the descriptor of the parent's bundle and checks its hash. A new invocation bundles the tree as it finds it, as
 * after an edit of the builder's.
 */
export function sealOnce(
  module: string,
  into: string,
  name: string,
  grants: { sources?: readonly string[]; reads?: readonly string[] } = {},
  given?: SealDescriptor,
): Sealed {
  mkdirSync(into, { recursive: true });
  const outfile = join(realOf(into), `${name}.mjs`);
  let record: SealRecord | undefined;
  if (given) {
    const bytes = readFileSync(given.file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== given.sha256)
      throw new FrameError(
        `the sealed bundle ${given.file} is not the one this invocation sealed: it changed`,
      );
    record = {
      file: given.file,
      inputs: given.inputs,
      tree: given.tree,
      influences: given.influences,
      bytes,
      sha256,
    };
  } else {
    const key = sealKey(module, grants);
    record = SEALS.get(key);
    if (!record) {
      const built = seal(module, into, name, grants);
      const bytes = readFileSync(built.file);
      record = { ...built, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
      SEALS.set(key, record);
      // The state of the tree when it was sealed: finishInvocation compares it with the state at the end of the run.
      WATCHED.set(key, {
        tree: record.tree,
        mark: markPath(dirname(into), record.tree),
        watch: new TreeWatch(
          [
            record.tree,
            ...(grants.sources ?? []),
            ...record.inputs,
            ...(grants.reads ?? []),
            ...record.influences.files,
          ],
          record.influences.packages,
        ),
        config: configSnapshot(dirname(module)),
        module,
      });
    }
  }
  writeFileSync(outfile, record.bytes);
  return {
    file: outfile,
    inputs: record.inputs,
    tree: record.tree,
    influences: record.influences,
    workspace: record.workspace,
  };
}

/** The descriptor of this process's bundle of a product, for its children; seals the product first if needed. */
export function describeSeal(
  module: string,
  folder: string,
  grants: { sources?: readonly string[]; reads?: readonly string[] } = {},
): SealDescriptor {
  const sealed = sealOnce(module, folder, 'sealed', grants);
  const record = SEALS.get(sealKey(module, grants)) as SealRecord;
  const refresh = () => writeFileSync(sealed.file, record.bytes);
  return {
    file: sealed.file,
    sha256: record.sha256,
    tree: record.tree,
    inputs: record.inputs,
    influences: record.influences,
    workspace: record.workspace,
    refresh,
  };
}

/**
 * A read-only watch on everything the unconfined run C could write and a later frame could read: the product's
 * source tree, the extra source trees, every path it is granted, and the files the bundle was built from. Run C is
 * the user-shaped run and may read the expected values, so a file it wrote (a stamp in the source, a new file in a
 * granted folder, a nearer node_modules package) would reach the confined runs of the next frame. The watch takes an
 * inventory at the start (every file, recursively, with a hash of its bytes); `diff` lists what was added, removed
 * or changed. It never writes, restores or deletes anything: the user's tree is theirs. What it finds is kept in a
 * mark (see `setMark`) that makes every later frame of the same tree refuse to start until the tree is restored.
 */
export class TreeWatch {
  private readonly before = new Map<string, string>();
  private readonly roots: string[] = [];
  /** Roots whose nested node_modules folders are not walked (a package taken from a node_modules). */
  private readonly shallow = new Set<string>();
  static readonly LIMIT = 200_000;

  constructor(paths: readonly string[], packages: readonly string[] = []) {
    for (const path of packages) {
      if (!existsSync(path)) continue;
      const real = realOf(path);
      if (this.roots.includes(real)) continue;
      this.roots.push(real);
      this.shallow.add(real);
    }
    for (const path of paths) {
      if (!existsSync(path)) {
        this.roots.push(path);
        continue;
      }
      const real = realOf(path);
      if (this.roots.some((root) => under(real, root))) continue;
      this.roots.push(real);
    }
    for (const root of this.roots)
      for (const [file, hash] of this.inventory(root)) this.before.set(file, hash);
  }

  private inventory(root: string): Map<string, string> {
    const found = new Map<string, string>();
    const walk = (path: string): void => {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(path);
      } catch {
        return;
      }
      if (stat.isDirectory()) {
        for (const name of readdirSync(path)) {
          if (name === '.git') continue;
          if (name === 'node_modules' && this.shallow.has(root)) continue;
          walk(join(path, name));
        }
      } else if (stat.isFile()) {
        if (found.size >= TreeWatch.LIMIT)
          throw new FrameError(
            `the tree ${root} holds more than ${TreeWatch.LIMIT} files: name a smaller folder for the product, or put the rest in \`sources\``,
          );
        found.set(path, createHash('sha256').update(readFileSync(path)).digest('hex'));
      }
    };
    walk(root);
    return found;
  }

  /**
   * The names directly inside each folder where Node.js looks for a package for the product: the node_modules folder
   * of every ancestor of the tree up to the filesystem root (present or not), the folders of NODE_PATH, and the
   * user-level folders. A package that appears there, or one that is removed, can shadow the one the bundle took
   * (review of PR 969: a copy one folder above the tree). Only names are listed, so a store of thousands of
   * packages costs one directory read per folder.
   */
  static resolutionFolders(tree: string): string[] {
    const folders: string[] = [];
    for (let dir = realOf(tree); ; ) {
      folders.push(join(dir, 'node_modules'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const extra of (process.env.NODE_PATH ?? '').split(delimiter)) if (extra) folders.push(extra);
    const home = process.env.HOME;
    if (home) folders.push(join(home, '.node_modules'), join(home, '.node_libraries'));
    return folders;
  }

  private static names(folder: string): string {
    if (!existsSync(folder)) return '(absent)';
    const out: string[] = [];
    // A package name never starts with a dot: .cache, .vite, .bin and .pnpm are not packages, and other tools write them.
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith('.')) continue;
      if (name.startsWith('@')) {
        let inner: string[] = [];
        try {
          inner = readdirSync(join(folder, name)).sort();
        } catch {
          inner = [];
        }
        for (const each of inner) out.push(`${name}/${each}`);
      } else out.push(name);
    }
    return out.join('\n');
  }

  private readonly listed = new Map<string, string>();

  /** Starts the listing of the folders Node.js resolves packages from. */
  watchResolution(tree: string): void {
    for (const folder of TreeWatch.resolutionFolders(tree)) this.listed.set(folder, TreeWatch.names(folder));
  }

  /** The paths that differ from the start (added, removed or changed). Nothing is touched. */
  diff(): string[] {
    const now = new Map<string, string>();
    for (const root of this.roots)
      for (const [file, hash] of existsSync(root) ? this.inventory(root) : []) now.set(file, hash);
    const changed: string[] = [];
    for (const [file, hash] of now) {
      const was = this.before.get(file);
      if (was === undefined) changed.push(`${file} (added)`);
      else if (was !== hash) changed.push(`${file} (changed)`);
    }
    for (const file of this.before.keys()) if (!now.has(file)) changed.push(`${file} (removed)`);
    for (const [folder, was] of this.listed)
      if (TreeWatch.names(folder) !== was) changed.push(`${folder} (packages added or removed)`);
    return changed;
  }
}

/** The mark of a tree that an unconfined run changed: a file of the validator's own cache, never in the user's tree. */
export function markPath(cache: string, tree: string): string {
  return join(cache, 'frame-marks', createHash('sha1').update(realOf(tree)).digest('hex'));
}

/** Refuses to start a frame on a tree that an earlier unconfined run changed. */
export function checkMark(file: string, tree: string): void {
  if (!existsSync(file)) return;
  let what = '';
  try {
    what = (JSON.parse(readFileSync(file, 'utf8')) as { message?: string }).message ?? '';
  } catch {
    // an unreadable mark still refuses
  }
  throw new FrameError(
    `an earlier run C changed the tree ${tree} (${what}): restore it, then delete ${file}; the frame never changes the user's tree`,
  );
}

/** Marks a tree an unconfined run changed. */
export function setMark(file: string, message: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ message }));
}

/** The folder of a sealed bundle. */
export const sealedDir = (file: string): string => dirname(file);
