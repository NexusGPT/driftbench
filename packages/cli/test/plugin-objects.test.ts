import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearObjectContexts,
  initializeShippedObjects,
  loadSpecFile,
  objectContextFor,
  objectRegistry,
  resolveBlockObjects,
} from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type DriftbenchPlugin, type Io, main } from '../src/index';
import {
  applyPlugins,
  beginPluginRun,
  pluginEvidence,
  pluginEvidenceNames,
  pluginPromptTemplate,
  resetPlugins,
} from '../src/plugins';

/**
 * The plugin API of the rules framework: `api.kind`, `api.rule`, `api.evidence`, `api.diagnosticStep`,
 * `api.promptTemplate` and `api.object`. The fixture plugin registers one of each, and its spec uses them by id.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/plugin-objects', import.meta.url));
const PLUGIN = join(FIXTURE, 'plugin.mjs');
const SPEC = 'specs/routed.yaml';

const temps: string[] = [];
afterEach(async () => {
  resetPlugins();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cli(argv: string[], cwd = FIXTURE, plugins?: DriftbenchPlugin[]) {
  let out = '';
  let err = '';
  const io: Io = {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await main(argv, io, plugins === undefined ? undefined : { plugins });
  return { code, out, err };
}

/** Runs plugins given in code in an isolated run, and returns the refusal, if any, and the cleanup. */
async function run(plugins: DriftbenchPlugin[]): Promise<{ refused: string | undefined; end: () => void }> {
  const end = beginPluginRun();
  return { refused: await applyPlugins(plugins, FIXTURE), end };
}

const ROOT_CHECK_SET = (id: string) =>
  `kind: check-set\nid: ${id}\nitems:\n  - id: tone\n    title: Replies keep the tone\n    impl: plugin:acme-tone\n`;

describe('the plugin API of the rules framework', () => {
  it('registers one of each, and a spec uses the plugin objects by id', async () => {
    expect(await cli(['spec', 'validate', SPEC])).toMatchObject({ code: 0 });
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const { refused, end } = await run([plugin]);
    try {
      expect(refused).toBeUndefined();
      clearObjectContexts();
      const path = join(FIXTURE, SPEC);
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      const uses = resolveBlockObjects(loaded.spec, 0, objectContextFor(path));
      // The shipped value-check, blame and placement policies resolve for every spec, whether or not a diagnostic
      // runs; the spec sets the other objects.
      expect(uses.filter((use) => use.setAt === 'shipped').map((use) => use.key)).toEqual([
        'value_check',
        'blame',
        'placement',
      ]);
      const used = uses
        .filter((use) => use.setAt !== 'shipped')
        .map((use) => [
          use.key,
          use.setAt,
          use.object.ref,
          use.object.items.map((item) => [item.id, item.impl, item.params]),
        ]);
      expect(used).toEqual([
        ['check_set', 'spec', 'check-set:acme@f0458f5f', [['tone', 'plugin:acme-tone', { tone: 'warm' }]]],
        [
          'diagnostics',
          'spec',
          'diagnostic:acme-dedup@e4985b87',
          [['dedup', 'plugin:acme-dedup', { prompt_template: 'linker/acme' }]],
        ],
      ]);
      expect(objectContextFor(path).store.resolve('policy/routing', 'intent').ref).toBe(
        'policy/routing:intent@36c5829b',
      );
    } finally {
      end();
    }
  });

  it('a spec that names a plugin object does not load without the plugin', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(elsewhere);
    await writeFile(join(elsewhere, 'routed.yaml'), await readFile(join(FIXTURE, SPEC), 'utf8'));
    const alone = await cli(['spec', 'validate', 'routed.yaml'], elsewhere);
    expect(alone.code).toBe(1);
    expect(alone.out).toContain('OBJECT_UNKNOWN');
    expect(alone.out).toContain('unknown object check-set:acme');
  });

  it('keeps the evidence, the steps and the prompt template a plugin registered for the run, then forgets them', async () => {
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const { refused, end } = await run([plugin]);
    try {
      expect(refused).toBeUndefined();
      expect(pluginEvidenceNames('check-set')).toEqual(['tone_score']);
      expect(pluginEvidence('check-set', 'tone_score')?.()).toBe(0.5);
      const template = pluginPromptTemplate('linker/acme');
      expect(template?.parts).toEqual({
        system: 'You link blocks to prompt units.',
        rubric: 'One unit per line.',
      });
      expect(template?.contract('a\nb')).toEqual(['a', 'b']);
      expect(template?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(objectRegistry.kind('policy/routing')?.summary).toBe('Which team a conversation goes to.');
      expect(objectRegistry.impl('plugin:acme-dedup')).toBeDefined();
      expect(objectRegistry.impl('plugin:route-by-intent')).toBeDefined();
    } finally {
      end();
    }
    expect(pluginEvidence('check-set', 'tone_score')).toBeUndefined();
    expect(pluginPromptTemplate('linker/acme')).toBeUndefined();
    expect(objectRegistry.kind('policy/routing')).toBeUndefined();
    expect(objectRegistry.impl('plugin:acme-dedup')).toBeUndefined();
  });

  it('one run does not leak its kinds, rules and objects into the next', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(elsewhere);
    await writeFile(join(elsewhere, 'routed.yaml'), await readFile(join(FIXTURE, SPEC), 'utf8'));
    expect((await cli(['spec', 'validate', 'routed.yaml', '--plugin', PLUGIN], elsewhere)).code).toBe(0);
    expect(objectRegistry.kind('policy/routing')).toBeUndefined();
    expect(objectRegistry.impl('plugin:acme-tone')).toBeUndefined();
    expect(objectRegistry.shipped().map(({ path }) => path)).not.toContain(
      join(FIXTURE, 'objects/check-set-acme.yaml'),
    );
    const next = await cli(['spec', 'validate', 'routed.yaml'], elsewhere);
    expect(next.code).toBe(1);
    expect(next.out).toContain('unknown object check-set:acme');
  });

  it('refuses a name two plugins register, for every part, naming both plugins', async () => {
    const twice: Array<[string, DriftbenchPlugin]> = [
      ['the object kind policy/twice', (api) => api.kind('policy/twice', { summary: 'Twice.' })],
      ['the implementation plugin:twice', (api) => api.rule('check-set', 'twice', { run: () => [] })],
      ['the implementation plugin:twice', (api) => api.diagnosticStep('twice', () => ({}))],
      ['the evidence twice of check-set', (api) => api.evidence('check-set', 'twice', () => 1)],
      [
        'the prompt template twice',
        (api) => api.promptTemplate('twice', { system: 'x' }, (answer) => answer),
      ],
    ];
    for (const [label, plugin] of twice) {
      const { refused, end } = await run([plugin, plugin]);
      end();
      expect(refused, label).toBe(
        `The plugin given in code (2) registers ${label}, which the plugin given in code (1) already registered. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.`,
      );
    }
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'acme.yaml'), ROOT_CHECK_SET('twice'));
    const rule: DriftbenchPlugin = (api) => api.rule('check-set', 'acme-tone', { run: () => [] });
    const object: DriftbenchPlugin = (api) => api.object(join(dir, 'acme.yaml'));
    const { refused, end } = await run([rule, object, object]);
    end();
    expect(refused).toBe(
      'The plugin given in code (3) gives the object check-set:twice, which driftbench or another plugin already ships. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
  });

  it('never replaces a shipped kind or object; a plugin object that extends one is accepted', async () => {
    const kind = await run([(api) => api.kind('check-set', { summary: 'Mine.' })]);
    kind.end();
    expect(kind.refused).toBe(
      'The plugin given in code (1) registers the object kind check-set, which driftbench already has. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'base.yaml'), ROOT_CHECK_SET('base'));
    await writeFile(
      join(dir, 'over.yaml'),
      'kind: check-set\nid: base\nextends: base\nitems:\n  - id: tone\n    enabled: false\n',
    );
    await writeFile(
      join(dir, 'child.yaml'),
      'kind: check-set\nid: child\nextends: base\nitems:\n  - id: tone\n    params: { tone: plain }\n',
    );
    const rule: DriftbenchPlugin = (api) => api.rule('check-set', 'acme-tone', { run: () => [] });
    const shipper: DriftbenchPlugin = (api) => api.object(join(dir, 'base.yaml'));
    const replacer = await run([rule, shipper, (api) => api.object(join(dir, 'over.yaml'))]);
    replacer.end();
    expect(replacer.refused).toBe(
      'The plugin given in code (3) gives the object check-set:base, which driftbench or another plugin already ships. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
    const extender = await run([rule, shipper, (api) => api.object(join(dir, 'child.yaml'))]);
    try {
      expect(extender.refused).toBeUndefined();
    } finally {
      extender.end();
    }
  });

  it('stops the run on a plugin object that does not resolve, and on a rule for a kind no one registered', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(
      join(dir, 'bad.yaml'),
      ROOT_CHECK_SET('bad').replace('plugin:acme-tone', 'plugin:nobody'),
    );
    const bad = await run([(api) => api.object(join(dir, 'bad.yaml'))]);
    bad.end();
    expect(bad.refused).toBe(
      'The plugin given in code (1) gives the object check-set:bad, which does not resolve: check-set:bad: item tone names plugin:nobody, which no builtin or plugin provides (' +
        join(dir, 'bad.yaml') +
        '#items.0)',
    );
    const orphan = await run([(api) => api.rule('policy/nowhere', 'lost', { run: () => 0 })]);
    orphan.end();
    expect(orphan.refused).toBe(
      'The plugin given in code (1) registers the rule lost for the kind policy/nowhere, which no one registered.',
    );
    const other = await cli(['spec', 'validate', SPEC], FIXTURE, [
      (api) => api.rule('check-set', 'other', { run: () => [] }),
    ]);
    expect(other.code).toBe(0);
  });

  it('checks the params of a plugin rule against the schema it declares', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'loud.yaml'), `${ROOT_CHECK_SET('loud')}    params: { tone: loud }\n`);
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const loud = await run([plugin, (api) => api.object(join(dir, 'loud.yaml'))]);
    loud.end();
    expect(loud.refused).toContain('check-set:loud: item tone params: params.tone: tone is plain or warm');
  });
});

describe('the plugin API of the rules framework: what it checks of each registration', () => {
  /** The refusal a plugin function that throws gives, with the plugin that threw. */
  async function refusal(plugin: DriftbenchPlugin): Promise<string> {
    const { refused, end } = await run([plugin]);
    end();
    return refused ?? '';
  }

  it('refuses a name that is not a plain name, for a kind, a rule, an evidence, a step and a template', async () => {
    const bad: Array<[string, DriftbenchPlugin]> = [
      ['kind', (api) => api.kind('Bad Name', { summary: 'S.' })],
      ['rule', (api) => api.rule('check-set', 'Plugin/Name', { run: () => [] })],
      ['evidence', (api) => api.evidence('check-set', 'Bad Name', () => 1)],
      ['diagnostic step', (api) => api.diagnosticStep('Bad Name', () => ({}))],
      ['prompt template', (api) => api.promptTemplate('Bad Name', { system: 'x' }, (answer) => answer)],
    ];
    for (const [what, plugin] of bad) {
      expect(await refusal(plugin), what).toContain(`the ${what} name`);
      expect(await refusal(plugin), what).toContain('is not a plain name');
    }
    // A slash between parts is a plain name for a kind and a template, as in policy/routing and linker/acme.
    expect(await refusal((api) => api.kind('policy/ok', { summary: 'S.' }))).toBe('');
  });

  it('refuses a kind without a summary, a rule without run and an evidence without a function', async () => {
    expect(await refusal((api) => api.kind('policy/mute', { summary: '' }))).toContain(
      'the kind policy/mute needs a summary',
    );
    expect(await refusal((api) => api.kind('policy/mute', {} as never))).toContain(
      'the kind policy/mute needs a summary',
    );
    expect(
      await refusal((api) => {
        api.kind('policy/ok', { summary: 'S.' });
        api.rule('policy/ok', 'norun', {} as never);
      }),
    ).toContain('the rule norun needs a run function');
    expect(
      await refusal((api) => {
        api.kind('policy/ok', { summary: 'S.' });
        api.evidence('policy/ok', 'nofn', 'nope' as never);
      }),
    ).toContain('the evidence nofn needs a function that computes it');
  });

  it('refuses an evidence name for a kind no one registered', async () => {
    expect(await refusal((api) => api.evidence('policy/nowhere', 'lost', () => 1))).toBe(
      'The plugin given in code (1) registers the evidence lost for the kind policy/nowhere, which no one registered.',
    );
  });

  it('lists the evidence names of one kind, sorted, and accepts one name for two kinds', async () => {
    const { refused, end } = await run([
      (api) => {
        api.kind('policy/first', { summary: 'S.' });
        api.kind('policy/second', { summary: 'S.' });
        api.evidence('policy/first', 'zeta', () => 'z');
        api.evidence('policy/first', 'alpha', () => 'a');
        api.evidence('policy/second', 'alpha', () => 'second alpha');
        api.evidence('policy/second', 'mid', () => 'm');
      },
    ]);
    try {
      expect(refused).toBeUndefined();
      expect(pluginEvidenceNames('policy/first')).toEqual(['alpha', 'zeta']);
      expect(pluginEvidenceNames('policy/second')).toEqual(['alpha', 'mid']);
      expect(pluginEvidenceNames('policy/none')).toEqual([]);
      expect(pluginEvidence('policy/first', 'alpha')?.()).toBe('a');
      expect(pluginEvidence('policy/second', 'alpha')?.()).toBe('second alpha');
      expect(pluginEvidence('policy/second', 'zeta')).toBeUndefined();
    } finally {
      end();
    }
  });

  it('takes a diagnostic step as a function or as { params, run }, and checks the params of the second', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    const object = (id: string, params: string) =>
      `kind: diagnostic\nid: ${id}\nsteps:\n  - id: step\n    title: A step\n    impl: plugin:both\n    params: ${params}\n`;
    initializeShippedObjects();
    const byFunction = await run([(api) => api.diagnosticStep('both', () => ({}))]);
    byFunction.end();
    expect(byFunction.refused).toBeUndefined();
    await writeFile(join(dir, 'ok.yaml'), object('ok', '{ depth: 2 }'));
    await writeFile(join(dir, 'bad.yaml'), object('bad', '{ depth: deep }'));
    const params = {
      safeParse: (value: unknown) =>
        typeof (value as { depth?: unknown } | undefined)?.depth === 'number'
          ? { success: true, data: value }
          : { success: false, error: { issues: [{ path: ['depth'], message: 'depth is a number' }] } },
    };
    const step: DriftbenchPlugin = (api) =>
      api.diagnosticStep('both', { params: params as never, run: () => ({}) });
    const good = await run([step, (api) => api.object(join(dir, 'ok.yaml'))]);
    good.end();
    expect(good.refused).toBeUndefined();
    const wrong = await run([step, (api) => api.object(join(dir, 'bad.yaml'))]);
    wrong.end();
    expect(wrong.refused).toContain('diagnostic:bad: item step params');
    expect(wrong.refused).toContain('depth is a number');
  });

  it('checks the parts and the parser of a prompt template, and fingerprints the parts only', async () => {
    expect(await refusal((api) => api.promptTemplate('t/one', null as never, (answer) => answer))).toContain(
      'needs its parts as a map of named texts',
    );
    expect(
      await refusal((api) => api.promptTemplate('t/one', { system: 1 } as never, (answer) => answer)),
    ).toContain('needs its parts as a map of named texts');
    expect(await refusal((api) => api.promptTemplate('t/one', { system: 'x' }, 'no' as never))).toContain(
      'needs the parser of its answers',
    );
    const { refused, end } = await run([
      (api) => {
        api.promptTemplate('t/a', { system: 'same', rubric: 'r' }, (answer) => ['a', answer]);
        api.promptTemplate('t/b', { system: 'same', rubric: 'r' }, (answer) => ['b', answer]);
        api.promptTemplate('t/c', { system: 'other', rubric: 'r' }, (answer) => answer);
      },
    ]);
    try {
      expect(refused).toBeUndefined();
      const [a, b, c] = ['t/a', 't/b', 't/c'].map((id) => pluginPromptTemplate(id));
      expect(a?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(b?.fingerprint).toBe(a?.fingerprint);
      expect(c?.fingerprint).not.toBe(a?.fingerprint);
      expect(a?.contract('x')).toEqual(['a', 'x']);
      expect(b?.contract('x')).toEqual(['b', 'x']);
    } finally {
      end();
    }
  });
});
