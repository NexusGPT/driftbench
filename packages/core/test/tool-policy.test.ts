import { describe, expect, it } from 'vitest';
import { deniesCall, gateToolCalls, type ToolRule } from '../src/contracts/tool-policy';

const rules: ToolRule[] = [
  { pattern: 'read_*', action: 'allow' },
  { pattern: 'send_*', action: 'deny' },
  { pattern: 'delete_*', action: 'ask' },
];

describe('gateToolCalls', () => {
  it('with no rules, every call comes back unchanged', () => {
    const calls = [{ label: 'send_email', input: {}, output: 'sent' }];
    expect(gateToolCalls(calls, [])).toEqual(calls);
  });

  it('marks a denied call: it keeps its label and input, loses its output, and names the rule', () => {
    const [gated] = gateToolCalls(
      [{ label: 'send_email', input: { to: 'a' }, output: 'sent', id: 'c1' }],
      rules,
    );
    expect(gated).toEqual({
      label: 'send_email',
      input: { to: 'a' },
      id: 'c1',
      error: 'denied by tool policy rule send_*',
    });
  });

  it('leaves allowed and unmatched calls as they were', () => {
    const calls = [
      { label: 'read_file', input: {}, output: 'x' },
      { label: 'lookup', input: {}, output: 'y' },
    ];
    expect(gateToolCalls(calls, rules)).toEqual(calls);
  });

  it('denies an ask rule, since no approver answers in the gate', () => {
    const [gated] = gateToolCalls([{ label: 'delete_row', input: {} }], rules);
    expect(gated?.error).toContain('asks, and no approver answers');
  });

  it('never drops a call: the record still shows what the agent tried', () => {
    expect(
      gateToolCalls(
        [
          { label: 'send_a', input: {} },
          { label: 'read_b', input: {} },
          { label: 'send_c', input: {} },
        ],
        rules,
      ),
    ).toHaveLength(3);
  });

  it('the first matching rule decides, and a deny rule matches the whole name only', () => {
    expect(deniesCall({ pattern: 'send', action: 'deny' })).toBe(true);
    const whole = gateToolCalls([{ label: 'send_email', input: {} }], [{ pattern: 'send', action: 'deny' }]);
    expect(whole[0]?.error).toBeUndefined();
    const first = gateToolCalls(
      [{ label: 'send_x', input: {} }],
      [
        { pattern: 'send_*', action: 'allow' },
        { pattern: 'send_*', action: 'deny' },
      ],
    );
    expect(first[0]?.error).toBeUndefined();
  });
});
