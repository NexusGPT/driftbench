/**
 * Production traces read into driftbench's run shape, from OpenTelemetry, the Nexus platform's trace export,
 * or a recorded Claude Code session. `driftbench import traces` drafts specs from them; `driftbench monitor
 * --source traces` watches them for drift.
 */

export { traceFromClaudeCode } from './claude-code';
export { nexusEntries, tracesFromNexus, tracesFromNexusEntries } from './nexus';
export { anyValue, type OtelSpan, parseOtlp, tracesFromOtel } from './otel';
export { type ReadTraces, readTraces, readTracesText } from './read';
export { type Rollup, rollUp, type SubtreeTotals } from './rollup';
export {
  type PriceTable,
  priced,
  TRACE_SOURCES,
  type Trace,
  type TraceObservation,
  type TraceSource,
  type TraceTurn,
} from './types';
