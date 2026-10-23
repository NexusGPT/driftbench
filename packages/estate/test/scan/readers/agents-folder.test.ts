import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateFile, locateInside, parseTypes, type TypesDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import * as agentsReader from '../../../src/scan/readers/agents-folder';

type Source = {
  id: string;
  root: string;
  kind: 'project' | 'home' | 'directory';
  reader: string;
  bindings: Array<{
    runtime: string;
    deployedRoot: string;
    deployedPath: string;
    method: 'link' | 'copy';
  }>;
  provenance: { file: string; path: string };
};
type Inventory = {
  files: Array<{ path: string; text: string }>;
  skipped: Array<{ what: string; reason: string }>;
};
type Reader = {
  AGENTS_FOLDER_TYPES: TypesDocument;
  readAgentsFolderSource: (
    root: string,
    options: { setupSource: Source; snapshotRoots: Record<string, string> },
  ) => Promise<Inventory>;
};
const reader = async (): Promise<Reader> => agentsReader;

function inventoryOf(read: Reader['readAgentsFolderSource'], input: Source, sources: readonly Source[]) {
  return read(input.root, {
    setupSource: input,
    snapshotRoots: Object.fromEntries(sources.map((entry) => [entry.id, entry.root])),
  });
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-agents-source-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

function source(root: string, extra: Partial<Source> = {}): Source {
  return {
    id: 'shared',
    root,
    kind: 'directory',
    reader: 'agents-folder',
    bindings: [],
    provenance: { file: 'driftbench.setup.yaml', path: 'sources[0]' },
    ...extra,
  };
}

// Expectations are authored from the layout contract, independently of the implementation's declarations.
// Adding a declared type without planting both its positive and negative case fails the completeness assertion.
const CASES = {
  instruction: {
    yes: 'instructions/policy.md',
    no: 'instructions/policy.md.bak',
    text: 'Keep the fictional ledger consistent.\n',
    aspects: ['instructs'],
  },
  skill: {
    yes: 'skills/reconcile/SKILL.md',
    no: 'skills/reconcile/SKILL.md.bak',
    text: '---\nname: reconcile\ndescription: Reconciles fictional rows.\n---\nRead the ledger.\n',
    aspects: ['instructs'],
  },
  'skill-reference': {
    yes: 'skills/reconcile/references/format.md',
    no: 'skills/reconcile/examples/format.md',
    text: 'Rows have an identifier and an amount.\n',
    aspects: ['informs'],
  },
  'skill-script': {
    yes: 'skills/reconcile/scripts/compute.py',
    no: 'skills/reconcile/examples/compute.py',
    text: 'raise RuntimeError("Fictional source must never execute")\n',
    aspects: ['executes'],
  },
  helper: {
    yes: 'helpers/reviewer.md',
    no: 'helpers/reviewer.txt',
    text: '---\nname: reviewer\ndescription: Reviews fictional rows.\n---\nCheck each row.\n',
    aspects: ['delegates', 'instructs'],
  },
  guard: {
    yes: 'guards/check.yaml',
    no: 'guards/check.txt',
    text: 'name: check\nevent: before-write\nscript: scripts/check.py\ntarget: skills/reconcile/SKILL.md\n',
    aspects: ['guards'],
  },
  script: {
    yes: 'scripts/check.py',
    no: 'scripts/check.py.txt',
    text: 'raise RuntimeError("Fictional source must never execute")\n',
    aspects: ['executes'],
  },
} as const;

describe('shared agents source contract', () => {
  it('declares exactly the independently planted types, using only the common model vocabulary', async () => {
    const { AGENTS_FOLDER_TYPES } = await reader();
    expect(Object.keys(AGENTS_FOLDER_TYPES.types).sort()).toEqual(Object.keys(CASES).sort());
    const parsed = parseTypes(AGENTS_FOLDER_TYPES, {
      runtime: 'agents-folder',
      roots: { source: '.' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    for (const type of parsed.set.types) {
      expect(type.aspects, type.name).toEqual(CASES[type.name as keyof typeof CASES].aspects);
      const planted = CASES[type.name as keyof typeof CASES];
      const positive = type.folder === undefined
        ? locateInside(type, planted.yes.split('/').slice(2).join('/')) : locateFile(type, planted.yes);
      const negative = type.folder === undefined
        ? locateInside(type, planted.no.split('/').slice(2).join('/')) : locateFile(type, planted.no);
      expect(positive, `${type.name}: positive locator`).toBeDefined();
      expect(negative, `${type.name}: negative locator`).toBeUndefined();
    }
  });

  it('reads filtered snapshot bytes, never the original source named in setup metadata', async () => {
    const { readAgentsFolderSource } = await reader();
    const original = await fixture({ 'AGENTS.md': 'Fictional excluded original.\n' });
    const snapshot = await fixture({ 'AGENTS.md': 'Fictional filtered snapshot.\n' });
    const inventory = await readAgentsFolderSource(snapshot, {
      setupSource: source(original),
      snapshotRoots: { shared: snapshot },
    });
    expect(inventory.files).toEqual([{ path: 'AGENTS.md', text: 'Fictional filtered snapshot.\n' }]);
  });

  it('does not authorize original roots merely because setup metadata declares them', async () => {
    const { readAgentsFolderSource } = await reader();
    const original = await fixture({ 'AGENTS.md': 'Fictional excluded original.\n' });
    const snapshot = await fixture({});
    await symlink(original, join(snapshot, 'unfiltered'));
    const inventory = await readAgentsFolderSource(snapshot, {
      setupSource: source(original),
      snapshotRoots: { shared: snapshot },
    });
    expect(inventory.files).toEqual([]);
    expect(inventory.skipped).toEqual([{ what: 'unfiltered', reason: 'outside-mapped-roots' }]);
  });

  for (const [type, planted] of Object.entries(CASES)) {
    it(`keeps the source bytes of the ${type} plant and its negative for common-model classification`, async () => {
      const { readAgentsFolderSource } = await reader();
      const root = await fixture({ [planted.yes]: planted.text, [planted.no]: planted.text });
      const input = source(root);
      const inventory = await inventoryOf(readAgentsFolderSource, input, [input]);
      expect(inventory.files).toEqual(
        [
          { path: planted.yes, text: planted.text },
          { path: planted.no, text: planted.text },
        ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      );
      expect(inventory.skipped).toEqual([]);
    });
  }

  it('reads the committed fictional example, independent of the source folder name', async () => {
    const { readAgentsFolderSource } = await reader();
    const root = fileURLToPath(new URL('../../fixtures/readers/agents-folder/shared/', import.meta.url));
    const input = source(root);
    const inventory = await inventoryOf(readAgentsFolderSource, input, [input]);
    expect(inventory.files.map((file) => file.path)).toContain('AGENTS.md');
    expect(inventory.files.find((file) => file.path === 'AGENTS.md')?.text).toBe(
      await readFile(join(root, 'AGENTS.md'), 'utf8'),
    );
  });

  it('preserves unknown files and empty files instead of silently dropping them', async () => {
    const { readAgentsFolderSource } = await reader();
    const root = await fixture({ 'unclassified.xyz': 'unclassified\n', 'empty.bin': '' });
    const input = source(root);
    const inventory = await inventoryOf(readAgentsFolderSource, input, [input]);
    expect(inventory.files).toEqual([
      { path: 'empty.bin', text: '' },
      { path: 'unclassified.xyz', text: 'unclassified\n' },
    ]);
    expect(inventory.skipped).toEqual([]);
  });

  it('reports missing roots and broken links with reasons', async () => {
    const { readAgentsFolderSource } = await reader();
    const root = await fixture({});
    const input = source(join(root, 'absent'));
    expect((await inventoryOf(readAgentsFolderSource, input, [input])).skipped).toEqual([
      { what: '.', reason: 'source-unreadable:ENOENT' },
    ]);
    await symlink('absent.md', join(root, 'dangling.md'));
    const present = source(root);
    expect((await inventoryOf(readAgentsFolderSource, present, [present])).skipped).toEqual([
      { what: 'dangling.md', reason: 'unreadable:ENOENT' },
    ]);
  });

  for (const spelling of ['.agents', 'dot_agents', 'nested/shared source']) {
    it(`is invariant under source relocation to ${spelling}`, async () => {
      const { readAgentsFolderSource } = await reader();
      const files = Object.fromEntries(Object.values(CASES).map((item) => [item.yes, item.text]));
      const a = await fixture(files);
      const b = await fixture(
        Object.fromEntries(Object.entries(files).map(([path, text]) => [`${spelling}/${path}`, text])),
      );
      const left = source(a);
      const right = source(join(b, spelling));
      expect(await inventoryOf(readAgentsFolderSource, left, [left])).toEqual(
        await inventoryOf(readAgentsFolderSource, right, [right]),
      );
    });
  }

  it('follows in-root links, accounts for cycles, and never reads an undeclared root', async () => {
    const { readAgentsFolderSource } = await reader();
    const root = await fixture({ 'instructions/a.md': 'Fictional policy.\n' });
    const outside = await fixture({ 'private.md': 'Fictional external sentinel.\n' });
    await symlink(outside, join(root, 'external'));
    await symlink('instructions', join(root, 'alias'));
    await symlink('.', join(root, 'cycle'));
    const input = source(root);
    const inventory = await inventoryOf(readAgentsFolderSource, input, [input]);
    expect(inventory.files.map((file) => file.path)).toEqual(['alias/a.md', 'instructions/a.md']);
    expect(inventory.skipped).toEqual([
      { what: 'cycle', reason: 'symlink-cycle' },
      { what: 'external', reason: 'outside-mapped-roots' },
    ]);
  });

  for (const kind of ['home', 'directory'] as const) {
    it(`follows a link into an explicitly mapped ${kind} source`, async () => {
      const { readAgentsFolderSource } = await reader();
      const root = await fixture({});
      const mappedRoot = await fixture({ 'policy.md': 'Fictional mapped policy.\n' });
      await symlink(mappedRoot, join(root, 'mapped'));
      const input = source(root);
      const mapping = source(mappedRoot, { id: 'mapped', kind });
      const inventory = await inventoryOf(readAgentsFolderSource, input, [input, mapping]);
      expect(inventory.files).toEqual([{ path: 'mapped/policy.md', text: 'Fictional mapped policy.\n' }]);
      expect(inventory.skipped).toEqual([]);
    });
  }

  it('records binary input as skipped with a reason', async () => {
    const { readAgentsFolderSource } = await reader();
    const root = await fixture({ 'binary.dat': 'a\u0000b' });
    const input = source(root);
    expect(await inventoryOf(readAgentsFolderSource, input, [input])).toEqual({
      files: [],
      skipped: [{ what: 'binary.dat', reason: 'binary-content' }],
    });
  });
});
