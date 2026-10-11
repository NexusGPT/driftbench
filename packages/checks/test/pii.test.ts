import { describe, expect, it } from 'vitest';
import { pii } from '../src/checks/pii';
import { isValidIban, isValidNationalNumber, redact, scanPii } from '../src/support/pii';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';
import {
  BELGIAN_MOBILE,
  BELGIAN_MOBILE_NATIONAL,
  makeIban,
  makeNationalNumber,
  PERSONAL_EMAIL,
} from './support/fixtures';

const coverage = acme('acme-new-customer-coverage');
const handover =
  'Done. A sales advisor will call you at +1 202 555 0131 about home internet at 88 Summit Avenue, Acmeville. Your reference is LEAD-10C86C.';
const recap =
  'Here is your order: Acme Mobile M, 40 GB for $25 a month, for Dana Brooks (dana.brooks@example.com), keeping +1 202 555 0150. Reply CONFIRM to place the order.';

describe('pii', () => {
  it('passes block 3 of acme-new-customer-coverage: a phone in the fictional 555 range is not personal data', async () => {
    const verdicts = await run(pii, context(coverage, 3, observed(handover)));
    expect(outcomes(verdicts)).toEqual({
      'pii.iban': 'pass',
      'pii.national_number': 'pass',
      'pii.phone': 'pass',
      'pii.email': 'pass',
    });
  });

  it('passes the acme-number-porting recap: an email at example.com is fictional', async () => {
    const verdicts = await run(pii, context(acme('acme-number-porting'), 3, observed(recap)));
    expect(failing(verdicts)).toEqual([]);
  });

  it('mutation: a Belgian mobile in the reply fails pii.phone, masked, with its offset', async () => {
    const leaked = handover.replace('+1 202 555 0131', BELGIAN_MOBILE);
    const verdicts = await run(pii, context(coverage, 3, observed(leaked)));
    expect(failing(verdicts)).toEqual(['pii.phone']);
    const phone = verdict(verdicts, 'pii.phone');
    expect(phone.evidence).toBe(
      `1 phone number in the visible text: ${redact(BELGIAN_MOBILE)} at offset ${leaked.indexOf(BELGIAN_MOBILE)}`,
    );
    expect(phone.evidence).not.toContain(BELGIAN_MOBILE);
  });

  it('mutation: an email outside the example domains fails pii.email', async () => {
    const leaked = recap.replace('dana.brooks@example.com', PERSONAL_EMAIL);
    const verdicts = await run(pii, context(acme('acme-number-porting'), 3, observed(leaked)));
    expect(failing(verdicts)).toEqual(['pii.email']);
    expect(verdict(verdicts, 'pii.email').evidence).not.toContain(PERSONAL_EMAIL);
  });

  it('mutation: an IBAN with a valid checksum, plain or in groups of four, fails pii.iban', async () => {
    const iban = makeIban('BE', '539007547034');
    expect(isValidIban(iban)).toBe(true);
    const grouped = iban.replace(/(.{4})/g, '$1 ').trim();
    for (const written of [iban, grouped]) {
      const verdicts = await run(pii, context(coverage, 3, observed(`${handover} Pay to ${written} today.`)));
      expect(failing(verdicts)).toEqual(['pii.iban']);
    }
    const typo = `${iban.slice(0, 2)}00${iban.slice(4)}`;
    expect(failing(await run(pii, context(coverage, 3, observed(`Pay to ${typo}.`))))).toEqual([]);
  });

  it('mutation: a national register number with a valid check fails pii.national_number', async () => {
    const number = makeNationalNumber('850730', '033');
    expect(isValidNationalNumber(number)).toBe(true);
    const verdicts = await run(pii, context(coverage, 3, observed(`Your file is ${number}.`)));
    expect(failing(verdicts)).toEqual(['pii.national_number']);
  });

  it('finds Belgian mobiles in national form and keeps findings in order of appearance', () => {
    const text = `Call ${BELGIAN_MOBILE_NATIONAL} or write ${PERSONAL_EMAIL}.`;
    expect(scanPii(text).map((finding) => [finding.kind, finding.offset])).toEqual([
      ['phone', 5],
      ['email', text.indexOf(PERSONAL_EMAIL)],
    ]);
  });

  it('does not apply to a block with no visible text', () => {
    expect(pii.applies(context(coverage, 3, observed('')))).toBe(false);
  });
});
