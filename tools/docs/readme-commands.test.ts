import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const FOLD = /<details><summary>How to do it([^<]*)<\/summary>([\s\S]*?)<\/details>/g;
const exec = promisify(execFile);
const FILE_LINE = /^(?:#|\/\/) file: (.+)\n/;

type Step = { command: string; shown: string[]; exit: number };

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
function steps(block: string): Step[] {
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

/** The printed lines of a command: no blank line, no trailing space, no absolute path of the clone or the folder. */
function clean(text: string, cwd: string): string[] {
  return text
    .replaceAll(`${ROOT}/`, '')
    .replaceAll(`${cwd}/`, '')
    .split('\n')
    .map((line) => line.trimEnd())
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

/** A command of the walkthrough: driftbench, or the shell. */
async function execute(command: string, cwd: string): Promise<{ code: number; lines: string[] }> {
  if (/^(pnpm |npx )?driftbench /.test(command)) return spawnCli(command, cwd);
  return shell(command, cwd);
}

/** What a step shows is its printed output, in order, and its exit code. */
function mismatch(step: Step, got: { code: number; lines: string[] }): string[] {
  const found: string[] = [];
  let from = 0;
  for (const line of step.shown) {
    const at = got.lines.indexOf(line, from);
    if (at < 0) {
      found.push(`the README line is not printed, in order: ${line}`);
    } else {
      from = at + 1;
    }
  }
  if (got.code !== step.exit) found.push(`exit code ${got.code}, the README says ${step.exit}`);
  return found;
}

async function report(command: string, step: Step, cwd: string): Promise<string> {
  const got = /^(pnpm |npx )?driftbench /.test(command) ? await run(command, cwd) : await shell(command, cwd);
  const found = mismatch(step, got);
  if (found.length === 0) return '';
  return `$ ${command}\n${found.join('\n')}\nPrinted:\n${got.lines.join('\n')}\n`;
}

describe('README commands that print what they show', () => {
  it('runs the quickstart of the README', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const section = readme.split('## Quickstart\n')[1]?.split('\n## Adapters\n')[0] ?? '';
    const agent = /```js\n([\s\S]*?)\n```/.exec(section)?.[1] ?? '';
    const spec = /```yaml\n([\s\S]*?)\n```/.exec(section)?.[1] ?? '';
    const consoles = [...section.matchAll(/```console\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '');
    expect(agent, 'the quickstart shows agent.mjs').toContain('readFileSync');
    expect(spec, 'the quickstart shows the spec').toContain('refund-happy-path');
    expect(consoles).toHaveLength(3);
    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-quickstart-'));
    try {
      await mkdir(join(cwd, 'specs'));
      await writeFile(join(cwd, 'agent.mjs'), `${agent}\n`);
      await writeFile(join(cwd, 'specs/refund.yaml'), `${spec}\n`);
      const problems: string[] = [];
      for (const [index, block] of consoles.entries()) {
        if (index === 1) {
          const broken = agent.replace('Refund started for order', 'Started a return for');
          await writeFile(join(cwd, 'agent.mjs'), `${broken}\n`);
        }
        if (index === 2) await writeFile(join(cwd, 'agent.mjs'), `${agent}\n`);
        for (const step of steps(block)) problems.push(await report(step.command, step, cwd));
      }
      expect(problems.filter((problem) => problem !== '').join('\n')).toBe('');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 180_000);

  it('runs every How to do it fold of the README that shows a command', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const problems: string[] = [];
    let shown = 0;
    for (const fold of readme.matchAll(FOLD)) {
      const body = fold[2] ?? '';
      const consoles = [...body.matchAll(/```console\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '');
      if (consoles.length === 0) continue;
      const cwd = await mkdtemp(join(tmpdir(), 'driftbench-fold-'));
      try {
        for (const file of body.matchAll(/^```(yaml|text|markdown)\n([\s\S]*?)^```$/gm)) {
          const text = file[2] ?? '';
          const name = FILE_LINE.exec(text)?.[1];
          if (name === undefined) continue;
          await mkdir(dirname(join(cwd, name)), { recursive: true });
          await writeFile(join(cwd, name), file[1] === 'yaml' ? text : text.replace(FILE_LINE, ''));
        }
        for (const block of consoles) {
          for (const step of steps(block)) {
            shown += 1;
            const problem = await report(step.command, step, cwd);
            if (problem !== '') problems.push(`Fold "${(fold[1] ?? '').trim()}"\n${problem}`);
          }
        }
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
    expect(shown).toBeGreaterThan(10);
    expect(problems.join('\n')).toBe('');
  }, 600_000);

  it('runs the walkthrough on the fixture estate, one folder, step by step', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const after = readme.split('\n## A walkthrough on one small estate\n')[1] ?? '';
    const section = after.split('\n## Results\n')[0] ?? '';
    const consoles = [...section.matchAll(/```console\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '');
    expect(consoles.length).toBeGreaterThan(6);
    const plan = consoles.flatMap((block) => steps(block).map((step) => step.command));
    process.stderr.write(`WALKPLAN ${plan.length}\n${plan.join('\n')}\n`);
    const base = await mkdtemp(join(tmpdir(), 'driftbench-walk-'));
    try {
      await symlink(join(ROOT, 'examples'), join(base, 'examples'));
      let cwd = base;
      const problems: string[] = [];
      for (const block of consoles) {
        for (const step of steps(block)) {
          if (step.command.startsWith('cd ')) {
            cwd = join(cwd, step.command.slice(3).trim());
            continue;
          }
          const started = Date.now();
          process.stderr.write(`WALKSTART ${step.command}\n`);
          const got = await execute(step.command, cwd);
          process.stderr.write(
            `WALK ${Date.now() - started} ms exit ${got.code} $ ${step.command}\n${got.lines.slice(0, 400).map((line) => line.slice(0, 600)).join('\n')}\nWALKEND\n`,
          );
          const found = mismatch(step, got);
          if (found.length > 0) problems.push(`$ ${step.command}\n${found.join('\n')}\n`);
        }
      }
      expect(problems.filter((problem) => problem !== '').join('\n')).toBe('');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 600_000);
});
