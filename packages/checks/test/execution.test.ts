import type { ExecutionRecord } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { execution } from '../src/checks/execution';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const task = acme('acme-price-sheet');
const built = 'I wrote out/acme-price-sheet.xlsx with the sheets Mobile and Home.';
const runs: ExecutionRecord[] = [
  { command: 'python -c "import openpyxl"', exitCode: 0 },
  { command: 'python build_sheet.py catalog.csv out/acme-price-sheet.xlsx', exitCode: 0 },
  { command: 'python check_sheet.py out/acme-price-sheet.xlsx', exitCode: 0, stdout: 'ok' },
];

describe('execution', () => {
  it('passes block 0 of acme-price-sheet: code ran, the last command exited 0, within 10 commands', async () => {
    const verdicts = await run(execution, context(task, 0, observed(built, [], { executions: runs })));
    expect(outcomes(verdicts)).toEqual({
      'execution.ran_code': 'pass',
      'execution.exit_code': 'pass',
      'execution.max_commands': 'pass',
    });
    expect(verdict(verdicts, 'execution.exit_code').evidence).toBe(
      'the last command "python check_sheet.py out/acme-price-sheet.xlsx" exited with 0, 0 expected',
    );
  });

  it('mutation: the last command exits 1; execution.exit_code fails and quotes stderr', async () => {
    const failed = [
      ...runs.slice(0, 2),
      { ...runs[2], exitCode: 1, stderr: 'AssertionError: D2 is not a formula' },
    ];
    const verdicts = await run(
      execution,
      context(task, 0, observed(built, [], { executions: failed as ExecutionRecord[] })),
    );
    expect(verdict(verdicts, 'execution.exit_code')).toMatchObject({
      outcome: 'fail',
      evidence:
        'the last command "python check_sheet.py out/acme-price-sheet.xlsx" exited with 1, 0 expected; stderr "AssertionError: D2 is not a formula"',
    });
  });

  it('mutation: eleven commands fail max_commands, and no command at all fails ran_code and exit_code', async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({ command: `step ${index}`, exitCode: 0 }));
    const busy = await run(execution, context(task, 0, observed(built, [], { executions: many })));
    expect(verdict(busy, 'execution.max_commands').evidence).toMatch(
      /^11 commands ran: .* and 6 more; at most 10 allowed$/,
    );
    const idle = await run(execution, context(task, 0, observed(built, [], { executions: [] })));
    expect(outcomes(idle)).toEqual({
      'execution.ran_code': 'fail',
      'execution.exit_code': 'fail',
      'execution.max_commands': 'pass',
    });
  });

  it('ran_code false passes when nothing ran, and every verdict is inconclusive without an executions list', async () => {
    const quiet = context(task, 0, observed(built, [], { executions: [] }), {
      expect: { execution: { ran_code: false } },
    });
    expect(outcomes(await run(execution, quiet))).toEqual({ 'execution.ran_code': 'pass' });
    const blind = await run(execution, context(task, 0, observed(built)));
    expect(blind.map((item) => item.outcome)).toEqual(['inconclusive', 'inconclusive', 'inconclusive']);
  });

  describe('as the process adapter reports a block: the commands, then the agent process last (role agent)', () => {
    const agent: ExecutionRecord = {
      command: 'acme-ops --task driftbench-stimulus.txt',
      role: 'agent',
      exitCode: 0,
    };
    const reported = runs.map((record): ExecutionRecord => ({ ...record, role: 'command' }));

    it('passes block 0 of acme-price-sheet: the agent process is neither code run nor a command', async () => {
      const verdicts = await run(
        execution,
        context(task, 0, observed(built, [], { executions: [...reported, agent] })),
      );
      expect(outcomes(verdicts)).toEqual({
        'execution.ran_code': 'pass',
        'execution.exit_code': 'pass',
        'execution.max_commands': 'pass',
      });
      expect(verdict(verdicts, 'execution.max_commands').evidence).toMatch(/^3 commands ran: /);
    });

    it('mutation: the agent reports no command; ran_code fails although the agent process ran', async () => {
      const verdicts = await run(execution, context(task, 0, observed(built, [], { executions: [agent] })));
      expect(verdict(verdicts, 'execution.ran_code')).toMatchObject({
        outcome: 'fail',
        evidence: 'ran_code true expected; no command ran; the agent process exited with 0',
      });
      expect(verdict(verdicts, 'execution.exit_code').evidence).toBe(
        'the agent reported no command; the agent process exited with 0, 0 expected',
      );
    });

    it('mutation: the agent process crashes after a clean last command; exit_code reads the crash, names both', async () => {
      const crashed: ExecutionRecord = { ...agent, exitCode: 1, stderr: 'Error: out of memory' };
      const verdicts = await run(
        execution,
        context(task, 0, observed(built, [], { executions: [...reported, crashed] })),
      );
      expect(verdict(verdicts, 'execution.exit_code')).toMatchObject({
        outcome: 'fail',
        evidence:
          'the agent process exited with 1, 0 expected; stderr "Error: out of memory"; the last command "python check_sheet.py out/acme-price-sheet.xlsx" exited with 0',
      });
      const alone = await run(execution, context(task, 0, observed(built, [], { executions: [crashed] })));
      expect(verdict(alone, 'execution.exit_code').evidence).toBe(
        'the agent process exited with 1, 0 expected; stderr "Error: out of memory"; the agent reported no command',
      );
    });

    it('mutation: the last command fails while the agent process exits 0; exit_code reads the command', async () => {
      const failed = [...reported.slice(0, 2), { ...(reported[2] as ExecutionRecord), exitCode: 2 }, agent];
      const verdicts = await run(execution, context(task, 0, observed(built, [], { executions: failed })));
      expect(verdict(verdicts, 'execution.exit_code')).toMatchObject({
        outcome: 'fail',
        evidence:
          'the last command "python check_sheet.py out/acme-price-sheet.xlsx" exited with 2, 0 expected; the agent process exited with 0',
      });
    });
  });
});
