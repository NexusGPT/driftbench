import type { DeviationClass } from '../schema/common';
import type { Spec } from '../schema/spec';
import { error, type Issue } from '../spec/issues';
import type { LoadedSpec, LoadResult } from '../spec/load';
import type { Inventory } from './inventory';

/** `n/a` when the behaviour does not apply on the channel, or the flow requires no deviation. */
export type CellStatus = 'covered' | 'missing' | 'n/a';

/** One behaviour on one channel, and the ids of the specs that cover it there. */
export type ChannelCell = { channel: string; status: CellStatus; specs: string[] };

export type BehaviourCoverage = {
  id: string;
  title: string;
  kind: 'conversation' | 'task';
  /** `missing` when any cell is missing, `n/a` when every cell is, else `covered`. */
  status: CellStatus;
  /** One cell per channel of the result, in the same order. */
  cells: ChannelCell[];
};

/** Behaviour counts on one channel. `applicable` is `covered` plus `missing`. */
export type ChannelTotals = { channel: string; applicable: number; covered: number; missing: number };

/** Where a spec exercises a deviation class: a perturbation, or a block whose stimulus is an injection. */
export type DeviationSource = {
  spec: string;
  source: 'perturbation' | 'injection';
  /** `perturbations.<n>` or `blocks.<n>`, counted from 0, like the loader's issue paths. */
  path: string;
};

/** One required deviation class of a flow, and the member specs that exercise it. */
export type DeviationCell = {
  deviation: DeviationClass;
  status: 'covered' | 'missing';
  specs: string[];
  /** Every perturbation and injection block of a member spec with this class, spec by spec. */
  sources: DeviationSource[];
};

export type FlowCoverage = {
  id: string;
  title: string;
  /** `missing` when any required class is missing, `n/a` when none is required, else `covered`. */
  status: CellStatus;
  /** Ids of the specs that belong to the flow: tagged `flow:<id>` or covering one of its behaviours. */
  specs: string[];
  /** One cell per required deviation class, in the inventory's order. */
  cells: DeviationCell[];
};

export const CoverageWarningCodes = [
  'UNKNOWN_BEHAVIOUR',
  'UNKNOWN_FLOW',
  'UNLISTED_CHANNEL',
  'KIND_MISMATCH',
] as const;
export type CoverageWarningCode = (typeof CoverageWarningCodes)[number];

/** Advice that never changes the verdict. `subject` is the behaviour id, flow id or channel concerned. */
export type CoverageWarning = {
  code: CoverageWarningCode;
  subject: string;
  specs: string[];
  message: string;
};

/** A spec that failed validation. It is listed and never counts as coverage. */
export type InvalidSpec = { path: string; error: Issue };

export type CoverageResult = {
  /** The channels of the behaviour matrix: the one asked for, else the whole channel universe. */
  channels: string[];
  behaviours: BehaviourCoverage[];
  perChannel: ChannelTotals[];
  flows: FlowCoverage[];
  warnings: CoverageWarning[];
  invalidSpecs: InvalidSpec[];
  summary: {
    /** Behaviours with at least one applicable channel, and how many of them are fully covered. */
    behaviours: { covered: number; total: number };
    /** Required flow x deviation cells, and how many of them are covered. */
    deviations: { covered: number; total: number };
  };
  /** False when any required cell is missing: a behaviour on an applicable channel, or a required deviation. */
  ok: boolean;
};

export type ComputeCoverageOptions = {
  /** Limit the matrix to one channel. Only specs on that channel, or on no channel, count. */
  channel?: string;
};

/**
 * The channels coverage is measured on: the inventory's `channels` when set, else every channel named by
 * a behaviour or a valid spec (sorted), else `default`.
 */
export function channelUniverse(specs: readonly LoadResult[], inventory: Inventory): string[] {
  if (inventory.channels) return [...inventory.channels];
  const found = new Set<string>();
  for (const behaviour of inventory.behaviours) {
    for (const channel of behaviour.channels ?? []) found.add(channel);
  }
  for (const spec of validSpecs(specs)) {
    if (spec.channel !== undefined) found.add(spec.channel);
  }
  return found.size > 0 ? [...found].sort() : ['default'];
}

/**
 * The behaviour x channel matrix and the flow x deviation matrix of an inventory, from loaded specs.
 * Pure: reads nothing, never throws. Invalid specs are listed and never count as coverage.
 */
export function computeCoverage(
  specs: readonly LoadResult[],
  inventory: Inventory,
  options: ComputeCoverageOptions = {},
): CoverageResult {
  const valid = validSpecs(specs);
  const channels = options.channel === undefined ? channelUniverse(specs, inventory) : [options.channel];
  // A spec counts when it runs on one of the matrix channels, or on no channel (then it counts for all).
  const counted = valid.filter((spec) => spec.channel === undefined || channels.includes(spec.channel));
  // Index once instead of scanning the whole suite for every behaviour on every channel. Lists keep
  // input order, including distinct specs with the same id; specIds still performs the final deduplication.
  const covering = new Map<string, Spec[]>();
  for (const spec of counted) {
    for (const id of new Set(spec.covers ?? [])) {
      const members = covering.get(id);
      if (members) members.push(spec);
      else covering.set(id, [spec]);
    }
  }

  const behaviours = inventory.behaviours.map((behaviour): BehaviourCoverage => {
    const cells = channels.map((channel): ChannelCell => {
      if (behaviour.channels && !behaviour.channels.includes(channel)) {
        return { channel, status: 'n/a', specs: [] };
      }
      const ids = specIds(
        (covering.get(behaviour.id) ?? []).filter(
          (spec) => spec.channel === undefined || spec.channel === channel,
        ),
      );
      return { channel, status: ids.length > 0 ? 'covered' : 'missing', specs: ids };
    });
    const { id, title, kind } = behaviour;
    return { id, title, kind, status: rollUp(cells.map((cell) => cell.status)), cells };
  });

  const perChannel = channels.map((channel, index): ChannelTotals => {
    const statuses = behaviours.map((behaviour) => behaviour.cells[index]?.status);
    const covered = statuses.filter((status) => status === 'covered').length;
    const missing = statuses.filter((status) => status === 'missing').length;
    return { channel, applicable: covered + missing, covered, missing };
  });

  const flows = inventory.flows.map((flow): FlowCoverage => {
    const behaviours = new Set(flow.behaviours);
    const members = counted.filter(
      (spec) => spec.tags?.includes(`flow:${flow.id}`) || spec.covers?.some((id) => behaviours.has(id)),
    );
    const cells = (flow.deviations ?? []).map((deviation): DeviationCell => {
      const sources = members.flatMap((spec) => deviationSources(spec, deviation));
      const ids = [...new Set(sources.map((source) => source.spec))];
      return { deviation, status: ids.length > 0 ? 'covered' : 'missing', specs: ids, sources };
    });
    const { id, title } = flow;
    return { id, title, status: rollUp(cells.map((cell) => cell.status)), specs: specIds(members), cells };
  });

  const invalidSpecs = specs.flatMap((result): InvalidSpec[] =>
    result.ok
      ? []
      : [{ path: result.path, error: result.errors[0] ?? error('SPEC_PARSE', '', 'the spec is invalid') }],
  );

  const applicable = behaviours.filter((behaviour) => behaviour.status !== 'n/a');
  const required = flows.flatMap((flow) => flow.cells);
  return {
    channels,
    behaviours,
    perChannel,
    flows,
    warnings: warningsFor(valid, inventory),
    invalidSpecs,
    summary: {
      behaviours: {
        covered: applicable.filter((behaviour) => behaviour.status === 'covered').length,
        total: applicable.length,
      },
      deviations: {
        covered: required.filter((cell) => cell.status === 'covered').length,
        total: required.length,
      },
    },
    ok:
      behaviours.every((behaviour) => behaviour.status !== 'missing') &&
      required.every((cell) => cell.status === 'covered'),
  };
}

/** Warnings look at every valid spec, whatever the channel filter: they describe the inventory's gaps. */
function warningsFor(specs: Spec[], inventory: Inventory): CoverageWarning[] {
  const behaviours = new Map(inventory.behaviours.map((behaviour) => [behaviour.id, behaviour]));
  const flowIds = new Set(inventory.flows.map((flow) => flow.id));
  const unknownBehaviours = new Map<string, string[]>();
  const unknownFlows = new Map<string, string[]>();
  const unlistedChannels = new Map<string, string[]>();
  const coveringKinds = new Map<string, Set<string>>();

  for (const spec of specs) {
    for (const id of spec.covers ?? []) {
      const behaviour = behaviours.get(id);
      if (!behaviour) {
        group(unknownBehaviours, id, spec.id);
        continue;
      }
      const kinds = coveringKinds.get(id) ?? new Set<string>();
      kinds.add(spec.kind);
      coveringKinds.set(id, kinds);
    }
    for (const tag of spec.tags ?? []) {
      if (!tag.startsWith('flow:')) continue;
      const flow = tag.slice('flow:'.length);
      if (!flowIds.has(flow)) group(unknownFlows, flow, spec.id);
    }
    if (inventory.channels && spec.channel !== undefined && !inventory.channels.includes(spec.channel)) {
      group(unlistedChannels, spec.channel, spec.id);
    }
  }

  const warnings: CoverageWarning[] = [];
  for (const [id, ids] of unknownBehaviours) {
    warnings.push({
      code: 'UNKNOWN_BEHAVIOUR',
      subject: id,
      specs: ids,
      message: `covered by ${ids.join(', ')}, but the inventory has no behaviour ${id}`,
    });
  }
  for (const [flow, ids] of unknownFlows) {
    warnings.push({
      code: 'UNKNOWN_FLOW',
      subject: flow,
      specs: ids,
      message: `tagged flow:${flow} on ${ids.join(', ')}, but the inventory has no flow ${flow}`,
    });
  }
  for (const [channel, ids] of unlistedChannels) {
    warnings.push({
      code: 'UNLISTED_CHANNEL',
      subject: channel,
      specs: ids,
      message: `the inventory does not list this channel, so these specs count for no channel: ${ids.join(', ')}`,
    });
  }
  // A task behaviour covered only by conversation specs (or the reverse) is probably not tested the way it runs.
  for (const behaviour of inventory.behaviours) {
    const kinds = coveringKinds.get(behaviour.id);
    if (!kinds || kinds.has(behaviour.kind)) continue;
    const ids = specIds(specs.filter((spec) => spec.covers?.includes(behaviour.id)));
    warnings.push({
      code: 'KIND_MISMATCH',
      subject: behaviour.id,
      specs: ids,
      message: `a ${behaviour.kind} behaviour, covered only by ${[...kinds].join(' and ')} specs: ${ids.join(', ')}`,
    });
  }
  return warnings;
}

/** The injection blocks and the perturbations of a spec with this class, in file order. */
function deviationSources(spec: Spec, deviation: DeviationClass): DeviationSource[] {
  const sources: DeviationSource[] = [];
  spec.blocks.forEach((block, index) => {
    if ('injection' in block.when && block.when.injection.class === deviation) {
      sources.push({ spec: spec.id, source: 'injection', path: `blocks.${index}` });
    }
  });
  spec.perturbations?.forEach((perturbation, index) => {
    if (perturbation.class === deviation) {
      sources.push({ spec: spec.id, source: 'perturbation', path: `perturbations.${index}` });
    }
  });
  return sources;
}

/** Adds a spec id under a key, each id once, in the order first seen. */
function group(groups: Map<string, string[]>, key: string, id: string): void {
  const ids = groups.get(key) ?? [];
  if (!ids.includes(id)) ids.push(id);
  groups.set(key, ids);
}

function validSpecs(specs: readonly LoadResult[]): Spec[] {
  return specs.filter((result): result is LoadedSpec => result.ok).map((result) => result.spec);
}

function specIds(specs: Spec[]): string[] {
  return [...new Set(specs.map((spec) => spec.id))];
}

function rollUp(statuses: CellStatus[]): CellStatus {
  if (statuses.includes('missing')) return 'missing';
  return statuses.includes('covered') ? 'covered' : 'n/a';
}
