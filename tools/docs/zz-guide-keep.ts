import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const exec = promisify(execFile);
/** The first line of a fenced block that makes it a file of the page: `# file: <path>` or `// file: <path>`. */
const FILE_LINE = /^(?:#|\/\/) file: (.+)\n/;
const FENCE = /^```(\S*)\n([\s\S]*?)^```$/gm;

export type Step = { command: string; shown: string[]; exit: number };

/** Splits a command line into words. Double and single quotes group; a backslash escapes inside double quotes. */
function words(line: string): string[] {
  const out: string[] = [];
  let word = '';
  let open = false;
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quote === '"' && ch === '\\') {
      i += 1;
      word += line.charAt(i);
    } else if (quote !== '' && ch === quote) {
      quote = '';
    } else if (quote === '' && (ch === '"' || ch === "'")) {
      quote = ch;
      open = true;
    } else if (quote === '' && ch === ' ') {
      if (open || word !== '') out.push(word);
      word = '';
      open = false;
    } else {
      word += ch;
    }
  }
  if (open || word !== '') out.push(word);
  return out;
}

/** The steps of a console block: a line that starts with `$ ` is a command, the lines after it are its output. */
export function steps(block: string): Step[] {
  const found: Step[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('$ ')) {
      const exit = /\s+# exit (\d)$/.exec(line);
      const command = line.slice(2).replace(/\s+# exit \d$/, '');
      found.push({ command, shown: [], exit: exit ? Number(exit[1]) : 0 });
    } else if (line.trim() !== '') {
      found[found.length - 1]?.shown.push(line.trimEnd());
    }
  }
  return found;
}

/** A campaign id of a run changes at every run, so a page shows it as `estate-run-<id>`. */
const idOf = (line: string): string => line.replace(/estate-run-[0-9a-f]{12}/g, 'estate-run-<id>');

/**
 * The printed lines of a command: no blank line, no trailing space, no absolute path of the clone or the folder,
 * and a campaign id shown as `<id>`.
 */
function clean(text: string, cwd: string): string[] {
  return text
    .replaceAll(`${ROOT}/`, '')
    .replaceAll(`${cwd}/`, '')
    .split('\n')
    .map((line) => idOf(line.trimEnd()))
    .filter((line) => line !== '');
}

/** Runs one shown driftbench command in `cwd` and returns its exit code and printed lines. */
async function run(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  const argv = words(command.replaceAll('$PWD', cwd));
  while (['pnpm', 'npx', 'driftbench'].includes(argv[0] ?? '')) argv.shift();
  const resolved = argv.map((word) => (/^(examples|packages)\//.test(word) ? join(ROOT, word) : word));
  let text = '';
  const code = await main(resolved, {
    cwd,
    out: (chunk) => {
      text += chunk;
    },
    err: (chunk) => {
      text += chunk;
    },
  });
  return { code, lines: clean(text, cwd) };
}

/** Runs one shown shell command (grep, sed, cp, mkdir) in `cwd`. */
async function shell(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  try {
    const done = await exec('/bin/sh', ['-c', `{ ${command}\n} < /dev/null`], { cwd, timeout: 30_000 });
    return { code: 0, lines: clean(`${done.stdout}${done.stderr}`, cwd) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    const text = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
    return { code: failed.code ?? 1, lines: clean(text, cwd) };
  }
}

/** Runs one shown driftbench command as its own process, as a person would: the CLI entry point under tsx. */
async function spawnCli(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  const argv = words(command.replaceAll('$PWD', cwd));
  while (['pnpm', 'npx', 'driftbench'].includes(argv[0] ?? '')) argv.shift();
  try {
    const tsx = join(ROOT, 'node_modules/.bin/tsx');
    const done = await exec(tsx, [join(ROOT, 'packages/cli/src/bin.ts'), ...argv], {
      cwd,
      timeout: 240_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, lines: clean(`${done.stdout}${done.stderr}`, cwd) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, lines: clean(`${failed.stdout ?? ''}${failed.stderr ?? ''}`, cwd) };
  }
}

/**
 * Runs a shown `npx tsx <file>` as its own process in `cwd`. A reader installs the packages the script
 * imports; the test resolves the same package names to the sources of this clone, with the repository paths.
 */
async function spawnScript(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  const file = words(command).slice(-1)[0] ?? '';
  try {
    const tsx = join(ROOT, 'node_modules/.bin/tsx');
    const done = await exec(tsx, ['--tsconfig', join(ROOT, 'tsconfig.base.json'), file], {
      cwd,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, lines: clean(`${done.stdout}${done.stderr}`, cwd) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, lines: clean(`${failed.stdout ?? ''}${failed.stderr ?? ''}`, cwd) };
  }
}

/** A command of the walkthrough: driftbench, a script run with tsx, or the shell. */
async function execute(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  if (/^(pnpm |npx )?driftbench /.test(command)) return spawnCli(command, cwd);
  if (/^(npx )?tsx [\w./-]+\.ts$/.test(command)) return spawnScript(command, cwd);
  return shell(command, cwd);
}

/** What a step shows is its printed output, in order, and its exit code. */
function mismatch(step: Step, got: { code: number; lines: string[] }): string[] {
  const found: string[] = [];
  let from = 0;
  for (const line of step.shown) {
    const at = got.lines.indexOf(idOf(line), from);
    if (at < 0) {
      found.push(`the README line is not printed, in order: ${line}`);
    } else {
      from = at + 1;
    }
  }
  if (got.code !== step.exit) found.push(`exit code ${got.code}, the README says ${step.exit}`);
  return found;
}

export async function report(command: string, step: Step, cwd: string): Promise<string> {
  const got = /^(pnpm |npx )?driftbench /.test(command) ? await run(command, cwd) : await shell(command, cwd);
  const found = mismatch(step, got);
  if (found.length === 0) return '';
  return `$ ${command}\n${found.join('\n')}\nPrinted:\n${got.lines.join('\n')}\n`;
}

/**
 * Runs a guide page the way a reader does, in one scratch folder: every fenced block that starts with
 * `# file: <path>` is written there, every `console` block is run in order (a line `$ cd <folder>` moves
 * the folder), and each command must print the lines the page shows after it, in order, and exit with
 * the code in `# exit <n>` (0 without it). Every line of a `text` block must have been printed by one
 * of the commands. Returns the problems, each with what the command really printed.
 */
export async function runGuidePage(root: string, page: string): Promise<string[]> {
  const doc = await readFile(join(root, page), 'utf8');
  const base = await mkdtemp(join(tmpdir(), 'driftbench-guide-'));
  const problems: string[] = [];
  const printed = new Set<string>();
  const excerpts: string[] = [];
  try {
    await symlink(join(root, 'examples'), join(base, 'examples'));
    let cwd = base;
    for (const fence of doc.matchAll(FENCE)) {
      const lang = fence[1] ?? '';
      const body = fence[2] ?? '';
      const name = FILE_LINE.exec(body)?.[1];
      if (name !== undefined) {
        await mkdir(dirname(join(cwd, name)), { recursive: true });
        const keepsLine = lang === 'yaml' || lang === 'js' || lang === 'ts';
        await writeFile(join(cwd, name), keepsLine ? body : body.replace(FILE_LINE, ''));
      } else if (lang === 'text') {
        excerpts.push(...body.split('\n').filter((line) => line.trim() !== ''));
      } else if (lang === 'console') {
        for (const step of steps(body.replace(/\n$/, ''))) {
          if (step.command.startsWith('cd ')) {
            cwd = join(cwd, step.command.slice(3).trim());
            continue;
          }
          const got = await execute(step.command, cwd);
          for (const line of got.lines) printed.add(line);
          const found = mismatch(step, got);
          if (found.length > 0) {
            const lines = got.lines.map((line) => line.slice(0, 400)).join('\n');
            problems.push(`$ ${step.command}\n${found.join('\n')}\nPrinted:\n${lines}\n`);
          }
        }
      }
    }
    for (const line of excerpts) {
      if (!printed.has(idOf(line.trimEnd()))) problems.push(`An excerpt line no command printed: ${line}`);
    }
  } finally {
    console.log("BASE " + base);
  }
  return problems;
}
