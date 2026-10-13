import { describe, expect, it } from 'vitest';
import { must, mustNot } from '../src/checks/must';
import { regex } from '../src/checks/regex';
import { acme } from './support/acme';
import { context, observed, outcomes, run } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const block = (text: string, expect: Record<string, unknown>) =>
  context(coverage, 1, observed(text, [], {}), { expect: expect as never });

describe('regex', () => {
  it('matches case-sensitively by default', async () => {
    expect(outcomes(await run(regex, block('Fiber 100 Mbps is here.', { regex: ['fiber \\d+'] })))).toEqual({
      'regex.0': 'fail',
    });
    expect(outcomes(await run(regex, block('Fiber 100 Mbps is here.', { regex: ['Fiber \\d+'] })))).toEqual({
      'regex.0': 'pass',
    });
  });

  it('gives one verdict per pattern', async () => {
    const verdicts = await run(regex, block('ORD-123456 is placed', { regex: ['ORD-\\d{6}', 'NOPE'] }));
    expect(outcomes(verdicts)).toEqual({ 'regex.0': 'pass', 'regex.1': 'fail' });
  });

  it('fails a pattern that does not compile, and says why', async () => {
    const verdicts = await run(regex, block('anything', { regex: ['('] }));
    expect(outcomes(verdicts)).toEqual({ 'regex.0': 'fail' });
  });

  it('leaves must and must_not case-insensitive', async () => {
    expect(outcomes(await run(must, block('Fiber here.', { must: ['fiber'] })))).toEqual({
      'must.0': 'pass',
    });
    expect(outcomes(await run(mustNot, block('FIBER here.', { must_not: ['fiber'] })))).toEqual({
      'must_not.0': 'fail',
    });
  });
});
