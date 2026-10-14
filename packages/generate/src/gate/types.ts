import type {
  DeviationClass,
  DriftClass,
  Message,
  Observed,
  Spec,
  ThenField,
  WorldState,
} from '@agent-nexus/driftbench-core';

/**
 * The contracts of the validity gate: its nine stages, the fields a Then reads, the fault set it plants,
 * and the report it writes. A block enters a suite only through the gate; each stage rejects with a named
 * reason, and the funnel counts them.
 */

/** The nine stages, in the order the funnel reads them. */
export const GATE_STAGES = [
  'observed',
  'leakage',
  'shortcut',
  'contrast',
  'red_first',
  'stability',
  'difficulty',
  'label_audit',
  'freshness',
] as const;
export type GateStage = (typeof GATE_STAGES)[number];

/** Stages 7 to 9 mark or split a block; they never reject it. */
export const MARKING_STAGES: ReadonlySet<GateStage> = new Set(['difficulty', 'label_audit', 'freshness']);

// What a Then reads lives in core, where the blast radius reads it too; the gate keeps exporting it.
export {
  OBSERVED_FIELDS,
  type ObservedField,
  type ThenField,
  WORDING_FIELDS,
  type WordingField,
} from '@agent-nexus/driftbench-core';

/** Every named reason a stage gives. Rejects carry one; a mark carries one too. */
export const GATE_REASONS = {
  observed: ['no-machine-then', 'words-only'],
  leakage: ['expected-value-in-when', 'expected-value-in-given', 'ngram-overlap', 'same-family-as-judge'],
  shortcut: ['passed-by-constant', 'passed-by-echo', 'passed-by-first-tool'],
  contrast: ['then-ignores-edit', 'twins-disagree'],
  red_first: ['not-green-on-reference', 'red-on-control', 'targets-no-fault', 'kills-no-fault'],
  stability: ['flips'],
  difficulty: ['saturated'],
  label_audit: ['sampled'],
  freshness: ['sealed-holdout'],
} as const satisfies Record<GateStage, readonly string[]>;
export type GateReason = (typeof GATE_REASONS)[GateStage][number];

/** One stage's verdict on one block. `skip` means the stage did not look at it, and says why. */
export type StageVerdict = {
  status: 'pass' | 'reject' | 'mark' | 'skip';
  reason?: GateReason;
  detail: string;
};

/**
 * One block's outcome on one agent. `unjudged` covers a block no gating machine verdict decided: no check
 * applied, a check was inconclusive, or the run ended before the block.
 */
export type BlockOutcome = 'pass' | 'fail' | 'unjudged';

/** The three trivial agents of the shortcut stage. */
export const TRIVIAL_AGENTS = ['constant', 'echo', 'first-tool'] as const;
export type TrivialAgent = (typeof TRIVIAL_AGENTS)[number];

/** The session of a faulty agent behind the function adapter: one per conversation, nothing shared. */
export type FaultSession = {
  respond(messages: Message[], world: WorldState): Promise<Observed>;
  /** Every accepted call of a side-effecting tool, oldest first: the end-state source. */
  payloads(): readonly { tool: string; input: unknown; output?: unknown }[];
};

/** A faulty agent in the same process, run by the function adapter. */
export type FunctionFault = { kind: 'function'; create(): FaultSession };

/** A faulty agent run as a process, by the process adapter: `node <script>` in a local sandbox. */
export type ProcessFault = { kind: 'process'; script: string };

/**
 * One planted fault. A drift fault plants one of X1 to X5; a deviation fault mishandles one deviation
 * class; a control changes nothing observable and must leave every block green.
 */
export type FaultDef = {
  /** A short id, unique in the set. */
  id: string;
  kind: 'drift' | 'deviation' | 'control';
  /** The class it plants: a drift class, a deviation class, or `control`. */
  class: DriftClass | DeviationClass | 'control';
  /** The target it wraps, as `adapter:agent`, such as function:acme-sales. */
  target: string;
  /** The Then fields the fault is meant to change. A block that reads one of them targets the fault. */
  affects: readonly ThenField[];
  /** What it does wrong, in one or two sentences. */
  description: string;
  agent: FunctionFault | ProcessFault;
};

/** What a fault set module exports. */
export type FaultSet = { faults: readonly FaultDef[] };

/** One candidate spec as the gate reads it. */
export type Candidate = {
  spec: Spec;
  /** The content hash the loader computed. */
  hash: string;
  /** The path relative to the candidates' root, with forward slashes. The gated copy keeps it. */
  path: string;
};

export type GateOptions = {
  /** Repeats on the reference for pass^k. */
  k: number;
  /** The seed of the label audit sample and the holdout split. */
  seed: number;
  /** The creation date every gated block records, YYYY-MM-DD. */
  date: string;
  /** The share of gated specs sealed into the holdout. */
  holdoutShare: number;
  /** Blocks sampled per family for the label audit. */
  auditPerFamily: number;
  /** n of the n-gram overlap check (13). */
  ngram: number;
  /** Share of a block's n-grams found in the origin specs above which it is rejected. */
  overlap: number;
  /** The judge's model family. Without it the family check is skipped and the report says so. */
  judgeFamily?: string;
  /** The specs the generated blocks come from, for the n-gram check. Without them the check is skipped. */
  origin?: readonly Spec[];
  /** A block whose own cell holds one of these dimensions, or one of these deviation classes, is about wording. */
  wording: { dimensions: readonly string[]; deviations: readonly string[] };
};

export const GATE_DEFAULTS = {
  k: 5,
  seed: 1,
  holdoutShare: 0.2,
  auditPerFamily: 3,
  ngram: 13,
  overlap: 0.5,
  wording: {
    dimensions: ['language', 'tone', 'format'],
    deviations: ['D5_language_switch', 'D7_silence_or_burst'],
  },
} as const;
