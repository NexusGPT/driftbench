import { describe, expect, it } from 'vitest';
import {
  compileGlob,
  coveringType,
  GLOB_LIMITS,
  matchGlob,
  parseFieldRead,
  parseJsonPath,
  parseLoaded,
  parseTypes,
  parseTypesText,
  selectJson,
  type TypeSet,
  type TypesOptions,
  typeNamed,
} from '../src/index';

const ROOTS = { project: '.', layout: '.agent' };

/** A small base profile: a hook type and a skill type that contains a reference type. */
function baseTypes(): TypeSet {
  const parsed = parseTypes(
    {
      version: 1,
      types: {
        hook: {
          root: 'layout',
          locate: ['hooks/**/*.py', 'settings.json#$.hooks.*[*]'],
          fields: { name: 'match' },
          aspects: ['guards'],
          loaded: 'on-event',
          references: ['path'],
        },
        skill: {
          root: 'layout',
          locate: 'skills/*/',
          entry: 'SKILL.md',
          fields: { name: ['frontmatter.name', 'match'], description: 'frontmatter.description' },
          contains: ['skill-reference'],
          aspects: ['instructs'],
          loaded: 'on-mention',
        },
        'skill-reference': { locate: 'references/**', aspects: ['informs'], loaded: 'by-reference' },
      },
    },
    { runtime: 'test-runtime', roots: ROOTS, source: 'profile:test' },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.set;
}

const options = (extra: Partial<TypesOptions> = {}): TypesOptions => ({
  runtime: 'test-runtime',
  roots: ROOTS,
  base: baseTypes(),
  folder: '.agent',
  source: '.agent/driftbench.estate.yaml',
  ...extra,
});

/** The worked example of docs/estate-model.md, as a user writes it. */
const EXAMPLE = `version: 1
types:
  judge-request:
    extends: hook
    locate: hooks/lib/judges/*.request.json
    fields: { id: $.id, prompt: $.system, schema: $.output }
    aspects: [guards, informs]
    loaded: on-event
  observe-flag:
    locate: hooks/.*-observe
    aspects: [configures]
    scope: { type: hook, by: name }
    loaded: always
`;

describe('globs', () => {
  it('matches whole root-relative paths, ** across folders and none, a star on dotted names too', () => {
    const standing = compileGlob('**/CLAUDE.md');
    if (!standing.ok) throw new Error(standing.error);
    for (const path of ['CLAUDE.md', 'a/CLAUDE.md', 'a/b/CLAUDE.md', '.hidden/CLAUDE.md'])
      expect(matchGlob(standing.glob, path), path).toBeDefined();
    for (const path of ['CLAUDE.mdx', 'xCLAUDE.md', 'claude.md'])
      expect(matchGlob(standing.glob, path), path).toBeUndefined();
    const below = compileGlob('skills/*/**');
    if (!below.ok) throw new Error(below.error);
    expect(matchGlob(below.glob, 'skills/a/b.md')).toEqual({ match: 'a' });
    expect(matchGlob(below.glob, 'skills/a/x/y.md')).toEqual({ match: 'a' });
    expect(matchGlob(below.glob, 'skills/a')).toBeUndefined();
  });

  it('captures what the last star matched, marks a folder glob, and reads braces and classes', () => {
    const folder = compileGlob('skills/*/');
    if (!folder.ok) throw new Error(folder.error);
    expect(folder.glob.folder).toBe(true);
    expect(matchGlob(folder.glob, 'skills/report')).toEqual({ match: 'report' });
    const flag = compileGlob('hooks/.*-observe');
    if (!flag.ok) throw new Error(flag.error);
    expect(matchGlob(flag.glob, 'hooks/.fs-guard-observe')).toEqual({ match: 'fs-guard' });
    expect(matchGlob(flag.glob, 'hooks/fs-guard-observe')).toBeUndefined();
    const named = compileGlob('**/*[Rr]egistry*.{md,json}');
    if (!named.ok) throw new Error(named.error);
    expect(matchGlob(named.glob, 'a/CHECK-Registry.md')).toBeDefined();
    expect(matchGlob(named.glob, 'a/registry.yaml')).toBeUndefined();
    // The last star is the capture: here the one after the name.
    expect(matchGlob(named.glob, 'a/xregistry-old.json')).toEqual({ match: '-old' });
    const plain = compileGlob('settings.json');
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.glob.captures).toBe(false);
    expect(matchGlob(plain.glob, 'settings.json')).toEqual({});
  });

  it('refuses a glob with more stars or characters than its limits, so no pattern makes matching backtrack', () => {
    // Ten stars between letters: on a long name of the letter, matching such a pattern backtracks heavily.
    expect(compileGlob('*a*a*a*a*a*a*a*a*a*b')).toEqual({ ok: false, error: 'too-many-stars' });
    expect(compileGlob(`docs/${'x'.repeat(GLOB_LIMITS.characters)}.md`)).toEqual({
      ok: false,
      error: 'too-long',
    });
    // At the limits, and with an escaped star that is no wildcard, a glob is read.
    expect(compileGlob('*/*/*/*/*/*/*/*.md').ok).toBe(true);
    expect(compileGlob('a\\*b/*/*/*/*/*/*/*/*.md').ok).toBe(true);
    const refused = parseTypes(
      {
        version: 1,
        types: { a: { locate: '*a*a*a*a*a*a*a*a*a*b', aspects: ['informs'], loaded: 'always' } },
      },
      options(),
    );
    expect(refused.ok ? [] : refused.errors.map((error) => [error.code, error.reason])).toEqual([
      ['locator', 'too-many-stars'],
    ]);
  });

  it('refuses a glob that leaves the root or cannot be read, with a code', () => {
    const refusals: Array<[string, string]> = [
      ['', 'empty'],
      ['/etc/x', 'absolute'],
      ['a/../b', 'parent-segment'],
      ['a//b', 'empty-segment'],
      ['a**b/c', 'double-star-in-segment'],
      ['a/[bc', 'unclosed-class'],
      ['a/{b,c', 'unclosed-brace'],
      ['{a/b,c}', 'slash-in-brace'],
      ['a\\', 'trailing-escape'],
    ];
    for (const [glob, error] of refusals) expect(compileGlob(glob), glob).toEqual({ ok: false, error });
  });
});

describe('field reads and JSON paths', () => {
  it('parses each read form and refuses any other text', () => {
    expect(parseFieldRead('$.a[0].b')).toEqual({
      ok: true,
      read: { from: 'json', path: [{ key: 'a' }, { index: 0 }, { key: 'b' }] },
    });
    expect(parseFieldRead('frontmatter.allowed-tools')).toEqual({
      ok: true,
      read: { from: 'frontmatter', path: [{ key: 'allowed-tools' }] },
    });
    expect(parseFieldRead('section(When to use)')).toEqual({
      ok: true,
      read: { from: 'section', heading: 'When to use' },
    });
    for (const plain of ['body', 'text', 'file-name', 'folder-name', 'match'])
      expect(parseFieldRead(plain)).toEqual({ ok: true, read: { from: plain } });
    expect(parseFieldRead('the name')).toEqual({ ok: false, error: 'field-read' });
    expect(parseFieldRead('section()')).toEqual({ ok: false, error: 'section-heading' });
    expect(parseFieldRead('$.a..b')).toEqual({ ok: false, error: 'json-path-step' });
  });

  it('selects every value a path names, in document order', () => {
    const steps = parseJsonPath('$.hooks.*[*].command');
    if (!steps.ok) throw new Error(steps.error);
    const value = { hooks: { Stop: [{ command: 'a' }, { command: 'b' }], PreToolUse: [{ command: 'c' }] } };
    expect(selectJson(value, steps.steps)).toEqual(['a', 'b', 'c']);
    const quoted = parseJsonPath('$["a b"][1]');
    if (!quoted.ok) throw new Error(quoted.error);
    expect(selectJson({ 'a b': [1, 2] }, quoted.steps)).toEqual([2]);
    expect(selectJson({}, quoted.steps)).toEqual([]);
  });

  it('reads a load time, with the event an on-event type names', () => {
    expect(parseLoaded('always')).toEqual({ when: 'always' });
    expect(parseLoaded('on-event(PreToolUse)')).toEqual({ when: 'on-event', event: 'PreToolUse' });
    expect(parseLoaded('sometimes')).toBeUndefined();
  });
});

describe('types documents', () => {
  it('loads the documented example: inheritance, overrides, the declaring folder and the scope link', () => {
    const result = parseTypesText(EXAMPLE, options());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.set.types.map((type) => type.name)).toEqual([
      'hook',
      'skill',
      'skill-reference',
      'judge-request',
      'observe-flag',
    ]);
    const judge = typeNamed(result.set, 'judge-request');
    expect(judge?.extends).toBe('hook');
    expect(judge?.aspects).toEqual(['guards', 'informs']);
    expect(judge?.loaded).toEqual({ when: 'on-event' });
    // Inherited: what the parent names and the child does not; the fields merge by name.
    expect(judge?.references).toEqual([{ by: 'path' }]);
    expect(Object.keys(judge?.fields ?? {})).toEqual(['name', 'id', 'prompt', 'schema']);
    expect(judge?.runtime).toBe('test-runtime');
    // A user type names no root: its globs are relative to the folder of the file that declares it.
    expect(judge?.folder).toBe('.agent');
    expect(judge?.locate.map((locator) => locator.written)).toEqual(['hooks/lib/judges/*.request.json']);
    const flag = typeNamed(result.set, 'observe-flag');
    expect(flag?.scope).toEqual({ type: 'hook', by: 'name', link: 'configures' });
    // A contained type is located only inside its parents; a type that names a root is located from it.
    expect(typeNamed(result.set, 'skill-reference')?.folder).toBeUndefined();
    expect(typeNamed(result.set, 'skill')?.folder).toBe('.agent');
    expect(typeNamed(result.set, 'hook')?.locate[1]?.entries).toEqual([
      { key: 'hooks' },
      { any: true },
      { any: true },
    ]);
  });

  it('refuses every malformed document with a code and the path of the fault', () => {
    const refused = (types: unknown, version: unknown = 1) => {
      const result = parseTypes({ version, types }, options());
      return result.ok ? [] : result.errors.map((error) => [error.path, error.code, error.reason]);
    };
    const minimal = { locate: 'x/*.md', aspects: ['informs'], loaded: 'always' };
    expect(refused({ a: minimal }, 2)).toEqual([['version', 'version', undefined]]);
    expect(refused({ a: { ...minimal, colour: 'red' } })[0]?.[1]).toBe('shape');
    expect(refused({ A: minimal })).toEqual([['types.A', 'type-name', undefined]]);
    expect(refused({ hook: minimal })).toEqual([['types.hook', 'redefined', undefined]]);
    expect(refused({ a: { ...minimal, extends: 'nothing' } })).toEqual([
      ['types.a.extends', 'unknown-type', undefined],
    ]);
    expect(refused({ a: { ...minimal, contains: ['nothing'] } })).toEqual([
      ['types.a.contains', 'unknown-type', undefined],
    ]);
    expect(refused({ a: { ...minimal, scope: { type: 'nothing', by: 'name' } } })).toEqual([
      ['types.a.scope.type', 'unknown-type', undefined],
    ]);
    expect(refused({ a: { ...minimal, root: 'elsewhere' } })).toEqual([
      ['types.a.root', 'unknown-root', undefined],
    ]);
    expect(refused({ a: { ...minimal, aspects: ['shouts'] } })).toEqual([
      ['types.a.aspects[0]', 'unknown-aspect', undefined],
    ]);
    expect(refused({ a: { ...minimal, aspects: ['informs', 'informs'] } })).toEqual([
      ['types.a.aspects[1]', 'duplicate-aspect', undefined],
    ]);
    expect(refused({ a: { ...minimal, aspects: [] } })).toEqual([
      ['types.a.aspects', 'missing-aspects', undefined],
    ]);
    expect(refused({ a: { locate: 'x', aspects: ['informs'] } })).toEqual([
      ['types.a.loaded', 'missing-loaded', undefined],
    ]);
    expect(refused({ a: { aspects: ['informs'], loaded: 'always' } })).toEqual([
      ['types.a.locate', 'missing-locate', undefined],
    ]);
    expect(refused({ a: { ...minimal, loaded: 'sometimes' } })).toEqual([
      ['types.a.loaded', 'loaded', undefined],
    ]);
    expect(refused({ a: { ...minimal, locate: '../x' } })).toEqual([
      ['types.a.locate[0]', 'locator', 'parent-segment'],
    ]);
    expect(refused({ a: { ...minimal, locate: 'x/*/#$.a' } })).toEqual([
      ['types.a.locate[0]', 'locator', 'folder-entries'],
    ]);
    expect(refused({ a: { ...minimal, fields: { name: 'the name' } } })).toEqual([
      ['types.a.fields.name[0]', 'field-read', 'field-read'],
    ]);
    expect(refused({ a: { ...minimal, references: ['links'] } })).toEqual([
      ['types.a.references[0]', 'reference', undefined],
    ]);
    expect(refused({ a: { ...minimal, entry: 'SKILL.md' } })).toEqual([
      ['types.a.entry', 'entry-without-folder', undefined],
    ]);
    expect(refused({ a: { ...minimal, locate: 'x/*/', entry: 'a/SKILL.md' } })).toEqual([
      ['types.a.entry', 'entry-name', undefined],
    ]);
    for (const entry of ['..', '.'])
      expect(refused({ a: { ...minimal, locate: 'x/*/', entry } }), entry).toEqual([
        ['types.a.entry', 'entry-name', undefined],
      ]);
    expect(refused({ a: { ...minimal, runtime: 'Not A Name' } })).toEqual([
      ['types.a.runtime', 'runtime-name', undefined],
    ]);
    expect(refused({ a: { ...minimal, scope: { type: 'hook', by: 'name', link: 'touches' } } })).toEqual([
      ['types.a.scope.link', 'link-kind', undefined],
    ]);
    const shapes = parseTypes(
      { version: 1, types: { a: { ...minimal, shape: 'step-list' } } },
      options({ shapes: ['catalogue'] }),
    );
    expect(shapes.ok ? [] : shapes.errors.map((error) => error.code)).toEqual(['unknown-shape']);
  });

  it('refuses a type that extends or contains itself through others', () => {
    const extendsCycle = parseTypes(
      {
        version: 1,
        types: {
          a: { extends: 'b', locate: 'x', aspects: ['informs'], loaded: 'always' },
          b: { extends: 'a', locate: 'y', aspects: ['informs'], loaded: 'always' },
        },
      },
      options(),
    );
    expect(extendsCycle.ok ? [] : extendsCycle.errors.map((error) => error.code)).toEqual(['extends-cycle']);
    const containsCycle = parseTypes(
      {
        version: 1,
        types: {
          a: { contains: ['b'], locate: 'x/*/', aspects: ['informs'], loaded: 'always' },
          b: { contains: ['a'], locate: 'y/*/', aspects: ['informs'], loaded: 'always' },
        },
      },
      options(),
    );
    expect(containsCycle.ok ? [] : containsCycle.errors.map((error) => error.code)).toEqual([
      'contains-cycle',
    ]);
  });

  it('refuses a document that is not YAML or JSON, and duplicate type names', () => {
    const broken = parseTypesText('version: 1\ntypes: [', options());
    expect(broken.ok ? '' : broken.errors[0]?.code).toBe('not-parsed');
    const twice = parseTypesText(
      'version: 1\ntypes:\n  a: { locate: x, aspects: [informs], loaded: always }\n  a: { locate: y, aspects: [informs], loaded: always }\n',
      options(),
    );
    expect(twice.ok ? '' : twice.errors[0]?.code).toBe('not-parsed');
  });
});

describe('which type covers a file', () => {
  const set = (() => {
    const parsed = parseTypes(
      {
        version: 1,
        types: {
          table: {
            root: 'layout',
            locate: 'tables/*.json',
            shape: 'table',
            aspects: ['indexes'],
            loaded: 'by-reference',
          },
          bundle: {
            root: 'layout',
            locate: 'bundles/*/',
            entry: 'BUNDLE.json',
            shape: 'table',
            contains: ['bundle-file'],
            aspects: ['informs'],
            loaded: 'on-demand',
          },
          'bundle-file': { locate: 'files/**', aspects: ['informs'], loaded: 'by-reference' },
          servers: {
            root: 'project',
            locate: '.servers.json#$.servers.*',
            aspects: ['acts'],
            loaded: 'always',
          },
        },
      },
      { runtime: 'test-runtime', roots: ROOTS, source: 'profile:test' },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.set;
  })();
  const has = (shape: string) => shape === 'table';
  const hasNot = () => false;

  it('covers a file a glob matches only when the file has the type shape', () => {
    expect(coveringType(set, '.agent/tables/a.json', has)).toBe('table');
    expect(coveringType(set, '.agent/tables/a.json', hasNot)).toBeUndefined();
    expect(coveringType(set, '.agent/tables/a.json')).toBeUndefined();
  });

  it('covers the entry of a folder part only when it has the shape, and the files a contained type locates', () => {
    expect(coveringType(set, '.agent/bundles/x/BUNDLE.json', has)).toBe('bundle');
    expect(coveringType(set, '.agent/bundles/x/BUNDLE.json', hasNot)).toBeUndefined();
    expect(coveringType(set, '.agent/bundles/x/files/a/b.txt', hasNot)).toBe('bundle');
    expect(coveringType(set, '.agent/bundles/x/notes.txt', has)).toBeUndefined();
  });

  it('covers the file an entry locator reads, and nothing outside every root', () => {
    expect(coveringType(set, '.servers.json')).toBe('servers');
    expect(coveringType(set, 'elsewhere/a.json', has)).toBeUndefined();
  });
});
