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
    // The stream names the structured tool result `tool_use_result`; the session file `toolUseResult`.
    if (base.tool_use_result !== undefined && base.toolUseResult === undefined) {
      base.toolUseResult = base.tool_use_result;
      delete base.tool_use_result;
    }
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

/** One guard row, in the shape of a decision-log row. */
export type HookRow = { at: string; event: string; check: string; verdict: string };

/**
 * Guard rows from the stream itself, seen in the first real run with `--include-hook-events`:
 * - a `hook_response` system record (`hook_name` is `<event>:<matcher>` or `<event>`, `exit_code`, `stdout`)
 *   gives a row; the verdict is the `permissionDecision` or `decision` a JSON stdout names, else deny for
 *   exit code 2, allow for 0 and error otherwise;
 * - a `permission_denied` system record gives `permission:<tool>` with verdict deny.
 * The record names no command, so the row is named by the script of the one hook the estate's settings put
 * under that event and matcher (`block-force-push.sh`), and by `<event>:<matcher>` when the settings hold
 * none or several. Hook records carry no time; every row takes the turn's start, so it falls in the turn.
 */
export function hookDecisions(parsed: ParsedStream, settings: unknown, at: string): HookRow[] {
  const rows: HookRow[] = [];
  for (const entry of parsed.lines) {
    if (!entry.ok || !isRecord(entry.value)) continue;
    const record = entry.value;
    if (stringField(record, 'type') !== 'system') continue;
    const subtype = stringField(record, 'subtype');
    if (subtype === 'permission_denied') {
      const tool = stringField(record, 'tool_name') ?? 'unknown';
      rows.push({ at, event: 'PermissionRequest', check: `permission:${tool}`, verdict: 'deny' });
      continue;
    }
    if (subtype !== 'hook_response') continue;
    const name = stringField(record, 'hook_name') ?? stringField(record, 'hook_event') ?? 'hook';
    const event = stringField(record, 'hook_event') ?? name.split(':')[0] ?? name;
    const matcher = name.includes(':') ? name.slice(name.indexOf(':') + 1) : undefined;
    rows.push({ at, event, check: scriptOf(settings, event, matcher) ?? name, verdict: verdictOf(record) });
  }
  return rows;
}

function verdictOf(record: Record<string, unknown>): string {
  const stdout = stringField(record, 'stdout') ?? '';
  if (stdout.trim().startsWith('{')) {
    try {
      const output: unknown = JSON.parse(stdout);
      if (isRecord(output)) {
        const specific = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {};
        const decision = stringField(specific, 'permissionDecision') ?? stringField(output, 'decision');
        if (decision !== undefined) return decision === 'block' ? 'deny' : decision;
      }
    } catch {
      // Not JSON after all: the exit code decides.
    }
  }
  const code = record.exit_code;
  if (code === 2) return 'deny';
  if (code === 0) return 'allow';
  return 'error';
}

/** The script name of the one command hook the settings put under the event and matcher. */
function scriptOf(settings: unknown, event: string, matcher: string | undefined): string | undefined {
  const hooks = isRecord(settings) && isRecord(settings.hooks) ? settings.hooks : undefined;
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return undefined;
  const commands: string[] = [];
  for (const group of groups) {
    if (!isRecord(group)) continue;
    const own = typeof group.matcher === 'string' && group.matcher !== '' ? group.matcher : undefined;
    if (own !== matcher) continue;
    for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
      if (isRecord(hook) && typeof hook.command === 'string') commands.push(hook.command);
    }
  }
  if (commands.length !== 1) return undefined;
  const words = (commands[0] ?? '').split(/\s+/).map((word) => word.replace(/["']/g, ''));
  const script = [...words].reverse().find((word) => /\.[A-Za-z0-9]+$/.test(word)) ?? words.at(-1);
  return script?.split('/').at(-1);
}
