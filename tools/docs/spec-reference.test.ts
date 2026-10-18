import { spawnSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import * as family from '../../packages/generate/src/families/schema';
import {
  checkLinks,
  DOCS,
  extractLinks,
  headingAnchors,
  run as runLinks,
  slug,
  unreachablePages,
} from './check-links';
import {
  checkValueLines,
  DEFAULT_OUT,
  exportName,
  FAMILY_OUT,
  FILE_PAGES,
  type FilePage,
  renderFamilyReference,
  renderFilePage,
  renderReference,
  run,
  schemaNames,
  toJsonSchema,
  VALUE_LINES,
} from './spec-reference';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');

function capture() {
  let out = '';
  let err = '';
  return {
    io: {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
    },
    output: () => ({ out, err }),
  };
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'driftbench-docs-'));
}

/** Every property key under a JSON Schema node, at any depth. */
function propertyKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyKeys(item, keys);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        for (const name of Object.keys(value)) keys.add(name);
      }
      if (key !== '$defs') propertyKeys(value, keys);
    }
  }
  return keys;
}

describe('spec reference generator', () => {
  it('writes a page equal to the committed docs/reference/spec.md', async () => {
    const out = join(await tempDir(), 'spec.md');
    const { io, output } = capture();
    expect(await run(['--out', out], io)).toBe(0);
    expect(output().out).toContain('Wrote ');
    expect(await readFile(out, 'utf8')).toBe(await readFile(DEFAULT_OUT, 'utf8'));
  });

  it('--check exits 0 on a current copy, and 1 naming the file on an edited or missing one', async () => {
    const dir = await tempDir();
    const copy = join(dir, 'spec.md');
    await copyFile(DEFAULT_OUT, copy);

    const current = capture();
    expect(await run(['--check', '--out', copy], current.io)).toBe(0);
    expect(current.output().out).toContain(`${copy} is up to date.`);

    await appendFile(copy, '\nEdited by hand.\n');
    const stale = capture();
    expect(await run(['--check', '--out', copy], stale.io)).toBe(1);
    expect(stale.output().err).toContain(`${copy} is stale`);

    const missing = capture();
    expect(await run(['--check', `--out=${join(dir, 'absent.md')}`], missing.io)).toBe(1);
    expect(missing.output().err).toContain('absent.md is missing');
  });

  it('exits 1 from the command line on a stale file and 0 on the committed one', async () => {
    const mutated = join(await tempDir(), 'spec.md');
    await writeFile(mutated, `${await readFile(DEFAULT_OUT, 'utf8')}| stale row |\n`);

    const stale = spawnSync(TSX, ['tools/docs/spec-reference.ts', '--check', '--out', mutated], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(stale.status, stale.stderr).toBe(1);
    expect(stale.stderr).toContain(`${mutated} is stale`);

    const committed = spawnSync(TSX, ['tools/docs/spec-reference.ts', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(committed.status, committed.stderr).toBe(0);
    expect(committed.stdout).toContain('docs/reference/spec.md is up to date.');
    expect(committed.stdout).toContain('docs/reference/family.md is up to date.');
  }, 60_000);

  it('refuses an unknown argument and an --out without a file, with exit 2', async () => {
    const unknown = capture();
    expect(await run(['--bogus'], unknown.io)).toBe(2);
    expect(unknown.output().err).toContain('unknown argument: --bogus');
    const bare = capture();
    expect(await run(['--out'], bare.io)).toBe(2);
  });

  it('documents every field of Spec and of the inventory, at any depth', () => {
    const { markdown } = renderReference();
    const names = schemaNames({ ...core });
    for (const schema of [core.Spec, core.Inventory]) {
      const keys = propertyKeys(toJsonSchema(schema, names));
      expect(keys.size).toBeGreaterThan(5);
      expect([...keys].filter((key) => !markdown.includes(`| \`${key}\` |`))).toEqual([]);
    }
    expect(propertyKeys(toJsonSchema(core.Spec, names)).size).toBeGreaterThan(80);
  });

  it('shows a field with a schema default as optional, with its default', () => {
    const { markdown } = renderReference();
    const behaviour = markdown.slice(markdown.indexOf('## InventoryBehaviour'));
    expect(behaviour).toContain('| `kind` | `conversation` or `task` | no | `conversation` |');
  });

  it('gives every deviation and drift class one line', () => {
    const { markdown } = renderReference();
    for (const [name, values] of [
      ['DeviationClass', core.DeviationClass.options],
      ['DriftClass', core.DriftClass.options],
    ] as const) {
      expect(markdown).toContain(`## ${name}`);
      for (const value of values) {
        const line = VALUE_LINES[name]?.[value];
        expect(line, `${name}.${value}`).toBeTruthy();
        expect(markdown).toContain(`| \`${value}\` | ${line} |`);
      }
    }
  });

  it('fails generation when an enum value has no line, or a line names an unknown value', () => {
    expect(() => checkValueLines('Kind', ['a', 'b'], { a: 'One.' })).toThrow(/Kind values without a line.*b/);
    expect(() => checkValueLines('Kind', ['a'], { a: 'One.', z: 'Two.' })).toThrow(
      /names values the enum lacks: z/,
    );
    expect(() => checkValueLines('Kind', ['a'], undefined)).toThrow(/no entry in VALUE_LINES/);
    expect(() => checkValueLines('Kind', ['a'], { a: 'One.' })).not.toThrow();
  });

  it('names sections after the documented short names', () => {
    const names = schemaNames({ ...core });
    expect(names.get(core.BlockSpec)).toBe('Block');
    expect(names.get(core.GivenOverride)).toBe('Given');
    expect(names.get(core.PerturbationSpec)).toBe('Perturbation');
    const { markdown } = renderReference();
    expect(markdown).toContain('## Block\n');
    expect(markdown).not.toContain('## BlockSpec');
  });

  it('keeps the name of a schema a field describes, and takes the section text from the export', () => {
    // `when: Stimulus.describe('The stimulus.')` holds a copy of Stimulus, not Stimulus itself.
    const names = schemaNames({ ...core });
    const described = core.Stimulus.describe('A field description.');
    expect(names.get(described)).toBeUndefined();
    expect(exportName(described, names)).toBe('Stimulus');
    const { markdown } = renderReference();
    expect(markdown).toContain('| `when` | [Stimulus](#stimulus) | yes |');
    expect(markdown).toContain('| `class` | [DeviationClass](#deviationclass) | yes |');
    const stimulus = markdown.slice(
      markdown.indexOf('## Stimulus\n'),
      markdown.indexOf('## Stimulus injection'),
    );
    expect(stimulus).toContain(String(core.Stimulus.description));
  });

  it('describes every field on the page, from the schemas', () => {
    expect(renderReference().missing).toEqual([]);
  });

  it('lists exactly the fields whose description cell is empty', async () => {
    const { markdown, missing } = renderReference();
    const emptyCells = markdown.split('\n').filter((line) => line.startsWith('| `') && line.endsWith('|  |'));
    expect(missing).toHaveLength(emptyCells.length);
    const listed = capture();
    expect(await run(['--missing'], listed.io)).toBe(0);
    expect(listed.output().out.split('\n').filter(Boolean)).toEqual(missing);
  });

  it('describes the shorthand the loader really applies', () => {
    const loaded = core.validateSpec({
      id: 'shorthand',
      ledger_seed: { plan: 'basic' },
      workspace_seed: 'fixtures/start',
      blocks: [{ user: 'hi', expect: { must: ['hello'] } }, { burst: ['a', 'b'] }],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.spec.kind).toBe('conversation');
    expect(loaded.spec.blocks[0]?.when).toEqual({ user: 'hi' });
    expect(loaded.spec.blocks[1]?.when).toEqual({ burst: ['a', 'b'] });
    expect(loaded.spec.given?.ledger).toEqual({ plan: 'basic' });
    expect(loaded.spec.given?.world?.workspace).toEqual({ from: 'fixtures/start' });
  });
});

describe('task family reference', () => {
  it('equals the committed docs/reference/family.md', async () => {
    expect(renderFamilyReference().markdown).toBe(await readFile(FAMILY_OUT, 'utf8'));
  });

  it('documents every field of the family file and the review file, at any depth, each with a description', () => {
    const { markdown, missing } = renderFamilyReference();
    const names = schemaNames({ ...family });
    for (const schema of [family.FamilyFile, family.ReviewFile]) {
      const keys = propertyKeys(toJsonSchema(schema, names));
      expect([...keys].filter((key) => !markdown.includes(`| \`${key}\` |`))).toEqual([]);
    }
    expect(propertyKeys(toJsonSchema(family.FamilyFile, names)).size).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it('renders a union of mapping shapes as one table per shape, named by its own key', () => {
    const { markdown } = renderFamilyReference();
    const files = markdown.slice(markdown.indexOf('## SeedFile\n'), markdown.indexOf('## SeedFile csv'));
    for (const key of ['csv', 'json', 'text', 'copy']) {
      expect(files).toContain(`* a mapping with \`${key}\`, with the fields below`);
      expect(files).toContain(`With \`${key}\`:`);
    }
  });
});

describe('the reference pages of the files people write', () => {
  for (const page of FILE_PAGES) {
    it(`writes docs/reference/${page.file} equal to the committed file, every field at any depth described`, async () => {
      const { markdown, missing } = renderFilePage(page as FilePage);
      expect(markdown).toBe(await readFile(join(ROOT, 'docs/reference', page.file), 'utf8'));
      const names = schemaNames({ ...page.names });
      for (const [, schema] of page.roots) {
        const keys = propertyKeys(toJsonSchema(schema as never, names));
        expect(keys.size).toBeGreaterThan(0);
        expect([...keys].filter((key) => !markdown.includes(`| \`${key}\` |`))).toEqual([]);
      }
      expect(missing).toEqual([]);
    });
  }

  it('renders a discriminated union as one table per shape, named by its constant', () => {
    const page = FILE_PAGES.find((entry) => entry.file === 'criteria.md') as FilePage;
    const { markdown } = renderFilePage(page);
    const anchors = markdown.slice(markdown.indexOf('## AnnotationAnchor'));
    for (const kind of ['message', 'tool_call', 'field', 'span']) {
      expect(anchors).toContain(`* a mapping with \`kind: ${kind}\`, with the fields below`);
      expect(anchors).toContain(`With \`kind: ${kind}\`:`);
    }
  });
});

describe('docs link checker', () => {
  it('finds every relative link in docs resolving, and every page reachable from docs/index.md', async () => {
    const { problems, links, files } = await checkLinks(DOCS);
    expect(problems).toEqual([]);
    expect(files).toBeGreaterThanOrEqual(17);
    expect(links).toBeGreaterThan(100);
    expect(await unreachablePages(DOCS)).toEqual([]);
    const { io, output } = capture();
    expect(await runLinks([DOCS], io)).toBe(0);
    expect(output().out).toContain('every page is reachable from index.md');
  });

  it('reports a missing file, a missing heading, an absolute path and an unreachable page', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'concepts'));
    await mkdir(join(dir, 'lanes'));
    await writeFile(
      join(dir, 'index.md'),
      [
        '# Home',
        '',
        '[a page](concepts/a.md) and [its heading](concepts/a.md#the-heading)',
        '[a lost heading](concepts/a.md#nowhere) and [a lost page](concepts/gone.md)',
        '[absolute](/concepts/a.md) and [web](https://example.com/x.md) and [self](#home)',
        '`[in code](concepts/gone.md)`',
        '```',
        '[in a fence](concepts/gone.md)',
        '```',
      ].join('\n'),
    );
    await writeFile(join(dir, 'concepts', 'a.md'), '# A\n\n## The heading\n\n[back](../index.md)\n');
    await writeFile(join(dir, 'orphan.md'), '# Orphan\n');
    await writeFile(join(dir, 'lanes', 'local.md'), '[skipped](nowhere.md)\n');

    const { problems } = await checkLinks(dir);
    expect(problems.map((problem) => [problem.target, problem.reason])).toEqual([
      ['concepts/a.md#nowhere', 'no heading with the anchor #nowhere'],
      ['concepts/gone.md', 'no such file or folder'],
      ['/concepts/a.md', 'absolute path; use a path relative to the page'],
    ]);
    expect(await unreachablePages(dir)).toEqual(['orphan.md']);

    const { io, output } = capture();
    expect(await runLinks([dir], io)).toBe(1);
    expect(output().err).toContain('orphan.md  not reachable from index.md');
  });

  it('computes anchors the way GitHub does and ignores links in code', () => {
    expect(slug('`spec validate`')).toBe('spec-validate');
    expect(slug('Given, When, Then')).toBe('given-when-then');
    expect(slug('Code, files and workspace')).toBe('code-files-and-workspace');
    expect([...headingAnchors('# Notes\n## Notes\n```\n# not a heading\n```\n')]).toEqual([
      'notes',
      'notes-1',
    ]);
    expect(
      extractLinks('[a](b.md "title") `[c](d.md)` ![e](f.png)\n[ref]: g.md').map((link) => link.target),
    ).toEqual(['b.md', 'f.png', 'g.md']);
  });
});
