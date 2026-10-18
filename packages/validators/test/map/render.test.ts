import { parseInventoryText } from '@agent-nexus/driftbench-core';
import { AtomKind } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { baseOrder, DECOYS, render, SYNONYMS, sectionKeys } from '../../src/ladders/map/render';
import { hiddenSpec } from '../../src/ladders/map/spec';
import { fold } from '../../src/ladders/map/truth';

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

describe('the hidden specification', () => {
  it('is the same on a repeat and differs between seeds', () => {
    expect(hiddenSpec(7)).toEqual(hiddenSpec(7));
    expect(JSON.stringify(hiddenSpec(7))).not.toBe(JSON.stringify(hiddenSpec(8)));
  });

  it('holds every part of section 2 on every seed', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      expect(spec.stages.length).toBeGreaterThanOrEqual(4);
      expect(spec.behaviours.length).toBeGreaterThanOrEqual(5);
      expect(spec.flows.length).toBeGreaterThanOrEqual(2);
      expect(spec.tools.length).toBeGreaterThanOrEqual(2);
      expect(spec.rules.length).toBeGreaterThanOrEqual(5);
      expect(spec.personas.map((dimension) => dimension.id)).toEqual(
        expect.arrayContaining(['customer_type', 'language']),
      );
      expect(spec.personaConstraints.length).toBeGreaterThanOrEqual(1);
      expect(spec.personas.filter((dimension) => dimension.role === 'axis')).toHaveLength(1);
      expect(spec.data.filter((dimension) => dimension.role === 'axis')).toHaveLength(1);
    }
  });

  it('draws rules of all fourteen atom kinds over the seeds', () => {
    const kinds = new Set(SEEDS.flatMap((seed) => hiddenSpec(seed).rules.map((rule) => rule.kind)));
    expect([...kinds].sort()).toEqual([...AtomKind.options].sort());
  });
});

describe('the renderer', () => {
  it('gives the same artefacts on a repeat', () => {
    const spec = hiddenSpec(3);
    expect(render(spec, { wording: 3 })).toEqual(render(spec, { wording: 3 }));
  });

  it('records a span for every atom, holding the atom id or text', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const spec = hiddenSpec(seed);
      const rendered = render(spec, { wording: seed });
      const text = (id: string) => {
        const span = rendered.spans.get(id);
        expect(span, id).toBeDefined();
        return rendered.prompt.slice(span?.start, span?.end);
      };
      for (const stage of spec.stages)
        expect(text(`stage/${stage.id}`)).toMatch(new RegExp(`^${stage.id}: `));
      for (const rule of spec.rules)
        expect(fold(text(`rule/${rule.id}`)).toLowerCase()).toContain(rule.condition.toLowerCase());
      for (const dimension of [...spec.personas, ...spec.data]) {
        for (const value of dimension.values)
          expect(text(`${dimension.id}/${value.id}`)).toMatch(new RegExp(`^${value.id}: `));
      }
      for (const phrase of spec.phrases) expect(text(`phrase/${phrase.id}`)).toBe(phrase.text);
      for (const constraint of [...spec.stageConstraints, ...spec.personaConstraints]) {
        expect(text(`constraint/${constraint.id}`)).toContain(constraint.anchor.channel);
      }
    }
  });

  it('writes an inventory the core reader accepts, with the planted ids', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      const parsed = parseInventoryText(render(spec, { wording: seed }).inventory, 'yaml');
      expect(parsed.ok, `seed ${seed}`).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.inventory.behaviours.map((behaviour) => behaviour.id)).toEqual(
        spec.behaviours.map((b) => b.id),
      );
      expect(parsed.inventory.flows.map((flow) => flow.deviations ?? [])).toEqual(
        spec.flows.map((flow) => flow.deviations),
      );
      expect(parsed.inventory.channels).toEqual(spec.channels);
    }
  });

  it('writes tool schemas as YAML with every planted argument', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      const tools = parseYaml(render(spec, { wording: seed }).tools) as {
        tools: Array<{
          name: string;
          input_schema: { properties: Record<string, unknown>; required: string[] };
        }>;
      };
      expect(tools.tools.map((tool) => tool.name)).toEqual(spec.tools.map((tool) => tool.name));
      tools.tools.forEach((tool, index) => {
        const planted = spec.tools[index]?.input ?? [];
        expect(Object.keys(tool.input_schema.properties)).toEqual(planted.map((arg) => arg.name));
        expect(tool.input_schema.required).toEqual(
          planted.filter((arg) => arg.required).map((arg) => arg.name),
        );
      });
    }
  });

  it('splits every rule into two sentences under the split transform, and only the rules', () => {
    const spec = hiddenSpec(4);
    const base = render(spec, { wording: 4 });
    const split = render(spec, { wording: 4, split: true });
    for (const rule of spec.rules) {
      const span = split.spans.get(`rule/${rule.id}`);
      expect(split.prompt.slice(span?.start, span?.end)).toBe(`${rule.main}. This holds ${rule.condition}.`);
      expect(split.split.has(`rule/${rule.id}`)).toBe(true);
    }
    const strip = (text: string) => text.replace(/^- .*$/gm, '');
    expect(strip(split.prompt)).toBe(strip(base.prompt));
  });

  it('changes template words under the synonym table, never an id or a user message', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const spec = hiddenSpec(seed);
      const base = render(spec, { wording: seed });
      const synonym = render(spec, { wording: seed, synonyms: true });
      expect(synonym.prompt).not.toBe(base.prompt);
      expect(synonym.prompt).not.toMatch(/\bcustomer\b/);
      for (const [id, span] of base.spans) {
        const after = synonym.spans.get(id);
        const before = base.prompt.slice(span.start, span.end);
        const now = synonym.prompt.slice(after?.start, after?.end);
        if (id.startsWith('phrase/')) expect(now).toBe(before);
        if (/^(stage|customer_type|language|tone|lookup_result|balance_state|slot_result)\//.test(id)) {
          expect(now.split(':')[0]).toBe(before.split(':')[0]);
        }
      }
      expect(SYNONYMS.length).toBeGreaterThan(10);
    }
  });

  it('reorders whole sections under a permutation and keeps every sentence', () => {
    const spec = hiddenSpec(5);
    const order = baseOrder(spec, 5);
    const base = render(spec, { wording: 5 });
    const permuted = render(spec, { wording: 5, order: [...order].reverse() });
    expect(base.order).toEqual(order);
    expect(permuted.order).toEqual([...order].reverse());
    const lines = (text: string) =>
      text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .sort();
    expect(lines(permuted.prompt)).toEqual(lines(base.prompt));
    expect(() => render(spec, { wording: 5, order: order.slice(1) })).toThrow(/section order/);
    expect(sectionKeys(spec)).toEqual(expect.arrayContaining(['stages', 'rules', 'about']));
  });

  it('adds decoys that name no planted id', () => {
    const spec = hiddenSpec(6);
    const base = render(spec, { wording: 6 });
    const more = render(spec, { wording: 6, extraDecoys: 3 });
    expect(base.decoys.length).toBeGreaterThanOrEqual(2);
    expect(more.decoys.length).toBe(base.decoys.length + 3);
    expect(more.decoys.map((decoy) => decoy.id)).toEqual(
      expect.arrayContaining(base.decoys.map((decoy) => decoy.id)),
    );
    const ids = [
      ...spec.stages.map((stage) => stage.id),
      ...spec.personas.flatMap((dimension) => dimension.values.map((value) => value.id)),
      ...spec.channels,
    ];
    for (const decoy of DECOYS) for (const id of ids) expect(decoy).not.toMatch(new RegExp(`\\b${id}\\b`));
  });
});
