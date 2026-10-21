import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The first fenced block of the README dropdown whose summary starts with `summary`, after the line `after`. */
function block(readme: string, summary: string, after: string): string {
  const dropdown = readme.slice(readme.indexOf(`<summary>${summary}`));
  const from = dropdown.indexOf(after);
  expect(from, `the README shows ${after}`).toBeGreaterThan(0);
  const start = dropdown.indexOf('```text\n', from) + '```text\n'.length;
  return dropdown.slice(start, dropdown.indexOf('\n```', start));
}

describe('README, personas and the fault finder', () => {
  const summary = 'Define the simulated user in the block';

  it('shows the block spec and the run lines that the help topic and the simulated user page hold', async () => {
    const readme = await readFile(`${ROOT}/docs/innovations.md`, 'utf8');
    const topic = await readFile(`${ROOT}/packages/cli/help/running-simulate.md`, 'utf8');
    const page = await readFile(`${ROOT}/docs/simulated-user.md`, 'utf8');
    const spec = block(readme, summary, 'A block can carry its own simulated user');
    expect(page).toContain(spec);
    const printed = block(readme, summary, 'Played from the two recorded cassettes');
    expect(topic).toContain(printed);
  });

  it('names no pull request for the fault finder and says no command runs it', async () => {
    const readme = await readFile(`${ROOT}/docs/innovations.md`, 'utf8');
    expect(readme).not.toMatch(/fault find(?:er|ing) is on its way/i);
    expect(readme).not.toContain('no command runs it yet');
    expect(readme).toContain('stored diagnoses');
    const topic = await readFile(`${ROOT}/packages/cli/help/running-diagnostics.md`, 'utf8');
    expect(topic).toContain('no command registers a diagnostic step');
  });
});
