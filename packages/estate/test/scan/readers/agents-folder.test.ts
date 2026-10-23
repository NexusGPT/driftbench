import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  locateFile,
  locateInside,
  parseTypes,
  type TypesDocument,
  type TypesOptions,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { scanEstate } from '../../../src/index';
import * as agentsReader from '../../../src/scan/readers/agents-folder';
import { assertDeclaredProse } from './agents-folder.conformance';
import { AGENTS_LINK_PLANTS, AGENTS_PART_PLANTS, AGENTS_PROSE_PLANTS } from './agents-folder.plants';

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
  AGENTS_FOLDER_SETUP_TYPES: TypesOptions;
  readAgentsFolderSource: (
    root: string,
    options: { setupSource: Source; snapshotRoots: Record<string, string> },
  ) => Promise<Inventory>;
};
const reader = async (): Promise<Reader> => agentsReader;

const declaredTypes = agentsReader.AGENTS_FOLDER_SETUP_TYPES.base?.types;
if (!declaredTypes) throw new Error('agents-folder must declare its built-in types');
const proseTypes = declaredTypes.filter((type) => type.aspects.includes('instructs'));

describe('generated declared prose conformance', () => {
  it('requires an independent prose plant for every declared instructs type', () => {
    const expected = proseTypes.map((type) => type.name).sort();
    expect(Object.keys(AGENTS_PROSE_PLANTS).sort()).toEqual(expected);
  });

  for (const type of proseTypes) {
    it(`${type.name}: emits its declared prose and rejects its negative case`, async () => {
      const part = AGENTS_PART_PLANTS[type.name];
      const prose = AGENTS_PROSE_PLANTS[type.name];
      if (!part || !prose) throw new Error(`${type.name}: missing independent plant`);
      const runtime = new agentsReader.AgentsFolderReader();
      const positive = await fixture(part.positive);
      const negative = await fixture(part.negative);
      assertDeclaredProse(await runtime.read(positive), type, prose);
      expect((await runtime.read(negative)).prose).toEqual([]);
    });

    if (type.name === 'instruction') continue;
    it(`red mutant: the ${type.name} case rejects instruction-only prose emission`, async () => {
      const part = AGENTS_PART_PLANTS[type.name];
      const prose = AGENTS_PROSE_PLANTS[type.name];
      if (!part || !prose) throw new Error(`${type.name}: missing independent plant`);
      const root = await fixture(part.positive);
      const raw = await new agentsReader.AgentsFolderReader().read(root);
      assertDeclaredProse(raw, type, prose);
      // Reproduce the reviewed type.name === 'instruction' predicate on this type's planted estate.
      const mutant = { ...raw, prose: [] };
      const assertMutant = () => assertDeclaredProse(mutant, type, prose);
      expect(assertMutant).toThrow(`${type.name}: missing declared prose`);
    });
  }
});

describe('agents-folder RawEstate', () => {
  it('counts an untyped file under the declared source coverage root as unknown', async () => {
    const root = await fixture({
      'AGENTS.md': 'Preserve fictional identifiers.\n',
      'unclassified/notes.xyz': 'Fictional untyped content.\n',
    });
    const raw = await new agentsReader.AgentsFolderReader().read(root);
    expect(raw.coverage).toEqual({ covered: 1, unknown: ['unclassified/notes.xyz'], skipped: [] });
  });

  const kinds: Record<string, string> = {
    instruction: 'standing',
    skill: 'skill',
    'skill-reference': 'skill_file',
    'skill-script': 'skill_file',
    helper: 'subagent',
    guard: 'settings',
    script: 'guard_script',
  };
  it('plants all declared type, aspect and link selector data for the shared projection step', () => {
    expect(Object.keys(AGENTS_PART_PLANTS).sort()).toEqual(
      Object.keys(agentsReader.AGENTS_FOLDER_TYPES.types).sort(),
    );
    expect(Object.keys(AGENTS_LINK_PLANTS).sort()).toEqual(
      [...new Set(agentsReader.AGENTS_FOLDER_LINK_SELECTORS.map((selector) => selector.kind))].sort(),
    );
    for (const [name, type] of Object.entries(agentsReader.AGENTS_FOLDER_TYPES.types)) {
      expect(AGENTS_PART_PLANTS[name]?.aspects).toEqual(type.aspects);
    }
  });
  it('has a positive and negative RawEstate case for every declared type and aspect', async () => {
    expect(Object.keys(kinds).sort()).toEqual(Object.keys(agentsReader.AGENTS_FOLDER_TYPES.types).sort());
    for (const [type, plant] of Object.entries(CASES)) {
      const runtime = new agentsReader.AgentsFolderReader();
      const yes = await runtime.read(await fixture({ [plant.yes]: plant.text }));
      const no = await runtime.read(await fixture({ [plant.no]: plant.text }));
      expect(yes.files.find((file) => file.path === plant.yes)?.kind, type).toBe(kinds[type]);
      expect(no.files.find((file) => file.path === plant.no)?.kind, type).toBe('other');
      expect(agentsReader.AGENTS_FOLDER_TYPES.types[type]?.aspects).toEqual(plant.aspects);
    }
  });

  it('feeds honest existing map kinds without a model call', async () => {
    const root = await fixture({
      'AGENTS.md': 'Preserve fictional identifiers.\n',
      'skills/reconcile/SKILL.md': CASES.skill.text,
      'skills/reconcile/scripts/compute.py': CASES['skill-script'].text,
      'helpers/reviewer.md': CASES.helper.text,
      'guards/check.yaml': 'event: before-write\nscript: scripts/check.py\n',
      'scripts/check.py': CASES.script.text,
      'unclassified.xyz': 'Fictional unknown.\n',
    });
    const runtime = new agentsReader.AgentsFolderReader();
    const raw = await runtime.read(root);
    expect(raw.skills.map((item) => item.name)).toEqual(['reconcile']);
    expect(raw.subagents.map((item) => item.name)).toEqual(['reviewer']);
    expect(raw.guards.map((item) => item.script)).toEqual(['scripts/check.py']);
    expect(raw.prose.map((item) => item.text)).toContain('Preserve fictional identifiers.\n');
    expect(raw.files.find((item) => item.path === 'unclassified.xyz')?.kind).toBe('other');
    const { map } = await scanEstate({ root, reader: runtime });
    expect(map.atoms.map((atom) => atom.kind)).toEqual(
      expect.arrayContaining(['skill', 'subagent', 'guard', 'script']),
    );
  });

  it('observes an aspect change through source types and survives moving a source', async () => {
    const files = { 'instructions/policy.md': CASES.instruction.text };
    const root = await fixture(files);
    const runtime = new agentsReader.AgentsFolderReader();
    expect((await runtime.read(root)).prose.map((chunk) => chunk.text)).toEqual(
      (await runtime.read(await fixture(files))).prose.map((chunk) => chunk.text),
    );
    const base = agentsReader.AGENTS_FOLDER_SETUP_TYPES.base;
    if (!base) throw new Error('missing types');
    const types = {
      ...base,
      types: base.types.map((type) =>
        type.name === 'instruction' ? { ...type, aspects: ['informs' as const] } : type,
      ),
    };
    const changed = new agentsReader.AgentsFolderReader({ setupSource: { ...source(root), types } });
    expect((await changed.read(root)).prose).toEqual([]);
  });

  it('keeps explicitly named helper findings after renaming and moving its file', async () => {
    const runtime = new agentsReader.AgentsFolderReader();
    const findings = [];
    for (const path of ['helpers/reviewer.md', 'helpers/nested/renamed.md', 'agents/review.md']) {
      const raw = await runtime.read(await fixture({ [path]: CASES.helper.text }));
      findings.push({
        names: raw.subagents.map((helper) => helper.name),
        prose: raw.prose.map((chunk) => chunk.text),
      });
    }
    expect(findings).toEqual([findings[0], findings[0], findings[0]]);
    expect(findings[0]?.names).toEqual(['reviewer']);
  });
});

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
  it('exposes deeply immutable source-relative setup type metadata', async () => {
    const { AGENTS_FOLDER_SETUP_TYPES } = await reader();
    expect(AGENTS_FOLDER_SETUP_TYPES.runtime).toBe('agents-folder');
    expect(AGENTS_FOLDER_SETUP_TYPES.folder).toBe('.');
    expect(AGENTS_FOLDER_SETUP_TYPES.roots).toEqual({ source: '.' });
    expect(Object.isFrozen(AGENTS_FOLDER_SETUP_TYPES)).toBe(true);
    expect(Object.isFrozen(AGENTS_FOLDER_SETUP_TYPES.base?.types)).toBe(true);
    const extended = parseTypes(
      {
        version: 1,
        types: {
          'review-skill': { extends: 'skill', aspects: ['informs'] },
        },
      },
      AGENTS_FOLDER_SETUP_TYPES,
    );
    expect(extended.ok).toBe(true);
    if (!extended.ok) throw new Error(JSON.stringify(extended.errors));
    const custom = extended.set.types.find((type) => type.name === 'review-skill');
    expect(custom?.folder).toBe('.');
    expect(custom?.aspects).toEqual(['informs']);
    expect(custom?.locate.map((locator) => locator.written)).toEqual(['skills/*/']);
  });

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
      const positive =
        type.folder === undefined
          ? locateInside(type, planted.yes.split('/').slice(2).join('/'))
          : locateFile(type, planted.yes);
      const negative =
        type.folder === undefined
          ? locateInside(type, planted.no.split('/').slice(2).join('/'))
          : locateFile(type, planted.no);
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

  for (const [name, bytes, reason] of [
    ['invalid.txt', Buffer.from([0xc3, 0x28]), 'invalid-utf8'],
    ['oversized.txt', Buffer.alloc(1024 * 1024 + 1, 'a'), 'size-limit:1048576'],
  ] as const) {
    it(`accounts for unread ${name} with its reason`, async () => {
      const root = await fixture({});
      await writeFile(join(root, name), bytes);
      const inventory = await agentsReader.readAgentsFolderSource(root);
      expect(inventory).toEqual({ files: [], skipped: [{ what: name, reason }] });
      expect((await new agentsReader.AgentsFolderReader().read(root)).notes).toEqual([
        { file: name, message: `skipped: ${reason}` },
      ]);
    });
  }
});
