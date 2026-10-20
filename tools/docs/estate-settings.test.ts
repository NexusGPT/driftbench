import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('the What you can change page', () => {
  it('is the help topic validate-estate-settings, word for word, so its command blocks are the ones CI runs', async () => {
    const page = await readFile(`${ROOT}/docs/estate-settings.md`, 'utf8');
    const topic = await readFile(`${ROOT}/packages/cli/help/validate-estate-settings.md`, 'utf8');
    const body = topic.slice(topic.indexOf('\n---\n', 4) + '\n---\n'.length).trimStart();
    expect(page.startsWith('# What you can change in an estate\n')).toBe(true);
    expect(page.slice(page.indexOf('## What it is'))).toBe(body);
    // The help topic test runs the worked example and compares each shown line with the printed output.
    const test = await readFile(`${ROOT}/packages/cli/test/help-topics.test.ts`, 'utf8');
    expect(test).toContain("const OUTPUT_CHECKED = ['validate-estate-settings'];");
  });

  it('names every key of the settings file, and gives every row an example', async () => {
    const page = await readFile(`${ROOT}/docs/estate-settings.md`, 'utf8');
    const tables = page.slice(page.indexOf('## Commands and every option'), page.indexOf('## Inputs'));
    const rows = tables
      .split('\n')
      .filter((line) => line.startsWith('| ') && !/^\| (Key|File|Port) \|/.test(line));
    for (const key of [
      'ignore',
      'externals',
      'aliases',
      'scripts',
      'labels',
      'labeler',
      'threshold',
      'ledger',
    ])
      expect(
        rows.some((row) => row.startsWith(`| \`${key}\` |`)),
        key,
      ).toBe(true);
    for (const row of rows) {
      const cells = row.split(' | ');
      expect(cells.at(-1)?.replace(/ ?\|$/, '').trim(), row).not.toBe('');
    }
    expect(rows.length).toBeGreaterThanOrEqual(8 + 6 + 6);
  });
});
