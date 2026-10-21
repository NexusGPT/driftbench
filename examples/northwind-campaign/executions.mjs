import { AgentFailure, machineVerdict } from '@agent-nexus/driftbench-core';

export const EXECUTION_LOG = '.claude/northwind/reconcile-executions.jsonl';

async function readLog(adapter, session) {
  let bytes;
  try {
    bytes = await adapter.readArtifact(session, EXECUTION_LOG);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new AgentFailure(`Cannot read the Northwind execution log: ${error.message}`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return text.split('\n').filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    if (typeof event.id !== 'string' || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) {
      throw new AgentFailure('Malformed Northwind execution record');
    }
    return event;
  });
}

/** Capture only events appended by this block; preserve them in the stored trace, including for replay. */
export function executionLogAdapter(adapter) {
  return {
    ...adapter,
    async send(session, turn) {
      const before = await readLog(adapter, session);
      const observed = await adapter.send(session, turn);
      const after = await readLog(adapter, session);
      if (after.length < before.length || before.some((event, index) => JSON.stringify(event) !== JSON.stringify(after[index]))) {
        throw new AgentFailure('The Northwind execution log was removed or rewritten during the block');
      }
      return {
        ...observed,
        raw: { ...observed.raw, northwindReconcileExecutions: after.slice(before.length) },
      };
    },
  };
}
