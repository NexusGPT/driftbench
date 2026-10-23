/**
 * The Claude Code session format, as this adapter reads it. Written from public knowledge of the format;
 * every field below is optional to the reader, and a record it does not know is kept, never dropped.
 *
 * Transcript. A JSONL file, one JSON record per line. Each record has a `type`:
 * - `user`: `message.content` is a string or a list of content blocks. A typed message (a string, or text
 *   blocks) opens a user turn. A record whose blocks are `tool_result` blocks carries tool results: each has
 *   `tool_use_id` (the id of the call it answers), `content` (a string or a list of text blocks) and
 *   `is_error`. Such a record may also carry `toolUseResult`, the tool's structured result (for Bash
 *   `stdout`, `stderr`, `interrupted`; for Write `type: create | update`). `isMeta: true` marks a message
 *   the runtime injected; `isCompactSummary: true` marks the summary that follows a compaction. Neither
 *   opens a turn.
 * - `assistant`: `message.content` is a list of blocks: `text` (`text`), `tool_use` (`id`, `name`,
 *   `input`), `thinking`. `message.id` names the model message; the runtime may split one message over
 *   several records, each repeating `message.usage` (`input_tokens`, `output_tokens`,
 *   `cache_creation_input_tokens`, `cache_read_input_tokens`), so usage counts once per message id.
 * - `system`: runtime notices. `subtype: compact_boundary` marks a compaction (`compactMetadata.trigger`,
 *   `compactMetadata.preTokens`). `subtype: init`, written by a headless run's stream, names the tools the
 *   runtime offered in `tools` (a tool a setting denies is not offered); a saved transcript may hold none.
 * - `summary`: a session title (`summary`, `leafUuid`); it belongs to the session, not to a turn.
 * - anything else (file history snapshots, queue operations, attachments): kept in `raw`.
 * Common fields: `uuid`, `parentUuid`, `sessionId`, `cwd`, `version`, `timestamp` (ISO 8601) and
 * `isSidechain` (true for the records of a helper's own conversation when the runtime writes them into the
 * same file; they are the helper's acts, not the agent's: kept in `raw`, and their tool calls are mapped to the
 * block's `helperCalls`, tied to the Agent call that began the helper by `parent_tool_use_id` or the `parentUuid` chain).
 *
 * Guard decision log (optional). A JSONL file, one row per guard verdict: `{ at, event, check, verdict }`,
 * with `at` in ISO 8601, `event` the runtime event that fired it (PreToolUse, Stop, ...), `check` the name
 * of the guard and `verdict` its verdict (allow, deny, nudge, ...). A row may carry `session`, the session
 * id; rows of another session are left out.
 *
 * Step feed (optional). A JSONL file, one row per stage reached: `{ at, step }`.
 */

import { isRecord } from '../shared/records';

/** One parsed line of a JSONL file: the record, or the text and the reason it did not parse. */
export type JsonlLine =
  | { line: number; ok: true; value: unknown }
  | { line: number; ok: false; text: string; error: string };

/** Parses JSONL text. Blank lines are skipped; a line that is not JSON is returned with its error. */
export function parseJsonl(text: string): JsonlLine[] {
  const out: JsonlLine[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    try {
      out.push({ line: index + 1, ok: true, value: JSON.parse(raw) });
    } catch (cause) {
      out.push({
        line: index + 1,
        ok: false,
        text: raw,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
  return out;
}

/** One row of a guard decision log. */
export type DecisionRow = {
  at: string;
  event?: string;
  check: string;
  verdict: string;
  session?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outcome?: string;
};

/** One row of a step feed. */
export type StepRow = { at: string; step: string };

export { isRecord };

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** A decision-log row, or why the row is not one. */
export function decisionRow(value: unknown): DecisionRow | string {
  if (!isRecord(value)) return 'the row is not an object';
  const at = stringField(value, 'at');
  const check = stringField(value, 'check');
  const verdict = stringField(value, 'verdict');
  if (at === undefined || Number.isNaN(Date.parse(at))) return 'the row has no valid at';
  if (check === undefined || check === '') return 'the row has no check';
  if (verdict === undefined || verdict === '') return 'the row has no verdict';
  const event = stringField(value, 'event');
  const session = stringField(value, 'session');
  const stdout = stringField(value, 'stdout');
  const stderr = stringField(value, 'stderr');
  const outcome = stringField(value, 'outcome');
  return {
    at,
    check,
    verdict,
    ...(event === undefined ? {} : { event }),
    ...(session === undefined ? {} : { session }),
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
    ...(typeof value.exitCode === 'number' && Number.isInteger(value.exitCode)
      ? { exitCode: value.exitCode }
      : {}),
    ...(outcome === undefined ? {} : { outcome }),
  };
}

/** A step-feed row, or why the row is not one. */
export function stepRow(value: unknown): StepRow | string {
  if (!isRecord(value)) return 'the row is not an object';
  const at = stringField(value, 'at');
  const step = stringField(value, 'step');
  if (at === undefined || Number.isNaN(Date.parse(at))) return 'the row has no valid at';
  if (step === undefined || step === '') return 'the row has no step';
  return { at, step };
}
