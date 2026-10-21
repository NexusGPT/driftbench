import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StaticTest } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, loadEstateMap, runStaticTests } from '../src/index';
import { FIXTURE } from './support';
import { HAND_ROLES } from './support';

function test(id: string, check: StaticTest['check']): StaticTest {
  return {
    id,
    planRow: id,
    testType: check.kind === 'setting' ? 'setting' : 'invariant',
    atom: `${check.kind}.x`,
    title: id,
    check,
    mapHash: 'h',
  };
}

const TESTS = [
  test('size', { kind: 'invariant', check: 'standing_size' }),
  test('registry', { kind: 'invariant', check: 'registry_complete' }),
  test('orphans', { kind: 'invariant', check: 'no_orphans' }),
  test('model', { kind: 'setting', key: 'model', value: 'opus' }),
  test('region', { kind: 'setting', key: 'env.NORTHWIND_REGION' }),
];

async function copy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-static-'));
  await cp(join(FIXTURE, 'CLAUDE.md'), join(root, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(root, '.claude'), { recursive: true });
  return root;
}

describe('the static runner', () => {
  it('reads the estate again and passes or fails each invariant and setting on the files as they are', async () => {
    const results = await runStaticTests(TESTS, { root: FIXTURE, reader: new ClaudeCodeReader() });
    expect(Object.fromEntries(results.map((result) => [result.id, result.pass]))).toEqual({
      size: true,
      registry: false,
      orphans: false,
      model: true,
      region: true,
    });
    expect(results.find((result) => result.id === 'registry')?.detail).toContain('G6');
  });

  it('counts the files the atoms of a given map name, which code cannot read again from the prose', async () => {
    const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    if (!loaded.ok) throw new Error('invalid map');
    const [alone] = await runStaticTests([test('orphans', { kind: 'invariant', check: 'no_orphans' })], {
      root: FIXTURE,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
    });
    // Code alone names no file by a sentence: the references the prose gave are unseen, so the files are unnamed.
    expect(alone?.detail).toContain('matching-rules.md');
    const [mapped] = await runStaticTests([test('orphans', { kind: 'invariant', check: 'no_orphans' })], {
      root: FIXTURE,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      map: loaded.map,
    });
    expect(mapped?.pass).toBe(false);
    expect(JSON.parse(mapped?.detail.slice(mapped.detail.indexOf('{')) ?? '{}')).toEqual({
      orphans: ['.claude/skills/invoice-reconcile/references/old-tolerances.md'],
    });
  });

  it('turns red on a copy whose setting changed or whose registry lost a row', async () => {
    const root = await copy();
    const settings = join(root, '.claude/settings.json');
    await writeFile(
      settings,
      (await readFile(settings, 'utf8')).replace('"model": "opus"', '"model": "haiku"'),
    );
    const registry = join(root, '.claude/guards/CHECK-REGISTRY.md');
    await writeFile(
      registry,
      (await readFile(registry, 'utf8')).replace(
        '| G6 | supplier-send-guard.py | PreToolUse | R2 | deny |\n',
        '',
      ),
    );
    const results = await runStaticTests(TESTS, { root, reader: new ClaudeCodeReader() });
    const by = Object.fromEntries(results.map((result) => [result.id, result]));
    expect(by.model?.pass).toBe(false);
    expect(by.model?.detail).toContain('haiku');
    expect(by.registry?.detail).not.toContain('G6');
  });

  it('fails an invariant the estate no longer measures, and a setting key it no longer declares', async () => {
    const results = await runStaticTests(
      [
        test('none', { kind: 'invariant', check: 'no_such_check' }),
        test('gone', { kind: 'setting', key: 'nope' }),
      ],
      { root: FIXTURE, reader: new ClaudeCodeReader() },
    );
    expect(results.map((result) => result.pass)).toEqual([false, false]);
  });
});
