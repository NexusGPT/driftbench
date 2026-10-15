import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createFollower } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { followerAdapter, generateFrom, runContext } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { blockOutcome, runOnce } from '../../src/gate/agents';

// Seed 3 has a read tool no flow calls, so no states relation says how a reply states its returned fields.
// Its prompt states every returned field one way ("<tool label with spaces> says <field> is <value>."), and
// the map's states relations of the other tools show that form.
const SEED = 3;

describe('a request turn that runs a tool', () => {
  it('reads every returned field the reply states, in the form the map states other tools with', async () => {
    const hidden = hiddenSpec(SEED);
    const tool = hidden.tools.find(
      (entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect,
    );
    if (!tool) throw new Error(`seed ${SEED} has no tool that no flow calls`);
    const source = await generateFrom(hidden, renderMap(hidden), SEED, {}, { once: true });
    if (!source.prepared)
      throw new Error(`the fictional map failed to load: ${JSON.stringify(source.refused)}`);
    const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed: SEED });
    const label = tool.name.replace(/_/g, ' ');
    let checked = 0;
    for (const spec of suite.complete) {
      const answer = spec.given?.world?.tools?.[tool.name]?.result as Record<string, unknown> | undefined;
      for (const block of spec.blocks) {
        const runs = (block.expect?.tools ?? []).some((call) => call.label === tool.name && call.count !== 0);
        if (!runs) continue;
        checked += 1;
        // The tool answers from the Given, so the reply has facts to state; each one is a must of the turn.
        expect(answer, `${spec.id} ${block.id}`).toBeDefined();
        const must = (block.expect?.must ?? []).map((pattern) => new RegExp(pattern));
        for (const field of tool.output) {
          const said = `${label} says ${field.name} is ${String(answer?.[field.name])}.`;
          expect(
            must.some((pattern) => pattern.test(said)),
            `${spec.id} ${block.id} reads "${said}"`,
          ).toBe(true);
          // The opposite yes or no fails the turn.
          if (field.type === 'boolean') {
            const flipped = `${label} says ${field.name} is ${String(!answer?.[field.name])}.`;
            expect(must.some((pattern) => pattern.test(flipped))).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 180_000);
});

/**
 * Seed 3 with every returned-field statement moved to relations that hold in one scope only, with a prefix:
 * a reply outside that scope states the field without it. Every block of every spec outside the scope that
 * runs the request-only tool must pass the correct follower.
 */
async function scopedForm(scope: 'channel' | 'flow') {
  const hidden = hiddenSpec(SEED);
  const tool = hidden.tools.find(
    (entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect,
  );
  if (!tool) throw new Error(`seed ${SEED} has no tool that no flow calls`);
  const scoped = scope === 'channel' ? (hidden.channels[0] as string) : (hidden.flows.at(-1)?.id as string);
  const prefix = scope === 'channel' ? 'CHANNEL_ONLY' : 'FLOW_ONLY';
  const rendered = renderMap(hidden);
  const map = parse(rendered.map) as { relations: Array<Record<string, unknown>> };
  const added: Array<Record<string, unknown>> = [];
  for (const relation of map.relations) {
    if (relation.kind !== 'states') continue;
    const must = (relation.must ?? []) as string[];
    const reported = must.filter((pattern) => pattern.includes('{'));
    if (reported.length === 0) continue;
    relation.must = must.filter((pattern) => !pattern.includes('{'));
    const quote = `Only in ${scope} ${scoped}, prefix every returned-field statement with ${prefix}. Elsewhere use the ordinary statement without that prefix.`;
    rendered.prompt += `\n${quote}\n`;
    added.push({
      ...relation,
      must: reported.map((pattern) => `${prefix} ${pattern}`),
      must_not: undefined,
      ...(scope === 'channel'
        ? { when: { ...((relation.when as object | undefined) ?? {}), channel: [scoped] } }
        : { subject: { dimension: 'flow', value: scoped } }),
      evidence: { source: './prompt.md', quote },
    });
  }
  map.relations.push(...added);
  rendered.map = stringify(map);
  const generated = await generateFrom(hidden, rendered, SEED, {}, { once: true });
  if (!generated.prepared) throw new Error(JSON.stringify(generated.refused));
  const outside = ({ spec }: (typeof generated.complete)[number]) =>
    scope === 'channel'
      ? spec.channel !== scoped
      : (spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell?.flow !== scoped;
  const specs = generated.complete.filter(
    (entry) =>
      outside(entry) &&
      entry.spec.blocks.some(
        (block) =>
          (block.id ?? '').endsWith('-value') &&
          block.expect?.tools?.some((call) => call.label === tool.name && call.count !== 0),
      ),
  );
  expect(specs.length).toBeGreaterThan(0);
  for (const { spec } of specs) {
    const run = await runOnce(spec, followerAdapter(createFollower(hidden)), 0, runContext());
    spec.blocks.forEach((block, index) => {
      expect(blockOutcome(run, index), `${spec.id} ${block.id} ${JSON.stringify(block.expect?.must)}`).toBe(
        'pass',
      );
    });
  }
}

describe('the form a request turn reads', () => {
  it('comes only from relations that hold on the spec channel', () => scopedForm('channel'), 300_000);
  it('comes only from relations of the spec flow', () => scopedForm('flow'), 300_000);
});
