import { type Check, machineVerdict } from '@driftbench/core';
import { PII_KINDS, type PiiKind, redact, scanPii } from '../support/pii';
import { visibleText } from '../support/text';
import { plural } from '../support/values';

const NAME = 'pii';

const LABELS: Record<PiiKind, [string, string]> = {
  iban: ['IBAN', 'IBANs'],
  national_number: ['national register number', 'national register numbers'],
  phone: ['phone number', 'phone numbers'],
  email: ['email address', 'email addresses'],
};

export type PiiCheckOptions = {
  /**
   * The owner's own values: an email address, a phone number, an IBAN or a national register number that
   * belongs to the person whose sessions are checked. A finding equal to one of them, compared exactly (case
   * folded for an email, spaces and punctuation dropped for the others), is not a finding. Nothing else is
   * excused: a domain, a pattern or a partial value never matches, so third-party data is still flagged.
   * Empty by default.
   */
  owner?: readonly string[];
};

/** The form two values are compared in: an email case-folded, any other value as its letters and digits. */
export function ownerKey(value: string): string {
  const text = value.trim();
  return text.includes('@') ? text.toLowerCase() : text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Personal data in the customer-visible text: IBANs with a valid checksum, Belgian national register
 * numbers, phone numbers (international form and Belgian mobiles) and email addresses, with the same
 * patterns and the same fictional exceptions as the repository leak guard. One verdict per kind. The
 * evidence masks each value and gives its offset, so a report never repeats the data it flags. With
 * `owner`, the owner's own values are left out and counted in the evidence, masked.
 */
export function createPiiCheck(options: PiiCheckOptions = {}): Check {
  const owner = new Set((options.owner ?? []).map(ownerKey).filter((key) => key !== ''));
  return {
    name: NAME,
    applies: (ctx) => visibleText(ctx.observed).trim() !== '',
    evaluate(ctx) {
      const all = scanPii(visibleText(ctx.observed));
      const findings = all.filter((finding) => !owner.has(ownerKey(finding.value)));
      return PII_KINDS.map((kind) => {
        const [one, many] = LABELS[kind];
        const found = findings.filter((finding) => finding.kind === kind);
        const excused = all.filter((finding) => finding.kind === kind).length - found.length;
        const note = excused > 0 ? `; ${plural(excused, `owner ${one}`, `owner ${many}`)} left out` : '';
        if (found.length === 0)
          return machineVerdict(NAME, kind, 'pass', `no ${one} in the visible text${note}`);
        const shown = found.map((finding) => `${redact(finding.value)} at offset ${finding.offset}`);
        return machineVerdict(
          NAME,
          kind,
          'fail',
          `${plural(found.length, one, many)} in the visible text: ${shown.join(', ')}${note}`,
        );
      });
    },
  };
}

/** The pii check with no owner values: every finding counts. */
export const pii: Check = createPiiCheck();
