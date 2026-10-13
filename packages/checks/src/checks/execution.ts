import { type Check, type ExecutionRecord, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { agentProcess, commandsOf } from '../support/executions';
import { plural } from '../support/values';

const NAME = 'execution';

/**
 * `expect.execution` against the commands the block ran, `observed.executions`. A record with role
 * `agent` is the agent's own process, not a command it ran: it never counts as code run or as a command.
 * `ran_code` true needs at least one command and false forbids any. `exit_code` is the exit code of the
 * last command; when the agent process exited non-zero (a crash), it is the agent process's; with no
 * command, it is the agent process's too. `max_commands` caps how many commands ran. An adapter that reports no executions list observed nothing, so each verdict is
 * inconclusive rather than a pass on nothing.
 */
export const execution: Check = {
  name: NAME,
  applies: (ctx) => {
    const expected = ctx.expect.execution;
    return (
      expected !== undefined &&
      (expected.ran_code !== undefined ||
        expected.exit_code !== undefined ||
        expected.max_commands !== undefined)
    );
  },
  evaluate(ctx) {
    const expected = ctx.expect.execution ?? {};
    const runs = ctx.observed.executions;
    const verdicts: Verdict[] = [];
    const facts: Array<[string, boolean]> = [
      ['ran_code', expected.ran_code !== undefined],
      ['exit_code', expected.exit_code !== undefined],
      ['max_commands', expected.max_commands !== undefined],
    ];
    if (runs === undefined) {
      for (const [id, asked] of facts) {
        if (asked) {
          verdicts.push(
            machineVerdict(
              NAME,
              id,
              'inconclusive',
              'the adapter reported no executions list for this block',
            ),
          );
        }
      }
      return verdicts;
    }
    const commands = commandsOf(runs);
    const agent = agentProcess(runs);
    const agentNote = agent === undefined ? '' : `; the agent process exited with ${agent.exitCode}`;
    const summary =
      commands.length === 0
        ? `no command ran${agentNote}`
        : `${plural(commands.length, 'command')} ran: ${listed(commands)}`;

    if (expected.ran_code !== undefined) {
      const ran = commands.length > 0;
      verdicts.push(
        machineVerdict(
          NAME,
          'ran_code',
          expected.ran_code === ran ? 'pass' : 'fail',
          `ran_code ${expected.ran_code} expected; ${summary}`,
        ),
      );
    }
    if (expected.exit_code !== undefined) verdicts.push(exitCode(expected.exit_code, commands, agent));
    if (expected.max_commands !== undefined) {
      verdicts.push(
        machineVerdict(
          NAME,
          'max_commands',
          commands.length <= expected.max_commands ? 'pass' : 'fail',
          `${summary}; at most ${expected.max_commands} allowed`,
        ),
      );
    }
    return verdicts;
  },
};

/**
 * The exit code `exit_code` reads: the agent process's when it exited non-zero (a crashed agent fails
 * `exit_code: 0` even after a clean last command), else the last command's, else the agent process's when
 * the agent reported no command. The evidence names both when both exist.
 */
function exitCode(want: number, commands: ExecutionRecord[], agent: ExecutionRecord | undefined): Verdict {
  const last = commands.at(-1);
  const verdict = (got: number, evidence: string) =>
    machineVerdict(NAME, 'exit_code', got === want ? 'pass' : 'fail', evidence);
  const lastText =
    last && `the last command ${JSON.stringify(cut(last.command))} exited with ${last.exitCode}`;
  if (agent !== undefined && agent.exitCode !== 0) {
    const also = lastText ? `; ${lastText}` : '; the agent reported no command';
    return verdict(
      agent.exitCode,
      `the agent process exited with ${agent.exitCode}, ${want} expected${stderr(agent)}${also}`,
    );
  }
  if (last !== undefined) {
    const also = agent === undefined ? '' : `; the agent process exited with ${agent.exitCode}`;
    return verdict(last.exitCode, `${lastText}, ${want} expected${stderr(last)}${also}`);
  }
  if (agent !== undefined) {
    return verdict(
      agent.exitCode,
      `the agent reported no command; the agent process exited with ${agent.exitCode}, ${want} expected`,
    );
  }
  return machineVerdict(
    NAME,
    'exit_code',
    'fail',
    `no command ran, so there is no exit code; ${want} expected`,
  );
}

function listed(runs: ExecutionRecord[]): string {
  const shown = runs.slice(0, 5).map((run) => `${JSON.stringify(cut(run.command))} (exit ${run.exitCode})`);
  return runs.length > 5 ? `${shown.join(', ')} and ${runs.length - 5} more` : shown.join(', ');
}

function stderr(run: ExecutionRecord): string {
  const text = run.stderr?.trim();
  return run.exitCode !== 0 && text ? `; stderr ${JSON.stringify(cut(text, 120))}` : '';
}

function cut(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}...` : line;
}
