import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChangeManifest, loadSpecFile } from '@agent-nexus/driftbench-core';
import { loadApprovedMap } from '@agent-nexus/driftbench-generate';
import { parseCriterionFile } from '@agent-nexus/driftbench-judges';
import { loadPersona } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';

const README = fileURLToPath(new URL('../../README.md', import.meta.url));
const SUMMARY = '<summary>See it in YAML</summary>';

/** Each dropdown is a standalone folder. Its file comments are also the copy instructions. */
async function checkDropdown(body: string, requireCleanLint = true): Promise<number> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-readme-yaml-'));
  try {
    const snippets = [...body.matchAll(/^```(yaml|text)\n([\s\S]*?)^```$/gm)];
    expect(snippets.length).toBeGreaterThan(0);
    const files = new Set<string>();
    for (const snippet of snippets) {
      const text = snippet[2] ?? '';
      const name = /^# file: (.+)\n/.exec(text)?.[1];
      expect(name, 'every snippet names its file').toBeDefined();
      const path = resolve(folder, name ?? '');
      expect(path.startsWith(folder + sep), 'file stays inside its example folder').toBe(true);
      expect(files.has(path), 'file names are unique inside a dropdown').toBe(false);
      files.add(path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    }
    let checked = 0;
    for (const snippet of snippets) {
      if (snippet[1] !== 'yaml') continue;
      const name = /^# file: (.+)\n/.exec(snippet[2] ?? '')?.[1] ?? '';
      const path = join(folder, name);
      if (name.endsWith('.spec.yaml')) {
        const result = await loadSpecFile(path);
        expect(result.ok ? [] : result.errors, name).toEqual([]);
        if (result.ok && requireCleanLint) expect(result.warnings, name).toEqual([]);
      } else if (name.endsWith('.persona.yaml')) {
        const persona = await loadPersona(path);
        expect(persona.spec, 'the persona points to a shown spec').toBeDefined();
        const spec = resolve(dirname(path), persona.spec ?? '');
        expect(files.has(spec), 'the referenced spec is shown in this dropdown').toBe(true);
        expect((await loadSpecFile(spec)).ok).toBe(true);
      } else if (name.endsWith('.map.yaml')) {
        const result = await loadApprovedMap(path);
        expect(result.ok ? [] : result, name).toEqual([]);
      } else if (name.endsWith('.change.yaml')) {
        const result = await loadChangeManifest(path);
        expect(result.ok ? [] : result.errors, name).toEqual([]);
      } else if (name.endsWith('.criterion.yaml')) {
        const result = parseCriterionFile(await readFile(path, 'utf8'), path);
        expect('issues' in result ? result.issues : [], name).toEqual([]);
      } else {
        throw new Error(`No real loader registered for README YAML file ${name}`);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    return checked;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('README innovation YAML dropdowns', () => {
  it('loads every YAML file and its shown references with the real loaders', async () => {
    const readme = await readFile(README, 'utf8');
    const section = readme.split('## What makes it different\n')[1]?.split('## What it does\n')[0] ?? '';
    const dropdowns = [
      ...readme.matchAll(/<details>\s*<summary>See it in YAML<\/summary>([\s\S]*?)<\/details>/g),
    ];
    expect(dropdowns).toHaveLength(10);
    const innovations = section.split(/^### /m).slice(1, 10);
    expect(innovations).toHaveLength(9);
    for (const innovation of innovations) {
      expect(innovation, innovation.split('\n')[0]).toContain(SUMMARY);
    }
    let checked = 0;
    for (const dropdown of dropdowns) checked += await checkDropdown(dropdown[1] ?? '');
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it('also loads every existing README YAML snippet, including the other dropdowns', async () => {
    const readme = (await readFile(README, 'utf8')).replace(
      /<details>\s*<summary>See it in YAML<\/summary>[\s\S]*?<\/details>/g,
      '',
    );
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
});
