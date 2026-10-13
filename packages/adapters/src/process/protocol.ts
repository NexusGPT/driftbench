import type { ExecutionRecord, RuntimeTrace } from '@agent-nexus/driftbench-core';

/**
 * The two optional line protocols a code agent can write in its workspace during a block. Each line is
 * one JSON object; blank lines are skipped; a line that does not parse is skipped and named in the
 * result, never guessed at.
 *
 * driftbench-commands.jsonl, one command the agent ran per line:
 *   {"command": "python build.py", "exitCode": 0, "startedAt": "2026-01-01T00:00:00.000Z", "latencyMs": 812}
 *
 * driftbench-runtime.jsonl, one runtime event per line:
 *   {"type": "skill", "name": "xlsx"}
 *   {"type": "guard", "name": "no_destructive_ops", "verdict": "pass"}
 *   {"type": "stage", "name": "build_sheet"}
 * Each may carry "at", an ISO time.
 */

export type ParseResult<T> = { value: T; errors: string[] };

export function parseCommands(text: string, file: string): ParseResult<ExecutionRecord[]> {
  const value: ExecutionRecord[] = [];
  const errors: string[] = [];
  for (const [line, entry] of objects(text, file, errors)) {
    const { command, exitCode, startedAt, latencyMs } = entry;
    if (typeof command !== 'string' || command === '') {
      errors.push(`${file} line ${line}: "command" must be a non-empty string`);
    } else if (typeof exitCode !== 'number' || !Number.isInteger(exitCode)) {
      errors.push(`${file} line ${line}: "exitCode" must be an integer`);
    } else if (startedAt !== undefined && typeof startedAt !== 'string') {
      errors.push(`${file} line ${line}: "startedAt" must be a string`);
    } else if (
      latencyMs !== undefined &&
      (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0)
    ) {
      errors.push(`${file} line ${line}: "latencyMs" must be a number of 0 or more`);
    } else {
      value.push({
        command,
        role: 'command',
        exitCode,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(latencyMs === undefined ? {} : { latencyMs }),
      });
    }
  }
  return { value, errors };
}

export function parseRuntime(
  text: string,
  file: string,
): ParseResult<Required<Pick<RuntimeTrace, 'skills' | 'guards' | 'stages'>>> {
  const value: Required<Pick<RuntimeTrace, 'skills' | 'guards' | 'stages'>> = {
    skills: [],
    guards: [],
    stages: [],
  };
  const errors: string[] = [];
  for (const [line, entry] of objects(text, file, errors)) {
    const { type, name, verdict, at } = entry;
    if (typeof name !== 'string' || name === '') {
      errors.push(`${file} line ${line}: "name" must be a non-empty string`);
    } else if (at !== undefined && typeof at !== 'string') {
      errors.push(`${file} line ${line}: "at" must be a string`);
    } else if (type === 'skill') {
      value.skills.push({ name, ...(at === undefined ? {} : { at }) });
    } else if (type === 'stage') {
      value.stages.push({ name, ...(at === undefined ? {} : { at }) });
    } else if (type === 'guard') {
      if (typeof verdict !== 'string' || verdict === '') {
        errors.push(`${file} line ${line}: a guard needs a non-empty "verdict"`);
      } else {
        value.guards.push({ name, verdict, ...(at === undefined ? {} : { at }) });
      }
    } else {
      errors.push(`${file} line ${line}: "type" must be skill, guard or stage`);
    }
  }
  return { value, errors };
}

/** The JSON objects of a JSON-lines text, with their 1-based line numbers. */
function* objects(
  text: string,
  file: string,
  errors: string[],
): Generator<[number, Record<string, unknown>]> {
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`${file} line ${index + 1}: not JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${file} line ${index + 1}: not a JSON object`);
      continue;
    }
    yield [index + 1, parsed as Record<string, unknown>];
  }
}
