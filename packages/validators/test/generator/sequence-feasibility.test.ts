import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { blockOutcome, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { createFollower, defaultInput } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, type Generation, runContext } from '../../src/ladders/generator/measure';

const hidden = hiddenSpec(1);
const tool = hidden.tools.find((tool) => tool.role === 'read');
if (!tool) throw new Error('missing read tool');
const readTool = tool;
const move = (from: string, to: string) => {
  const phrase = hidden.phrases.find(
    (phrase) => phrase.intent.kind === 'transition' && phrase.intent.edge === `${from}-to-${to}`,
  );
  if (!phrase) throw new Error('missing move');
  return phrase.text.replace(/\{[^}]+\}/g, String(Object.values(defaultInput(readTool))[0]));
};
const parsed = validateSpec({
  id: 'read-failure',
  kind: 'conversation',
  stages: hidden.stages.map((stage) => stage.id),
  blocks: [
    { id: 'start', when: { user: move(hidden.start, hidden.goal) }, expect: { stage: hidden.goal } },
    {
      id: 'failure',
      given: { world: { tools: { [readTool.name]: { error: 'unavailable' } } } },
      when: { injection: { class: 'D8_tool_failure', user: move(hidden.goal, 'check') } },
      expect: {
        stage: hidden.goal,
        tools: [{ label: readTool.name, count: 2, input: defaultInput(readTool) }],
        must: ['not answering'],
      },
    },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const complete: LoadedSpec[] = [
  {
    ok: true,
    path: 'complete/read-failure.yaml',
    hash: contentHash(parsed.spec),
    warnings: [],
    spec: parsed.spec,
  },
];
const loop = structuredClone(parsed.spec);
loop.id = 'read-failure-loop';
const success = loop.blocks[1];
if (!success) throw new Error('missing read block');
const failure = structuredClone(success);
failure.id = 'loop-failure';
failure.when = { injection: { class: 'D8_tool_failure', user: move('check', 'check') } };
failure.expect = { ...failure.expect, stage: 'check' };
success.given = undefined;
success.when = { user: move(hidden.goal, 'check') };
success.expect = {
  stage: 'check',
  tools: [{ label: readTool.name, count: 1, input: parsed.spec.blocks[1]?.expect?.tools?.[0]?.input }],
};
loop.blocks.push(failure);
complete.push({
  ok: true,
  path: 'complete/read-failure-loop.yaml',
  hash: contentHash(loop),
  warnings: [],
  spec: loop,
});

async function verdict(specs: LoadedSpec[]) {
  const data = new SeedData(1, {}, async () => {
    throw new Error('scale not requested');
  });
  const generated: Generation = {
    hidden,
    generatorSeed: 1,
    first: new Map(),
    second: new Map(),
    loaded: specs,
    complete: specs,
  };
  await data.memoized('generated', async () => generated);
  const item = bankItems().find((item) => item.id === 'sequence.stages.D8_tool_failure');
  if (!item) throw new Error('missing item');
  return item.check(data);
}

describe('failure stage feasibility', () => {
  it('requires every feasible stage, not stages where the specified tool cannot fail', async () => {
    for (const { spec } of complete) {
      const run = await runOnce(spec, followerAdapter(createFollower(hidden)), 1, runContext());
      expect(run.blocks.map((_, index) => blockOutcome(run, index))).toEqual(spec.blocks.map(() => 'pass'));
    }
    const result = await verdict(complete);
    expect(result.pass, result.detail).toBe(true);
  });
  it('rejects a product-output mutant omitting the feasible failure probe, then passes restored output', async () => {
    const mutant = structuredClone(complete).slice(0, 1);
    expect((await verdict(mutant)).pass).toBe(false);
    expect((await verdict(complete)).pass).toBe(true);
  });
});
