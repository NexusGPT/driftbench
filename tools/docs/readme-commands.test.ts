import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const FOLD = /<details><summary>How to do it([^<]*)<\/summary>([\s\S]*?)<\/details>/g;
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

/** Runs one shown command in `cwd` and returns its exit code and printed lines, with absolute paths made relative. */
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
  const lines = text
    .replaceAll(`${ROOT}/`, '')
    .replaceAll(`${cwd}/`, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  return { code, lines };
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
  const got = await run(command, cwd);
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
});
