import { validateSpec } from '@driftbench/core';
import { describe, expect, it } from 'vitest';
import {
  loadRedteamPlugins,
  pluginToSpec,
  REDTEAM_PLUGINS,
  renderPlugin,
  SKIPPED_PLUGINS,
} from '../../src/redteam-plugins/index';

/** A fictional target: no real company, product or person. */
const PURPOSE = 'Acme Telecom help assistant for billing and plan questions';

const PLACEHOLDER = /\{\{\s*[a-zA-Z]+\s*\}\}/;

describe('the red-team plugin pack', () => {
  it('loads at least 40 plugins with unique ids, harm and security plugins among them', () => {
    const plugins = loadRedteamPlugins();
    expect(plugins.length).toBeGreaterThanOrEqual(40);
    expect(new Set(plugins.map((plugin) => plugin.id)).size).toBe(plugins.length);
    expect(plugins.some((plugin) => plugin.family === 'harm')).toBe(true);
    expect(plugins.some((plugin) => plugin.family === 'security')).toBe(true);
  });

  it('lists every skipped plugin with the reason it was skipped', () => {
    expect(SKIPPED_PLUGINS.length).toBeGreaterThan(0);
    for (const skipped of SKIPPED_PLUGINS) {
      expect(skipped.reason.trim(), skipped.source).not.toBe('');
      expect(REDTEAM_PLUGINS.map((plugin) => plugin.source)).not.toContain(skipped.source);
    }
  });

  describe.each(REDTEAM_PLUGINS.map((plugin) => [plugin.id, plugin] as const))('%s', (_id, plugin) => {
    it('has a non-empty generation template and grader rubric', () => {
      expect(plugin.template.trim()).not.toBe('');
      expect(plugin.rubric.trim()).not.toBe('');
    });

    it('renders its template with a fictional purpose and leaves no placeholder', () => {
      const rendered = renderPlugin(plugin, { purpose: PURPOSE, n: 3 });
      expect(rendered.template).toContain(PURPOSE);
      expect(rendered.template).not.toMatch(PLACEHOLDER);
      expect(rendered.rubric).toContain(PURPOSE);
      expect(rendered.rubric).not.toMatch(PLACEHOLDER);
    });
  });

  it.each(['sql-injection', 'harm-hate', 'ssrf'])('turns %s into a spec the spec loader accepts', (id) => {
    const plugin = REDTEAM_PLUGINS.find((candidate) => candidate.id === id);
    expect(plugin).toBeDefined();
    if (!plugin) return;
    const spec = pluginToSpec(plugin, { purpose: PURPOSE, seed: 7 });
    const loaded = validateSpec(spec, `redteam:${id}`);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors)).toBe(true);
    expect(spec.kind).toBe('conversation');
    expect(spec.criteria?.[0]?.rubric).toContain(PURPOSE);
    expect(spec.blocks[0]?.when).toEqual({ user: expect.stringContaining(PURPOSE) });
  });

  it('gives a different spec id for each seed of one plugin', () => {
    const plugin = REDTEAM_PLUGINS[0];
    if (!plugin) throw new Error('the pack is empty');
    const first = pluginToSpec(plugin, { purpose: PURPOSE, seed: 1 });
    const second = pluginToSpec(plugin, { purpose: PURPOSE, seed: 2 });
    expect(first.id).not.toBe(second.id);
  });
});
