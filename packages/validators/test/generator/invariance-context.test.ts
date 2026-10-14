import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { blockOutcome, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { BASE_PATHS } from '../../src/ladders/generator/bank2';
import { createFollower, defaultInput, defaultValue } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, type Generation, runContext } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

const hidden = hiddenSpec(1);
const tool = required(hidden.tools.find((tool) => tool.role === 'read'));
const flag = required(tool.output.find((field) => field.type === 'boolean'));
const input = required(
  hidden.data.find(
    (value) => value.tool === tool.name && value.direction === 'in' && value.partition === 'at-minimum',
  ),
);
const phrase = required(
  hidden.phrases.find((phrase) => phrase.intent.kind === 'data' && phrase.intent.value === input.id),
);

function specimen(path: string, id: string, persona: string, channel: string, output: boolean): LoadedSpec {
  const result = validateSpec({
    id,
    title: `Path ${path} of request: output evidence`,
    kind: 'conversation',
    channel,
    tags: [`persona:${persona}`],
    given: {
      world: {
        tools: {
          [tool.name]: {
            result: Object.fromEntries(
              tool.output.map((field) => [
                field.name,
                field.name === flag.name ? output : defaultValue(field),
              ]),
            ),
          },
        },
      },
    },
    blocks: [
      {
        id: 'value',
        when: { user: phrase.text },
        expect: {
          stage: hidden.start,
          tools: [{ label: tool.name, count: 1, input: defaultInput(tool) }],
          must: [`${flag.name} is ${output}`],
        },
      },
    ],
    metadata: {
      generated: {
        cell: {
          [`${tool.name}.in.${required(tool.input[1]).name}`]: input.id,
          [`${tool.name}.out.${flag.name}`]: String(output),
        },
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return {
    ok: true,
    warnings: [],
    path: `complete/${id}.yaml`,
    spec: result.spec,
    hash: contentHash(result.spec),
  };
}

async function verdict(path: string, axis: string, complete: LoadedSpec[]) {
  const data = new SeedData(1, {}, async () => {
    throw new Error('scale not requested');
  });
  const generation: Generation = {
    hidden,
    generatorSeed: 1,
    first: new Map(),
    second: new Map(),
    loaded: complete,
    complete,
  };
  await data.memoized('generated', async () => generation);
  const item = bankItems().find((item) => item.id === `invariance.${path}.${axis}`);
  if (!item) throw new Error('missing item');
  return item.check(data);
}

describe('invariance holds tool outputs fixed', () => {
  for (const path of BASE_PATHS)
    for (const axis of ['persona', 'channel']) {
      it(`${path} ${axis}: correct outputs pass, a context-dependent expectation mutant fails, restore passes`, async () => {
        const reference = [
          specimen(path, 'a', 'visitor', 'web', true),
          specimen(
            path,
            'b',
            axis === 'persona' ? 'member' : 'visitor',
            axis === 'channel' ? 'messaging' : 'web',
            true,
          ),
          specimen(path, 'c', 'visitor', 'web', false),
        ];
        for (const { spec } of reference) {
          const run = await runOnce(spec, followerAdapter(createFollower(hidden)), 1, runContext());
          expect(blockOutcome(run, 0)).toBe('pass');
        }
        expect((await verdict(path, axis, reference)).pass).toBe(true);
        const mutant = structuredClone(reference);
        required(required(required(mutant[1]).spec.blocks[0]).expect).must = [`${flag.name} is false`];
        expect((await verdict(path, axis, mutant)).pass).toBe(false);
        expect((await verdict(path, axis, reference)).pass).toBe(true);
        // Varying outputs alone is not evidence of a persona/channel invariant pair.
        expect((await verdict(path, axis, [required(reference[0]), required(reference[2])])).pass).toBe(
          false,
        );
      });
    }
});
