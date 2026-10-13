import { describe, expect, it } from 'vitest';
import { type GuardObservation, judgeGuardSpec, judgeHelperSpec, judgeScriptSpec } from '../../src/index';

const allow: GuardObservation = { decision: 'allow', ms: 20, timedOut: false };
const deny: GuardObservation = { decision: 'deny', message: 'Never force push.', ms: 25, timedOut: false };
const context: GuardObservation = {
  decision: 'allow',
  output: '{"additionalContext":"stop"}',
  ms: 20,
  timedOut: false,
};
const guard = { name: 'g.sh', timeoutMs: 5000 };

describe('a unit spec of a guard, judged on the runs of its payloads', () => {
  it('passes a negative control when the guard stays silent, and fails when it fires', () => {
    const spec = { guards: [{ name: 'g.sh', verdict: 'deny', count: 0 }] };
    expect(judgeGuardSpec(spec, guard, [allow, allow])).toEqual([]);
    expect(judgeGuardSpec(spec, guard, [allow, deny])).toEqual([
      'guards.g.sh: fired on 1 of 2 payloads, expected none (deny: Never force push.)',
    ]);
    expect(judgeGuardSpec({ guards: [{ name: 'g.sh', count: 0 }] }, guard, [context])).toHaveLength(1);
  });

  it('asks for one payload that sets the guard off, with the verdict when the spec names one', () => {
    const any = { guards: [{ name: 'g.sh', count: { min: 1 } }] };
    expect(judgeGuardSpec(any, guard, [allow, context])).toEqual([]);
    expect(judgeGuardSpec(any, guard, [allow, allow])).toEqual([
      'guards.g.sh: fired on none of 2 payloads, expected at least one',
    ]);
    const denies = { guards: [{ name: 'g.sh', verdict: 'deny', count: { min: 1 } }] };
    expect(judgeGuardSpec(denies, guard, [allow, deny])).toEqual([]);
    expect(judgeGuardSpec(denies, guard, [context])).toEqual([
      'guards.g.sh: no payload was denied, expected a deny',
    ]);
  });

  it('fails a run over the declared timeout, and a blocking message that breaks an output rule', () => {
    const spec = { guards: [{ name: 'g.sh', count: { min: 1 } }], finished: 'g.sh' };
    expect(judgeGuardSpec(spec, guard, [deny])).toEqual([]);
    expect(judgeGuardSpec(spec, guard, [{ ...deny, ms: 5200 }])).toEqual([
      'custom.guard_finished: a run took 5200 ms, over the timeout of 5000 ms',
    ]);
    expect(
      judgeGuardSpec(spec, guard, [{ decision: 'error', message: 'timed out', ms: 5000, timedOut: true }]),
    ).toContain('custom.guard_finished: a run was cut at the timeout of 5000 ms');
    const worded = { guards: [], message: { name: 'g.sh', mustNot: ['EUR\\s?\\d'] } };
    expect(judgeGuardSpec(worded, guard, [{ ...deny, message: 'Pay EUR 5 first.' }])).toEqual([
      'custom.guard_message: the message "Pay EUR 5 first." matches EUR\\s?\\d',
    ]);
    expect(judgeGuardSpec(worded, guard, [{ decision: 'deny', ms: 20, timedOut: false }])).toEqual([
      'custom.guard_message: the guard blocked without saying why',
    ]);
  });

  it('fails every spec of a guard with no payload to run', () => {
    expect(judgeGuardSpec({ guards: [{ name: 'g.sh', count: { min: 1 } }] }, guard, [])).toEqual([
      'guards.g.sh: no payload to run the guard on',
    ]);
  });
});

describe('a unit spec of a helper alone and of a script', () => {
  it('passes a helper whose file gives a system prompt, and fails one with no body', () => {
    expect(judgeHelperSpec('clerk', { name: 'clerk', description: 'Checks.', body: 'You read.\n' })).toEqual(
      [],
    );
    expect(judgeHelperSpec('clerk', { name: 'clerk', description: 'Checks.', body: '\n' })).toEqual([
      'contract_alone: the agent file of clerk holds no body to run as its system prompt',
    ]);
    expect(judgeHelperSpec('clerk', undefined)).toEqual(['contract_alone: the estate holds no helper clerk']);
  });

  it('fails a script that answers its documented call as it answers no argument', () => {
    const usage = { args: [] as string[], exitCode: 2, message: 'usage: track.sh <code>' };
    expect(
      judgeScriptSpec([usage, { args: ['NWX', '1'], exitCode: 1, message: 'no shipment NWX 1' }]),
    ).toEqual([]);
    expect(judgeScriptSpec([usage, { args: ['a'], exitCode: 0 }])).toEqual([]);
    expect(
      judgeScriptSpec([
        { args: [], exitCode: 1, message: 'the script broke' },
        { args: ['NWX', '1'], exitCode: 1, message: 'the script broke' },
      ]),
    ).toEqual([
      'script_fixture: the call with NWX 1 ends as the call with no argument does (exit 1): the script does not read its arguments',
    ]);
    expect(judgeScriptSpec([{ args: [], exitCode: 127, message: 'not found' }])).toEqual([
      'script_fixture: the script did not run (exit 127)',
    ]);
  });
});
