import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readerFor } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { doctorCommand, inspectSetup } from '../src/commands/doctor';

async function estate(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-setup-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
const files = (depth: string, settings: string) => ({
  'CLAUDE.md': '# Instructions\n\nUse structured data.\n',
  [`.claude/${depth}/SKILL.md`]: '---\nname: fictional\ndescription: Produce a table.\n---\n\nRead inputs.\n',
  [`.claude/${settings}`]: '{"permissions":{"allow":["Read"]}}',
  'unknown.data': 'fictional',
});

describe('doctor reads through the runtime registry without executing', () => {
  for (const depth of ['skills/table', 'skills/group/table']) {
    for (const settings of ['settings.json', 'settings.local.json']) {
      it(`detects with evidence and preserves reader assumptions: ${depth}, ${settings}`, async () => {
        const root = await estate(files(depth, settings));
        const result = await inspectSetup(root);
        const reader = readerFor('claude-code');
        expect(reader).toBeDefined();
        const raw = await reader?.read(root);
        expect(result.sources[0]?.files).toEqual(raw?.files.map(({ path, kind }) => ({ path, kind })));
        expect(result.draft.runtime).toBe('claude-code');
        expect(result.draft.execute).toEqual({ policy: 'never', commands: [] });
        expect(result.draft.budget).toEqual({ usd: 0, modelCalls: 0 });
        expect(result.detections.every((claim) => claim.confidence > 0 && claim.evidence.length > 0)).toBe(
          true,
        );
        expect(result.coverage.unknown).toContain('project:unknown.data');
        expect(result.nextSteps.every((step) => step.usd !== null || step.reason)).toBe(true);
      });
    }
  }

  it.each(['fixture', 'fixture-v2', 'reader-cases'])(
    'draft matches current fixture assumptions: %s',
    async (name) => {
      const root = fileURLToPath(new URL(`../../../examples/estates/${name}/`, import.meta.url));
      const result = await inspectSetup(root);
      const raw = await readerFor('claude-code')?.read(root);
      expect(result.sources[0]?.files).toEqual(raw?.files.map(({ path, kind }) => ({ path, kind })));
      expect(result.draft.runtime).toBe(raw?.runtime);
    },
  );

  it('is invariant under relocation and ignored junk; detects content, added and deleted file drift', async () => {
    const root = await estate(files('skills/table', 'settings.json'));
    const moved = await estate(files('skills/table', 'settings.json'));
    const before = await inspectSetup(root);
    await mkdir(join(moved, 'node_modules'), { recursive: true });
    await writeFile(join(moved, 'node_modules', 'ignored.txt'), 'ignored');
    expect((await inspectSetup(moved)).draft).toEqual(before.draft);
    expect((await inspectSetup(root, before.draft)).drift.status).toBe('pass');
    await writeFile(join(root, 'CLAUDE.md'), '# Changed\n');
    await unlink(join(root, '.claude/settings.json'));
    await writeFile(join(root, 'new.data'), 'new');
    const after = await inspectSetup(root, before.draft);
    expect(after.drift.status).toBe('fail');
    expect(after.drift.changes.map((change) => change.kind).sort()).toEqual(['added', 'changed', 'removed']);
  });

  it('does not read an unmapped home from legacy configuration or escaping links', async () => {
    const home = await estate({ 'secret/SKILL.md': '---\nname: private\n---\nPrivate.\n' });
    const root = await estate({
      'CLAUDE.md': '# Fictional\n',
      'driftbench.estate.yaml': `userSkills: ${home}\n`,
    });
    const result = await inspectSetup(root);
    expect(result.coverage.skipped).toContainEqual(expect.objectContaining({ reason: 'home not mapped' }));
    expect(JSON.stringify(result)).not.toContain('Private.');
    await unlink(join(root, 'driftbench.estate.yaml'));
    await mkdir(join(root, '.claude'));
    await symlink(home, join(root, '.claude/skills'));
    expect((await inspectSetup(root)).coverage.skipped).toContainEqual(
      expect.objectContaining({ reason: 'unmapped symlink' }),
    );
  });

  it('uses declared custom types and scope; empty folders are not run', async () => {
    const empty = await inspectSetup(await estate({}));
    expect(empty.coverage.status).toBe('not-run');
    expect(empty.draft.runtime).toBeNull();
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      'checks/one.py': 'print(1)',
      'private.txt': 'secret',
    });
    const baseline = await inspectSetup(root);
    const setup = {
      ...baseline.draft,
      types: { custom: { extends: 'script', locate: 'checks/*.py' } },
      privacy: { ...baseline.draft.privacy, exclude: ['private.txt'] },
    };
    const result = await inspectSetup(root, setup);
    expect(result.coverage.unknown).not.toContain('project:checks/one.py');
    expect(result.coverage.skipped).toContainEqual({ what: 'project:private.txt', reason: 'privacy' });
  });

  it('writes an exclusive draft; check mode fails on drift without rewriting it', async () => {
    const root = await estate({ 'CLAUDE.md': '# Instructions\n' });
    const out: string[] = [];
    const io = { cwd: root, out: (text: string) => out.push(text), err: (text: string) => out.push(text) };
    expect(await doctorCommand('.', { write: 'driftbench.setup.yaml', json: true }, io)).toBe(0);
    const original = await readFile(join(root, 'driftbench.setup.yaml'), 'utf8');
    expect(await doctorCommand('.', { check: true }, io)).toBe(0);
    await writeFile(join(root, 'CLAUDE.md'), '# Different\n');
    expect(await doctorCommand('.', { check: true }, io)).toBe(1);
    expect(await readFile(join(root, 'driftbench.setup.yaml'), 'utf8')).toBe(original);
    expect(await doctorCommand('.', { write: 'driftbench.setup.yaml' }, io)).toBe(2);
  });
});

describe('doctor declared policies and deployments', () => {
  it('checks a declared link target and drafts its binding with evidence', async () => {
    const root = await estate({ 'CLAUDE.md': '# Instructions\n', 'shared/SKILL.md': '---\nname: shared\n---\nInstructions.\n' });
    await mkdir(join(root, '.claude'));
    await symlink('../shared', join(root, '.claude/shared'));
    const detected = await inspectSetup(root);
    const declared = { ...detected.draft, sources: [
      detected.draft.sources[0]!,
      { id: 'shared', path: 'shared', kind: 'directory' as const, reader: 'claude-code' },
    ] };
    const result = await inspectSetup(root, declared);
    expect(result.draft.sources[1]?.bindings).toContainEqual({ runtime: 'claude-code', deployedRoot: 'project', deployedPath: '.claude/shared', method: 'link' });
    expect(result.detections).toContainEqual(expect.objectContaining({ confidence: 1, field: 'sources.shared.bindings' }));
    expect(declared.sources[1]).not.toHaveProperty('bindings');
  });

  it('blocks a changed deployment target even when the target folders contain no files', async () => {
    const root = await estate({ 'CLAUDE.md': '# Instructions\n' });
    await mkdir(join(root, 'shared'));
    await mkdir(join(root, 'different'));
    await mkdir(join(root, '.claude'));
    await symlink('../shared', join(root, '.claude/shared'));
    const initial = await inspectSetup(root);
    const setup = { ...initial.draft, sources: [initial.draft.sources[0]!, {
      id: 'shared', path: 'shared', kind: 'directory' as const, reader: 'claude-code',
      bindings: [{ runtime: 'claude-code', deployedRoot: 'project', deployedPath: '.claude/shared', method: 'link' as const }],
    }] };
    const accepted = (await inspectSetup(root, setup)).draft;
    expect((await inspectSetup(root, accepted)).drift.status).toBe('pass');
    await unlink(join(root, '.claude/shared'));
    await symlink('../different', join(root, '.claude/shared'));
    expect((await inspectSetup(root, accepted)).drift.status).toBe('fail');
  });

  it('prices only declared rates and blocks model advice under privacy or budget limits', async () => {
    const root = await estate({ 'CLAUDE.md': '# Instructions\n' });
    const initial = await inspectSetup(root);
    const setup = { ...initial.draft, privacy: { ...initial.draft.privacy, model: 'allow' as const }, budget: {
      usd: 1, modelCalls: 2, pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 4, inputTokensPerCall: 1000, outputTokensPerCall: 500 },
    } };
    const result = await inspectSetup(root, setup);
    expect(result.nextSteps.find((step) => step.action === 'Model-assisted evaluation')).toMatchObject({ usd: 0.008, allowed: true });
    const denied = { ...setup, privacy: { ...setup.privacy, model: 'deny' as const } };
    expect((await inspectSetup(root, denied)).nextSteps.find((step) => step.action === 'Model-assisted evaluation')?.allowed).toBe(false);
  });
});
