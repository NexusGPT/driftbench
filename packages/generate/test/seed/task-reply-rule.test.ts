import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { TaskFamilyRelation } from '../../src/extract/proposal';
import { streamTaskSpecs } from '../../src/seed/tasks';
import { zedPrepared } from '../enumerate/support';

const relation = TaskFamilyRelation.parse({
  kind: 'task_family',
  flow: 'balance',
  family: './family',
  stages: ['start', 'start'],
  evidence: { source: 'README.md', quote: 'a task' },
  produced_by: 'model',
  approved: true,
});
const variant = {
  spec: {
    id: 'toy-i01-base',
    kind: 'task',
    blocks: [{ id: 'open', when: { user: 'Open the request.' }, expect: { stage: 'start' } }],
    rules: { forbidden_tools: ['delete_record'] },
  },
};
const run = { seed: 1, mapPath: 'map.yaml' };

describe('a task spec the generator places in the map', () => {
  it('holds one reply per user turn when the map states no reply count, keeping its own rules', () => {
    const prepared = zedPrepared();
    expect(prepared.relations.repliesPerTurn).toBe('one');
    const [placed] = [...streamTaskSpecs(prepared, [{ relation, variants: [variant] }], run)];
    expect(placed?.spec.rules).toEqual({ forbidden_tools: ['delete_record'], one_message_per_turn: true });
  });

  it('keeps only its own rules when the map lets the agent send several replies', () => {
    const base = zedPrepared();
    const prepared = { ...base, relations: { ...base.relations, repliesPerTurn: 'any' as const } };
    const [placed] = [...streamTaskSpecs(prepared, [{ relation, variants: [variant] }], run)];
    expect(placed?.spec.rules).toEqual({ forbidden_tools: ['delete_record'] });
  });

  it('holds the rule on every task spec of a hidden map, as every other generated spec does', async () => {
    const hidden = hiddenSpec(1);
    const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
    const seeder = (spec: (typeof source.complete)[number]['spec']) =>
      (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder;
    const tasks = source.complete.filter(({ spec }) => seeder(spec) === 'task');
    const others = source.complete.filter(({ spec }) => seeder(spec) !== 'task');
    expect(tasks.length).toBeGreaterThan(0);
    expect(others.every(({ spec }) => spec.rules?.one_message_per_turn === true)).toBe(true);
    for (const { spec } of tasks) expect(spec.rules?.one_message_per_turn, spec.id).toBe(true);
  }, 180_000);
});
