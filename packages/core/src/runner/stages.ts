import { machineVerdict } from '../contracts/check';
import type { BlockResult, Observed, Verdict } from '../schema/run';
import type { Expect, Spec } from '../schema/spec';
import { isZero } from '../spec/semantics';

/**
 * Where the stage of a block comes from:
 * - `runtime`: the last stage the runtime reported in this block;
 * - `runtime-carried`: no stage in this block, the last one an earlier block of the run reported (F and P);
 * - `tools`: the step classifier, from the block's tool calls and the tools the spec expects per stage;
 * - `carried`: no tool call and no runtime stage, so the stage before this block still holds;
 * - `start`: no tool call, no stage before: the first stage of the catalogue that expects no tool.
 */
export type StageSource = 'runtime' | 'runtime-carried' | 'tools' | 'carried' | 'start';

export type StageReading = { stage: string; source: StageSource; evidence: string };

/**
 * The tools each stage of the catalogue expects: the labels a block or a perturbation expecting that stage
 * names with a count above 0. Code only, read from the spec; a stage no block expects has an empty set.
 */
export function stageSignatures(spec: Spec): Map<string, Set<string>> {
  const signatures = new Map<string, Set<string>>((spec.stages ?? []).map((stage) => [stage, new Set()]));
  const expects: Expect[] = [
    ...spec.blocks.map((block) => block.expect ?? {}),
    ...(spec.perturbations ?? []).map((perturbation) => perturbation.expect ?? {}),
  ];
  for (const expect of expects) {
    if (expect.stage === undefined) continue;
    const signature = signatures.get(expect.stage);
    if (!signature) continue;
    for (const tool of expect.tools ?? []) if (!isZero(tool.count)) signature.add(tool.label);
  }
  return signatures;
}

/**
 * The step classifier: the stage a block reached when the runtime reports none, from its tool calls alone.
 * The stage whose expected tools overlap the block's called tools most (Jaccard) wins; a tie goes to the
 * first tied stage at or after the stage before the block in the catalogue, else to the first tied stage.
 * A block with tool calls no stage expects is not classified. A block with no tool call keeps the stage
 * before it (`carried`), or, as the first block, takes the first stage that expects no tool (`start`).
 */
export function classifyStage(
  spec: Spec,
  observed: Observed,
  previous: string | undefined,
  signatures: Map<string, Set<string>> = stageSignatures(spec),
): StageReading | undefined {
  const catalogue = spec.stages ?? [];
  if (catalogue.length === 0) return undefined;
  const called = new Set(observed.toolCalls.map((call) => call.label));
  if (called.size === 0) {
    if (previous !== undefined) {
      return { stage: previous, source: 'carried', evidence: `no tool call, so ${previous} still holds` };
    }
    const first = catalogue.find((stage) => (signatures.get(stage)?.size ?? 0) === 0);
    return first === undefined
      ? undefined
      : {
          stage: first,
          source: 'start',
          evidence: `no tool call; ${first} is the first stage that expects none`,
        };
  }
  let best: { stage: string; score: number }[] = [];
  for (const stage of catalogue) {
    const signature = signatures.get(stage) ?? new Set<string>();
    const shared = [...called].filter((label) => signature.has(label)).length;
    if (shared === 0) continue;
    const score = shared / new Set([...called, ...signature]).size;
    if (best.length === 0 || score > (best[0]?.score ?? 0)) best = [{ stage, score }];
    else if (score === best[0]?.score) best.push({ stage, score });
  }
  const labels = [...called].sort().join(', ');
  if (best.length === 0) return undefined;
  const from = previous === undefined ? 0 : Math.max(0, catalogue.indexOf(previous));
  const pick = best.find((entry) => catalogue.indexOf(entry.stage) >= from) ?? best[0];
  if (!pick) return undefined;
  return {
    stage: pick.stage,
    source: 'tools',
    evidence: `called ${labels}; ${pick.stage} expects ${[...(signatures.get(pick.stage) ?? [])].sort().join(', ')}`,
  };
}

/**
 * The stage a block reached, with its source. The runtime's own report wins: this block's, or in F and P
 * the last an earlier block reported (as the stage check reads it). Without one, the step classifier.
 */
export function readStage(
  spec: Spec,
  observed: Observed,
  options: {
    mode: 'T' | 'F' | 'P';
    history: readonly BlockResult[];
    previous: string | undefined;
    signatures?: Map<string, Set<string>>;
  },
): StageReading | undefined {
  const own = observed.runtime?.stages?.at(-1)?.name;
  if (own !== undefined) return { stage: own, source: 'runtime', evidence: `the runtime reports ${own}` };
  if (options.mode !== 'T') {
    for (const block of [...options.history].reverse()) {
      const name = block.observed.runtime?.stages?.at(-1)?.name;
      if (name !== undefined) {
        return {
          stage: name,
          source: 'runtime-carried',
          evidence: `no stage reported; ${name}, from block ${block.index}, still holds`,
        };
      }
    }
  }
  return classifyStage(spec, observed, options.previous, options.signatures);
}

/**
 * The flow verdicts of a block, family `flow` (drift class X3_flow):
 * - `flow.stage`, when the stage came from the step classifier and the block expects one: gating when
 *   the tools decided it, non-gating and inconclusive when the stage is only carried or assumed.
 * - `flow.order`, when the block expects no stage and the step classifier read the stage: the stage it reached
 *   is earlier in the catalogue than the one before it, so the flow went back with nothing in the spec asking
 *   for it. A runtime-reported stage gets none.
 * The evidence says whether the agent skipped ahead, went back, or reached a stage off the catalogue.
 */
export function flowVerdicts(
  spec: Spec,
  expect: Expect,
  reading: StageReading | undefined,
  previous: string | undefined,
): Verdict[] {
  // A stage the runtime reported gets no flow verdict, with or without an expected stage: the stage check judges it.
  if (!reading || reading.source === 'runtime' || reading.source === 'runtime-carried') return [];
  const catalogue = spec.stages ?? [];
  const expected = expect.stage;
  if (expected !== undefined) {
    const ok = reading.stage === expected;
    const confident = reading.source === 'tools';
    const evidence = `reached ${reading.stage} (${reading.evidence}), expected ${expected}${ok ? '' : `: ${movement(catalogue, reading.stage, expected)}`}`;
    return [
      machineVerdict('flow', 'stage', confident ? (ok ? 'pass' : 'fail') : 'inconclusive', evidence, {
        gating: confident,
      }),
    ];
  }
  if (previous === undefined || reading.source === 'carried' || reading.source === 'start') return [];
  const before = catalogue.indexOf(previous);
  const now = catalogue.indexOf(reading.stage);
  if (before < 0 || now < 0) return [];
  return [
    machineVerdict(
      'flow',
      'order',
      now >= before ? 'pass' : 'fail',
      `${previous} then ${reading.stage}${now >= before ? ', in catalogue order' : ': the flow went back with no stage expected'}`,
    ),
  ];
}

/** How a reached stage stands to the expected one in the catalogue. */
function movement(catalogue: readonly string[], reached: string, expected: string): string {
  const at = catalogue.indexOf(reached);
  const want = catalogue.indexOf(expected);
  if (at < 0) return `${reached} is not a stage of the catalogue`;
  if (want < 0) return `${expected} is not a stage of the catalogue`;
  return at > want ? `skipped ahead past ${expected}` : `went back before ${expected}`;
}

/** In mode T, the stage before block `blockIndex`: the last stage an earlier spec block expects. */
export function canonicalPreviousStage(spec: Spec, blockIndex: number): string | undefined {
  for (let index = blockIndex - 1; index >= 0; index--) {
    const stage = spec.blocks[index]?.expect?.stage;
    if (stage !== undefined) return stage;
  }
  return undefined;
}
