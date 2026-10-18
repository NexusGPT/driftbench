import type { Spec } from '@agent-nexus/driftbench-core';
import {
  addEventCodes,
  assertGridSize,
  combinations,
  compileSpace,
  type Projection,
  placeSpec,
  projectGrid,
  resolveT,
  tupleValues,
} from '@agent-nexus/driftbench-space';
import { SEEDERS, type Seeder } from '../seed/assemble';
import type { PreparedMap } from '../seed/map';
import type { MeasuredCoverage } from './generate';
import { DiskArray } from './stream-storage';

type Counts = { complete: Float64Array; all: Float64Array; order: number[] };
type BlockCounts = { blocks: number; machine: number };
const stable = (value: number) => Math.round(value * 1e12) / 1e12;
const machineShare = ({ blocks, machine }: BlockCounts) => ({
  machine_then_share: blocks === 0 ? 0 : machine / blocks,
  judged_only_blocks: blocks - machine,
});

/** Counts depend on the input grid, never on the number of generated specs. */
export class StreamCoverage {
  readonly space;
  readonly projections: Projection[];
  readonly counts: Counts[];
  readonly pairs: number[];
  readonly required: number[];
  readonly bySeeder: Record<Seeder, Float64Array[]>;
  readonly blocks: Record<Seeder, BlockCounts>;
  readonly weights: DiskArray<number[][]>;
  readonly requiredFlows: Array<{
    flow: string;
    behaviours: Set<string>;
    deviation: string;
    covered: boolean;
  }>;
  private readonly cellCounts = new WeakMap<object, { counts: Float64Array; code: number }>();
  private complete = 0;
  private all = 0;

  constructor(
    readonly prepared: PreparedMap,
    t: number,
    scratch: string,
  ) {
    assertGridSize(prepared.axisMap, 4_000_000);
    this.space = compileSpace(prepared.axisMap);
    const k = this.space.dimensions.length;
    resolveT(this.space, Math.min(t, k));
    resolveT(this.space, 2);
    const subsets = new Map<string, number[]>();
    for (const strength of new Set([1, 2, 3, Math.min(t, k)])) {
      for (const subset of combinations(k, strength)) subsets.set(subset.join(','), subset);
    }
    this.required = this.space.dimensions.flatMap((dimension, index) =>
      dimension.values.some((value) => value.required) ? [index] : [],
    );
    if (this.required.length > 0) subsets.set(this.required.join(','), this.required);
    this.projections = projectGrid(this.space, [...subsets.values()]).projections;
    this.counts = this.projections.map((projection) => ({
      complete: new Float64Array(projection.size),
      all: new Float64Array(projection.size),
      order: [],
    }));
    this.pairs = this.indices(Math.min(2, k));
    this.bySeeder = Object.fromEntries(
      SEEDERS.map((seeder) => [
        seeder,
        this.pairs.map((index) => new Float64Array(this.projections[index]?.size ?? 0)),
      ]),
    ) as Record<Seeder, Float64Array[]>;
    this.blocks = Object.fromEntries(SEEDERS.map((seeder) => [seeder, { blocks: 0, machine: 0 }])) as Record<
      Seeder,
      BlockCounts
    >;
    this.weights = new DiskArray(scratch, 'weights.jsonl');
    this.requiredFlows = (prepared.inventory?.flows ?? []).flatMap((flow) =>
      (flow.deviations ?? []).map((deviation) => ({
        flow: flow.id,
        behaviours: new Set(flow.behaviours),
        deviation,
        covered: false,
      })),
    );
  }

  indices(t: number): number[] {
    return this.projections.flatMap((projection, index) =>
      projection.dimensions.length === t ? [index] : [],
    );
  }

  add(spec: Spec, seeder: Seeder, complete: boolean): void {
    this.all += 1;
    if (complete) this.complete += 1;
    const placement = placeSpec(this.space, spec);
    const pairCodes: number[][] = [];
    this.projections.forEach((projection, index) => {
      const codes = new Set<number>();
      for (const event of placement.events) addEventCodes(projection, event, codes);
      const counts = this.counts[index] as Counts;
      const pair = this.pairs.indexOf(index);
      const kept: number[] = [];
      for (const code of codes) {
        if (projection.allowed[code] !== 1) continue;
        counts.all[code] = (counts.all[code] ?? 0) + 1;
        if (!complete) continue;
        if (counts.complete[code] === 0) counts.order.push(code);
        counts.complete[code] = (counts.complete[code] ?? 0) + 1;
        if (pair >= 0) {
          const own = this.bySeeder[seeder][pair] as Float64Array;
          own[code] = (own[code] ?? 0) + 1;
          kept.push(code);
        }
      }
      if (pair >= 0) pairCodes.push(kept);
    });
    if (!complete) return;
    this.weights.push(pairCodes);
    const blocks = this.blocks[seeder];
    for (const block of spec.blocks) {
      blocks.blocks += 1;
      if (
        Object.keys(block.expect ?? {}).some((key) => key !== 'criteria' && key !== 'ledger_add') ||
        spec.rules !== undefined
      )
        blocks.machine += 1;
    }
    if (
      this.prepared.inventory?.channels &&
      spec.channel !== undefined &&
      !this.prepared.inventory.channels.includes(spec.channel)
    )
      return;
    for (const cell of this.requiredFlows) {
      if (
        cell.covered ||
        !(spec.tags?.includes(`flow:${cell.flow}`) || spec.covers?.some((id) => cell.behaviours.has(id)))
      )
        continue;
      cell.covered =
        spec.blocks.some(
          (block) => 'injection' in block.when && block.when.injection.class === cell.deviation,
        ) || (spec.perturbations ?? []).some((entry) => entry.class === cell.deviation);
    }
  }

  /** Current coverage of a cell snapshot, without placing and decoding the same spec again. */
  isCovered(cell: { values: Record<string, string>; count: number }): boolean {
    const entry = this.cellCounts.get(cell);
    if (!entry) throw new Error('Expected a cell returned by this coverage instance');
    return (entry.counts[entry.code] ?? 0) > 0;
  }

  cells(t: number): Array<{ values: Record<string, string>; count: number }> {
    const out: Array<{ values: Record<string, string>; count: number }> = [];
    for (const index of this.indices(Math.min(t, this.space.dimensions.length))) {
      const projection = this.projections[index] as Projection;
      const counts = this.counts[index] as Counts;
      projection.allowed.forEach((allowed, code) => {
        if (allowed) {
          const cell = {
            values: { ...tupleValues(projection, code, this.space) },
            count: counts.complete[code] ?? 0,
          };
          this.cellCounts.set(cell, { counts: counts.complete, code });
          out.push(cell);
        }
      });
    }
    return out;
  }

  measured(t: number, complete = true): MeasuredCoverage {
    t = Math.min(t, this.space.dimensions.length);
    let allowed = 0;
    let covered = 0;
    for (const index of this.indices(t)) {
      const projection = this.projections[index] as Projection;
      const counts = (this.counts[index] as Counts)[complete ? 'complete' : 'all'];
      projection.allowed.forEach((flag, code) => {
        if (flag) {
          allowed += 1;
          if ((counts[code] ?? 0) > 0) covered += 1;
        }
      });
    }
    return {
      t,
      specs: complete ? this.complete : this.all,
      allowed,
      covered,
      share: allowed === 0 ? 0 : covered / allowed,
    };
  }

  private diversity(counts: number[]) {
    const n = counts.reduce((sum, count) => sum + count, 0);
    const shares = counts.map((count) => count / Math.max(1, n));
    const entropy = -shares.reduce((sum, share) => sum + (share > 0 ? share * Math.log(share) : 0), 0);
    return {
      n,
      shares,
      entropy,
      hill_q0: counts.length,
      pielou: counts.length > 1 ? stable(entropy / Math.log(counts.length)) : 1,
    };
  }

  seederMeasures(seeder: Seeder): Record<string, number> {
    const counts = this.bySeeder[seeder].flatMap((counts) => [...counts].filter((count) => count > 0));
    const { hill_q0, pielou } = this.diversity(counts);
    return { hill_q0, pielou, ...machineShare(this.blocks[seeder]) };
  }

  measures(): Record<string, number> {
    const counts = this.pairs.flatMap((index) =>
      [...(this.counts[index] as Counts).complete].filter((count) => count > 0),
    );
    const { n, shares, entropy, hill_q0, pielou } = this.diversity(counts);
    const f1 = counts.filter((count) => count === 1).length;
    const f2 = counts.filter((count) => count === 2).length;
    let weighted = 0;
    for (const index of this.pairs) {
      const projection = this.projections[index] as Projection;
      for (const code of (this.counts[index] as Counts).order) weighted += projection.mass[code] ?? 0;
    }
    let sumWeights = 0;
    let squaredWeights = 0;
    // The final per-cell denominators are known only after the last spec. Re-read one placement at a time.
    for (const row of this.weights) {
      let weight = 0;
      row.forEach((codes, pair) => {
        const index = this.pairs[pair] as number;
        const projection = this.projections[index] as Projection;
        for (const code of codes)
          weight += (projection.mass[code] ?? 0) / ((this.counts[index] as Counts).complete[code] ?? 1);
      });
      weight /= Math.max(1, this.pairs.length);
      sumWeights += weight;
      squaredWeights += weight * weight;
    }
    let requiredTotal = this.requiredFlows.length;
    let requiredCovered = this.requiredFlows.filter((cell) => cell.covered).length;
    const index = this.projections.findIndex(
      (projection) => projection.dimensions.join(',') === this.required.join(','),
    );
    if (this.required.length > 0 && index >= 0) {
      const projection = this.projections[index] as Projection;
      projection.allowed.forEach((allowed, code) => {
        if (!allowed) return;
        const values = tupleValues(projection, code, this.space);
        if (
          !this.required.every((dimension) => {
            const entry = this.space.dimensions[dimension];
            return entry?.values.some((value) => value.id === values[entry.id] && value.required);
          })
        )
          return;
        requiredTotal += 1;
        if (((this.counts[index] as Counts).complete[code] ?? 0) > 0) requiredCovered += 1;
      });
    }
    const three = this.space.dimensions.length >= 3 ? this.measured(3) : undefined;
    const out: Record<string, number> = {
      discovery: n === 0 ? 1 : f1 / n,
      chao_coverage: n === 0 ? 0 : 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2 || 1)),
      chao1:
        counts.length +
        (n === 0
          ? 0
          : f2 > 0
            ? ((n - 1) / n) * ((f1 * f1) / (2 * f2))
            : ((n - 1) / n) * ((f1 * (f1 - 1)) / 2)),
      hill_q0,
      hill_q1: stable(Math.exp(entropy)),
      hill_q2:
        1 /
        Math.max(
          Number.EPSILON,
          shares.reduce((sum, share) => sum + share * share, 0),
        ),
      pielou,
      t3_share: three?.share ?? 0,
      t3_allowed: three?.allowed ?? 0,
      weighted_share: weighted / Math.max(1, this.pairs.length),
      effective_sample_size: squaredWeights === 0 ? 0 : (sumWeights * sumWeights) / squaredWeights,
      required_covered: requiredCovered,
      required_total: requiredTotal,
    };
    for (const index of this.indices(1)) {
      const projection = this.projections[index] as Projection;
      const dimension = this.space.dimensions[projection.dimensions[0] ?? -1];
      if (dimension)
        out[`axis_${dimension.id}`] = [...(this.counts[index] as Counts).complete].filter(
          (count, code) => count > 0 && projection.allowed[code] === 1,
        ).length;
    }
    Object.assign(
      out,
      machineShare(
        Object.values(this.blocks).reduce(
          (total, own) => ({ blocks: total.blocks + own.blocks, machine: total.machine + own.machine }),
          { blocks: 0, machine: 0 },
        ),
      ),
    );
    return out;
  }
}
