import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJudgeText } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult } from '../contract';
import { isRecord, JudgeError } from '../http';
import { buildPrompt } from '../prompt';

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
 * unparsed answer, never a pass. The command has no token limit flag, so the large budget asks again the
 * same way. Reads CLAUDE_JUDGE_MODEL when no model is given.
 */

export type ClaudeCliOptions = Pick<ClientOptions, 'env' | 'id' | 'model' | 'cost' | 'timeoutMs'> & {
  /** The command to run. Default `claude`. */
  command?: string;
  /** Arguments before the judge's own, such as a script path for a fake command. */
  commandArgs?: readonly string[];
  /** Passed as --max-budget-usd on every call: the command stops a call that would spend more. */
  maxBudgetUsd?: number;
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
const JUDGE_FLAGS = [
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
export const CLAUDE_SETTINGS = JSON.stringify(['-p', '--output-format', 'json', ...JUDGE_FLAGS]);

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
    cost: options.cost ?? claudeCost(model),
    settings: CLAUDE_SETTINGS,
    async judge(request) {
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
        ...JUDGE_FLAGS,
        ...(options.maxBudgetUsd === undefined ? [] : ['--max-budget-usd', String(options.maxBudgetUsd)]),
      ];
      const ran = await run(command, args, prompt.user, { cwd: workdir(), env, timeoutMs });
      return readResult(ran, model, request);
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

function run(
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
