#!/usr/bin/env node
// Writes a large synthetic estate for timing the scan, the plan, mutate and estate run at the size of a
// real working estate: reader-cases itself, plus many skills (about 6,000 atoms in all) and about 100 MB of
// files no runtime loads (node_modules and test runs under hooks), which the reader and the copies skip.
// Usage: node examples/estates/reader-cases/tools/make-large.mjs <empty target folder> [skills] [megabytes]
// Fictional data only. The output is never committed.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [target, skillArg = '1200', megaArg = '100'] = process.argv.slice(2);
if (!target) {
  console.error('usage: make-large.mjs <empty target folder> [skills] [megabytes]');
  process.exit(2);
}
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`${target} is not empty`);
  process.exit(2);
}
const skills = Number(skillArg);
const megabytes = Number(megaArg);
const cases = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(target, { recursive: true });
cpSync(join(cases, '.claude'), join(target, '.claude'), { recursive: true, dereference: true });
for (const name of ['CLAUDE.md', 'driftbench.estate.yaml']) cpSync(join(cases, name), join(target, name));

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const rows = [];
for (let index = 0; index < skills; index++) {
  const name = `job-${String(index).padStart(4, '0')}`;
  const folder = join(target, '.claude/skills', name);
  write(
    join(folder, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: Run operations job ${index}. Use when the user asks for job ${index}.`,
      'allowed-tools: Read, Bash(python3 *)',
      '---',
      '',
      `# Job ${index}`,
      '',
      `1. Read \`references/rules-${index}.md\` before editing any file of job ${index}.`,
      `2. Run \`python3 scripts/run-${index}.py\` and show the summary it prints.`,
      '3. When the job fails twice, stop and tell the user what failed.',
      '',
    ].join('\n'),
  );
  write(
    join(folder, `references/rules-${index}.md`),
    `# Rules ${index}\n\n- Keep job ${index} under ten minutes.\n`,
  );
  write(join(folder, `scripts/run-${index}.py`), "print('ok')\n");
  rows.push(`| run job ${index} | \`${name}\` |`);
}
write(
  join(target, '.claude/memory/JOBS.md'),
  ['# Jobs', '', '| When the user wants to | Load |', '|---|---|', ...rows, ''].join('\n'),
);

// Files no runtime loads: test runs with their node_modules under hooks, the bulk of a real estate's bytes.
const chunk = `${'x'.repeat(50 * 1024 - 1)}\n`;
const files = Math.round((megabytes * 1024) / 50);
for (let index = 0; index < files; index++) {
  const run = `run-${String(Math.floor(index / 100)).padStart(3, '0')}`;
  write(
    join(target, `.claude/hooks/tests/validation-bank/runs/${run}/node_modules/pkg-${index % 100}/index.js`),
    chunk,
  );
}
console.log(`Wrote ${target}: ${skills} job skills and ${files} ignored files of 50 KB.`);
