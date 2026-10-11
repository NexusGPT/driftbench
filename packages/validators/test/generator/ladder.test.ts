import { fileURLToPath } from 'node:url';
import { type FaultSession, generateSuite, renderProposal } from '@driftbench/generate';
import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import {
  createFollower,
  faultFamily,
  GENERATOR_COMPONENTS,
  GENERATOR_THRESHOLDS,
  generatorLadder,
  type HiddenSpec,
  hiddenProposal,
  renderMap,
} from '../../src/ladders/generator/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMPONENTS = new Set<string>(Object.values(GENERATOR_COMPONENTS));

const run = (ladder: ReturnType<typeof generatorLadder>, seed = 1) => runLadder(ladder, { seed, root: ROOT });

/** A family narrowed to some classes. */
const only =
  (...classes: string[]) =>
  (spec: HiddenSpec) =>
    faultFamily(spec).filter((fault) => classes.includes(fault.class));

describe('the generator ladder', () => {
  it('has the seven levels of docs/validators.md section 3, with their thresholds', () => {
    const ladder = generatorLadder();
    expect(ladder.component).toBe('generator');
    expect(ladder.levels.map((level) => [level.id, level.threshold])).toEqual([
      ['generate', 1],
      ['cheaters', 0.8],
      ['reference', 0.95],
      ['classes', 1],
      ['mutation', 0.9],
      ['coverage', 1],
      ['stability', 1],
    ]);
    expect(GENERATOR_THRESHOLDS.mutation).toBe(0.9);
  });

  it('reaches level 1 on the current code and names the blocks a cheater passes at level 2', async () => {
    const result = await run(generatorLadder());
    expect(result.rows[0]).toMatchObject({ pass: true, observed: 1, itemCount: 0 });
    expect(result.level).toBe(1);
    expect(result.failing?.id).toBe('cheaters');
    expect(result.rows.slice(2).every((row) => row.pass === null)).toBe(true);
    const items = result.failing?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id).toMatch(/^gen-[a-z]+-\d{3}(-\d+)?#b\d+-/);
      expect(COMPONENTS.has(item.component), item.component).toBe(true);
      expect(item.detail).toMatch(/^passed by (constant|echo|copy-given|every-tool|replay-suite) through /);
    }
  });

  it('fails level 1 when two runs on the same map and seed differ, naming the file', async () => {
    let calls = 0;
    const result = await run(
      generatorLadder({
        generate: (prepared, options) => {
          const out = generateSuite(prepared, options);
          calls += 1;
          const [first, ...rest] = out.files;
          return first
            ? { ...out, files: [{ ...first, text: `${first.text}# run ${calls}\n` }, ...rest] }
            : out;
        },
      }),
    );
    expect(result.level).toBe(0);
    expect(result.failing?.items.map((item) => [item.id.split(':')[0], item.component])).toEqual([
      ['bytes', GENERATOR_COMPONENTS.random],
    ]);
  });

  it('fails level 1 when the generator writes a spec the core loader refuses', async () => {
    const result = await run(
      generatorLadder({
        generate: (prepared, options) => {
          const out = generateSuite(prepared, options);
          const at = out.files.findIndex((file) => file.path.startsWith('specs/graph/'));
          const files = out.files.map((file, index) =>
            index === at
              ? { ...file, text: file.text.replace(/^kind: conversation$/m, 'kind: chatter') }
              : file,
          );
          return { ...out, files };
        },
      }),
    );
    expect(result.level).toBe(0);
    expect(result.failing?.items.some((item) => item.id.startsWith('invalid:specs/graph/'))).toBe(true);
  });

  it('fails level 1 with one item when the generator refuses the map', async () => {
    const result = await run(
      generatorLadder({
        render: (spec) => {
          const files = renderMap(spec);
          return { ...files, prompt: files.prompt.replace(/- opening:/, '- start:') };
        },
      }),
    );
    expect(result.level).toBe(0);
    expect(result.failing?.items).toHaveLength(1);
    expect(result.failing?.items[0]).toMatchObject({
      id: 'map:MAP_INVALID',
      component: GENERATOR_COMPONENTS.loader,
    });
  });

  it('fails level 3 with the follower trace when the reference skips a stage', async () => {
    const skipping = (spec: HiddenSpec): (() => FaultSession) => {
      const fault = faultFamily(spec).find((entry) => entry.class === 'X3_flow' && entry.rate === 1);
      if (fault?.def.agent.kind !== 'function') throw new Error('no X3 fault');
      return fault.def.agent.create;
    };
    const result = await run(generatorLadder({ cheaters: [], follower: skipping }));
    expect(result.rows[1]).toMatchObject({ pass: true, observed: 1 });
    expect(result.failing?.id).toBe('reference');
    const item = result.failing?.items.find((entry) => entry.detail.includes('stage.reached'));
    expect(item?.detail).toMatch(/the follower fails it: stage\.reached: reached \w+, expected \w+/);
    expect(item?.component).toBe(GENERATOR_COMPONENTS.edgeBlock);
    expect(item?.detail).toMatch(/the follower did: stage \w+; calls /);
    expect(item?.detail).toMatch(/the map entry: \{"cell":/);
  });

  it('fails level 4 on a class no block kills, naming the rule, the nearest block and the check it lacks', async () => {
    const result = await run(generatorLadder({ cheaters: [], faults: only('X2_contradiction', 'X3_flow') }));
    expect(result.failing?.id).toBe('classes');
    expect(result.rows[3]?.observed).toBe(0.5);
    expect(result.failing?.items).toHaveLength(1);
    const item = result.failing?.items[0];
    expect(item).toMatchObject({ id: 'X2_contradiction', component: GENERATOR_COMPONENTS.assemble });
    expect(item?.detail).toMatch(/It breaks "Facts come only from tool results\."/);
    expect(item?.detail).toMatch(/the nearest block gen-[\w-]+#[\w-]+ reads /);
    expect(item?.detail).toMatch(/it lacks a must or must_not on the tool answer the reply states/);
  });

  it('fails level 5 on a class whose every-second-time fault survives, with the interval', async () => {
    const result = await run(generatorLadder({ cheaters: [], faults: only('X3_flow', 'X5_tool') }));
    expect(result.failing?.id).toBe('mutation');
    const item = result.failing?.items.find((entry) => entry.id === 'X5_tool');
    expect(item?.component).toBe(GENERATOR_COMPONENTS.boundary);
    expect(item?.detail).toMatch(
      /^\d of 3 scored faults killed \(score [\d.]+, 95% interval \[[\d.]+, [\d.]+\]/,
    );
    expect(item?.detail).toMatch(/Survivors: x5-any-r2: /);
  });

  it('reaches level 7 when every planted class dies and the baseline is empty, and fails level 6 against the hand-written baseline', async () => {
    const full = await run(
      generatorLadder({ cheaters: [], faults: only('X3_flow', 'X4_format'), baseline: () => [] }),
    );
    expect(full.rows.map((row) => row.pass)).toEqual([true, true, true, true, true, true, true]);
    expect(full.level).toBe(7);
    const against = await run(generatorLadder({ cheaters: [], faults: only('X3_flow', 'X4_format') }));
    expect(against.failing?.id).toBe('coverage');
    for (const item of against.failing?.items ?? []) {
      expect(item.id).toMatch(/^(axis|required):/);
      expect(COMPONENTS.has(item.component)).toBe(true);
    }
  });

  it('fails level 6 when the map the generator reads has lost an axis', async () => {
    const withoutPersonas = (spec: HiddenSpec) => {
      const proposal = hiddenProposal(spec);
      return {
        ...renderMap(spec),
        map: renderProposal({
          ...proposal,
          dimensions: proposal.dimensions.filter((dimension) => dimension.id !== 'user_type'),
          constraints: proposal.constraints.filter((constraint) => !('user_type' in constraint.forbid)),
          phrases: proposal.phrases.filter((phrase) => phrase.dimension !== 'user_type'),
        }),
      };
    };
    const result = await run(
      generatorLadder({ cheaters: [], faults: only('X3_flow', 'X4_format'), render: withoutPersonas }),
    );
    expect(result.failing?.id).toBe('coverage');
    const item = result.failing?.items.find((entry) => entry.id === 'axis:user_type');
    expect(item?.detail).toMatch(
      /^the generated suite covers 0 pairs with user_type, the hand-written baseline [1-9]/,
    );
  });

  it('fails level 7 when the reference flips between repeats', async () => {
    const flaky = (spec: HiddenSpec): (() => FaultSession) => {
      const clean = createFollower(spec);
      const broken = faultFamily(spec).find((entry) => entry.class === 'X3_flow' && entry.rate === 1);
      if (broken?.def.agent.kind !== 'function') throw new Error('no X3 fault');
      const wrong = broken.def.agent.create;
      let sessions = 0;
      // Five repeats per spec: the third repeat of every spec runs the skipping agent.
      return () => {
        sessions += 1;
        return sessions % 5 === 3 ? wrong() : clean();
      };
    };
    const result = await run(
      generatorLadder({
        cheaters: [],
        faults: only('X3_flow', 'X4_format'),
        baseline: () => [],
        follower: flaky,
      }),
    );
    expect(result.level).toBe(6);
    expect(result.failing?.id).toBe('stability');
    expect(result.failing?.items[0]).toMatchObject({ component: GENERATOR_COMPONENTS.runner });
    expect(result.failing?.items[0]?.detail).toMatch(/: pass, pass, fail, pass, pass$/);
  });
});
