import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTypes, parseTypesText, TYPES_ERROR_CODES, typeNamed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { DOCS } from './check-links';

/** The body of every `yaml types` fence: a types document the page shows. */
function typesFences(markdown: string): string[] {
  return [...markdown.matchAll(/^```yaml types\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? '');
}

describe('the estate model page', () => {
  it('shows a types document the real loader reads, against a profile that ships a script type', async () => {
    const text = await readFile(join(DOCS, 'estate-model.md'), 'utf8');
    const fences = typesFences(text);
    expect(fences).toHaveLength(1);
    const roots = { project: '.', layout: '.agent' };
    const base = parseTypes(
      {
        version: 1,
        types: {
          script: { root: 'layout', locate: '**/*.py', aspects: ['executes'], loaded: 'by-reference' },
        },
      },
      { runtime: 'example', roots, source: 'profile:example' },
    );
    if (!base.ok) throw new Error(JSON.stringify(base.errors));
    const loaded = parseTypesText(fences[0] as string, {
      runtime: 'example',
      roots,
      base: base.set,
      folder: '.agent',
      source: 'docs/estate-model.md',
    });
    expect(loaded.ok ? [] : loaded.errors).toEqual([]);
    if (!loaded.ok) return;
    expect(typeNamed(loaded.set, 'judge-request')?.extends).toBe('script');
    expect(typeNamed(loaded.set, 'observe-flag')?.scope).toEqual({
      type: 'script',
      by: 'name',
      link: 'configures',
    });
  });

  it('lists every code the loader refuses with in the refusal table, and no other', async () => {
    const text = await readFile(join(DOCS, 'estate-model.md'), 'utf8');
    // The table of the section "What the loader refuses": the codes of each row's first cell.
    const section = text.slice(text.indexOf('### What the loader refuses'));
    const rows = section.split('\n').filter((line) => /^\| `/.test(line));
    const listed = rows.flatMap((row) =>
      [...(row.split(' | ')[0] ?? '').matchAll(/`([a-z-]+)`/g)].map((match) => match[1]),
    );
    expect([...listed].sort()).toEqual([...TYPES_ERROR_CODES].sort());
  });
});
