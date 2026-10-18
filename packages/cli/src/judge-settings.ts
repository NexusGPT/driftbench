import {
  arithmeticSandbox,
  fitPrompt,
  type JudgeClient,
  withVerification,
} from '@agent-nexus/driftbench-judges';
import type { Command } from 'commander';
import type { Io } from './io';
import { optionNumber } from './number';

/**
 * Run-wide judge settings, on every command that builds a judge: `--verify arithmetic` checks the explicit
 * equations of a reply in a bounded arithmetic sandbox and hands the judge the results as a tool line;
 * `--prompt-budget <chars>` drops the oldest transcript entries until the rendered prompt fits. Absent, the
 * judge is used as it is, so its requests do not change.
 */

export type JudgeSettingOptions = { verify?: string; promptBudget?: string };

/** The settings as a wrapper of a judge client. */
export type JudgeSettings = (client: JudgeClient) => JudgeClient;

export const VERIFY_KINDS = ['arithmetic'] as const;

export function addJudgeSettingOptions(command: Command): Command {
  return command
    .option(
      '--verify <kind>',
      'check what the reply states before the judge reads it; arithmetic: explicit equations, in a bounded sandbox',
    )
    .option(
      '--prompt-budget <chars>',
      'drop the oldest transcript entries until the judge prompt fits this many characters; the last block stays',
    );
}

/** The wrapper the options ask for; undefined after printing why an option is wrong. */
export function judgeSettingsFrom(options: JudgeSettingOptions, io: Io): JudgeSettings | undefined {
  if (options.verify !== undefined && !(VERIFY_KINDS as readonly string[]).includes(options.verify)) {
    io.err(`error: --verify takes ${VERIFY_KINDS.join(', ')}, not "${options.verify}"\n`);
    return undefined;
  }
  let budget: number | undefined;
  if (options.promptBudget !== undefined) {
    budget = optionNumber(options.promptBudget);
    if (!Number.isInteger(budget) || budget <= 0) {
      io.err(
        `error: --prompt-budget takes a whole number of characters above 0, not "${options.promptBudget}"\n`,
      );
      return undefined;
    }
  }
  const verify = options.verify !== undefined;
  return (client) => {
    let wrapped = client;
    if (verify) wrapped = withVerification(wrapped, { enabled: true, sandbox: arithmeticSandbox() });
    if (budget !== undefined) wrapped = withPromptBudget(wrapped, budget);
    return wrapped;
  };
}

/** A client that fits each request to the budget before the inner client reads it. */
function withPromptBudget(client: JudgeClient, maxChars: number): JudgeClient {
  const compare = client.judgeComparison?.bind(client);
  return {
    ...client,
    judge: (request) => client.judge(fitPrompt(request, maxChars)),
    ...(compare
      ? { judgeComparison: (a, b) => compare(fitPrompt(a, maxChars), fitPrompt(b, maxChars)) }
      : {}),
  };
}
