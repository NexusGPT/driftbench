import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJudgeText } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult } from '../contract';
import { isRecord, JudgeError } from '../http';
import { buildPrompt } from '../prompt';
import { JUDGE_DIALECTS, withJudgeDialect } from './dialects';
import type { TokenUsage } from './usage';

/**
 * A system 2 judge behind the local `claude` command (Claude Code in print mode), for a machine where the
 * account is signed in to the command and no API key is set. One call is one process:
 *
 *   claude -p --output-format json --model <m> --system-prompt <judge system prompt> --tools ""
 *     --setting-sources "" --strict-mcp-config --no-session-persistence --max-turns 1
 *
 * The user prompt (rubric and data, inside their data tags) goes on stdin, never on the command line. The
 * process runs in an empty folder of its own, with no tool, no settings file and no MCP server, so no
 * project file, memory or hook of the caller reaches the judge. The answer is the `result` text of the
 * JSON result, read through the answer contract; the cost is its `total_cost_usd`.
 *
 * Errors: an API error result is retryable and gives no answer; a run that stopped at its turn limit is an
 * unparsed answer, never a pass. An output-limit error gets one lower-effort recovery, subject to the
 * caller spend cap. Reads CLAUDE_JUDGE_MODEL when no model is given.
 */

export type ClaudeCliOptions = Pick<ClientOptions, 'env' | 'id' | 'model' | 'cost' | 'timeoutMs'> & {
  /** The command to run. Default `claude`. */
  command?: string;
  /** Arguments before the judge's own, such as a script path for a fake command. */
  commandArgs?: readonly string[];
  /** Passed as --max-budget-usd on every call: the command stops a call that would spend more. */
  maxBudgetUsd?: number;
  /** Opt-in adaptive thinking control. Unset preserves the native request. */
  claudeEffort?: 'low' | 'medium' | 'high';
  /** Conservative upper bound reserved before a recovery when maxBudgetUsd is set. */
  retryMaxCostUsd?: number;
};

/**
 * Relative cost by model, from the list price ratio of the three Claude tiers (1 : 3 : 5), on the scale
 * where a chat model costs 10. A model name that names none of them costs 10.
 */
export function claudeCost(model: string): number {
  const name = model.toLowerCase();
  if (name.includes('opus')) return 50;
  if (name.includes('sonnet')) return 30;
  return 10;
}

/** The flags that shape every answer: no tool, no settings file, no MCP server, no session, one turn. */
export const CLAUDE_JUDGE_FLAGS = [
  '--tools',
  '',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--max-turns',
  '1',
] as const;

/** The client settings a cassette keys on: the print-mode format and the judge flags (not the spend cap). */
export const CLAUDE_SETTINGS = JSON.stringify(['-p', '--output-format', 'json', ...CLAUDE_JUDGE_FLAGS]);

type Ran = { code: number | null; stdout: string; stderr: string };

export function createClaudeCliJudge(options: ClaudeCliOptions = {}): JudgeClient {
  const env = options.env ?? process.env;
  const model = env.CLAUDE_JUDGE_MODEL?.trim() || options.model;
  if (!model) throw new JudgeError('config', 'CLAUDE_JUDGE_MODEL is not set and no model was given');
  const command = options.command ?? 'claude';
  const timeoutMs = options.timeoutMs ?? 120_000;
  let folder: string | undefined;
  const workdir = () => {
    folder ??= mkdtempSync(join(tmpdir(), 'driftbench-claude-judge-'));
    return folder;
  };

  return {
    id: options.id ?? `claude-${model}`,
    family: 'anthropic',
    cls: 'system2',
    model,
    dialect: JUDGE_DIALECTS['claude-cli'].id,
    cost: options.cost ?? claudeCost(model),
    settings:
      options.claudeEffort === undefined
        ? CLAUDE_SETTINGS
        : JSON.stringify({ settings: CLAUDE_SETTINGS, claudeEffort: options.claudeEffort }),
    async judge(original) {
      const request = withJudgeDialect(original, JUDGE_DIALECTS['claude-cli'].id);
      const prompt = buildPrompt(request);
      const args = [
        ...(options.commandArgs ?? []),
        '-p',
        '--output-format',
        'json',
        '--model',
        model,
        '--system-prompt',
        prompt.system,
        ...CLAUDE_JUDGE_FLAGS,
        ...(options.maxBudgetUsd === undefined ? [] : ['--max-budget-usd', String(options.maxBudgetUsd)]),
      ];
      const sent = await runClaudeJudgeCommand(command, args, prompt.user, {
        ...options,
        cwd: workdir(),
        env,
        timeoutMs,
      });
      return { ...readResult(sent.ran, model, request), ...sent.accounting };
    },
  };
}

function readResult(ran: Ran, model: string, request: JudgeRequest): JudgeResult {
  let payload: unknown;
  try {
    payload = JSON.parse(ran.stdout);
  } catch {
    if (ran.code !== 0) {
      throw new JudgeError('http', `claude exited ${ran.code}: ${clip(ran.stderr || ran.stdout)}`);
    }
    throw new JudgeError('bad_response', `claude printed not a JSON result: ${clip(ran.stdout)}`);
  }
  if (!isRecord(payload) || payload.type !== 'result') {
    throw new JudgeError('bad_response', `claude printed not a JSON result: ${clip(ran.stdout)}`);
  }
  const cost =
    typeof payload.total_cost_usd === 'number' && payload.total_cost_usd >= 0
      ? { costUsd: payload.total_cost_usd }
      : {};
  const text = typeof payload.result === 'string' ? payload.result : '';
  if (payload.is_error === true) {
    throw new JudgeError('http', `claude ${model} answered with an error: ${clip(text)}`, {
      retryable: true,
    });
  }
  if (payload.subtype !== 'success') {
    return {
      answer: inconclusive(`claude ${model} stopped without an answer: ${String(payload.subtype)}`),
      raw: ran.stdout,
      unparsed: true,
      ...cost,
    };
  }
  return { ...parseJudgeText(text, request), ...cost };
}

/** Shared isolated-process mechanics for contract-aware judges and raw dialect transports. */
export function runClaudeCommand(
  command: string,
  args: readonly string[],
  input: string,
  options: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number },
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new JudgeError('network', `claude ran past ${options.timeoutMs} ms and was stopped`, {
          retryable: true,
        }),
      );
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (cause) => {
      clearTimeout(timer);
      reject(new JudgeError('config', `cannot run ${command}: ${cause.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The process closed its input early; its exit code and output say why.
    });
    child.stdin.end(input);
  });
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
}

export type ClaudeThinkingRecovery = {
  readonly reason: 'reasoning-budget-exhausted';
  readonly requestCount: number;
  readonly attempts: readonly { raw: string; usage: TokenUsage; costUsd?: number }[];
  readonly retrySkipped?: 'spend-cap';
};
export class ClaudeThinkingError extends JudgeError {
  constructor(
    readonly thinkingRecovery: ClaudeThinkingRecovery,
    readonly usage: TokenUsage,
    readonly costUsd?: number,
  ) {
    super('reasoning-budget-exhausted', 'Claude exhausted its output budget before producing an answer');
  }
}
/** Keeps native receipts and cumulative billing even when a recovery fails. */
export async function runClaudeJudgeCommand(
  command: string,
  args: readonly string[],
  input: string,
  options: ClaudeCliOptions & { cwd: string; env: Record<string, string | undefined>; timeoutMs: number },
): Promise<{
  ran: Ran;
  accounting: { thinkingRecovery?: ClaudeThinkingRecovery; usage?: TokenUsage; costUsd?: number };
}> {
  for (const n of [options.maxBudgetUsd, options.retryMaxCostUsd])
    if (n !== undefined && (!Number.isFinite(n) || n <= 0))
      throw new RangeError('spend limits must be positive and finite');
  const attempts: { raw: string; usage: TokenUsage; costUsd?: number }[] = [];
  const totals = () => {
    const usage: Record<string, number> = {};
    for (const key of ['input', 'output'] as const)
      if (attempts.every((a) => a.usage[key] !== undefined))
        usage[key] = attempts.reduce((n, a) => n + (a.usage[key] ?? 0), 0);
    const costUsd = attempts.every((a) => a.costUsd !== undefined)
      ? attempts.reduce((n, a) => n + (a.costUsd ?? 0), 0)
      : undefined;
    return { usage, ...(costUsd === undefined ? {} : { costUsd }) };
  };
  const recovery = (retrySkipped?: 'spend-cap'): ClaudeThinkingRecovery => ({
    reason: 'reasoning-budget-exhausted',
    requestCount: attempts.length,
    attempts,
    ...(retrySkipped ? { retrySkipped } : {}),
  });
  const fail = (skipped?: 'spend-cap') => {
    const t = totals();
    return new ClaudeThinkingError(recovery(skipped), t.usage, t.costUsd);
  };
  for (let n = 0; n < 2; n++) {
    const effort = n ? 'low' : options.claudeEffort;
    const nextArgs = [...args];
    if (effort !== undefined) nextArgs.push('--effort', effort);
    if (n && options.maxBudgetUsd !== undefined) {
      const spent = totals().costUsd;
      if (
        spent === undefined ||
        options.retryMaxCostUsd === undefined ||
        spent + options.retryMaxCostUsd > options.maxBudgetUsd
      )
        throw fail('spend-cap');
      const at = nextArgs.indexOf('--max-budget-usd');
      if (at >= 0) nextArgs[at + 1] = String(options.maxBudgetUsd - spent);
    }
    let ran: Ran;
    try {
      ran = await runClaudeCommand(command, nextArgs, input, options);
    } catch (cause) {
      if (n) {
        const error = fail();
        error.cause = cause;
        throw error;
      }
      throw cause;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(ran.stdout);
    } catch {
      payload = undefined;
    }
    const value = isRecord(payload) ? payload : {};
    const u = isRecord(value.usage) ? value.usage : {};
    const valid = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    attempts.push({
      raw: ran.stdout,
      usage: {
        ...(valid(u.input_tokens) ? { input: u.input_tokens } : {}),
        ...(valid(u.output_tokens) ? { output: u.output_tokens } : {}),
      },
      ...(valid(value.total_cost_usd) ? { costUsd: value.total_cost_usd } : {}),
    });
    const exhausted =
      value.is_error === true &&
      (value.api_error === 'max_output_tokens' ||
        (typeof value.result === 'string' &&
          /^API Error: Claude's response exceeded the \d+ output token maximum\./.test(value.result)));
    if (!exhausted) {
      if (n && (ran.code !== 0 || value.is_error === true || value.type !== 'result')) throw fail();
      return { ran, accounting: n ? { ...totals(), thinkingRecovery: recovery() } : {} };
    }
  }
  throw fail();
}
