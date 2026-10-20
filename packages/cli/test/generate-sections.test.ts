import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BlockLink, parseSpecText, sectionsFromHeadings } from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { type Io, main } from '../src/index';

// A generation of the Northwind suite takes seconds; under a parallel suite more than the default.
vi.setConfig({ testTimeout: 120_000 });

/** `--sections` on `estate generate`: a block links the CLAUDE.md sections of its atoms. Fictional data only. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const PLAN = join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml');
const PROMPT = join(FIXTURE, 'CLAUDE.md');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function specFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await specFiles(path)));
    else if (entry.name.endsWith('.yaml')) out.push(path);
  }
  return out;
}

let dir: string;
let registryPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'generate-sections-'));
  const made = sectionsFromHeadings(await readFile(PROMPT, 'utf8'), { promptId: 'northwind', version: 'v1' });
  if (!made.ok) throw new Error(made.errors.join('\n'));
  const registry = {
    ...made.registry,
    sections: made.registry.sections.map((section) =>
      section.id === 'rules' ? { ...section, references: ['output'] } : section,
    ),
  };
  registryPath = join(dir, 'claude.sections.yaml');
  await writeFile(registryPath, stringify(registry, { lineWidth: 0 }));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('estate generate --sections', () => {
  it('writes, for a block of a rule of CLAUDE.md, the link to its section and to the section that reaches it', async () => {
    const out = join(dir, 'suite');
    const result = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      PLAN,
      '--out',
      out,
      '--sections',
      `${registryPath}=${PROMPT}`,
    ]);
    expect([0, 1]).toContain(result.code);
    let through = 0;
    for (const file of await specFiles(out)) {
      const loaded = parseSpecText(await readFile(file, 'utf8'), 'yaml', file);
      if (!loaded.ok) throw new Error(`${file}: ${JSON.stringify(loaded.errors)}`);
      const links = (loaded.spec.metadata?.links ?? []) as BlockLink[];
      for (const link of links) {
        if (link.to.kind !== 'prompt_section') continue;
        expect(link.to.prompt).toBe('northwind');
        expect(link.at_version).toBe('v1');
        const evidence = link.evidence as { declared?: { through?: string } } | undefined;
        if (evidence?.declared?.through === 'rules') {
          expect(link.to.section).toBe('output');
          through++;
        }
      }
    }
    expect(through).toBeGreaterThan(0);
  });

  it('refuses a registry that does not describe its prompt, and one with no prompt beside it, with nothing written', async () => {
    const stale = join(dir, 'stale.sections.yaml');
    await writeFile(
      stale,
      (await readFile(registryPath, 'utf8')).replace(/^text_sha256: .*$/m, `text_sha256: ${'f'.repeat(64)}`),
    );
    const out = join(dir, 'refused');
    const refused = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      PLAN,
      '--out',
      out,
      '--sections',
      `${stale}=${PROMPT}`,
    ]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('the registry does not describe');
    expect(refused.err).toContain('text_sha256');
    const alone = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      PLAN,
      '--out',
      out,
      '--sections',
      registryPath,
    ]);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('cannot be read');
    await expect(readdir(out)).rejects.toThrow();
  });
});
