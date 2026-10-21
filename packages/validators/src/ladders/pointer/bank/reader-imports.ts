import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The static check of the reader's folder: the reader (`packages/estate/src/pointer`) imports nothing from the
 * validators. A reader that imports the bank, an oracle or the reference reader can read the truth an item holds.
 * The check reads every source file of the folder for the module specifiers it names (static and dynamic imports,
 * `require`, `new URL`), and reports each that points into a `validators` folder or names the validators package.
 * It does not follow a specifier built at run time; the verdict channel and the environment pin are the defence
 * against that (the other two items of this group).
 */

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIERS = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"`])([^'"`\n]+)\1/g,
  /\bimport\s*(['"`])([^'"`\n]+)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\brequire\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\bnew\s+URL\s*\(\s*(['"`])([^'"`\n]+)\1/g,
];
const INTO_VALIDATORS = /(?:^|[\\/])validators(?:[\\/]|$)|driftbench-validators/;

function sourcesOf(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourcesOf(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out.sort();
}

/** One line for each specifier of the folder that points into the validators; empty when there is none. */
export function importsOfValidators(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`the reader folder ${dir} does not exist`);
  const found: string[] = [];
  for (const file of sourcesOf(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of SPECIFIERS) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[2] ?? '';
        if (INTO_VALIDATORS.test(specifier)) found.push(`${relative(dir, file)}: ${specifier}`);
      }
    }
  }
  return [...new Set(found)].sort();
}
