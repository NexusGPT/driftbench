import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Builds the isolated measure run (docs/validators.md section 12.7) into one folder outside the repository:
 * `app.mjs`, the blocks bank, its harness and the measurement bundled into one ES module with no source map and
 * no module names; `agents/code-agent.mjs`, the planted code agent the product runs as a program; and `app`, the
 * program that starts the run. The product packages stay outside the bundle, imported by their file in the
 * repository, so the run measures the product as it is.
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
function productOutside(): Plugin {
  const table = aliases();
  return {
    name: 'product-outside',
    setup(build) {
      build.onResolve({ filter: /^@agent-nexus\// }, (args) => {
        if (args.path.startsWith('@agent-nexus/driftbench-validators')) {
          throw new Error(`${args.importer} imports the validators package by name`);
        }
        const file = aliasFile(args.path, table);
        if (!file) throw new Error(`no path alias for ${args.path}`);
        return { path: pathToFileURL(file).href, external: true };
      });
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.importer.includes(`${sep}node_modules${sep}`)) return undefined;
        const target = resolve(dirname(args.importer), args.path);
        if (target.startsWith(VALIDATORS + sep)) return undefined;
        return { path: pathToFileURL(sourceFile(target)).href, external: true };
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

export async function buildIsolated(folder: string): Promise<{ bundle: string; inputs: string[] }> {
  mkdirSync(join(folder, 'agents'), { recursive: true });
  const bundle = join(folder, 'app.mjs');
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
    // The one import.meta.url of the bank (kinds.ts) finds the planted code agent beside the bundle.
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(bundle).href) },
    plugins: [productOutside()],
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
  const outside = inputs.filter((input) => !input.startsWith(`packages${sep}validators${sep}`));
  process.stdout.write(`bundled ${inputs.length} modules into ${bundle}\n`);
  if (outside.length > 0)
    process.stdout.write(`modules from outside the validators: ${outside.join(', ')}\n`);
}
