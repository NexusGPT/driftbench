import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CoverageWarningCodes,
  InventoryIssueCodes,
  IssueCodes,
  ItemFile,
  type LoadResult,
  parseObjectText,
  parseSpecText,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { DOCS, markdownFiles } from './check-links';

const TOOLS = fileURLToPath(new URL('.', import.meta.url));
/** An en dash or an em dash, built from code points so no source file holds one. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
/**
 * Names that belong to one runtime, not to the core vocabulary of tools, skills, guards and stages.
 * They may appear only under docs/adapters, where each runtime is mapped onto the four concepts.
 */
const RUNTIME_NAMES = [
  /\bhooks?\b/i,
  /\bboards?\b/i,
  /\bprocess steps?\b/i,
  /\bguardrails?\b/i,
  /\bstep classifier\b/i,
  /\bflow steps?\b/i,
  /\bexpect\.step\b/,
  /\bstep_after\b/,
  /\bSTEP_UNKNOWN\b/,
  /\bstepObserved\b/,
  /\bskillsLoaded\b/,
  /\bboardOps\b/,
  /^steps:/m,
];

/**
 * Pages that quote the README's files: maps, personas, section registries, criteria and specs that name an agent.
 * tools/docs/readme-yaml.test.ts loads every YAML fence of these pages with the real loader of its file kind.
 */
const LOADED_BY_README_YAML = new Set(['innovations.md', 'how-it-works.md', 'recipes.md']);

type Page = { path: string; text: string };

async function pages(): Promise<Page[]> {
  const files = await markdownFiles(DOCS);
  return Promise.all(
    files.map(async (file) => ({ path: relative(DOCS, file), text: await readFile(file, 'utf8') })),
  );
}

/** The body of every fenced block with the given language. */
function fences(markdown: string, lang: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`^\`\`\`${lang}\\n([\\s\\S]*?)^\`\`\`$`, 'gm');
  for (const match of markdown.matchAll(pattern)) blocks.push(match[1] ?? '');
  return blocks;
}

/** Loads a YAML example: a whole spec, a list of blocks, or a top-level fragment such as `target:`. */
function loadExample(yaml: string): { kind: 'spec' | 'blocks' | 'fragment'; result: LoadResult } {
  if (/^id:/m.test(yaml) && /^blocks:/m.test(yaml))
    return { kind: 'spec', result: parseSpecText(yaml, 'yaml') };
  if (yaml.startsWith('- ')) {
    const indented = yaml.replace(/^(?=.)/gm, '  ');
    return { kind: 'blocks', result: parseSpecText(`id: example\nblocks:\n${indented}`, 'yaml') };
  }
  return {
    kind: 'fragment',
    result: parseSpecText(
      `id: example\nblocks:\n  - user: hi\n    expect: { must: [hello] }\n${yaml}`,
      'yaml',
    ),
  };
}

describe('docs content', () => {
  it('has no em dash and no en dash on any page or in the docs tools', async () => {
    const sources = await Promise.all(
      (await readdir(TOOLS))
        .filter((name) => name.endsWith('.ts'))
        .map(async (name) => ({
          path: `tools/docs/${name}`,
          text: await readFile(join(TOOLS, name), 'utf8'),
        })),
    );
    const offending = [...(await pages()), ...sources]
      .filter((page) => DASHES.test(page.text))
      .map((page) => page.path);
    expect(sources.length).toBeGreaterThanOrEqual(4);
    expect(offending).toEqual([]);
  });

  it('keeps runtime-specific names under docs/adapters only, and the platform judge on its adapter page', async () => {
    const all = await pages();
    const outside = all.filter((page) => !page.path.startsWith('adapters'));
    const found = outside.flatMap((page) =>
      RUNTIME_NAMES.filter((name) => name.test(page.text)).map((name) => `${page.path}: ${name.source}`),
    );
    expect(outside.map((page) => page.path)).toContain(join('reference', 'spec.md'));
    expect(found).toEqual([]);
    const adapters = all
      .filter((page) => page.path.startsWith('adapters'))
      .map((page) => page.text)
      .join('\n');
    for (const name of ['hook', 'board.<op>', 'process step', 'guardrail', 'shell']) {
      expect(adapters).toContain(name);
    }
    const jev = all.filter((page) => /\bjev\b/i.test(page.text)).map((page) => page.path);
    expect(jev).toEqual([join('adapters', 'nexus.md')]);
  });

  it('loads every YAML example, and every whole spec lints clean', async () => {
    let specs = 0;
    let checked = 0;
    for (const page of await pages()) {
      if (LOADED_BY_README_YAML.has(page.path)) continue;
      for (const yaml of fences(page.text, 'yaml')) {
        const where = `${page.path}: ${yaml.split('\n')[0]}`;
        if (/^# file: objects\//.test(yaml)) {
          // An object file of a plugin: the envelope of any rule file.
          const parsed = ItemFile.safeParse(parseObjectText(yaml, where).raw);
          expect(parsed.success ? [] : parsed.error.issues, where).toEqual([]);
          checked += 1;
          continue;
        }
        const { kind, result } = loadExample(yaml);
        // A spec that names an object a plugin adds cannot resolve it here: the object step is the only error allowed.
        const errors = result.ok
          ? []
          : result.errors.filter(
              (issue) =>
                !(
                  page.path === 'plugins.md' &&
                  yaml.includes('# file: specs/routed.yaml') &&
                  issue.code === 'OBJECT_UNKNOWN'
                ),
            );
        expect(errors, where).toEqual([]);
        if (kind === 'spec') {
          specs += 1;
          expect(result.warnings, where).toEqual([]);
        }
        checked += 1;
      }
    }
    expect(specs).toBeGreaterThanOrEqual(4);
    expect(checked).toBeGreaterThanOrEqual(12);
  });

  it('uses the committed scripted cassette judge IDs in the judge guide', async () => {
    const text = await readFile(join(DOCS, 'concepts', 'judges.md'), 'utf8');
    const cassette = JSON.parse(
      await readFile(join(DOCS, '..', 'examples/acme/criteria/council.cassette.json'), 'utf8'),
    ) as { judges: Array<{ id: string }> };
    expect(cassette.judges).toHaveLength(6);
    for (const judge of cassette.judges) expect(text).toContain(`\`${judge.id}\``);
  });

  it('shows one conversation spec and one task spec on the block page', async () => {
    const text = await readFile(join(DOCS, 'concepts', 'block.md'), 'utf8');
    const kinds = fences(text, 'yaml')
      .map((yaml) => parseSpecText(yaml, 'yaml'))
      .map((result) => (result.ok ? result.spec.kind : 'invalid'));
    expect(kinds).toEqual(['conversation', 'task']);
  });

  it('covers both kinds of block on every concept page, with no separate code-agent page', async () => {
    const all = await pages();
    const concepts = all.filter((page) => page.path.startsWith('concepts'));
    expect(concepts.map((page) => basename(page.path)).sort()).toEqual([
      'blast-radius.md',
      'block.md',
      'drift.md',
      'given-when-then.md',
      'judges.md',
      'recovery.md',
      'run-modes.md',
      'script.md',
      'statistics.md',
    ]);
    for (const page of concepts) {
      expect(page.text, page.path).toMatch(/conversation/i);
      expect(page.text, page.path).toMatch(/\btask/i);
    }
    expect(all.filter((page) => /code.?agent/i.test(page.path)).map((page) => page.path)).toEqual([]);
  });

  it('lists every code the spec loader, the inventory loader and coverage report on the CLI page', async () => {
    const text = await readFile(join(DOCS, 'reference', 'cli.md'), 'utf8');
    const codes = [...IssueCodes, ...InventoryIssueCodes, ...CoverageWarningCodes];
    expect(codes.filter((code) => !text.includes(`| \`${code}\` |`))).toEqual([]);
  });

  it('gives every reference tool cell of the comparison one source and a read date', async () => {
    const text = await readFile(join(DOCS, 'comparison.md'), 'utf8');
    const rows = text.split('\n').filter((line) => /^\| \d+ \| /.test(line));
    expect(rows).toHaveLength(30);
    for (const row of rows) {
      const cells = row.split(' | ').slice(2, 9);
      expect(cells).toHaveLength(7);
      for (const cell of cells) {
        const sourced =
          /^(yes|partial|not found), \[source\]\(https:\/\/[^)\s]+\), read \d{4}-\d{2}-\d{2}$/.test(cell);
        const unsourced = /^not documented in its docs, read \d{4}-\d{2}-\d{2}$/.test(cell);
        expect(sourced || unsourced, `${row.slice(0, 40)}: ${cell}`).toBe(true);
      }
    }
  });
});
