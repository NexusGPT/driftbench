import type { LoadedSpec } from '@driftbench/core';
import { coverage, type SpaceCoverage } from '@driftbench/space';
import { wilson } from '@driftbench/stats';
import { showNumber } from '../../format';
import { defineLadder, type Item, type Ladder, type Measure } from '../../ladder';
import { baselineSuite } from './baseline';
import { CHEATERS } from './cheaters';
import { plantedClasses } from './faults';
import {
  type BlockRun,
  type FaultRecord,
  type Generation,
  type GeneratorParts,
  generation,
  REFERENCE_REPEATS,
  type Runs,
  runAll,
} from './measure';
import { hiddenInventory, hiddenSpaceMap } from './render';

export { baselineObjects, baselineSpecs, baselineSuite } from './baseline';
export {
  CHEATERS,
  type Cheater,
  cheaterAdapter,
  givenValues,
  type ReplayCall,
  replayCalls,
} from './cheaters';
export { DRIFT_CLASSES, faultFamily, type HiddenFault, plantedClasses } from './faults';
export {
  createFollower,
  defaultInput,
  FOREIGN_REPLY,
  type Mutation,
  type MutationContext,
  userTurn,
} from './follower';
export * from './hidden';
export {
  type BlockRun,
  type FaultRecord,
  type Generation,
  type GeneratorParts,
  generation,
  REFERENCE_REPEATS,
  type Runs,
  runAll,
} from './measure';
export * from './render';

/**
 * The generator validator (docs/validators.md section 3): do generated tests catch what they claim? From a
 * hidden specification drawn by the seed, code writes the approved map, the rule follower, the fault family,
 * the cheaters and the hand-written baseline; the real generator runs on the map and its complete specs run
 * through the real runner and checks on all of them. Seven levels, each one ratio with named items.
 */

/** The thresholds of the seven levels (docs/validators.md section 3). */
export const GENERATOR_THRESHOLDS = {
  generate: 1,
  cheaters: 0.8,
  reference: 0.95,
  classes: 1,
  mutation: 0.9,
  coverage: 1,
  stability: 1,
} as const;

/** The fixed table from what an item names to the one component it points at. */
export const GENERATOR_COMPONENTS = {
  loader: 'packages/generate/src/enumerate/load.ts',
  assemble: 'packages/generate/src/seed/assemble.ts#renderDraft',
  random: 'packages/generate/src/seed/random.ts',
  values: 'packages/generate/src/seed/values.ts#inputAssertion',
  graph: 'packages/generate/src/seed/seeders.ts#graphSeeder',
  edgeBlock: 'packages/generate/src/seed/seeders.ts#edgeBlock',
  twise: 'packages/generate/src/seed/seeders.ts#twiseSeeder',
  boundary: 'packages/generate/src/seed/seeders.ts#boundarySeeder',
  deviation: 'packages/generate/src/seed/seeders.ts#probeDraft',
  metamorphic: 'packages/generate/src/seed/seeders.ts#metamorphicSeeder',
  carrier: 'packages/generate/src/seed/seeders.ts#carrierDraft',
  addDeviation: 'packages/generate/src/seed/seeders.ts#addDeviation',
  detours: 'packages/generate/src/seed/deviation.ts#DETOURS',
  deviationSeeder: 'packages/generate/src/seed/seeders.ts#deviationSeeder',
  map: 'packages/validators/src/ladders/generator/render.ts',
  runner: 'packages/core/src/runner/run.ts',
} as const;

/** The component a block's Then comes from, by the seeder that wrote it. */
const SEEDER_COMPONENT: Record<string, string> = {
  graph: GENERATOR_COMPONENTS.graph,
  twise: GENERATOR_COMPONENTS.carrier,
  boundary: GENERATOR_COMPONENTS.boundary,
  deviation: GENERATOR_COMPONENTS.deviation,
  metamorphic: GENERATOR_COMPONENTS.metamorphic,
};

/** The component that should give a block the check that kills each class. */
export const CLASS_COMPONENT: Record<string, string> = {
  X1_local: GENERATOR_COMPONENTS.values,
  X2_contradiction: GENERATOR_COMPONENTS.assemble,
  X3_flow: GENERATOR_COMPONENTS.graph,
  X4_format: GENERATOR_COMPONENTS.addDeviation,
  X5_tool: GENERATOR_COMPONENTS.boundary,
  D1_off_topic: GENERATOR_COMPONENTS.deviation,
  D2_goal_shift: GENERATOR_COMPONENTS.detours,
  D3_contradiction: GENERATOR_COMPONENTS.deviation,
  D4_loose_confirmation: GENERATOR_COMPONENTS.deviation,
  D5_language_switch: GENERATOR_COMPONENTS.addDeviation,
  D6_instruction_in_data: GENERATOR_COMPONENTS.deviation,
  D7_silence_or_burst: GENERATOR_COMPONENTS.addDeviation,
  D8_tool_failure: GENERATOR_COMPONENTS.addDeviation,
  D9_out_of_scope: GENERATOR_COMPONENTS.deviation,
  D10_return: GENERATOR_COMPONENTS.deviation,
};

/** The component of an axis the generated suite covers less than the baseline. */
const AXIS_COMPONENT: Record<string, string> = {
  behaviour: GENERATOR_COMPONENTS.twise,
  deviation: GENERATOR_COMPONENTS.deviationSeeder,
  channel: GENERATOR_COMPONENTS.twise,
  stage: GENERATOR_COMPONENTS.graph,
  user_type: GENERATOR_COMPONENTS.twise,
};

/** The blocks every level after the first scores: blocks of complete specs whose Then a machine decides. */
export function machineBlocks(runs: Runs): BlockRun[] {
  return runs.blocks.filter((block) => block.fields.length > 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

function empty(level: string): Item {
  return {
    id: `${level}:empty`,
    component: GENERATOR_COMPONENTS.assemble,
    detail: 'no complete block with a machine Then was generated, so nothing can be scored',
  };
}

/** Level 1: every generated spec loads, lints clean, and the second run writes the same bytes. */
export function generateLevel(generated: Generation): Measure {
  if (generated.refused) {
    return {
      value: 0,
      items: [
        {
          id: `map:${generated.refused.code}`,
          component: GENERATOR_COMPONENTS.loader,
          detail: `the generator refused the hidden map: ${generated.refused.message}${generated.refused.issues.length > 0 ? `; ${generated.refused.issues.slice(0, 5).join('; ')}` : ''}`,
        },
      ],
    };
  }
  const items: Item[] = [];
  const bad = new Set<string>();
  for (const result of generated.loaded) {
    if (!result.ok) {
      bad.add(result.path);
      items.push({
        id: `invalid:${result.path}`,
        component: GENERATOR_COMPONENTS.assemble,
        detail: `the core loader refuses it: ${result.errors.map((issue) => `${issue.path} ${issue.code} ${issue.message}`).join('; ')}`,
      });
      continue;
    }
    const complete = result.path.startsWith('specs/');
    const unexpected = result.warnings.filter(
      (warning) =>
        complete ||
        !(
          warning.code === 'CRITERION_UNRESOLVED' &&
          /needs-(approved-phrase|derivable-then)/.test(warning.message)
        ),
    );
    if (unexpected.length > 0) {
      bad.add(result.path);
      items.push({
        id: `lint:${result.path}`,
        component: GENERATOR_COMPONENTS.assemble,
        detail: `lint warns: ${unexpected.map((warning) => `${warning.path} ${warning.code} ${warning.message}`).join('; ')}`,
      });
    }
  }
  const specPaths = [...generated.first.keys()].filter((path) => /\.ya?ml$/.test(path));
  const paths = new Set([...generated.first.keys(), ...generated.second.keys()]);
  for (const path of [...paths].sort()) {
    const a = generated.first.get(path);
    const b = generated.second.get(path);
    if (a === b) continue;
    bad.add(path);
    items.push({
      id: `bytes:${path}`,
      component: GENERATOR_COMPONENTS.random,
      detail:
        a === undefined || b === undefined
          ? `written by ${a === undefined ? 'the second' : 'the first'} run only, on the same map and seed`
          : `the two runs on the same map and seed differ from character ${[...a].findIndex((char, index) => char !== b[index])}`,
    });
  }
  for (const entry of generated.report?.invalid ?? []) {
    items.push({
      id: `report-invalid:${entry.id}`,
      component: GENERATOR_COMPONENTS.assemble,
      detail: `the generator refused its own spec, so it was never written: ${entry.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
    });
  }
  const total = specPaths.length + (generated.report?.invalid.length ?? 0);
  const good = specPaths.filter((path) => !bad.has(path)).length;
  if (total === 0) {
    return {
      value: Number.NaN,
      items: [
        ...items,
        {
          id: 'generate:empty',
          component: GENERATOR_COMPONENTS.assemble,
          detail: 'the generator wrote no spec',
        },
      ],
    };
  }
  return { value: good / total, items };
}

/** Level 2: blocks with a machine Then that no cheater passes. */
export function cheaterLevel(runs: Runs): Measure {
  const blocks = machineBlocks(runs);
  if (blocks.length === 0) return { value: Number.NaN, items: [empty('cheaters')] };
  const items: Item[] = [];
  for (const block of blocks) {
    const passed = CHEATERS.filter((name) => block.cheaters[name]?.outcome === 'pass');
    if (passed.length === 0) continue;
    items.push({
      id: block.key,
      component: SEEDER_COMPONENT[block.seeder] ?? GENERATOR_COMPONENTS.assemble,
      detail: passed
        .map(
          (name) => `passed by ${name} through ${block.cheaters[name]?.passing.join(', ') || 'no verdict'}`,
        )
        .concat(`its Then reads ${block.fields.join(', ')}`)
        .join('; '),
    });
  }
  return { value: ratio(blocks.length - items.length, blocks.length), items };
}

/** Level 3: blocks the rule follower passes. A block it fails is a wrong expectation. */
export function referenceLevel(runs: Runs, generated: Generation): Measure {
  const blocks = machineBlocks(runs);
  if (blocks.length === 0) return { value: Number.NaN, items: [empty('reference')] };
  const specs = new Map(generated.complete.map((loaded) => [loaded.spec.id, loaded.spec]));
  const items: Item[] = [];
  for (const block of blocks) {
    if (block.reference[0] === 'pass') continue;
    const spec = specs.get(block.spec);
    const record = (
      spec?.metadata?.generated as
        | { blocks?: Array<{ block?: string; cell?: unknown; phrase?: unknown }> }
        | undefined
    )?.blocks?.find((entry) => entry.block === spec?.blocks[block.index]?.id);
    const input = block.referenceFailing.some((line) => line.includes('.input.'));
    // A move block (`b<n>-<from>-to-<to>`) gets its stage from edgeBlock, whichever seeder walked it.
    const move = /^b\d+-.+-to-/.test(spec?.blocks[block.index]?.id ?? '');
    const stage = block.referenceFailing.some((line) => line.startsWith('stage.'));
    items.push({
      id: block.key,
      component: input
        ? GENERATOR_COMPONENTS.values
        : move && stage
          ? GENERATOR_COMPONENTS.edgeBlock
          : (SEEDER_COMPONENT[block.seeder] ?? GENERATOR_COMPONENTS.assemble),
      detail: `${block.reference[0] === 'fail' ? `the follower fails it: ${block.referenceFailing.join('; ')}` : 'no machine verdict decided it on the follower'}; the follower did: ${block.referenceTrace}; the map entry: ${JSON.stringify({ cell: record?.cell, phrase: record?.phrase })}`,
    });
  }
  return { value: ratio(blocks.length - items.length, blocks.length), items };
}

/** A fault is killed by a block green on the follower and red on the fault. */
export function killed(record: FaultRecord, blocks: readonly BlockRun[]): BlockRun | undefined {
  return blocks.find(
    (block) => block.reference[0] === 'pass' && block.faults[record.fault.def.id]?.outcome === 'fail',
  );
}

/** The block nearest to catching a fault: one that carries its class, else reads a field it changes, in a spec it changed. */
export function nearestBlock(record: FaultRecord, blocks: readonly BlockRun[]): BlockRun | undefined {
  const changed = new Set(record.changedOn);
  const candidates = blocks.filter((block) => changed.has(block.spec));
  return (
    candidates.find((block) => block.deviation === record.fault.class) ??
    candidates.find((block) => block.fields.some((field) => record.fault.def.affects.includes(field))) ??
    candidates[0]
  );
}

export type ClassScore = {
  class: string;
  planted: number;
  scored: number;
  killed: number;
  equivalent: string[];
  survivors: FaultRecord[];
  interval?: { estimate: number; low: number; high: number };
};

/** Per planted class: faults planted, scored (not equivalent), killed, with the Wilson 95% interval. */
export function classScores(generated: Generation, runs: Runs): ClassScore[] {
  const blocks = machineBlocks(runs);
  // The classes planted in this run, in the family's order: every drift class and each deviation class the
  // hidden specification holds, unless a test planted a narrower family.
  const planted = new Set(runs.faults.map((record) => record.fault.class));
  const classes = plantedClasses(generated.hidden).filter((cls) => planted.has(cls));
  return classes.map((cls) => {
    const members = runs.faults.filter((record) => record.fault.class === cls);
    const scored = members.filter((record) => record.changedOn.length > 0);
    const kills = scored.filter((record) => killed(record, blocks) !== undefined);
    const bounds = scored.length > 0 ? wilson(kills.length, scored.length) : undefined;
    return {
      class: cls,
      planted: members.length,
      scored: scored.length,
      killed: kills.length,
      equivalent: members
        .filter((record) => record.changedOn.length === 0)
        .map((record) => record.fault.def.id),
      survivors: scored.filter((record) => !kills.includes(record)),
      ...(bounds
        ? { interval: { estimate: kills.length / scored.length, low: bounds.lower, high: bounds.upper } }
        : {}),
    };
  });
}

function survivorDetail(record: FaultRecord, blocks: readonly BlockRun[]): string {
  const near = nearestBlock(record, blocks);
  const where = near
    ? `the nearest block ${near.key} reads ${near.fields.join(', ') || 'nothing a machine checks'}${near.deviation ? ` and carries ${near.deviation}` : ''}`
    : 'no complete block with a machine Then is in a spec it changed';
  return `${record.fault.def.id}: ${record.fault.def.description} It breaks "${record.fault.rule}". It changed ${record.changedOn.length} spec(s); ${where}; it lacks ${record.fault.needs}`;
}

/** Level 4: every planted class has a fault some block kills. */
export function classLevel(generated: Generation, runs: Runs): Measure {
  const blocks = machineBlocks(runs);
  const scores = classScores(generated, runs);
  const items: Item[] = [];
  for (const score of scores) {
    if (score.killed > 0) continue;
    const members = runs.faults.filter((record) => record.fault.class === score.class);
    items.push({
      id: score.class,
      component: CLASS_COMPONENT[score.class] ?? GENERATOR_COMPONENTS.assemble,
      detail:
        score.scored === 0
          ? `no fault of the class ever changed what an agent did in a generated spec (${score.equivalent.join(', ')}): the suite never sets up ${score.class}; it lacks ${members[0]?.fault.needs ?? 'a block that reaches it'}`
          : `none of ${score.scored} scored faults is killed. ${score.survivors.map((record) => survivorDetail(record, blocks)).join(' | ')}`,
    });
  }
  return { value: ratio(scores.length - items.length, scores.length), items };
}

/** Level 5: killed over scored faults, the lowest over the classes, at least 0.9 per class. */
export function mutationLevel(generated: Generation, runs: Runs): Measure {
  const blocks = machineBlocks(runs);
  const scores = classScores(generated, runs).filter((score) => score.scored > 0);
  if (scores.length === 0) return { value: Number.NaN, items: [empty('mutation')] };
  const items: Item[] = [];
  let lowest = 1;
  for (const score of scores) {
    const value = score.killed / score.scored;
    lowest = Math.min(lowest, value);
    if (value >= GENERATOR_THRESHOLDS.mutation) continue;
    const bounds = score.interval;
    items.push({
      id: score.class,
      component: CLASS_COMPONENT[score.class] ?? GENERATOR_COMPONENTS.assemble,
      detail: `${score.killed} of ${score.scored} scored faults killed (score ${showNumber(value)}, 95% interval [${showNumber(bounds?.low ?? 0)}, ${showNumber(bounds?.high ?? 1)}]${score.equivalent.length > 0 ? `; equivalent, left out: ${score.equivalent.join(', ')}` : ''}). Survivors: ${score.survivors.map((record) => survivorDetail(record, blocks)).join(' | ')}`,
    });
  }
  return { value: lowest, items };
}

export type AxisCoverage = { axis: string; generated: number; baseline: number; onlyBaseline: string[] };

/** Pairs covered per axis of the hidden cells, by the generated complete specs and by the baseline. */
export function axisCoverage(
  generated: Generation,
  baseline: readonly LoadedSpec[] = baselineSuite(generated.hidden),
): {
  axes: AxisCoverage[];
  required: SpaceCoverage['required'];
} {
  const map = hiddenSpaceMap(generated.hidden);
  const inventory = hiddenInventory(generated.hidden);
  const ours = coverage(map, generated.complete, { t: 2, inventory });
  const theirs = coverage(map, baseline, { t: 2, inventory });
  const coveredPairs = (report: SpaceCoverage, axis: string) =>
    new Set(
      report.grid.cells
        .filter((cell) => cell.count > 0 && axis in cell.values)
        .map((cell) =>
          Object.entries(cell.values)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join(' + '),
        ),
    );
  const axes = map.dimensions.map((dimension) => {
    const mine = coveredPairs(ours, dimension.id);
    const base = coveredPairs(theirs, dimension.id);
    return {
      axis: dimension.id,
      generated: mine.size,
      baseline: base.size,
      onlyBaseline: [...base].filter((pair) => !mine.has(pair)),
    };
  });
  return { axes, required: ours.required };
}

/** Level 6: every axis at or above the hand-written baseline in pairs covered, every required cell covered. */
export function coverageLevel(generated: Generation, baseline?: readonly LoadedSpec[]): Measure {
  const { axes, required } = axisCoverage(generated, baseline);
  const items: Item[] = [];
  for (const axis of axes) {
    if (axis.generated >= axis.baseline) continue;
    items.push({
      id: `axis:${axis.axis}`,
      component: AXIS_COMPONENT[axis.axis] ?? GENERATOR_COMPONENTS.twise,
      detail: `the generated suite covers ${axis.generated} pairs with ${axis.axis}, the hand-written baseline ${axis.baseline}; pairs only the baseline covers: ${axis.onlyBaseline.slice(0, 8).join('; ')}${axis.onlyBaseline.length > 8 ? `; and ${axis.onlyBaseline.length - 8} more` : ''}`,
    });
  }
  for (const cell of required) {
    if (cell.covered) continue;
    const name =
      cell.source === 'inventory'
        ? `${cell.flow}/${cell.deviation}`
        : Object.entries(cell.values)
            .map(([key, value]) => `${key}=${value}`)
            .join('+');
    items.push({
      id: `required:${name}`,
      component: GENERATOR_COMPONENTS.deviationSeeder,
      detail:
        cell.source === 'inventory'
          ? `the inventory requires flow ${cell.flow} perturbed with ${cell.deviation}, and no complete generated spec tags the flow and injects the class`
          : 'a required cell of the map is covered by no complete generated spec',
    });
  }
  return { value: ratio(axes.length + required.length - items.length, axes.length + required.length), items };
}

/** Level 7: pass to the k on the follower, over the blocks green on its first run. */
export function stabilityLevel(runs: Runs): Measure {
  const green = machineBlocks(runs).filter((block) => block.reference[0] === 'pass');
  if (green.length === 0) return { value: Number.NaN, items: [empty('stability')] };
  const items: Item[] = green
    .filter((block) => block.reference.some((outcome) => outcome !== 'pass'))
    .map((block) => ({
      id: block.key,
      component: GENERATOR_COMPONENTS.runner,
      detail: `on ${block.reference.length} repeats of the same deterministic follower: ${block.reference.join(', ')}`,
    }));
  return { value: ratio(green.length - items.length, green.length), items };
}

/**
 * The generator ladder. `parts` replaces a part of the chain (the hidden specification, the renderer, the
 * generator, the follower, the faults, the cheaters, k): tests plant a defect through it. Runs are kept per
 * seed for the levels of one ladder run.
 */
export function generatorLadder(parts: GeneratorParts = {}): Ladder {
  const generations = new Map<number, Promise<Generation>>();
  const allRuns = new Map<number, Promise<Runs>>();
  const generatedFor = (seed: number) => {
    let found = generations.get(seed);
    if (!found) {
      found = generation(seed, parts);
      generations.set(seed, found);
    }
    return found;
  };
  const runsFor = (seed: number) => {
    let found = allRuns.get(seed);
    if (!found) {
      found = generatedFor(seed).then((generated) => runAll(generated, parts));
      allRuns.set(seed, found);
    }
    return found;
  };
  const k = parts.k ?? REFERENCE_REPEATS;
  return defineLadder({
    component: 'generator',
    levels: [
      {
        id: 'generate',
        name: 'generate and lint',
        metric: 'specs that load, lint clean and repeat byte for byte on a second run / specs generated',
        threshold: GENERATOR_THRESHOLDS.generate,
        compute: async ({ seed }) => generateLevel(await generatedFor(seed)),
      },
      {
        id: 'cheaters',
        name: 'cheater resistance',
        metric:
          'complete blocks with a machine Then that no cheater passes / complete blocks with a machine Then',
        threshold: GENERATOR_THRESHOLDS.cheaters,
        compute: async ({ seed }) => cheaterLevel(await runsFor(seed)),
      },
      {
        id: 'reference',
        name: 'green on the reference',
        metric: 'blocks the rule follower passes / complete blocks with a machine Then',
        threshold: GENERATOR_THRESHOLDS.reference,
        compute: async ({ seed }) => referenceLevel(await runsFor(seed), await generatedFor(seed)),
      },
      {
        id: 'classes',
        name: 'every fault class killed',
        metric: 'fault classes some block kills / fault classes planted',
        threshold: GENERATOR_THRESHOLDS.classes,
        compute: async ({ seed }) => classLevel(await generatedFor(seed), await runsFor(seed)),
      },
      {
        id: 'mutation',
        name: 'mutation score',
        metric: 'killed faults / scored faults, the lowest over the classes',
        threshold: GENERATOR_THRESHOLDS.mutation,
        compute: async ({ seed }) => mutationLevel(await generatedFor(seed), await runsFor(seed)),
      },
      {
        id: 'coverage',
        name: 'coverage of the hidden cells',
        metric:
          'axes at or above the hand-written baseline in pairs covered, and required cells covered / axes and required cells',
        threshold: GENERATOR_THRESHOLDS.coverage,
        compute: async ({ seed }) => {
          const generated = await generatedFor(seed);
          return coverageLevel(generated, (parts.baseline ?? baselineSuite)(generated.hidden));
        },
      },
      {
        id: 'stability',
        name: 'stability',
        metric: `blocks that pass all ${k} repeats on the follower / blocks green on its first run`,
        threshold: GENERATOR_THRESHOLDS.stability,
        compute: async ({ seed }) => stabilityLevel(await runsFor(seed)),
      },
    ],
  });
}
