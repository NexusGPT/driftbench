import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Check } from '@agent-nexus/driftbench-core';
import {
  createClaudeCliJudge,
  type JudgeClient,
  JudgeError,
  noJudgeCheck,
  singleJudgeCheck,
} from '@agent-nexus/driftbench-judges';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';

/**
 * The judge of a run (`estate run`, `replay`): `--judge claude:<model>` asks the local `claude` command,
 * one call per judged criterion per block, through the judges package's command client. Its cost is added
 * to the run's cost. With no `--judge`, every criterion a block names is inconclusive and gates as the
 * criterion does: never a pass.
 *
 * A judge command that is not a stand-in (a file carrying the stand-in marker) is billed, so it needs
 * `--judge-budget <usd>`: once the judge has spent that much, every later criterion is inconclusive.
 */

/** The line a stand-in command carries in its first lines. Any other command is billed. */
export const STAND_IN_MARKER = '@driftbench-stand-in';

/** True when the command is a file that names itself a stand-in in its first lines. */
export async function isStandIn(command: string): Promise<boolean> {
  if (!command.includes('/')) return false;
  const handle = await open(command, 'r').catch(() => undefined);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').includes(STAND_IN_MARKER);
  } finally {
    await handle.close();
  }
}

export type RunJudgeOptions = { judge?: string; judgeCommand?: string; judgeBudget?: string };

export type RunJudge = {
  check: Check;
  /** What the judge has spent so far, in US dollars. */
  spend: { usd: number };
  /** `claude:<model>`, or `none`. */
  label: string;
  billed: boolean;
};

export function addJudgeOptions(command: Command): Command {
  return command
    .option(
      '--judge <judge>',
      'judge the judged criteria with claude:<model>, such as claude:haiku (paid calls)',
    )
    .option('--judge-command <path>', 'the claude command the judge runs (default claude)')
    .option(
      '--judge-budget <usd>',
      'stop judging once the judge has spent this much; needed for a billed judge',
    );
}

export async function runJudgeFrom(
  options: RunJudgeOptions,
  io: Io,
  env: Record<string, string | undefined> = process.env,
): Promise<RunJudge | undefined> {
  const spend = { usd: 0 };
  if (options.judge === undefined) {
    if (options.judgeCommand !== undefined || options.judgeBudget !== undefined) {
      io.err('error: --judge-command and --judge-budget need --judge claude:<model>\n');
      return undefined;
    }
    return { check: noJudgeCheck(), spend, label: 'none', billed: false };
  }
  const match = /^claude:([A-Za-z0-9._-]+)$/.exec(options.judge.trim());
  if (!match?.[1]) {
    io.err(`error: --judge takes claude:<model>, such as claude:haiku, not "${options.judge}"\n`);
    return undefined;
  }
  const model = match[1];
  let budget: number | undefined;
  if (options.judgeBudget !== undefined) {
    budget = optionNumber(options.judgeBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      io.err(`error: --judge-budget takes a positive number of US dollars, not "${options.judgeBudget}"\n`);
      return undefined;
    }
  }
  const path = options.judgeCommand === undefined ? 'claude' : resolve(io.cwd, options.judgeCommand);
  const billed = !(await isStandIn(path));
  if (billed && budget === undefined) {
    io.err('error: a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>\n');
    return undefined;
  }
  const script = /\.(c|m)?js$/.test(path);
  const client = createClaudeCliJudge({
    model,
    env: { ...env, CLAUDE_JUDGE_MODEL: model },
    ...(script ? { command: process.execPath, commandArgs: [path] } : { command: path }),
    ...(budget === undefined ? {} : { maxBudgetUsd: budget }),
  });
  return { check: singleJudgeCheck(capped(client, spend, budget)), spend, label: `claude:${model}`, billed };
}

/** A client that stops calling once the spend reaches the cap, and adds every reported cost to it. */
function capped(client: JudgeClient, spend: { usd: number }, cap: number | undefined): JudgeClient {
  return {
    id: client.id,
    family: client.family,
    cls: client.cls,
    ...(client.model ? { model: client.model } : {}),
    cost: client.cost,
    async judge(request) {
      if (cap !== undefined && spend.usd >= cap) {
        throw new JudgeError('config', `the judge budget of ${cap} USD is spent: no more judge calls`);
      }
      const result = await client.judge(request);
      spend.usd += result.costUsd ?? 0;
      return result;
    },
  };
}
