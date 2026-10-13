import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CustomCheckFunction, defaultRegistry } from '@agent-nexus/driftbench-checks';
import type { AgentAdapter, TargetRef } from '@agent-nexus/driftbench-core';
import type { JudgeClient } from '@agent-nexus/driftbench-judges';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Io } from './io';

/**
 * Plugins: modules of the team's own code that the CLI loads before it runs a command. A plugin registers
 * adapters (so a target such as `http:my-bot` reaches the team's agent), custom checks (the names a spec
 * lists under `rules.custom`) and pairwise judges (the names `compare --pairwise-judge` takes).
 *
 * The CLI loads a plugin from two places only: the `plugins` list of the project config (`driftbench.yaml`
 * in the working folder, or the file `--config` names) and the `--plugin <module>` flag. It never loads one
 * from a spec file. A plugin is code and runs with the rights of the person who runs the CLI: list only
 * modules you trust, as you would a test file.
 *
 * With no plugin, nothing here runs and every command behaves as before.
 */

/** What lives as long as one campaign: a temporary folder for sandboxes, removed when the campaign closes. */
export type PluginScope = { tempDir(): Promise<string> };

/** Makes the adapter of one target. Undefined when the plugin has none for this agent name. */
export type PluginAdapterFactory = (
  target: TargetRef,
  scope?: PluginScope,
) => AgentAdapter | undefined | Promise<AgentAdapter | undefined>;

/** What a plugin registers with. */
export type PluginApi = {
  /** The working folder of the CLI run. */
  readonly cwd: string;
  /** The adapter of every target `<name>:<agent>`, such as `http:my-bot` for the name `http`. */
  adapter(name: string, factory: PluginAdapterFactory): void;
  /** A custom check, run on every block of a spec that lists `name` under `rules.custom`. */
  check(name: string, check: CustomCheckFunction): void;
  /** A judge that `compare --pairwise-judge <name>` uses. */
  pairwiseJudge(name: string, factory: () => JudgeClient): void;
};

/** A plugin: a function that registers adapters, checks and judges. A plugin module exports it as default. */
export type DriftbenchPlugin = (api: PluginApi) => void | Promise<void>;

/** Returns the plugin unchanged; it gives a plugin module the types of `PluginApi`. */
export function definePlugin(plugin: DriftbenchPlugin): DriftbenchPlugin {
  return plugin;
}

const adapters = new Map<string, PluginAdapterFactory>();
const judges = new Map<string, () => JudgeClient>();
const checks = new Set<string>();

/** Forgets every adapter, judge and check the plugins registered. `main` calls it before it loads plugins. */
export function resetPlugins(): void {
  adapters.clear();
  judges.clear();
  for (const name of checks) defaultRegistry.unregister(name);
  checks.clear();
}

/** The adapter a plugin registered for the target, or undefined. */
export async function pluginAdapter(
  target: TargetRef,
  scope?: PluginScope,
): Promise<AgentAdapter | undefined> {
  const factory = adapters.get(target.adapter);
  return factory === undefined ? undefined : factory(target, scope);
}

/** The adapter names the plugins registered, sorted. */
export function pluginAdapterNames(): string[] {
  return [...adapters.keys()].sort();
}

/** The pairwise judge a plugin registered under the name, or undefined. */
export function pluginPairwiseJudge(name: string): JudgeClient | undefined {
  return judges.get(name)?.();
}

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

function apiFor(cwd: string): PluginApi {
  return {
    cwd,
    adapter(name, factory) {
      if (!NAME.test(name))
        throw new Error(`the adapter name ${JSON.stringify(name)} is not a target prefix`);
      if (typeof factory !== 'function') throw new Error(`the adapter ${name} needs a factory function`);
      adapters.set(name, factory);
    },
    check(name, check) {
      defaultRegistry.register(name, check);
      checks.add(name);
    },
    pairwiseJudge(name, factory) {
      if (typeof factory !== 'function') throw new Error(`the judge ${name} needs a factory function`);
      judges.set(name, factory);
    },
  };
}

/** Runs plugins given in code, in order. Throws what a plugin throws. */
export async function applyPlugins(plugins: readonly DriftbenchPlugin[], cwd: string): Promise<void> {
  const api = apiFor(cwd);
  for (const plugin of plugins) await plugin(api);
}

/** One plugin to load: the module as written, and the folder a relative path starts from. */
export type PluginSource = { module: string; from: string };

/**
 * Loads each module and runs the plugin it exports (its default export, or the export named `plugin`).
 * Returns the reason of the first failure, for exit 2; undefined when all loaded.
 */
export async function loadPlugins(
  sources: readonly PluginSource[],
  cwd: string,
): Promise<string | undefined> {
  const api = apiFor(cwd);
  for (const source of sources) {
    let loaded: Record<string, unknown>;
    try {
      loaded = (await import(locate(source))) as Record<string, unknown>;
    } catch (cause) {
      return `Cannot load the plugin ${source.module}: ${reason(cause)}`;
    }
    const plugin = typeof loaded.default === 'function' ? loaded.default : loaded.plugin;
    if (typeof plugin !== 'function') {
      return `The plugin ${source.module} exports no function: export it as default, (api) => { ... }`;
    }
    try {
      await (plugin as DriftbenchPlugin)(api);
    } catch (cause) {
      return `The plugin ${source.module} failed: ${reason(cause)}`;
    }
  }
  return undefined;
}

/** A file (a path relative to `from`, or absolute) as a file URL; else a package name resolved from `from`. */
function locate(source: PluginSource): string {
  const { module, from } = source;
  const path = resolve(from, module);
  if (module.startsWith('.') || isAbsolute(module) || existsSync(path)) return pathToFileURL(path).href;
  try {
    return pathToFileURL(createRequire(join(from, 'driftbench-plugin.js')).resolve(module)).href;
  } catch {
    return module;
  }
}

function reason(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}

/** The arguments without `--plugin <module>` and `--plugin=<module>`, and the modules they named. */
export function pluginArgs(argv: readonly string[]): { argv: string[]; modules: string[]; missing: boolean } {
  const rest: string[] = [];
  const modules: string[] = [];
  let missing = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--') {
      rest.push(...argv.slice(index));
      break;
    }
    if (arg === '--plugin') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) missing = true;
      else modules.push(value);
      index++;
    } else if (arg.startsWith('--plugin=')) {
      const value = arg.slice('--plugin='.length);
      if (value === '') missing = true;
      else modules.push(value);
    } else {
      rest.push(arg);
    }
  }
  return { argv: rest, modules, missing };
}

/** The project config a run reads plugins from: the file `--config` names when it is a file, else `driftbench.yaml`. */
export function pluginConfigPath(argv: readonly string[], cwd: string): string | undefined {
  let named: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--') break;
    if (arg === '--config') named = argv[index + 1];
    else if (arg.startsWith('--config=')) named = arg.slice('--config='.length);
  }
  const path = resolve(cwd, named ?? 'driftbench.yaml');
  return existsSync(path) ? path : undefined;
}

export type PluginConfig = { ok: true; sources: PluginSource[] } | { ok: false; message: string };

/**
 * Reads the `plugins` list of a project config: module paths, relative to the config file, or package names.
 * A file that is not a YAML map gives no plugin here; the command that reads the config reports it.
 */
export async function readPluginConfig(path: string): Promise<PluginConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { ok: true, sources: [] };
  }
  const doc = parseDocument(text);
  const root = doc.contents;
  if (doc.errors.length > 0 || !isMap(root)) return { ok: true, sources: [] };
  const list = root.get('plugins', true);
  if (list === undefined || list === null) return { ok: true, sources: [] };
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const bad = (offset: number) => ({
    ok: false as const,
    message: `${path}:${lineOf(offset)}: plugins must be a list of module paths or package names`,
  });
  if (!isSeq(list)) return bad(list.range?.[0] ?? 0);
  const sources: PluginSource[] = [];
  for (const item of list.items) {
    const at = isScalar(item) || isMap(item) || isSeq(item) ? (item.range?.[0] ?? 0) : 0;
    if (!isScalar(item) || typeof item.value !== 'string' || item.value.trim() === '') return bad(at);
    sources.push({ module: item.value.trim(), from: dirname(path) });
  }
  return { ok: true, sources };
}

/**
 * Finds and loads the plugins of one CLI run. Returns the arguments without the `--plugin` flags, or the
 * message of a failure. Reads no file and imports nothing when no config exists and no flag is given.
 */
export async function pluginsFromRun(
  argv: readonly string[],
  io: Pick<Io, 'cwd'>,
): Promise<{ ok: true; argv: string[] } | { ok: false; message: string }> {
  const flags = pluginArgs(argv);
  if (flags.missing) return { ok: false, message: '--plugin takes a module path or a package name' };
  const sources: PluginSource[] = [];
  const config = pluginConfigPath(flags.argv, io.cwd);
  if (config !== undefined) {
    const read = await readPluginConfig(config);
    if (!read.ok) return read;
    sources.push(...read.sources);
  }
  sources.push(...flags.modules.map((module) => ({ module, from: io.cwd })));
  if (sources.length > 0) {
    const failure = await loadPlugins(sources, io.cwd);
    if (failure !== undefined) return { ok: false, message: failure };
  }
  return { ok: true, argv: flags.argv };
}
