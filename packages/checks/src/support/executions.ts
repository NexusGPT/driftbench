import type { ExecutionRecord } from '@agent-nexus/driftbench-core';

/**
 * The commands of a block's executions list. A record with role `agent` is the agent's own process (the
 * process adapter adds it last); it is never a command the agent ran. A record without a role is a command.
 */
export function commandsOf(runs: readonly ExecutionRecord[]): ExecutionRecord[] {
  return runs.filter((run) => run.role !== 'agent');
}

/** The record of the agent's own process, when the adapter reports one. */
export function agentProcess(runs: readonly ExecutionRecord[]): ExecutionRecord | undefined {
  return runs.find((run) => run.role === 'agent');
}
