import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkSectionRegistry,
  checkSpecLinks,
  loadChangeManifest,
  loadSectionRegistry,
  loadSpecFile,
  registriesByPrompt,
  type SectionRegistry,
} from '@agent-nexus/driftbench-core';
import { loadApprovedMap } from '@agent-nexus/driftbench-generate';
import { parseCriterionFile } from '@agent-nexus/driftbench-judges';
import { loadPersona } from '@agent-nexus/driftbench-users';
import { describe, expect, it, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const README = join(ROOT, 'README.md');
const INNOVATIONS = join(ROOT, 'docs/innovations.md');
const HOW_IT_WORKS = join(ROOT, 'docs/how-it-works.md');
const RECIPES = join(ROOT, 'docs/recipes.md');
const SUMMARY = '<summary>See it in YAML</summary>';
/** The folds that carry files: "See it in YAML or TypeScript" on the docs pages, "How to do it" in the README. */
const DROPDOWN =
  /<details><summary>(?:See it in (YAML|TypeScript)|How to do it[^<]*)<\/summary>([\s\S]*?)<\/details>/g;

/** The file a snippet names on its first line: `# file:` in YAML, text and markdown, `// file:` in TypeScript. */
const FILE_LINE = /^(?:#|\/\/) file: (.+)\n/;

/**
 * Each dropdown is a standalone folder. Its file comments are also the copy instructions. A YAML or
 * TypeScript file keeps its first line, a comment; in a text or markdown file that line only names it.
 * TypeScript files run, and what they print must equal the dropdown's untyped fence.
 */
async function checkDropdown(body: string, requireCleanLint = true, allowNoFiles = false): Promise<number> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-readme-yaml-'));
  try {
    const fences = [...body.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)];
    const snippets = fences.filter((fence) => ['yaml', 'text', 'markdown', 'ts'].includes(fence[1] ?? ''));
    if (allowNoFiles && snippets.length === 0) return 0;
    expect(snippets.length).toBeGreaterThan(0);
    const files = new Map<string, { kind: string; path: string }>();
    for (const snippet of snippets) {
      const kind = snippet[1] ?? '';
      const text = snippet[2] ?? '';
      const name = FILE_LINE.exec(text)?.[1];
      expect(name, 'every snippet names its file').toBeDefined();
      const path = resolve(folder, name ?? '');
      expect(path.startsWith(folder + sep), 'file stays inside its example folder').toBe(true);
      expect(files.has(name ?? ''), 'file names are unique inside a dropdown').toBe(false);
      files.set(name ?? '', { kind, path });
      await mkdir(dirname(path), { recursive: true });
      const keepsLine = kind === 'yaml' || kind === 'ts';
      await writeFile(path, keepsLine ? text : text.replace(FILE_LINE, ''));
    }
    const registries: SectionRegistry[] = [];
    for (const [name, { kind, path }] of files) {
      if (kind !== 'yaml' || !name.endsWith('.sections.yaml')) continue;
      const result = await loadSectionRegistry(path);
      expect(result.ok ? [] : result.errors, name).toEqual([]);
      if (!result.ok) continue;
      const prompt = files.get(`${result.registry.prompt_id}.md`);
      expect(prompt, 'the registry describes a prompt shown in this dropdown').toBeDefined();
      expect(checkSectionRegistry(result.registry, await readFile(prompt?.path ?? '', 'utf8')), name).toEqual(
        [],
      );
      registries.push(result.registry);
    }
    const byPrompt = registriesByPrompt(registries);
    if (!byPrompt.ok) throw new Error(byPrompt.errors.join('\n'));
    let checked = 0;
    for (const [name, { kind, path }] of files) {
      if (kind !== 'yaml') continue;
      if (name.endsWith('.spec.yaml')) {
        const result = await loadSpecFile(path);
        expect(result.ok ? [] : result.errors, name).toEqual([]);
        if (result.ok && requireCleanLint) expect(result.warnings, name).toEqual([]);
        if (result.ok) expect(checkSpecLinks(result.spec, byPrompt.byPrompt), name).toEqual([]);
      } else if (name.endsWith('.sections.yaml')) {
        // Loaded and checked against its prompt above.
      } else if (name.endsWith('.persona.yaml')) {
        const persona = await loadPersona(path);
        expect(persona.spec, 'the persona points to a shown spec').toBeDefined();
        const spec = resolve(dirname(path), persona.spec ?? '');
        expect(
          [...files.values()].some((file) => file.path === spec),
          'the referenced spec is shown in this dropdown',
        ).toBe(true);
        expect((await loadSpecFile(spec)).ok).toBe(true);
      } else if (name.endsWith('.map.yaml')) {
        const result = await loadApprovedMap(path);
        expect(result.ok ? [] : result, name).toEqual([]);
      } else if (name.endsWith('.change.yaml')) {
        const result = await loadChangeManifest(path);
        expect(result.ok ? [] : result.errors, name).toEqual([]);
      } else if (name.endsWith('.criterion.yaml') || name.startsWith('criteria/')) {
        const result = parseCriterionFile(await readFile(path, 'utf8'), path);
        expect('issues' in result ? result.issues : [], name).toEqual([]);
      } else {
        throw new Error(`No real loader registered for README YAML file ${name}`);
      }
      checked += 1;
    }
    const scripts = [...files.entries()].filter(([, file]) => file.kind === 'ts');
    if (scripts.length > 0) {
      const outputs = fences.filter((fence) => fence[1] === '');
      expect(outputs, 'a script dropdown shows what its script prints, once').toHaveLength(1);
      expect(scripts, 'one script per dropdown').toHaveLength(1);
      const printed: string[] = [];
      const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '));
      });
      try {
        await import(pathToFileURL(scripts[0]?.[1].path ?? '').href);
      } finally {
        log.mockRestore();
      }
      expect(`${printed.join('\n')}\n`, scripts[0]?.[0]).toBe(outputs[0]?.[2]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    return checked;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('README and docs YAML dropdowns', () => {
  it('loads every YAML file and its shown references with the real loaders', async () => {
    const innovations = await readFile(INNOVATIONS, 'utf8');
    const section = innovations.split(/^## More that ships$/m)[0] ?? '';
    const ideas = section.split(/^## /m).slice(1);
    expect(ideas).toHaveLength(10);
    for (const idea of ideas) expect(idea, idea.split('\n')[0]).toContain(SUMMARY);
    const pages = new Map<string, { yaml: number; ts: number; folds: number; checked: number }>();
    const expected = new Map([
      [INNOVATIONS, { yaml: 11, ts: 0, folds: 0, checked: 17 }],
      [HOW_IT_WORKS, { yaml: 0, ts: 2, folds: 0, checked: 3 }],
      [README, { yaml: 0, ts: 0, folds: 21, checked: 15 }],
    ]);
    for (const page of expected.keys()) {
      const text = await readFile(page, 'utf8');
      const dropdowns = [...text.matchAll(DROPDOWN)];
      let checked = 0;
      for (const dropdown of dropdowns)
        checked += await checkDropdown(dropdown[2] ?? '', true, page === README);
      pages.set(page, {
        yaml: dropdowns.filter((dropdown) => dropdown[1] === 'YAML').length,
        ts: dropdowns.filter((dropdown) => dropdown[1] === 'TypeScript').length,
        folds: dropdowns.filter((dropdown) => dropdown[1] === undefined).length,
        checked,
      });
    }
    expect(Object.fromEntries(pages)).toEqual(Object.fromEntries(expected));
  }, 180_000);

  it('names the pull requests of a feature that is not built yet', async () => {
    const readme = await readFile(INNOVATIONS, 'utf8');
    const bodies = [...readme.matchAll(DROPDOWN)].map((dropdown) => dropdown[2] ?? '');
    expect(bodies.join('\n')).not.toMatch(/ships? in \[PR/);
    for (const pr of [418, 444]) {
      expect(readme.includes(`[#${pr}](https://github.com/NexusGPT/driftbench/pull/${pr})`), `#${pr}`).toBe(
        true,
      );
    }
    const base = 'https://github.com/NexusGPT/driftbench/pull';
    expect(readme).toContain(`not built yet ([#418](${base}/418), [#444]`);
    expect(readme).not.toMatch(/coming in \[#418\]/);
  });

  it('also loads every YAML snippet outside the dropdowns, in the README and the moved pages', async () => {
    const texts = await Promise.all(
      [README, INNOVATIONS, HOW_IT_WORKS, RECIPES].map((page) => readFile(page, 'utf8')),
    );
    const readme = texts.join('\n').replace(DROPDOWN, '');
    const snippets = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)];
    expect(snippets.length).toBeGreaterThan(0);
    for (const [index, snippet] of snippets.entries()) {
      let yaml = snippet[1] ?? '';
      const criterion = /^criterion:/m.test(yaml);
      // A shown block list belongs under blocks; its stage names form its catalogue.
      if (yaml.startsWith('- ')) {
        const stages = [...yaml.matchAll(/^\s+stage: (.+)$/gm)].map((match) => match[1]);
        yaml = `id: readme-block-${index}\nstages: ${JSON.stringify(stages)}\nblocks:\n${yaml.replace(/^(?=.)/gm, '  ')}`;
      }
      const name = `example-${index}.${criterion ? 'criterion' : 'spec'}.yaml`;
      await checkDropdown(`\`\`\`yaml\n# file: ${name}\n${yaml}\`\`\``, false);
    }
  });

  it('rejects a misspelled spec key through the same loader path', async () => {
    await expect(
      checkDropdown('```yaml\n# file: broken.spec.yaml\nid: acme-broken\nblokcs: []\n```'),
    ).rejects.toThrow();
  });

  it('rejects a link to a section its registry does not hold', async () => {
    const readme = await readFile(INNOVATIONS, 'utf8');
    const links = [...readme.matchAll(DROPDOWN)].find((dropdown) => dropdown[2]?.includes('metadata.links'));
    expect(links).toBeDefined();
    const broken = (links?.[2] ?? '').replace('section: recap }', 'section: recapp }');
    expect(broken).not.toBe(links?.[2]);
    await expect(checkDropdown(broken)).rejects.toThrow();
  });

  it('rejects a script whose shown output differs from what it prints', async () => {
    const readme = await readFile(HOW_IT_WORKS, 'utf8');
    const script = [...readme.matchAll(DROPDOWN)].find((dropdown) => dropdown[2]?.includes('headline.ts'));
    expect(script).toBeDefined();
    const broken = (script?.[2] ?? '').replace('[35.4%, 88.2%]\n```', '[35.4%, 88.3%]\n```');
    expect(broken).not.toBe(script?.[2]);
    await expect(checkDropdown(broken)).rejects.toThrow();
  }, 60_000);
});
