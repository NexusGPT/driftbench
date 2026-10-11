import { isRecord, type JsonlLine, parseJsonl, stringField } from '../format';

/**
 * The headless stream, as this runner reads it. Written from public knowledge of the shape and NOT verified
 * against a live run yet: the first billed run checks it.
 *
 * `<runtime> -p <prompt> --output-format stream-json --verbose` prints one JSON record per line:
 * - `system` with `subtype: init`: `session_id`, `cwd`, `model`, `tools`. Opens the stream.
 * - `assistant`: `message` as in the session file (text, tool_use and thinking blocks, `id`, `usage`).
 * - `user`: `message.content` with `tool_result` blocks, the results of the calls before it.
 * - `result`: closes the stream. `subtype` (success or an error kind), `is_error`, `result` (the final
 *   text), `num_turns`, `duration_ms`, `total_cost_usd`, `usage`.
 * Records a helper writes carry `parent_tool_use_id` (the id of the Agent call that started it); they are
 * the helper's acts, not the agent's. Every record may carry `session_id`; this reader also takes a
 * `timestamp` when the stream has one (the real stream may not; then order is the only clock).
 *
 * The runner turns one stream into session-file records (see `../format.ts`) so the session adapter maps
 * it into one block: a typed user record with the ask opens the block, the stream's records follow.
 */

export type StreamResult = {
  subtype?: string;
  isError: boolean;
  text?: string;
  numTurns?: number;
  durationMs?: number;
  costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number };
};

export type ParsedStream = {
  /** The session id the runtime gave the run, from the init record or any record carrying one. */
  sessionId?: string;
  model?: string;
  /** The closing result record, when the stream has one. */
  result?: StreamResult;
  /** Records in order, as parsed. */
  lines: JsonlLine[];
  /** What the reader noticed: lines that are not JSON, a stream with no init or no result. */
  issues: string[];
};

export function parseStream(text: string): ParsedStream {
  const lines = parseJsonl(text);
  const out: ParsedStream = { lines, issues: [] };
  let init = false;
  for (const entry of lines) {
    if (!entry.ok) {
      out.issues.push(`stream line ${entry.line} is not JSON: ${entry.error}`);
      continue;
    }
    const record = entry.value;
    if (!isRecord(record)) continue;
    const sessionId = stringField(record, 'session_id');
    if (sessionId !== undefined) out.sessionId ??= sessionId;
    const type = stringField(record, 'type');
    if (type === 'system' && stringField(record, 'subtype') === 'init') {
      init = true;
      const model = stringField(record, 'model');
      if (model !== undefined) out.model = model;
    }
    if (type === 'result') out.result = resultOf(record);
  }
  if (lines.length > 0 && !init) out.issues.push('the stream has no init record');
  if (lines.length > 0 && out.result === undefined) out.issues.push('the stream has no result record');
  return out;
}

function resultOf(record: Record<string, unknown>): StreamResult {
  const usage = isRecord(record.usage) ? record.usage : undefined;
  const subtype = stringField(record, 'subtype');
  const text = stringField(record, 'result');
  return {
    ...(subtype === undefined ? {} : { subtype }),
    isError: record.is_error === true || (subtype !== undefined && subtype !== 'success'),
    ...(text === undefined ? {} : { text }),
    ...(typeof record.num_turns === 'number' ? { numTurns: record.num_turns } : {}),
    ...(typeof record.duration_ms === 'number' ? { durationMs: record.duration_ms } : {}),
    ...(typeof record.total_cost_usd === 'number' && record.total_cost_usd >= 0
      ? { costUsd: record.total_cost_usd }
      : {}),
    ...(usage
      ? {
          usage: {
            inputTokens:
              count(usage.input_tokens) +
              count(usage.cache_creation_input_tokens) +
              count(usage.cache_read_input_tokens),
            outputTokens: count(usage.output_tokens),
          },
        }
      : {}),
  };
}

const OVERLOADED = /overloaded|\b529\b|rate[ _-]?limit|\b429\b/i;

/**
 * True when a run ended on the provider's overload or rate limit rather than on the agent: the result
 * record is an error whose text names it, or the run failed with no result and its error output names it.
 */
export function isOverloaded(parsed: ParsedStream, exitCode: number, stderr: string): boolean {
  if (parsed.result?.isError)
    return OVERLOADED.test(`${parsed.result.text ?? ''} ${parsed.result.subtype ?? ''}`);
  if (parsed.result === undefined && exitCode !== 0) return OVERLOADED.test(stderr);
  return false;
}

export type NormaliseInput = {
  parsed: ParsedStream;
  /** The ask, as the runtime received it: the typed user record that opens the block. */
  ask: string;
  /** When the turn started; the opening record's timestamp, so every guard and step row of the turn falls in it. */
  startedAt: string;
  cwd: string;
  /** Messages queued while the reply ran: kept as injected records, never as a new turn. */
  queued?: readonly string[];
};

/**
 * Session-file records for one turn: the typed ask, then the stream's records. The init and result records
 * are kept as system records (they open and close the run); a helper's records are marked as sidechain; a
 * typed user record inside the stream (a queued message the runtime echoed) is marked injected, so the turn
 * stays one block. Every record carries the session id and the folder, as the session file does.
 */
export function normaliseStream(input: NormaliseInput): string[] {
  const sessionId = input.parsed.sessionId ?? 'unknown-session';
  const common = { sessionId, cwd: input.cwd };
  const records: unknown[] = [
    {
      ...common,
      type: 'user',
      timestamp: input.startedAt,
      message: { role: 'user', content: input.ask },
    },
  ];
  for (const message of input.queued ?? []) {
    records.push({
      ...common,
      type: 'user',
      isMeta: true,
      queued: true,
      timestamp: input.startedAt,
      message: { role: 'user', content: message },
    });
  }
  for (const entry of input.parsed.lines) {
    if (!entry.ok) continue;
    const record = entry.value;
    if (!isRecord(record)) continue;
    const type = stringField(record, 'type');
    const base: Record<string, unknown> = { ...common, ...record };
    delete base.session_id;
    const helper = typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id !== '';
    if (helper) base.isSidechain = true;
    if (type === 'system' || type === 'result') {
      records.push({ ...base, type: 'system', subtype: type === 'result' ? 'result' : base.subtype });
      continue;
    }
    if (type === 'user' && !helper && typedText(record)) {
      records.push({ ...base, isMeta: true, echoed: true });
      continue;
    }
    records.push(base);
  }
  return records.map((record) => JSON.stringify(record));
}

/** True when a stream user record is a typed message rather than tool results. */
function typedText(record: Record<string, unknown>): boolean {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = message?.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && !content.some((part) => isRecord(part) && part.type === 'tool_result');
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
