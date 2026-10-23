import { describe, expect, it } from 'vitest';
import { parseTypes } from '../../src/estate-model/part-type';
import { CLAUDE_CODE_PROFILE } from '../../src/runtime-profile/claude-code';
import { parseSetupText, resolveSetupSources } from '../../src/setup/schema';

const document = {
  version: 1,
  sources: [{ id: 'project', path: '.', kind: 'project', reader: 'claude-code' }],
  runtime: 'claude-code',
  roles: { reviewer: { aspects: ['guards'] } },
  scope: { include: ['**'], exclude: [] },
  execute: { policy: 'never', commands: [] },
  budget: { usd: 0, modelCalls: 0 },
  privacy: { model: 'deny', exports: 'metadata', exclude: [] },
};
const parse = (value: unknown) => parseSetupText(JSON.stringify(value), CLAUDE_CODE_PROFILE);

describe('declared setup schema', () => {
  it('resolves custom types through the existing loader including extends', () => {
    const result = parse({ ...document, types: { audit: { extends: 'script', locate: 'checks/*.py' } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.types.project?.types.find((type) => type.name === 'audit')).toMatchObject({
      aspects: ['executes'],
      runtime: 'claude-code',
    });
    expect(result.setup.roles).toEqual(document.roles);
  });

  it.each([
    { typo: true },
    { version: 2 },
    { budget: { usd: -1, modelCalls: 0 } },
    { execute: { policy: 'never', commands: ['anything'] } },
    { roles: { reviewer: { aspects: ['magic'] } } },
    { scope: { include: ['../*'], exclude: [] } },
    {
      sources: [
        { id: 'same', path: '.', kind: 'project', reader: 'claude-code' },
        { id: 'same', path: '.', kind: 'home', reader: 'claude-code' },
      ],
    },
    {
      sources: [
        {
          id: 'project',
          path: '.',
          kind: 'project',
          reader: 'claude-code',
          bindings: [{ runtime: 'codex', deployedRoot: 'home', deployedPath: '.codex', method: 'link' }],
        },
      ],
    },
    { runtime: 'different-runtime' },
    { types: { audit: { extends: 'missing' } } },
  ])('refuses malformed or contradictory declared data: %j', (change) => {
    expect(parse({ ...document, ...change }).ok).toBe(false);
  });

  it('keeps quoted tilde paths literal, and refuses duplicate YAML keys', () => {
    const result = parse({
      ...document,
      sources: [{ id: 'project', path: '~/literal', kind: 'project', reader: 'claude-code' }],
    });
    expect(result.ok && result.setup.sources[0]?.path).toBe('~/literal');
    expect(parseSetupText('version: 1\nversion: 1', CLAUDE_CODE_PROFILE).ok).toBe(false);
  });
});

it('scopes same-named types by source and never gives .agents the host locator', () => {
  const result = parse({
    ...document,
    sources: [
      document.sources[0],
      {
        id: 'shared',
        path: '.agents',
        kind: 'directory',
        reader: 'agents-folder',
        types: {
          skill: {
            locate: 'skills/*/',
            entry: 'SKILL.md',
            aspects: ['acts', 'instructs'],
            loaded: 'on-demand',
          },
        },
      },
    ],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const host = result.types.project?.types.find((type) => type.name === 'skill');
  const shared = result.types.shared?.types.find((type) => type.name === 'skill');
  expect(host?.folder).toBe('.claude');
  expect(shared?.folder).toBe('.');
  expect(shared?.locate.map((locator) => locator.written)).toEqual(['skills/*/']);
  const resolved = resolveSetupSources(result.setup, '/fictional/setup/driftbench.setup.yaml', (id) =>
    id === 'claude-code'
      ? {
          runtime: id,
          roots: CLAUDE_CODE_PROFILE.roots,
          base: CLAUDE_CODE_PROFILE.types,
        }
      : undefined,
  );
  expect(resolved[1]?.root).toBe('/fictional/setup/.agents');
  expect(resolved[1]?.types.types.find((type) => type.name === 'skill')?.folder).toBe('.');
});

it('uses immutable reader setupTypes metadata for source-local inheritance', () => {
  const base = parseTypes(
    {
      version: 1,
      types: {
        skill: {
          locate: 'skills/*/',
          entry: 'SKILL.md',
          aspects: ['acts', 'instructs'],
          loaded: 'on-demand',
        },
      },
    },
    { runtime: 'codex', roots: { source: '.' } },
  );
  expect(base.ok).toBe(true);
  if (!base.ok) return;
  const result = parseSetupText(
    JSON.stringify({
      ...document,
      sources: [
        {
          id: 'shared',
          path: '.agents',
          kind: 'directory',
          reader: 'agents-folder',
          types: { extended: { extends: 'skill', fields: { description: 'frontmatter.description' } } },
        },
      ],
    }),
    (id) =>
      id === 'agents-folder'
        ? {
            runtime: 'codex',
            roots: { source: '.' },
            base: base.set,
            folder: '.',
          }
        : undefined,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const type = result.types.shared?.types.find((entry) => entry.name === 'extended');
  expect(type?.runtime).toBe('codex');
  expect(type?.folder).toBe('.');
  expect(type?.locate.map((entry) => entry.written)).toEqual(['skills/*/']);
});

it('keeps built-ins empty when the reader resolver has no metadata, even for a named host profile', () => {
  const result = parseSetupText(JSON.stringify(document), () => undefined);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.types.project?.types).toEqual([]);
});


it('accepts an own source type named constructor beside an empty project shorthand', () => {
  const declaration = { locate: 'constructors/*.md', aspects: ['instructs'], loaded: 'always' };
  const setup = {
    ...document,
    types: {},
    sources: [{ ...document.sources[0], types: { constructor: declaration } }],
  };
  const result = parse(setup);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.types.project?.types.find((type) => type.name === 'constructor')?.locate.map((locator) => locator.written)).toEqual(['constructors/*.md']);
  expect(parse({ ...setup, types: { constructor: declaration } }).ok).toBe(false);
});
