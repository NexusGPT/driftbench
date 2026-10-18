import type { LoadResult } from '@agent-nexus/driftbench-core';
import { compileSpace, placeSpec, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { at, map, spec } from './support';

const values = (...ids: string[]) => ids.map((id) => ({ id, title: id }));

/** Every kind once; stage, channel, persona and task list none, behaviour and data do not. */
const ALL = map({
  version: '1',
  agent: 'all',
  dimensions: [
    { id: 'stage', title: 'Stage', kind: 'stage', values: values('none', 's1', 's2', 's3') },
    {
      id: 'deviation',
      title: 'Deviation',
      kind: 'deviation',
      values: values('none', 'D1_off_topic', 'D8_tool_failure'),
    },
    { id: 'behaviour', title: 'Behaviour', kind: 'behaviour', values: values('B-001', 'B-002') },
    { id: 'channel', title: 'Channel', kind: 'channel', values: values('none', 'chat') },
    { id: 'persona', title: 'Persona', kind: 'persona', values: values('none', 'terse') },
    { id: 'data', title: 'Data', kind: 'data', values: values('fiber', 'no-fiber') },
    { id: 'task', title: 'Task size', kind: 'task', values: values('none', 'small') },
  ],
  constraints: [],
  prior: { kind: 'declared' },
});

/** The events of a spec, each value index read back as its id, by dimension id. */
function place(result: LoadResult, space: SpaceMap = ALL) {
  if (!result.ok) throw new Error('expected a valid spec');
  const compiled = compileSpace(space);
  const placement = placeSpec(compiled, result.spec);
  const events = placement.events.map((event) => {
    const out: Record<string, string | string[]> = { path: event.path };
    compiled.dimensions.forEach((dimension, index) => {
      out[dimension.id] = (event.values[index] ?? []).map((value) => dimension.values[value]?.id ?? '?');
    });
    return out;
  });
  return { events, unknown: placement.unknown };
}

const injection = (deviation: string, stage: string) => ({
  when: { injection: { class: deviation, user: 'by the way' } },
  expect: { stage },
});

describe('placement by stage and deviation, per event', () => {
  it('places a block on its expect.stage, with no deviation', () => {
    const { events } = place(spec({ id: 'plain', blocks: [at('s1'), at('s2')] }));
    expect(events.map(({ path, stage, deviation }) => ({ path, stage, deviation }))).toEqual([
      { path: 'blocks.0', stage: ['s1'], deviation: ['none'] },
      { path: 'blocks.1', stage: ['s2'], deviation: ['none'] },
    ]);
  });

  it('places an injection block on the stage reached when it arrives, not on the stage after it', () => {
    const { events } = place(spec({ id: 'aside', blocks: [at('s1'), injection('D1_off_topic', 's2')] }));
    expect(events[1]).toMatchObject({ path: 'blocks.1', stage: ['s1'], deviation: ['D1_off_topic'] });
  });

  it('places an injection in the first block on its own stage', () => {
    const { events } = place(spec({ id: 'first', blocks: [injection('D1_off_topic', 's2')] }));
    expect(events[0]).toMatchObject({ stage: ['s2'], deviation: ['D1_off_topic'] });
  });

  it('places a perturbation on the stage of the nearest earlier block that declares one', () => {
    const { events } = place(
      spec({
        id: 'failure',
        blocks: [at('s1'), { user: 'no stage here', expect: { must: ['ok'] } }, at('s3')],
        perturbations: [
          {
            id: 'down',
            class: 'D8_tool_failure',
            inject_at: 2,
            world: { tools: { lookup: { error: 'down' } } },
            expect: { stage: 's3' },
          },
        ],
      }),
    );
    expect(events.map(({ path, stage }) => [path, stage])).toEqual([
      ['blocks.0', ['s1']],
      ['blocks.1', ['none']],
      ['blocks.2', ['s3']],
      ['perturbations.0', ['s1']],
    ]);
    expect(events[3]?.deviation).toEqual(['D8_tool_failure']);
  });

  it('places a perturbation before the first block on its expect.stage, else its recovery.stage_after', () => {
    const { events } = place(
      spec({
        id: 'early',
        blocks: [at('s1')],
        perturbations: [
          { id: 'one', class: 'D1_off_topic', inject_at: 0, user: 'hi?', expect: { stage: 's3' } },
          {
            id: 'two',
            class: 'D1_off_topic',
            inject_at: 0,
            user: 'hi?',
            recovery: { within_blocks: 0, stage_after: 's2' },
          },
        ],
      }),
    );
    expect(events.slice(1).map(({ stage }) => stage)).toEqual([['s3'], ['s2']]);
  });

  it('places nowhere on a dimension without none when nothing is named', () => {
    const noNone = map({
      ...ALL,
      dimensions: [{ id: 'stage', title: 'Stage', kind: 'stage', values: values('s1') }],
    });
    const { events } = place(
      spec({ id: 'silent', blocks: [{ user: 'hi', expect: { must: ['x'] } }] }),
      noNone,
    );
    expect(events).toEqual([{ path: 'blocks.0', stage: [] }]);
  });
});

describe('placement by spec fields, for every event', () => {
  it('reads behaviours from covers, the channel, and the persona, data and task tags', () => {
    const { events, unknown } = place(
      spec({
        id: 'tagged',
        covers: ['B-001', 'B-002'],
        channel: 'chat',
        tags: ['flow:new-home', 'persona:terse', 'data:fiber', 'data:no-fiber', 'task:small'],
        blocks: [at('s1'), at('s2')],
      }),
    );
    expect(unknown).toEqual([]);
    for (const event of events) {
      expect(event).toMatchObject({
        behaviour: ['B-001', 'B-002'],
        channel: ['chat'],
        persona: ['terse'],
        data: ['fiber', 'no-fiber'],
        task: ['small'],
      });
    }
  });

  it('falls on none where the map lists it when the spec names nothing', () => {
    const { events } = place(spec({ id: 'bare', blocks: [at('s1')] }));
    expect(events[0]).toEqual({
      path: 'blocks.0',
      stage: ['s1'],
      deviation: ['none'],
      behaviour: [],
      channel: ['none'],
      persona: ['none'],
      data: [],
      task: ['none'],
    });
  });

  it('reports a value the map does not list and keeps the spec or event off none', () => {
    const { events, unknown } = place(
      spec({
        id: 'strays',
        covers: ['B-099'],
        channel: 'whatsapp',
        tags: ['persona:angry'],
        blocks: [at('s9')],
        perturbations: [{ id: 'billing', class: 'D9_out_of_scope', inject_at: 1, user: 'my bill is wrong' }],
      }),
    );
    expect(unknown).toEqual([
      { kind: 'behaviour', value: 'B-099', path: 'covers.0' },
      { kind: 'channel', value: 'whatsapp', path: 'channel' },
      { kind: 'persona', value: 'angry', path: 'tags.0' },
      { kind: 'stage', value: 's9', path: 'blocks.0.stage' },
      { kind: 'stage', value: 's9', path: 'perturbations.0.stage' },
      { kind: 'deviation', value: 'D9_out_of_scope', path: 'perturbations.0.class' },
    ]);
    expect(events[0]).toMatchObject({
      stage: [],
      deviation: ['none'],
      channel: [],
      persona: [],
      task: ['none'],
    });
    expect(events[1]).toMatchObject({ path: 'perturbations.0', stage: [], deviation: [] });
  });

  it('reports nothing on a kind the map does not model', () => {
    const stagesOnly = map({
      ...ALL,
      dimensions: [{ id: 'stage', title: 'Stage', kind: 'stage', values: values('s1') }],
    });
    const { unknown } = place(
      spec({ id: 'other', channel: 'email', tags: ['persona:angry'], covers: ['B-099'], blocks: [at('s1')] }),
      stagesOnly,
    );
    expect(unknown).toEqual([]);
  });
});
