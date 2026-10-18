import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { MAP_COMPONENTS, mapLadderV1 as mapLadder } from '../../src/ladders/map/first';
import { contractStatesRole, oracleRecording } from '../../src/ladders/map/oracle';
import { render } from '../../src/ladders/map/render';
import { runPipeline } from '../../src/ladders/map/run';
import { hiddenSpec } from '../../src/ladders/map/spec';
import { baseOptions } from '../../src/ladders/map/transforms';
import { toolPartitions, truthOf } from '../../src/ladders/map/truth';
import { editedAnswers, editedExtract } from './support';

describe('the map ladder on the current extractor', () => {
  it('has the seven levels of section 2, in order', () => {
    expect(mapLadder().levels.map((level) => [level.id, level.threshold])).toEqual([
      ['structured', 1],
      ['prose-atoms', 0.9],
      ['precision', 1],
      ['constraints', 0.9],
      ['metamorphic', 1],
      ['composition', 1],
      ['roles', 1],
    ]);
  });

  it('reaches level 1 and more on seeds 1 to 3: every planted entity, atom and constraint is recovered', async () => {
    for (const seed of [1, 2, 3]) {
      const run = await runLadder(mapLadder(), { seed, maxLevel: 4 });
      expect(run.rows.slice(0, 4).map((row) => [row.id, row.observed, row.pass])).toEqual([
        ['structured', 1, true],
        ['prose-atoms', 1, true],
        ['precision', 1, true],
        ['constraints', 1, true],
      ]);
      expect(run.level).toBeGreaterThanOrEqual(4);
    }
  });

  it('runs the extractor through the recording port, with no model', async () => {
    const spec = hiddenSpec(2);
    const run = await runPipeline(spec, baseOptions(spec));
    if (!run.result.ok) throw new Error('the extractor refused the rendering');
    expect(run.result.proposal.produced_by.family).toBe('oracle');
    expect(run.result.sections.map((section) => [section.section, section.status, section.calls])).toEqual([
      ['stages', 'done', 1],
      ['rules', 'done', 1],
      ['personas', 'done', 1],
      ['data', 'done', 1],
      ['phrases', 'done', 1],
      ['relations', 'done', 1],
    ]);
    expect(run.result.refusals).toEqual([]);
  });
});

describe('the truth of the tool schemas', () => {
  it('lists the partitions the pre-pass contract states, written by hand for one tool', () => {
    expect(
      toolPartitions('slot.book', 'in', [
        { name: 'tier', required: true, schema: { type: 'enum', members: ['basic', 'plus'] } },
        { name: 'urgent', required: false, schema: { type: 'boolean' } },
        { name: 'count', required: true, schema: { type: 'integer', minimum: 1 } },
        { name: 'note', required: true, schema: { type: 'string', minLength: 0, maxLength: 20 } },
        { name: 'label', required: true, schema: { type: 'open' } },
        { name: 'comment', required: false, schema: { type: 'open' } },
        { name: 'items', required: true, schema: { type: 'array', maxItems: 3 } },
        {
          name: 'owner',
          required: false,
          schema: {
            type: 'object',
            nullable: true,
            children: [{ name: 'tier', required: true, schema: { type: 'enum', members: ['low', 'high'] } }],
          },
        },
      ]),
    ).toEqual([
      { dimension: 'slot.book.in.tier', values: ['slot.book.in.tier.basic', 'slot.book.in.tier.plus'] },
      {
        dimension: 'slot.book.in.urgent',
        values: ['slot.book.in.urgent.true', 'slot.book.in.urgent.false', 'slot.book.in.urgent.absent'],
      },
      {
        dimension: 'slot.book.in.count',
        values: [
          'slot.book.in.count.below-minimum',
          'slot.book.in.count.at-minimum',
          'slot.book.in.count.above-minimum',
        ],
      },
      {
        dimension: 'slot.book.in.note',
        values: [
          'slot.book.in.note.at-min-length',
          'slot.book.in.note.at-max-length',
          'slot.book.in.note.above-max-length',
        ],
      },
      {
        dimension: 'slot.book.in.comment',
        values: ['slot.book.in.comment.present', 'slot.book.in.comment.absent'],
      },
      {
        dimension: 'slot.book.in.items',
        values: [
          'slot.book.in.items.empty',
          'slot.book.in.items.one-item',
          'slot.book.in.items.several-items',
          'slot.book.in.items.at-max-items',
          'slot.book.in.items.above-max-items',
        ],
      },
      {
        dimension: 'slot.book.in.owner',
        values: ['slot.book.in.owner.present', 'slot.book.in.owner.null', 'slot.book.in.owner.absent'],
      },
      {
        dimension: 'slot.book.in.owner.tier',
        values: ['slot.book.in.owner.tier.low', 'slot.book.in.owner.tier.high'],
      },
    ]);
  });

  it('plants at least one tool dimension and one inventory constraint on most seeds', () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const truths = seeds.map((seed) => truthOf(hiddenSpec(seed)));
    expect(truths.every((truth) => truth.structural.some((entry) => entry.from === 'tools'))).toBe(true);
    expect(
      truths.filter((truth) => truth.constraints.some((c) => c.from === 'inventory')).length,
    ).toBeGreaterThan(5);
    expect(truths.every((truth) => truth.constraints.some((c) => c.from === 'prose'))).toBe(true);
  });
});

describe('planted faults, one per level', () => {
  it('level 1: a tool dimension the pipeline drops is named, pointing at the tool pre-pass', async () => {
    const spec = hiddenSpec(1);
    const truth = truthOf(spec);
    const dropped = truth.structural.find((entry) => entry.from === 'tools')?.dimension as string;
    const ladder = mapLadder({
      extract: editedExtract((proposal) => {
        proposal.dimensions = proposal.dimensions.filter(
          (dimension: { id: string }) => dimension.id !== dropped,
        );
      }),
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(0);
    expect(run.rows[1]?.pass).toBeNull();
    const items = run.failing?.items ?? [];
    expect(items.length).toBe(truth.structural.filter((entry) => entry.dimension === dropped).length);
    expect(items[0]).toMatchObject({ component: MAP_COMPONENTS.tools });
    expect(items[0]?.id.startsWith(`${dropped}/`)).toBe(true);
    expect(items[0]?.detail).toBe(`planted in tools.yaml: the map has no dimension ${dropped}`);
  });

  it('level 1: a behaviour the inventory pre-pass loses points at the pre-pass', async () => {
    const ladder = mapLadder({
      extract: editedExtract((proposal) => {
        const behaviour = proposal.dimensions.find(
          (dimension: { id: string }) => dimension.id === 'behaviour',
        );
        behaviour.values = behaviour.values.slice(1);
      }),
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(0);
    expect(run.failing?.items).toEqual([
      {
        id: 'behaviour/B-001',
        component: MAP_COMPONENTS.inventory,
        detail: 'planted in inventory.yaml: behaviour has no value B-001',
      },
    ]);
  });

  it('level 2: rules the model leaves out are named with their rendered sentence', async () => {
    const ladder = mapLadder({
      answerer: editedAnswers((answers) => {
        const rules = answers.rules.dimensions[0];
        rules.values = rules.values.slice(0, 1);
      }),
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(1);
    expect(run.failing?.id).toBe('prose-atoms');
    const spec = hiddenSpec(1);
    expect(run.failing?.items.map((item) => item.id)).toEqual(
      spec.rules.slice(1).map((rule) => `rule/${rule.id}`),
    );
    const item = run.failing?.items[0];
    expect(item?.component).toBe(MAP_COMPONENTS.contract);
    expect(item?.detail).toMatch(
      /^rendered ".+" at characters \d+ to \d+ of prompt\.md; the rules request carried prompt\.md whole \(\d+ characters\); the map has no value rule\/R-\d+; no refusal was reported$/,
    );
  });

  it('level 2: quotes copied from the wrong sentence are off their span or refused, and named', async () => {
    const ladder = mapLadder({
      answerer: editedAnswers((answers) => {
        const rules = answers.rules.dimensions[0].values;
        const quotes = rules.map((value: { quote: string }) => value.quote);
        rules.forEach((value: { quote: string }, index: number) => {
          value.quote = quotes[(index + 1) % quotes.length];
        });
        answers.stages.dimensions[0].values[0].quote = 'a sentence that is not in the prompt';
      }),
    });
    const run = await runLadder(ladder, { seed: 2 });
    const spec = hiddenSpec(2);
    expect(run.level).toBe(1);
    expect(run.failing?.items.map((item) => [item.id, item.component])).toEqual([
      [`stage/${spec.stages[0]?.id}`, MAP_COMPONENTS.quote],
      ...spec.rules.map((rule) => [`rule/${rule.id}`, MAP_COMPONENTS.quote]),
    ]);
    expect(run.failing?.items[0]?.detail).toMatch(/refused: the quote is not in prompt\.md/);
    expect(run.failing?.items[1]?.detail).toMatch(/the quote lies outside its span: "/);
  });

  it('level 3: an entry read from a decoy is named as the decoy', async () => {
    const ladder = mapLadder({
      answerer: editedAnswers((answers, _spec, rendered) => {
        const decoy = rendered.decoys[0];
        if (!decoy) throw new Error('no decoy');
        answers.rules.dimensions[0].values.push({
          id: 'R-99',
          title: 'an invented rule',
          source: 'prompt.md',
          quote: rendered.prompt.slice(decoy.span.start, decoy.span.end),
        });
      }),
    });
    const run = await runLadder(ladder, { seed: 3 });
    expect(run.level).toBe(2);
    expect(run.failing?.id).toBe('precision');
    expect(run.failing?.items).toHaveLength(1);
    expect(run.failing?.items[0]).toMatchObject({ id: 'rule/R-99', component: MAP_COMPONENTS.accept });
    expect(run.failing?.items[0]?.detail).toMatch(/^the value rule\/R-99 comes from the decoy decoy-\d+: "/);
  });

  it('level 3: a constraint nobody stated is invented', async () => {
    const ladder = mapLadder({
      answerer: editedAnswers((answers, spec) => {
        const type = spec.personas[0]?.values[0]?.id as string;
        answers.personas.constraints.push({
          forbid: { customer_type: type, stage: spec.stages[0]?.id },
          reason: 'invented',
          source: 'prompt.md',
          quote: answers.personas.dimensions[0].values[0].quote,
        });
      }),
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(2);
    expect(run.failing?.items[0]?.id).toMatch(
      /^constraint (customer_type=\w+,stage=greet|stage=greet,customer_type=\w+)$/,
    );
    expect(run.failing?.items[0]?.detail).toMatch(/was never planted; it quotes prompt\.md/);
  });

  it('level 4: constraints the model leaves out are named, pointing at the constraint prompt', async () => {
    const ladder = mapLadder({
      answerer: editedAnswers((answers) => {
        answers.personas.constraints = [];
        answers.stages.constraints = [];
      }),
    });
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((candidate) => {
      const truth = truthOf(hiddenSpec(candidate));
      const prose = truth.constraints.filter((constraint) => constraint.from === 'prose').length;
      return prose / truth.constraints.length > 0.1;
    }) as number;
    const run = await runLadder(ladder, { seed });
    expect(run.level).toBe(3);
    expect(run.failing?.id).toBe('constraints');
    const spec = hiddenSpec(seed);
    expect(run.failing?.items.map((item) => item.id).sort()).toEqual(
      [...spec.stageConstraints, ...spec.personaConstraints].map((constraint) => constraint.id).sort(),
    );
    expect(run.failing?.items[0]?.component).toBe(MAP_COMPONENTS.contract);
    expect(run.failing?.items[0]?.detail).toMatch(
      /^rendered ".+" for the (stages|personas) section: not in the map$/,
    );
  });

  it('the perfect model quotes every atom from its own span', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = hiddenSpec(seed);
      const rendered = render(spec, baseOptions(spec));
      const recording = oracleRecording(spec, rendered);
      const quotes = Object.values(recording.answers).flatMap((answer) =>
        ((answer as { dimensions: Array<{ values: Array<{ quote: string }> }> }).dimensions ?? []).flatMap(
          (dimension) => dimension.values.map((value) => value.quote),
        ),
      );
      for (const quote of quotes) expect(rendered.prompt).toContain(quote);
    }
  });

  it('gives roles only when the system prompt of the extractor asks for them', () => {
    const template = '{"dimensions": [{"id": "<dimension id>", "kind": "<kind>"}]}';
    expect(contractStatesRole(template)).toBe(false);
    const spec = hiddenSpec(1);
    const rendered = render(spec, baseOptions(spec));
    const answers = oracleRecording(spec, rendered, { roles: contractStatesRole(template) })
      .answers as Record<string, { dimensions: Array<{ id: string; role?: string }> }>;
    expect(answers.personas?.dimensions.length).toBeGreaterThan(0);
    for (const dimension of answers.personas?.dimensions ?? []) expect(dimension).not.toHaveProperty('role');
  });

  it('gives declared roles when the system prompt of the extractor asks for them', () => {
    const template =
      '{"dimensions": [{"id": "<dimension id>", "kind": "<kind>", "role": "<axis or detail>"}]}';
    expect(contractStatesRole(template)).toBe(true);
    const spec = hiddenSpec(1);
    const rendered = render(spec, baseOptions(spec));
    const answers = oracleRecording(spec, rendered, { roles: contractStatesRole(template) })
      .answers as Record<string, { dimensions: Array<{ id: string; role?: string }> }>;
    const declared = new Map(truthOf(spec).roles.map((entry) => [entry.dimension, entry.role]));
    expect(answers.personas?.dimensions.length).toBeGreaterThan(0);
    for (const dimension of answers.personas?.dimensions ?? []) {
      expect(declared.has(dimension.id)).toBe(true);
      expect(dimension.role).toBe(declared.get(dimension.id));
    }
  });

  it('accepts or refuses explicit role answers according to the live extractor contract', async () => {
    const spec = hiddenSpec(1);
    const run = await runPipeline(spec, baseOptions(spec), {
      answerer: (s, r) => oracleRecording(s, r, { roles: true }),
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) throw new Error('the extractor refused the rendering');
    const roleRefused = run.result.refusals.some((refusal) => /unknown key role/.test(refusal.reason));
    expect(roleRefused).toBe(!contractStatesRole());
    if (contractStatesRole()) {
      const declared = new Map(truthOf(spec).roles.map((entry) => [entry.dimension, entry.role]));
      for (const [id, role] of declared)
        expect(run.result.proposal.dimensions.find((dimension) => dimension.id === id)?.role).toBe(role);
    }
  });
});
