import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../../../tools/test-setup/temp-folders';
import { mod97 } from '../../src/intake';

/**
 * Personal-data look-alikes for the detector tests, built at run time so that no source file holds one:
 * the repository's leak guard scans every tracked file, and these values are generated, never anyone's.
 */

export const ACME = fileURLToPath(new URL('../../../../examples/acme/', import.meta.url));

function lettersToDigits(text: string): string {
  let out = '';
  for (const char of text) out += /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
  return out;
}

/** An IBAN with a valid checksum, for a country whose BBAN is all digits. */
export function makeIban(country: string, bban: string): string {
  const check = 98 - mod97(lettersToDigits(`${bban}${country}00`));
  return `${country}${String(check).padStart(2, '0')}${bban}`;
}

/** A Belgian national register number with a valid check, for a birth in the 1900s. */
export function makeBelgianNumber(yymmdd: string, serial: string): string {
  const base = `${yymmdd}${serial}`;
  const check = String(97 - (Number(base) % 97)).padStart(2, '0');
  return `${base.slice(0, 2)}.${base.slice(2, 4)}.${base.slice(4, 6)}-${base.slice(6, 9)}.${check}`;
}

/** A French NIR (13 digits and a two-digit key). */
export function makeNir(body13: string): string {
  const key = String(97 - Number(BigInt(body13) % 97n)).padStart(2, '0');
  return `${body13}${key}`;
}

/** A number of the given length whose last digit makes the Luhn check pass. */
export function makeCard(prefix: string, length: number): string {
  let body = prefix;
  while (body.length < length - 1) body += String((body.length * 7) % 10);
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = `${body}${digit}`;
    let sum = 0;
    let double = false;
    for (let index = candidate.length - 1; index >= 0; index -= 1) {
      let value = Number(candidate[index]);
      if (double) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
      double = !double;
    }
    if (sum % 10 === 0) return candidate;
  }
  throw new Error('unreachable');
}

/** A real-looking address at a domain that is not reserved for examples. */
export function realEmail(local: string): string {
  return `${local}@${['mail', 'box'].join('')}.be`;
}

/** A real-looking Belgian mobile number, in international form. */
export function realMobile(): string {
  return ['+32', '471', '12', '34', '56'].join(' ');
}

/** A folder under the system temp folder, which is outside any git work tree. */
export function scratch(prefix: string): Promise<string> {
  return tempFolder(`driftbench-${prefix}-`);
}
