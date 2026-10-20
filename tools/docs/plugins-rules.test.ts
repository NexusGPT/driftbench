import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';
import { resetPlugins } from '../../packages/cli/src/plugins';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = `${ROOT}/examples/plugins/rules`;

afterEach(() => resetPlugins());

async function run(argv: string[], cwd = EXAMPLE) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** The fenced block of docs/plugins.md that starts with `$ <first command>`. */
async function shown(first: string): Promise<string> {
  const page = await readFile(`${ROOT}/docs/plugins.md`, 'utf8');
  const marker = `\`\`\`text\n$ ${first}\n`;
  const start = page.indexOf(marker);
  expect(start, `the page shows $ ${first}`).toBeGreaterThan(0);
  const from = start + '```text\n'.length;
  return page.slice(from, page.indexOf('\n```', from)).trimEnd();
}

describe('docs/plugins.md, the rule framework plugin example', () => {
  it('prints what the page shows for the commands it runs', async () => {
    const block = await shown('driftbench spec validate specs');
    const validate = await run(['spec', 'validate', 'specs']);
    const list = await run(['object', 'list']);
    expect(validate.code, validate.err).toBe(0);
    expect(list.code, list.err).toBe(0);
    const expected = [
      '$ driftbench spec validate specs',
      validate.out.trimEnd(),
      '$ driftbench object list',
      list.out.trimEnd(),
    ].join('\n');
    expect(block).toBe(expected);
  }, 120_000);

  it('refuses the spec without the plugin, as the page says', async () => {
    const page = await readFile(`${ROOT}/docs/plugins.md`, 'utf8');
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-doc-plugin-'));
    let bare: Awaited<ReturnType<typeof run>>;
    try {
      await cp(`${EXAMPLE}/specs`, join(dir, 'specs'), { recursive: true });
      await writeFile(join(dir, 'driftbench.yaml'), '# no plugin\n');
      bare = await run(['spec', 'validate', 'specs'], dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(bare.code).toBe(1);
    expect(page).toContain('`OBJECT_UNKNOWN  spec routed: uses.check_set: unknown object check-set:acme`');
    expect(bare.out).toContain('OBJECT_UNKNOWN  spec routed: uses.check_set: unknown object check-set:acme');
  }, 120_000);
  it('shows only API calls that the example plugin makes', async () => {
    const page = await readFile(`${ROOT}/docs/plugins.md`, 'utf8');
    const plugin = await readFile(`${EXAMPLE}/plugin.mjs`, 'utf8');
    const snippet = /```js\n\/\/ plugin\.mjs\n([\s\S]*?)\n```/.exec(page)?.[1] ?? '';
    const lines = snippet
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const line of lines) expect(plugin, line).toContain(line);
  });
});
