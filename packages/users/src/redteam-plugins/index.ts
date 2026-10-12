import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { HARM_PLUGINS } from './harm';
import { POLICY_PLUGINS } from './policy';
import { renderPlugin } from './render';
import { SECURITY_PLUGINS } from './security';
import { type RedteamPlugin as Plugin, RedteamPlugin } from './types';

export { HARM_PLUGINS } from './harm';
export { POLICY_PLUGINS } from './policy';
export { renderPlugin, renderText } from './render';
export { SECURITY_PLUGINS } from './security';
export { SKIPPED_PLUGINS } from './skipped';
export { PluginFamilies, type PluginFamily, RedteamPlugin, type SkippedPlugin } from './types';

/** Every ported plugin, harm and security first. */
export const REDTEAM_PLUGINS: readonly Plugin[] = [...HARM_PLUGINS, ...SECURITY_PLUGINS, ...POLICY_PLUGINS];

/**
 * The plugins, each checked against its schema. Throws when a plugin is malformed or two share an id, and names
 * each problem.
 */
export function loadRedteamPlugins(): readonly Plugin[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const candidate of REDTEAM_PLUGINS) {
    const parsed = RedteamPlugin.safeParse(candidate);
    if (!parsed.success) {
      problems.push(`${candidate.id}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      continue;
    }
    if (ids.has(parsed.data.id)) problems.push(`${parsed.data.id}: the id is used twice`);
    ids.add(parsed.data.id);
  }
  if (problems.length > 0) throw new Error(`the red-team plugins are invalid:\n  ${problems.join('\n  ')}`);
  return REDTEAM_PLUGINS;
}

/**
 * A driftbench spec for one plugin: the generation template is the user turn, and the grader rubric is one
 * gating criterion the block judges. The spec is checked with the spec loader and returned; an invalid one throws.
 * Note: the user turn is the generation request itself. A run needs a generator to replace it with an attack
 * request before the target sees it.
 */
export function pluginToSpec(
  plugin: Plugin,
  options: { readonly purpose: string; readonly seed: number },
): Spec {
  const rendered = renderPlugin(plugin, { purpose: options.purpose, n: 1 });
  const spec = {
    id: `redteam-${plugin.id}-${options.seed}`,
    kind: 'conversation',
    title: plugin.title,
    description: `A ${plugin.family} red-team check, generated from the ${plugin.id} plugin.`,
    channel: 'chat',
    criteria: [{ name: plugin.id, rubric: rendered.rubric, gating: true, scope: 'block' }],
    blocks: [{ id: 'attack', when: { user: rendered.template }, expect: { criteria: [plugin.id] } }],
    metadata: { plugin: plugin.id, seed: options.seed, source: plugin.source },
  };
  const loaded = validateSpec(spec, `redteam:${plugin.id}`);
  if (!loaded.ok) {
    throw new Error(
      `the spec for ${plugin.id} is invalid: ${loaded.errors.map((issue) => issue.message).join('; ')}`,
    );
  }
  return loaded.spec;
}
