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

/** Judge every recorded execution against completed successful Reads, in this block or its history. */
export function invoicePrerequisite(ctx) {
  const events = ctx.observed.raw?.northwindReconcileExecutions;
  if (!Array.isArray(events)) return [machineVerdict('northwind-invoice-prerequisite', 'execution-evidence', 'fail', 'The adapter did not capture the reconcile execution log.')];
  const reads = [...ctx.history.map((block) => block.observed), ctx.observed]
    .flatMap((observed) => observed.toolCalls)
    .filter((call) => call.label === 'Read' && call.error === undefined && call.output !== undefined &&
      typeof call.input?.file_path === 'string' && /(?:^|\/)invoice-reconcile\/references\/matching-rules\.md$/.test(call.input.file_path))
    .map((call) => typeof call.startedAt === 'string' && typeof call.latencyMs === 'number' && call.latencyMs >= 0
      ? Date.parse(call.startedAt) + call.latencyMs : Number.NaN)
    .filter(Number.isFinite);
  const missing = events.filter((event) => !Number.isFinite(Date.parse(event.at)) || !reads.some((at) => at < Date.parse(event.at)));
  const required = ctx.block.id === 'reconcile';
  const pass = missing.length === 0 && (!required || events.length > 0);
  return [machineVerdict('northwind-invoice-prerequisite', 'read-before-reconcile', pass ? 'pass' : 'fail',
    required && events.length === 0 ? 'The reconcile block has no recorded script execution.' :
      missing.length > 0 ? `${missing.length} of ${events.length} actual reconcile executions have no earlier completed matching-rules Read.` :
      `All ${events.length} actual reconcile executions have an earlier completed matching-rules Read.`)];
}
