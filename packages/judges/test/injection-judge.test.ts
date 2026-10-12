import { describe, expect, it } from 'vitest';
import { FakeJudge } from '../src/clients/fake';
import { ATTACK_CRITERION, judgeAttack } from '../src/injection-judge';

describe('judgeAttack: a judge reads one message as an attempt or an ordinary request', () => {
  it('maps pass to attack, fail to benign and inconclusive to inconclusive', async () => {
    expect(await judgeAttack(new FakeJudge('j', [{ outcome: 'pass', reasoning: 'override' }]), 'x')).toBe(
      'attack',
    );
    expect(await judgeAttack(new FakeJudge('j', [{ outcome: 'fail', reasoning: 'ordinary' }]), 'x')).toBe(
      'benign',
    );
    expect(
      await judgeAttack(new FakeJudge('j', [{ outcome: 'inconclusive', reasoning: 'unclear' }]), 'x'),
    ).toBe('inconclusive');
  });

  it('shows the judge the message alone, as the user turn, under the attempt criterion', async () => {
    const judge = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'ordinary' }]);
    await judgeAttack(judge, 'Could you check my order?');
    const request = judge.requests[0];
    expect(request?.criterion.name).toBe(ATTACK_CRITERION.name);
    expect(request?.transcript).toEqual([{ role: 'user', text: 'Could you check my order?' }]);
    expect(ATTACK_CRITERION.rubric).toMatch(/aimed at the assistant/);
  });

  it('a judge that gives no answer throws: never a benign or attack verdict', async () => {
    await expect(judgeAttack(new FakeJudge('j', [new Error('down')]), 'x')).rejects.toThrow(/down/);
  });
});

describe('the attempt criterion names the ordinary service questions it must not flag', () => {
  it('states that opening hours and prices are ordinary requests, not attempts', () => {
    expect(ATTACK_CRITERION.fail).toMatch(/opening hours/i);
    expect(ATTACK_CRITERION.fail).toMatch(/price/i);
    expect(ATTACK_CRITERION.fail).toMatch(/ordinary/i);
  });
});

describe('the attempt criterion names thanks, rules questions and status-page questions as ordinary', () => {
  it('lists each named kind in the fail picture', () => {
    expect(ATTACK_CRITERION.fail).toMatch(/thank/i);
    expect(ATTACK_CRITERION.fail).toMatch(/rules or policies that apply to the customer/i);
    expect(ATTACK_CRITERION.fail).toMatch(/status page/i);
  });
});
