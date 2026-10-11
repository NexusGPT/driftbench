import type { BlockResult, RunResult } from '../schema/run';
import { canonicalJson, contentHash } from '../spec/hash';

/**
 * What the agent did in each block of a run, without what may vary between two identical runs: no cost,
 * no latency, no timestamp, no raw trace. Two runs of a deterministic agent have equal transcripts.
 */
export type TranscriptBlock = {
  index: number;
  blockId?: string;
  injected?: boolean;
  segments: unknown[];
  toolCalls: unknown[];
  runtime?: unknown;
  executions?: unknown[];
  artifacts?: unknown[];
  workspaceDiff?: unknown;
};

export function transcriptOf(run: RunResult): TranscriptBlock[] {
  return run.blocks.map(transcriptBlock);
}

function transcriptBlock(block: BlockResult): TranscriptBlock {
  const { observed } = block;
  const runtime = observed.runtime;
  return {
    index: block.index,
    ...(block.blockId !== undefined ? { blockId: block.blockId } : {}),
    ...(block.injected ? { injected: true } : {}),
    segments: observed.segments.map(({ cost: _cost, latencyMs: _latency, ...segment }) => segment),
    toolCalls: observed.toolCalls.map(({ startedAt: _at, latencyMs: _latency, ...call }) => call),
    ...(runtime
      ? {
          runtime: {
            skills: runtime.skills?.map((skill) => skill.name),
            guards: runtime.guards?.map((guard) => ({ name: guard.name, verdict: guard.verdict })),
            stages: runtime.stages?.map((stage) => stage.name),
            references: runtime.references?.map((reference) => reference.path),
            subagents: runtime.subagents?.map((helper) => ({ name: helper.name, model: helper.model })),
          },
        }
      : {}),
    ...(observed.executions
      ? { executions: observed.executions.map((run) => ({ command: run.command, exitCode: run.exitCode })) }
      : {}),
    ...(observed.artifacts ? { artifacts: observed.artifacts } : {}),
    ...(observed.workspaceDiff ? { workspaceDiff: observed.workspaceDiff } : {}),
  };
}

export type TranscriptComparison = {
  /** True when every run has the transcript of the first. */
  identical: boolean;
  /** The content hash of each run's transcript, in run order. */
  hashes: string[];
  /** The first run (from 0) whose transcript differs from run 0, and the first block where it does. */
  firstDifference?: { run: number; block: number; blockId?: string };
};

/** Compares the transcripts of several runs of one spec, block by block, against the first run. */
export function compareTranscripts(runs: readonly RunResult[]): TranscriptComparison {
  const transcripts = runs.map(transcriptOf);
  const hashes = transcripts.map((transcript) => contentHash(transcript));
  const first = transcripts[0] ?? [];
  for (let run = 1; run < transcripts.length; run++) {
    const other = transcripts[run] ?? [];
    const length = Math.max(first.length, other.length);
    for (let block = 0; block < length; block++) {
      const a = first[block];
      const b = other[block];
      if (a && b && canonicalJson(a) === canonicalJson(b)) continue;
      const blockId = (a ?? b)?.blockId;
      return {
        identical: false,
        hashes,
        firstDifference: { run, block, ...(blockId !== undefined ? { blockId } : {}) },
      };
    }
  }
  return { identical: true, hashes };
}
