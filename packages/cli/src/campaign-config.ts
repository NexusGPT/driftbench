import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CampaignConfig } from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import { parseDocument } from 'yaml';
import { configKeyError, DEFAULT_CONFIG } from './aggregate-config';
import type { Io } from './io';

/**
 * The `campaign:` key of the project config (`driftbench.yaml`, or --config): the settings of
 * `driftbench campaign run`, each a plain mapping onto the flag of the same name. A flag given on the command
 * line wins over the file. A file with no `campaign:` key changes nothing.
 */

export type CampaignConfigLoad =
  | { ok: true; config: CampaignConfig | undefined }
  | { ok: false; message: string };

/**
 * Reads the `campaign:` key. Without --config the file is `driftbench.yaml` in the working folder and is
 * optional: a missing file, a file that is not YAML, or one with no `campaign:` key gives no settings, as
 * before the key existed. Unknown top-level keys, a --config that cannot be read, and a `campaign:` key
 * that does not fit are errors.
 */
export async function readCampaignConfig(
  given: string | undefined,
  cwd: string,
): Promise<CampaignConfigLoad> {
  const explicit = given !== undefined;
  const path = resolve(cwd, given ?? DEFAULT_CONFIG);
  if (!explicit && !existsSync(path)) return { ok: true, config: undefined };
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      message: `Cannot read the config ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  let root: unknown;
  try {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw doc.errors[0];
    const keyError = configKeyError(doc.contents, text, path);
    if (keyError) return { ok: false, message: keyError };
    root = doc.toJS();
  } catch (cause) {
    if (!explicit) return { ok: true, config: undefined };
    return {
      ok: false,
      message: `${path}: not YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root))
    return { ok: true, config: undefined };
  const block = (root as Record<string, unknown>).campaign;
  if (block === undefined || block === null) return { ok: true, config: undefined };
  const parsed = CampaignConfig.safeParse(block);
  if (parsed.success) return { ok: true, config: parsed.data };
  const issue = parsed.error.issues[0];
  const at = ['campaign', ...(issue?.path ?? [])].join('.');
  return { ok: false, message: `${path}: ${at}: ${issue?.message ?? 'invalid'}` };
}

/** The option of a command each file key sets, and the value the flag would have given. */
const MAPPING: Array<[option: string, value: (config: CampaignConfig) => unknown]> = [
  ['dataset', (c) => c.dataset],
  ['prompt', (c) => c.prompts],
  ['target', (c) => c.targets],
  ['route', (c) => c.routes],
  ['mode', (c) => c.modes?.join(',')],
  ['repeats', (c) => (c.repeats === undefined ? undefined : String(c.repeats))],
  ['agentVersion', (c) => c.agent_version],
  ['store', (c) => c.store],
  ['cache', (c) => c.cache],
  ['cacheSuite', (c) => c.cache_suite],
  ['concurrency', (c) => (c.concurrency === undefined ? undefined : String(c.concurrency))],
  ['budgetUsd', (c) => (c.budget_usd === undefined ? undefined : String(c.budget_usd))],
  ['processCommand', (c) => c.process_command],
  ['driver', (c) => c.driver],
  ['persona', (c) => c.personas],
  ['recording', (c) => c.recordings],
  ['model', (c) => (c.model === true ? true : undefined)],
  ['agentFamily', (c) => c.agent_family],
  ['judgeFamily', (c) => c.judge_families],
  ['retryAttempts', (c) => (c.retry?.max_attempts === undefined ? undefined : String(c.retry.max_attempts))],
  ['retryBaseMs', (c) => (c.retry?.base_delay_ms === undefined ? undefined : String(c.retry.base_delay_ms))],
  ['retryMaxMs', (c) => (c.retry?.max_delay_ms === undefined ? undefined : String(c.retry.max_delay_ms))],
];

/**
 * Fills the options of a command from the `campaign:` key: every option in `only` (all of them without it)
 * that the command defines and the command line did not give takes the file's value, in the form the flag
 * gives it. Returns the config, or undefined when there is none; false after an error message.
 */
export async function applyCampaignConfig(
  command: Command,
  options: Record<string, unknown>,
  io: Io,
  only?: readonly string[],
): Promise<CampaignConfig | undefined | false> {
  const loaded = await readCampaignConfig(options.config as string | undefined, io.cwd);
  if (!loaded.ok) {
    io.err(`${loaded.message}\n`);
    return false;
  }
  const config = loaded.config;
  if (config === undefined) return undefined;
  const defined = new Set(command.options.map((option) => option.attributeName()));
  for (const [name, read] of MAPPING) {
    if (!defined.has(name) || (only !== undefined && !only.includes(name))) continue;
    const value = read(config);
    if (value === undefined || command.getOptionValueSource(name) === 'cli') continue;
    options[name] = value;
  }
  return config;
}
