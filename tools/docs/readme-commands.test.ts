import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { report, runGuidePage, steps } from './guide-page';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const FOLD = /<details><summary>How to do it([^<]*)<\/summary>([\s\S]*?)<\/details>/g;
const FILE_LINE = /^(?:#|\/\/) file: (.+)\n/;

describe('README commands that print what they show', () => {
  it('runs the quickstart of the guide', async () => {
    const section = await readFile(`${ROOT}/docs/guide/quickstart.md`, 'utf8');
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
    const problems = await runGuidePage(ROOT, 'docs/guide/walkthrough.md');
    expect(problems.join('\n')).toBe('');
  }, 600_000);
});
