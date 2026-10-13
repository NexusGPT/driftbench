import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { JudgeClient } from '@agent-nexus/driftbench-judges';
import { afterEach, describe, expect, it } from 'vitest';
import { readAggregateConfig } from '../src/aggregate-config';
import { defaultPairwiseClient } from '../src/commands/compare';
import {
  type DriftbenchPlugin,
  defaultDeps,
  definePlugin,
  type Io,
  type MainOptions,
  main,
} from '../src/index';
import { pluginArgs, pluginConfigPath, readPluginConfig, resetPlugins } from '../src/plugins';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLE = join(ROOT, 'examples/plugins');
const SPEC = 'examples/plugins/specs/hello.yaml';
const PLUGIN = 'examples/plugins/plugin.mjs';
const KNOWN =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent.';

async function cli(argv: string[], cwd = ROOT, options?: MainOptions) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io, options), out, err };
}

const temps: string[] = [];
async function temp(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugins-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

afterEach(async () => {
  resetPlugins();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('plugins', () => {
  it('without a plugin, a target no adapter reaches is refused with the message of before', async () => {
    const run = await cli(['campaign', 'run', SPEC]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(`No adapter is set up for echo:demo, the target of plugins-hello. ${KNOWN}\n`);
  });

  it('--plugin loads the adapter and the check of the example', async () => {
    const run = await cli(['campaign', 'run', SPEC, '--plugin', PLUGIN, '--json']);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('"id": "custom.polite.banned"');
    expect(run.out).not.toContain('no check of that name is registered');
    const smoke = await cli(['smoke', `--plugin=${PLUGIN}`, SPEC]);
    expect(smoke.code).toBe(0);
    expect(smoke.out).toContain('plugins-hello on echo:demo');
  });

  it('the plugins list of driftbench.yaml is read from the working folder, paths relative to the file', async () => {
    const run = await cli(['campaign', 'run', 'specs/hello.yaml'], EXAMPLE);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('plugins-hello · echo:demo');
  });

  it('a plugin check fails the block it catches', async () => {
    const dir = await temp({
      'rude.yaml': [
        'id: plugins-rude',
        "version: '1'",
        'title: The banned word comes back',
        'channel: chat',
        'lang: EN',
        'target: { adapter: echo, agent: demo }',
        'rules: { custom: { polite: { banned: [stupid] } } }',
        'blocks:',
        '  - user: That is stupid',
        '',
      ].join('\n'),
    });
    const run = await cli(['campaign', 'run', join(dir, 'rude.yaml'), '--plugin', PLUGIN, '--json']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('the reply holds the banned word stupid');
  });

  it('one run does not leak its plugins into the next', async () => {
    expect((await cli(['smoke', SPEC, '--plugin', PLUGIN])).code).toBe(0);
    const next = await cli(['smoke', SPEC]);
    expect(next.code).toBe(2);
    expect(next.err).toContain(`No adapter is set up for echo:demo, the target of plugins-hello. ${KNOWN}\n`);
  });

  it('names the plugin adapters when a target has none', async () => {
    const run = await cli(['smoke', SPEC, '--target', 'http:nobody', '--plugin', PLUGIN]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(`No adapter is set up for http:nobody. ${KNOWN} Plugins add the adapters echo.\n`);
  });

  it('refuses a plugin that cannot load, with exit 2 and one line', async () => {
    const dir = await temp({
      'empty.mjs': 'export const nothing = 1;\n',
      'throws.mjs': "export default () => { throw new Error('no key set'); };\n",
      'bad.yaml': 'aggregates: []\nplugins: ./one.mjs\n',
      'blank.yaml': "plugins:\n  - ''\n",
    });
    const missing = await cli(['spec', 'lint', SPEC, '--plugin', './nowhere.mjs']);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/^driftbench: Cannot load the plugin \.\/nowhere\.mjs: .+\n$/);
    const empty = await cli(['spec', 'lint', SPEC, '--plugin', join(dir, 'empty.mjs')]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain('exports no function');
    const throws = await cli(['spec', 'lint', SPEC, '--plugin', join(dir, 'throws.mjs')]);
    expect(throws.code).toBe(2);
    expect(throws.err).toContain('failed: no key set');
    const noValue = await cli(['spec', 'lint', SPEC, '--plugin']);
    expect(noValue.code).toBe(2);
    expect(noValue.err).toBe('driftbench: --plugin takes a module path or a package name\n');
    const bad = await readPluginConfig(join(dir, 'bad.yaml'));
    expect(bad).toEqual({
      ok: false,
      message: `${join(dir, 'bad.yaml')}:2: plugins must be a list of module paths or package names`,
    });
    expect((await readPluginConfig(join(dir, 'blank.yaml'))).ok).toBe(false);
    const run = await cli(['spec', 'lint', SPEC, '--config', join(dir, 'bad.yaml')]);
    expect(run.code).toBe(2);
    expect(run.err).toContain('bad.yaml:2: plugins must be a list');
  });

  it('reads no plugin from a config that is absent, not a map or without the key', async () => {
    const dir = await temp({
      'list.yaml': '- a\n',
      'broken.yaml': 'a: [b\n',
      'plain.yaml': 'aggregates: []\n',
    });
    for (const name of ['list.yaml', 'broken.yaml', 'plain.yaml', 'absent.yaml']) {
      expect(await readPluginConfig(join(dir, name))).toEqual({ ok: true, sources: [] });
    }
    expect(pluginConfigPath(['report'], dir)).toBeUndefined();
    expect(pluginConfigPath(['report', '--config', 'plain.yaml'], dir)).toBe(join(dir, 'plain.yaml'));
    expect(pluginConfigPath(['estate', 'run', '--config', 'host'], dir)).toBeUndefined();
  });

  it('the config accepts the plugins key, and names its keys when it refuses one', async () => {
    const dir = await temp({
      'ok.yaml': 'aggregates: []\nplugins: []\n',
      'unknown.yaml': 'aggregates: []\nmystery: 1\n',
    });
    expect(await readAggregateConfig(join(dir, 'ok.yaml'))).toEqual({ ok: true, specs: [] });
    expect(await readAggregateConfig(join(dir, 'unknown.yaml'))).toEqual({
      ok: false,
      message: `${join(dir, 'unknown.yaml')}:2: unknown key mystery; the config defines aggregates, plugins, scales only`,
    });
  });

  it('takes --plugin anywhere before --, in both spellings', () => {
    expect(pluginArgs(['smoke', '--plugin', 'a.mjs', 'x.yaml', '--plugin=b', '--', '--plugin', 'c'])).toEqual(
      {
        argv: ['smoke', 'x.yaml', '--', '--plugin', 'c'],
        modules: ['a.mjs', 'b'],
        missing: false,
      },
    );
    expect(pluginArgs(['smoke', '--plugin', '--json']).missing).toBe(true);
    expect(pluginArgs(['smoke', '--plugin=']).missing).toBe(true);
    expect(pluginArgs(['lint', 'x.yaml'])).toEqual({ argv: ['lint', 'x.yaml'], modules: [], missing: false });
  });

  it('main takes plugins and deps in code', async () => {
    const plugin: DriftbenchPlugin = definePlugin((api) => {
      api.adapter('echo', () =>
        functionAdapter({
          respond: (messages) => {
            const text = `You said: ${messages.at(-1)?.content ?? ''}`;
            return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
          },
          deterministic: true,
        }),
      );
    });
    const withPlugin = await cli(['smoke', SPEC], ROOT, { plugins: [plugin] });
    expect(withPlugin.code).toBe(0);
    let asked = '';
    const withDeps = await cli(['smoke', SPEC], ROOT, {
      deps: {
        ...defaultDeps,
        adapterFor: async (target) => {
          asked = `${target.adapter}:${target.agent}`;
          return undefined;
        },
      },
    });
    expect(asked).toBe('echo:demo');
    expect(withDeps.code).toBe(2);
  });

  it('a plugin judge answers --pairwise-judge by its name; an unknown name is refused as before', async () => {
    const judge = { id: 'mine' } as JudgeClient;
    await cli(['spec', 'lint', SPEC], ROOT, { plugins: [(api) => api.pairwiseJudge('mine', () => judge)] });
    expect(defaultPairwiseClient('mine')).toBe(judge);
    resetPlugins();
    expect(() => defaultPairwiseClient('mine')).toThrow(
      'unknown pairwise judge mine: use openai, anthropic or google',
    );
  });
});
