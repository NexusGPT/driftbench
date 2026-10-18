import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { createMarkdownRenderer, resolveConfig } from 'vitepress';
import { describe, expect, it } from 'vitest';
import { DOCS, markdownFiles } from './check-links';

/**
 * The docs site compiles every page as a Vue template: markdown first, then the Vue compiler. Text that Vue
 * reads as an interpolation or a tag (a `{{` in inline code, a bare `<name`) breaks `pnpm docs:site:build`
 * on main only, where the site workflow runs. This test renders each page with VitePress's own markdown
 * renderer and the site's markdown options (docs/.vitepress/config.mts), and parses the result with the Vue compiler VitePress uses, so the docs checks catch that class.
 */
type VueCompiler = {
  parse(source: string, options: { filename: string }): { errors: Array<{ message: string }> };
};
/** Vue is VitePress's own dependency, not the repository's: it is loaded from where VitePress resolves it. */
const vue = createRequire(createRequire(import.meta.url).resolve('vitepress/package.json'))(
  'vue/compiler-sfc',
) as VueCompiler;

describe('docs site', () => {
  it('compiles every page as a Vue template', async () => {
    const site = await resolveConfig(DOCS, 'build', 'production');
    const md = await createMarkdownRenderer(site.srcDir, site.markdown, site.site.base, site.logger);
    const problems: string[] = [];
    for (const file of await markdownFiles(DOCS)) {
      const env = { path: file, relativePath: relative(DOCS, file) };
      const html = md.render(await readFile(file, 'utf8'), env);
      const { errors } = vue.parse(`<template><div>${html}</div></template>`, { filename: file });
      for (const error of errors) problems.push(`${relative(DOCS, file)}: ${error.message}`);
    }
    expect(problems).toEqual([]);
  }, 60_000);
});
