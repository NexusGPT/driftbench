import { describe, expect, it } from 'vitest';
import { must, mustNot } from '../src/checks/must';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const offer =
  'Fiber is not available at 88 Summit Avenue, Acmeville yet, but 5G home internet is. The plan available there: Acme Air 5G, up to 200 Mbps for $35 a month. Would you like Acme Air 5G?';

describe('must and must_not', () => {
  it('pass block 1 of acme-new-customer-coverage, with the matched text and its offset', async () => {
    const ctx = context(coverage, 1, observed(offer));
    const verdicts = [...(await run(must, ctx)), ...(await run(mustNot, ctx))];
    expect(outcomes(verdicts)).toEqual({
      'must.0': 'pass',
      'must.1': 'pass',
      'must.2': 'pass',
      'must_not.0': 'pass',
    });
    expect(verdict(verdicts, 'must.2').evidence).toContain(
      `matched "$35" at offset ${offer.indexOf('$35')}: `,
    );
    expect(verdict(verdicts, 'must_not.0').evidence).toMatch(
      /^\/Fiber \(300\|1000\)\/ does not match; visible text "Fiber is not/,
    );
  });

  it('mutation: the reply offers Acme Fiber 300 and drops the price; must_not.0 and must.2 fail', async () => {
    const wrong =
      'Good news: Acme Fiber 300 is available at 88 Summit Avenue. Fiber is not available elsewhere. Acme Air 5G too.';
    const ctx = context(coverage, 1, observed(wrong));
    const verdicts = [...(await run(must, ctx)), ...(await run(mustNot, ctx))];
    expect(failing(verdicts)).toEqual(['must.2', 'must_not.0']);
    expect(verdict(verdicts, 'must_not.0').evidence).toBe(
      '/Fiber (300|1000)/ matched "Fiber 300" at offset 16: "Good news: Acme Fiber 300 is available at 88 Summit Ave..."',
    );
    expect(verdict(verdicts, 'must.2').evidence).toMatch(/^\/\\\$35\/ is missing; visible text "Good news/);
  });

  it('compiles patterns with the m flag, so ^ and $ match at every line', async () => {
    const ctx = context(coverage, 1, observed('Thanks.\nWhich one would you like?'), {
      expect: { must: ['^Which one', 'Thanks\\.$'] },
    });
    expect(failing(await run(must, ctx))).toEqual([]);
  });

  it('reads the text segments when the adapter leaves observed.text empty', async () => {
    const seen = observed('');
    seen.segments.push({ type: 'text', text: 'Hi, I am the Acme Telecom sales assistant.' });
    seen.segments.push({ type: 'text', text: 'What is the street address?' });
    const verdicts = await run(must, context(coverage, 0, seen));
    expect(failing(verdicts)).toEqual([]);
  });

  it('fails a pattern that does not compile, naming it', async () => {
    const ctx = context(coverage, 1, observed(offer), { expect: { must: ['(unclosed'] } });
    const [only] = await run(must, ctx);
    expect(only?.outcome).toBe('fail');
    expect(only?.evidence).toMatch(/^\/\(unclosed\/ does not compile: /);
  });
});
