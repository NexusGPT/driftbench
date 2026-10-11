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

/**
 * Personal data in the customer-visible text: IBANs with a valid checksum, Belgian national register
 * numbers, phone numbers (international form and Belgian mobiles) and email addresses, with the same
 * patterns and the same fictional exceptions as the repository leak guard. One verdict per kind. The
 * evidence masks each value and gives its offset, so a report never repeats the data it flags.
 */
export const pii: Check = {
  name: NAME,
  applies: (ctx) => visibleText(ctx.observed).trim() !== '',
  evaluate(ctx) {
    const findings = scanPii(visibleText(ctx.observed));
    return PII_KINDS.map((kind) => {
      const [one, many] = LABELS[kind];
      const found = findings.filter((finding) => finding.kind === kind);
      if (found.length === 0) return machineVerdict(NAME, kind, 'pass', `no ${one} in the visible text`);
      const shown = found.map((finding) => `${redact(finding.value)} at offset ${finding.offset}`);
      return machineVerdict(
        NAME,
        kind,
        'fail',
        `${plural(found.length, one, many)} in the visible text: ${shown.join(', ')}`,
      );
    });
  },
};
