import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Builds the isolated measure run (docs/validators.md section 12.7) into one folder outside the repository:
 * `app.mjs`, the blocks bank, its harness and the measurement bundled into one ES module with no source map and
 * no module names; `child/host.mjs` and `child/cli.mjs`, the modules the frame starts in the product's own
 * processes; `agents/code-agent.mjs`, the planted code agent the product runs as a program; and `app`, the
 * program that starts the run. The bank's bundle imports no product package: the build fails if it does
 * (section 13, "The bank runs the product through the frame"). The child modules import the product packages
 * by their file in the repository, so the run measures the product as it is.
 *
 * Usage: tsx packages/validators/src/ladders/blocks/isolated/build.ts <folder>
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATORS = resolve(HERE, '../../../..');
const ROOT = resolve(VALIDATORS, '../..');

type Esbuild = {
  build(options: Record<string, unknown>): Promise<{
    errors: unknown[];
    warnings: { text: string }[];
    metafile?: { inputs: Record<string, unknown> };
    outputFiles?: { text: string }[];
  }>;
};

type Plugin = {
  name: string;
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      callback: (args: {
        path: string;
        importer: string;
        kind: string;
      }) => { path: string; external: boolean } | undefined,
    ): void;
    onLoad?(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { contents: string; loader: string } | undefined,
    ): void;
  }): void;
};

/** esbuild, as tsup (a devDependency of the repository) carries it: no new dependency. */
function esbuild(): Esbuild {
  const fromRoot = createRequire(join(ROOT, 'package.json'));
  const fromTsup = createRequire(fromRoot.resolve('tsup/package.json'));
  return fromTsup('esbuild') as Esbuild;
}

/** The repository's path aliases (tsconfig.base.json), longest pattern first. */
function aliases(): [string, string][] {
  const config = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: { paths: Record<string, string[]> };
  };
  return Object.entries(config.compilerOptions.paths)
    .map(([pattern, targets]) => [pattern, targets[0] as string] as [string, string])
    .sort(([a], [b]) => b.length - a.length);
}

/** The file a product package name points at, or undefined for a name the aliases do not hold. */
function aliasFile(specifier: string, table: readonly [string, string][]): string | undefined {
  for (const [pattern, target] of table) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (specifier === pattern) return resolve(ROOT, target);
      continue;
    }
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (
      specifier.startsWith(head) &&
      specifier.endsWith(tail) &&
      specifier.length >= head.length + tail.length
    ) {
      const middle = specifier.slice(head.length, specifier.length - tail.length);
      if (middle.includes('/')) continue;
      return resolve(ROOT, target.replace('*', middle));
    }
  }
  return undefined;
}

/** The source file a relative import names: as written, or with `.ts`, or its folder's `index.ts`. */
function sourceFile(path: string): string {
  for (const candidate of [path, `${path}.ts`, join(path, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`no source file for the import ${path}`);
}

/**
 * Keeps the product outside the bundle: a product package name, or a relative import that leaves the validators
 * package, becomes an import of the product's own file by its absolute URL. The validators package itself is
 * never imported by name: the bank reaches it by relative imports, which the bundle takes in.
 */
function productOutside(bank = false): Plugin {
  const table = aliases();
  return {
    name: 'product-outside',
    setup(build) {
      build.onResolve({ filter: /^@agent-nexus\// }, (args) => {
        if (args.path.startsWith('@agent-nexus/driftbench-validators')) {
          throw new Error(`${args.importer} imports the validators package by name`);
        }
        if (bank) throw new Error(`${args.importer} imports the product package ${args.path} into the bank`);
        const file = aliasFile(args.path, table);
        if (!file) throw new Error(`no path alias for ${args.path}`);
        return { path: pathToFileURL(file).href, external: true };
      });
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.importer.includes(`${sep}node_modules${sep}`)) return undefined;
        const target = resolve(dirname(args.importer), args.path);
        if (target.startsWith(VALIDATORS + sep)) return undefined;
        if (bank)
          throw new Error(`${args.importer} imports ${args.path}, outside the validators, into the bank`);
        return { path: pathToFileURL(sourceFile(target)).href, external: true };
      });
    },
  };
}

/**
 * The frame's own files keep their place in the repository: the frame finds the TypeScript loader and the cache
 * folder its runs start from by its module's path, so its `import.meta.url` stays the file it was in. Every other
 * module of the bundle sees the bundle's URL.
 */
function frameInPlace(): Plugin {
  const frame = join(VALIDATORS, 'src', 'frame') + sep;
  return {
    name: 'frame-in-place',
    setup(build) {
      build.onLoad?.({ filter: /\.ts$/ }, (args) => {
        if (!args.path.startsWith(frame)) return undefined;
        const text = readFileSync(args.path, 'utf8');
        return {
          contents: text.split('import.meta.url').join(JSON.stringify(pathToFileURL(args.path).href)),
          loader: 'ts',
        };
      });
    },
  };
}

/**
 * The bundle with its module names replaced: esbuild names each lazily run module (`__esm`, `__commonJS`) by its
 * path, and that name is the function name a stack frame shows. Each becomes `m<n>`.
 */
export function neutralNames(text: string): string {
  let next = 0;
  const named = new Map<string, string>();
  return text.replace(/\b(__esm|__commonJS)\(\{"([^"]+)"\(/g, (_, wrapper: string, path: string) => {
    let name = named.get(path);
    if (name === undefined) {
      name = `m${next}`;
      next += 1;
      named.set(path, name);
    }
    return `${wrapper}({"${name}"(`;
  });
}

/**
 * The modules the frame starts in the product's processes (blocks/child): the product side of the bank and the
 * command line's runner, each one ES module beside the bundle, the product's packages imported from the
 * repository by their files.
 */
async function buildChild(folder: string): Promise<{ host: string; cli: string; worker: string }> {
  mkdirSync(join(folder, 'child'), { recursive: true });
  const out = {
    host: join(folder, 'child', 'host.mjs'),
    cli: join(folder, 'child', 'cli.mjs'),
    worker: join(folder, 'child', 'worker.mjs'),
  };
  const entries: Record<string, string> = { host: 'host.ts', cli: 'cli.ts', worker: 'cli-worker.ts' };
  for (const [name, file] of Object.entries(out)) {
    const result = await esbuild().build({
      entryPoints: [join(HERE, '..', 'child', entries[name] as string)],
      outfile: file,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      sourcemap: false,
      minifyWhitespace: true,
      legalComments: 'none',
      plugins: name === 'worker' ? [productOutside(true), frameInPlace()] : [productOutside()],
      write: false,
      logLevel: 'silent',
    });
    if (result.errors.length > 0)
      throw new Error(`the ${name} module failed: ${JSON.stringify(result.errors)}`);
    const text = result.outputFiles?.[0]?.text;
    if (text === undefined) throw new Error(`the ${name} module wrote no file`);
    writeFileSync(file, text);
  }
  return out;
}

export async function buildIsolated(folder: string): Promise<{ bundle: string; inputs: string[] }> {
  mkdirSync(join(folder, 'agents'), { recursive: true });
  const bundle = join(folder, 'app.mjs');
  const child = await buildChild(folder);
  const result = await esbuild().build({
    entryPoints: [join(HERE, 'measure.ts')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    // No comments: an unminified bundle names every module it holds in a comment line.
    minifyWhitespace: true,
    legalComments: 'none',
    // The bank's import.meta.url is the bundle's (kinds.ts finds the planted code agent beside it); the modules
    // the frame starts in the product's processes sit beside it too.
    define: { __BLOCKS_CHILD__: JSON.stringify(child) },
    plugins: [productOutside(true), frameInPlace()],
    // The CommonJS packages the bank takes in (yaml) require node built-ins.
    banner: {
      js: 'import{createRequire as __nodeRequire}from"node:module";const require=__nodeRequire(import.meta.url);',
    },
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  if (result.errors.length > 0) throw new Error(`the bundle failed: ${JSON.stringify(result.errors)}`);
  for (const warning of result.warnings) process.stderr.write(`bundle warning: ${warning.text}\n`);
  const text = result.outputFiles?.[0]?.text;
  if (text === undefined) throw new Error('the bundle wrote no file');
  writeFileSync(bundle, neutralNames(text));
  copyFileSync(join(HERE, '../agents/code-agent.mjs'), join(folder, 'agents', 'code-agent.mjs'));
  copyFileSync(join(HERE, 'app.cjs'), join(folder, 'app'));
  const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) => relative(ROOT, resolve(input)));
  return { bundle, inputs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) throw new Error('usage: build.ts <folder>');
  const { bundle, inputs } = await buildIsolated(resolve(folder));
  const outside = inputs.filter(
    (input) =>
      !input.startsWith(`packages${sep}validators${sep}`) &&
      !input.includes(`${sep}node_modules${sep}`) &&
      !input.startsWith('<'),
  );
  process.stdout.write(`bundled ${inputs.length} modules into ${bundle}\n`);
  if (outside.length > 0)
    process.stdout.write(`modules from outside the validators: ${outside.join(', ')}\n`);
}
