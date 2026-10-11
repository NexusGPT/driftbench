import { type Check, type ExecutionRecord, machineVerdict, type Verdict } from '@driftbench/core';
import { plural } from '../support/values';

const NAME = 'execution';

/**
 * `expect.execution` against the commands the block ran, `observed.executions`: `ran_code` true needs at
 * least one command and false forbids any, `exit_code` is the exit code of the last command, and
 * `max_commands` caps how many ran. An adapter that reports no executions list observed no command, so
 * each verdict is inconclusive rather than a pass on nothing.
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
    const summary =
      runs.length === 0 ? 'no command ran' : `${plural(runs.length, 'command')} ran: ${commands(runs)}`;

    if (expected.ran_code !== undefined) {
      const ran = runs.length > 0;
      const ok = expected.ran_code === ran;
      verdicts.push(
        machineVerdict(
          NAME,
          'ran_code',
          ok ? 'pass' : 'fail',
          `ran_code ${expected.ran_code} expected; ${summary}`,
        ),
      );
    }
    if (expected.exit_code !== undefined) {
      const last = runs.at(-1);
      verdicts.push(
        last === undefined
          ? machineVerdict(
              NAME,
              'exit_code',
              'fail',
              `no command ran, so there is no exit code; ${expected.exit_code} expected`,
            )
          : machineVerdict(
              NAME,
              'exit_code',
              last.exitCode === expected.exit_code ? 'pass' : 'fail',
              `the last command ${JSON.stringify(cut(last.command))} exited with ${last.exitCode}, ${expected.exit_code} expected${stderr(last)}`,
            ),
      );
    }
    if (expected.max_commands !== undefined) {
      verdicts.push(
        machineVerdict(
          NAME,
          'max_commands',
          runs.length <= expected.max_commands ? 'pass' : 'fail',
          `${summary}; at most ${expected.max_commands} allowed`,
        ),
      );
    }
    return verdicts;
  },
};

function commands(runs: ExecutionRecord[]): string {
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
