import { z } from 'zod';

/**
 * What selection and the holdout read from the gate's output: the faults each gated spec turns red
 * (`gate-report.json`) and the specs the gate sealed (`holdout/seal.json`). Both are parsed loosely: only
 * the fields read here are checked, so a report with more fields still reads.
 */

const FaultEntry = z.looseObject({
  id: z.string().min(1),
  kind: z.string(),
  class: z.string(),
  equivalent: z.boolean(),
});

const BlockEntry = z.looseObject({
  key: z.string().min(1),
  status: z.string(),
  faults: z.record(z.string(), z.looseObject({ outcome: z.string(), changed: z.boolean() })).optional(),
});

const GateReport = z.looseObject({
  mutation: z.looseObject({ by_fault: z.array(FaultEntry) }),
  blocks: z.array(BlockEntry),
});

/** The mutation evidence of one gate report. */
export type GateEvidence = {
  /** The faults that count: not a control and not equivalent, by id, with their class. */
  faults: Map<string, { class: string; kind: string }>;
  /** For each spec id, the counted faults some accepted block of the spec turns red. */
  kills: Map<string, string[]>;
};

/**
 * Reads the mutation evidence of a parsed `gate-report.json`. A spec turns a fault red when one of its
 * accepted blocks fails on the fault and the fault changed what the block observed. A control fault and an
 * equivalent fault never count. Returns a message when the report has not the expected shape.
 */
export function evidenceFromReport(report: unknown): GateEvidence | string {
  const parsed = GateReport.safeParse(report);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `not a gate report: ${issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'invalid'}`;
  }
  const faults = new Map<string, { class: string; kind: string }>();
  for (const fault of parsed.data.mutation.by_fault) {
    if (fault.kind === 'control' || fault.equivalent) continue;
    faults.set(fault.id, { class: fault.class, kind: fault.kind });
  }
  const kills = new Map<string, Set<string>>();
  for (const block of parsed.data.blocks) {
    if (block.status !== 'accepted') continue;
    const spec = specOfKey(block.key);
    for (const [fault, run] of Object.entries(block.faults ?? {})) {
      if (!faults.has(fault) || run.outcome !== 'fail' || !run.changed) continue;
      const held = kills.get(spec) ?? new Set<string>();
      held.add(fault);
      kills.set(spec, held);
    }
  }
  return {
    faults,
    kills: new Map([...kills].map(([spec, set]) => [spec, [...set].sort()])),
  };
}

/** Merges the evidence of several reports. A spec id in two reports keeps the faults of both. */
export function mergeEvidence(all: readonly GateEvidence[]): GateEvidence {
  const faults = new Map<string, { class: string; kind: string }>();
  const kills = new Map<string, Set<string>>();
  for (const evidence of all) {
    for (const [id, fault] of evidence.faults) faults.set(id, fault);
    for (const [spec, list] of evidence.kills) {
      const held = kills.get(spec) ?? new Set<string>();
      for (const fault of list) held.add(fault);
      kills.set(spec, held);
    }
  }
  return { faults, kills: new Map([...kills].map(([spec, set]) => [spec, [...set].sort()])) };
}

/** The spec id of a gate block key, `<spec id>#<block id or index>`. */
export function specOfKey(key: string): string {
  const at = key.lastIndexOf('#');
  return at < 0 ? key : key.slice(0, at);
}

const SealFile = z.looseObject({
  sealed: z.literal(true),
  seed: z.number().int().min(0),
  share: z.number().min(0).max(1),
  specs: z.array(z.looseObject({ id: z.string().min(1), path: z.string().min(1), hash: z.string().min(1) })),
});

/** A seal the gate wrote: the seed and share of its split, and each sealed spec with its content hash. */
export type GateSeal = {
  seed: number;
  share: number;
  /** `path` is relative to the gate's output folder, the parent of the folder holding seal.json. */
  specs: Array<{ id: string; path: string; hash: string }>;
};

/** Reads a parsed `seal.json` of the gate. Returns a message when it has not the expected shape. */
export function sealFromJson(value: unknown): GateSeal | string {
  const parsed = SealFile.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `not a gate seal: ${issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'invalid'}`;
  }
  return {
    seed: parsed.data.seed,
    share: parsed.data.share,
    specs: parsed.data.specs.map(({ id, path, hash }) => ({ id, path, hash })),
  };
}
