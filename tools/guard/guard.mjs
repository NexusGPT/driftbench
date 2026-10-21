#!/usr/bin/env node
/**
 * driftbench leak guard.
 *
 * Refuses a tree that carries personal data or client identifiers: IBANs with a valid
 * checksum, Belgian national register numbers, phone numbers, real email addresses, and
 * any term on a private denylist. Fictional data passes: emails at example.com, .test,
 * .invalid, .example or .localhost, and phones in the reserved NANP range 555-0100 to
 * 555-0199.
 *
 * Usage:  node tools/guard/guard.mjs [paths...] [--json] [--canary]
 *   no paths   scan every file git tracks or would track (ignored files are skipped)
 *   --json     print one JSON document
 *   --canary   plant generated data in a temporary folder and prove every check fires
 *   --require-denylist  fail when no denylist term is loaded (CI on main uses it)
 * Denylist:   GUARD_DENYLIST (newline or comma separated) plus a local .guard-denylist file.
 *             Denylisted terms are never printed, not even partly.
 * Allow:      a line containing "guard:allow" suppresses pattern findings on that line.
 *             It never suppresses a denylist finding.
 * Exceptions: each tools/guard/fingerprints/*.json lists exact values a generator made up.
 *             An entry is the kind plus the sha256 of the exact matched text; nothing else is excused.
 *             It never suppresses a denylist finding.
 * Size:       files above 10 MiB fail the guard with a named error; they are never skipped.
 * Exit:       0 clean, 1 findings, scan errors or a canary miss, 2 usage error.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** ISO 13616 IBAN length per country. */
export const IBAN_LENGTHS = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

export const KINDS = ['iban', 'national-number', 'phone', 'email', 'denylist'];

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
]);
const BINARY_EXTENSIONS = new Set(
  (
    '.png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff .ico .icns .psd .pdf .zip .gz .tgz .bz2 .xz .7z ' +
    '.woff .woff2 .ttf .otf .eot .mp3 .mp4 .m4a .mov .webm .wav .ogg .wasm .jar .bin .exe .dll .so .dylib'
  ).split(' '),
);
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_BYTES = 10 * 1024 * 1024;
// A larger read limit for one file at the root, by its path: the guard still reads and scans all of it, so a raise
// checks more, never less. .gitleaksignore holds one exact fingerprint per recorded hash and grows with each recording.
const MAX_BYTES_AT = new Map([['.gitleaksignore', 32 * 1024 * 1024]]);
const ALLOW_MARKER = 'guard:allow';
const EXCEPTIONS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fingerprints');

/** Remainder of a long decimal string divided by 97. */
export function mod97(digits) {
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + (char.charCodeAt(0) - 48)) % 97;
  return remainder;
}

function lettersToDigits(text) {
  let out = '';
  for (const char of text) out += /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
  return out;
}

/** True when the text is an IBAN of the right length for its country with a valid checksum. */
export function isValidIban(raw) {
  const iban = raw.replace(/[\s ]/g, '').toUpperCase();
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!length || iban.length !== length || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** True when 11 digits form a Belgian national register number: a plausible date and a valid check. */
export function isValidNationalNumber(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const monthOk = month <= 12 || (month >= 20 && month <= 32) || (month >= 40 && month <= 52);
  if (!monthOk || day > 31) return false;
  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9));
  return 97 - (base % 97) === check || 97 - ((2_000_000_000 + base) % 97) === check;
}

/** True for the fictional NANP range: +1, optional area code, 555, then 0100 to 0199. */
export function isFictionalPhone(digits) {
  return /^1(\d{3})?55501\d{2}$/.test(digits);
}

const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);
const ALLOWED_EMAIL_SUFFIXES = ['.example', '.test', '.invalid', '.localhost', 'users.noreply.github.com'];
const ALLOWED_EMAILS = new Set(['git@github.com']);

/** True when an email address is fictional or technical, never a person's. */
export function isAllowedEmail(address) {
  const lower = address.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const domain = lower.slice(lower.lastIndexOf('@') + 1);
  return (
    ALLOWED_EMAIL_DOMAINS.has(domain) || ALLOWED_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix))
  );
}

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]){10,32}/g;
// Numeric PII must not start or end inside a hexadecimal digest.
const NATIONAL_CANDIDATE = /(?<![\da-fA-F.])\d{2}\.?\d{2}\.?\d{2}[-. ]?\d{3}[-. ]?\d{2}(?![\da-fA-F])/g;
const INTERNATIONAL_PHONE = /(?<![\w+])\+[1-9][\d \-().]{6,22}\d(?![\da-fA-F])/g;
const BELGIAN_MOBILE = /(?<![\da-fA-F+])(?:00 ?32 ?|0)4[5-9]\d(?:[ ./-]?\d{2}){3}(?![\da-fA-F])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function fingerprint(kind, value) {
  return `${kind}:${createHash('sha256').update(value).digest('hex')}`;
}

/** Reads the exact-fingerprint exceptions of every JSON file in the folder: a set of `kind:sha256` strings. */
export function loadExceptions(dir = EXCEPTIONS_DIR) {
  const set = new Set();
  if (!existsSync(dir)) return set;
  for (const name of readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    for (const entry of JSON.parse(readFileSync(join(dir, name), 'utf8')).entries ?? []) {
      if (
        !['national-number', 'phone', 'iban', 'email'].includes(entry.kind) ||
        !/^[0-9a-f]{64}$/.test(entry.sha256)
      ) {
        throw new Error(`bad fingerprint entry in ${name}`);
      }
      set.add(`${entry.kind}:${entry.sha256}`);
    }
  }
  return set;
}

/**
 * Finds personal data and denylisted terms in one text.
 * Returns raw values so the caller decides how to redact them.
 */
export function scanText(text, { denylist = [], exceptions = new Set() } = {}) {
  const findings = [];
  let allowed = 0;
  let excused = 0;
  const terms = denylist.map((term, index) => ({
    index: index + 1,
    pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, 'gi'),
  }));

  text.split('\n').forEach((content, offset) => {
    const line = offset + 1;
    let lineFindings = [];

    for (const match of content.matchAll(IBAN_CANDIDATE)) {
      const compact = match[0].replace(/[\s ]/g, '');
      const length = IBAN_LENGTHS[compact.slice(0, 2)];
      if (length && compact.length >= length && isValidIban(compact.slice(0, length))) {
        lineFindings.push({ line, kind: 'iban', value: compact.slice(0, length) });
      }
    }
    for (const match of content.matchAll(NATIONAL_CANDIDATE)) {
      if (isValidNationalNumber(match[0]))
        lineFindings.push({ line, kind: 'national-number', value: match[0] });
    }
    for (const match of content.matchAll(INTERNATIONAL_PHONE)) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15 && !isFictionalPhone(digits)) {
        lineFindings.push({ line, kind: 'phone', value: match[0].trim() });
      }
    }
    for (const match of content.matchAll(BELGIAN_MOBILE)) {
      lineFindings.push({ line, kind: 'phone', value: match[0] });
    }
    for (const match of content.matchAll(EMAIL)) {
      if (!isAllowedEmail(match[0])) lineFindings.push({ line, kind: 'email', value: match[0] });
    }

    if (exceptions.size > 0) {
      const kept = lineFindings.filter(
        (finding) => !exceptions.has(fingerprint(finding.kind, finding.value)),
      );
      excused += lineFindings.length - kept.length;
      lineFindings = kept;
    }
    if (content.includes(ALLOW_MARKER)) {
      allowed += lineFindings.length;
    } else {
      findings.push(...lineFindings);
    }

    for (const term of terms) {
      for (const match of content.matchAll(term.pattern)) {
        findings.push({ line, kind: 'denylist', value: match[0], entry: term.index });
      }
    }
  });

  return { findings, allowed, excused };
}

/** Masks a value for printing. Denylisted terms are masked entirely. */
export function redact(value, kind) {
  const text = value.trim();
  if (kind === 'denylist') return `${'•'.repeat(Math.min(text.length, 12))} (${text.length} chars)`;
  if (text.length <= 4) return '•'.repeat(text.length);
  return `${text.slice(0, 2)}${'•'.repeat(Math.max(text.length - 4, 1))}${text.slice(-2)}`;
}

/** Reads denylist terms from GUARD_DENYLIST and the .guard-denylist file. Terms under 3 characters are ignored. */
export function loadDenylist(env, root) {
  const raw = [];
  if (env.GUARD_DENYLIST) raw.push(...env.GUARD_DENYLIST.split(/[\n,]/));
  const file = join(root, '.guard-denylist');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim().startsWith('#')) raw.push(line);
    }
  }
  return [
    ...new Set(raw.map((term) => term.trim()).filter((term) => term.length >= 3 && !term.startsWith('#'))),
  ];
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** The files to scan, and the folder paths are shown relative to. */
export function listFiles(paths, cwd, notice) {
  if (paths.length > 0) {
    const files = [];
    for (const path of paths) {
      const full = resolve(cwd, path);
      if (!existsSync(full)) throw new UsageError(`no such file or folder: ${path}`);
      if (statSync(full).isDirectory()) walk(full, files);
      else files.push(full);
    }
    return { root: cwd, files: [...new Set(files)].sort() };
  }
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch (cause) {
    notice(
      `not inside a git repository (${String(cause.message).split('\n')[0]}); scanning every file under ${cwd}\n`,
    );
    return { root: cwd, files: walk(cwd, []).sort() };
  }
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    root,
    files: [...new Set(listed.split('\0').filter(Boolean))].sort().map((file) => join(root, file)),
  };
}

function readText(file, maxBytes = MAX_BYTES) {
  const name = basename(file);
  if (LOCKFILES.has(name) || name === '.guard-denylist') return { skip: 'excluded' };
  if (BINARY_EXTENSIONS.has(extname(name).toLowerCase())) return { skip: 'binary' };
  let info;
  try {
    info = statSync(file);
  } catch {
    return { skip: 'missing' };
  }
  if (!info.isFile()) return { skip: 'not a file' };
  if (info.size > maxBytes) return { error: `size ${info.size} bytes exceeds scan limit ${maxBytes} bytes` };
  const buffer = readFileSync(file);
  if (buffer.subarray(0, 8000).includes(0)) return { skip: 'binary' };
  return { text: buffer.toString('utf8') };
}

/** Scans files and returns findings and scan errors with paths relative to the root. */
export function scanFiles(files, root, denylist, exceptions = new Set()) {
  const findings = [];
  const skipped = [];
  const errors = [];
  let scanned = 0;
  let allowed = 0;
  let excused = 0;
  for (const file of files) {
    const shown = relative(root, file) || file;
    const read = readText(file, MAX_BYTES_AT.get(shown) ?? MAX_BYTES);
    if (read.error) {
      errors.push({ file: shown, reason: read.error });
      continue;
    }
    if (read.skip) {
      skipped.push({ file: shown, reason: read.skip });
      continue;
    }
    scanned += 1;
    const result = scanText(read.text, { denylist, exceptions });
    allowed += result.allowed;
    excused += result.excused;
    for (const finding of result.findings) findings.push({ file: shown, ...finding });
  }
  return { findings, skipped, errors, scanned, allowed, excused };
}

class UsageError extends Error {}

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function digitsFrom(random, count) {
  let out = '';
  for (let index = 0; index < count; index += 1) out += String(Math.floor(random() * 10));
  return out;
}

/** Builds an IBAN with a valid checksum for a country whose BBAN is all digits. */
export function makeIban(country, bban) {
  const check = 98 - mod97(lettersToDigits(`${bban}${country}00`));
  return `${country}${String(check).padStart(2, '0')}${bban}`;
}

/** Builds a valid Belgian national register number for a birth in the 1900s. */
export function makeNationalNumber(yymmdd, serial) {
  const base = `${yymmdd}${serial}`;
  const check = String(97 - (Number(base) % 97)).padStart(2, '0');
  return `${base.slice(0, 2)}.${base.slice(2, 4)}.${base.slice(4, 6)}-${base.slice(6, 9)}.${check}`;
}

/** Plants generated data next to fictional data and checks that only the real-looking data is caught. */
export function runCanary(denylist) {
  const random = seeded(20261011);
  const iban = makeIban('BE', digitsFrom(random, 12));
  const ibanBad = `${iban.slice(0, -1)}${(Number(iban.slice(-1)) + 1) % 10}`;
  const national = makeNationalNumber('850730', `0${digitsFrom(random, 2)}`);
  const mobile = digitsFrom(random, 6);
  const phone = `+32 47${digitsFrom(random, 1)} ${mobile.slice(0, 2)} ${mobile.slice(2, 4)} ${mobile.slice(4)}`;
  const email = ['canary.person', 'driftbench-canary.dev'].join('@');
  const lines = [
    `account ${iban}`,
    `typo ${ibanBad}`,
    `register ${national}`,
    `call ${phone}`,
    `write ${email}`,
    'fiction +1 202 555 0123 and jane@example.com',
  ];
  if (denylist.length > 0) lines.push(`client ${denylist[0]}`);

  const dir = mkdtempSync(join(tmpdir(), 'driftbench-guard-canary-'));
  try {
    writeFileSync(join(dir, 'canary.md'), `${lines.join('\n')}\n`);
    const { findings } = scanFiles([join(dir, 'canary.md')], dir, denylist);
    const expected = {
      iban: 1,
      'national-number': 1,
      phone: 1,
      email: 1,
      denylist: denylist.length > 0 ? 1 : 0,
    };
    const got = Object.fromEntries(
      KINDS.map((kind) => [kind, findings.filter((f) => f.kind === kind).length]),
    );
    const misses = KINDS.filter((kind) => got[kind] !== expected[kind]);
    return { ok: misses.length === 0, expected, got, misses, denylistTerms: denylist.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { json: false, canary: false, requireDenylist: false, help: false, paths: [] };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--canary') options.canary = true;
    else if (arg === '--require-denylist') options.requireDenylist = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new UsageError(`unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  return options;
}

const HELP = `Usage: node tools/guard/guard.mjs [paths...] [--json] [--canary] [--require-denylist]
Scans for IBANs, Belgian national register numbers, phone numbers, real email addresses
and denylisted terms. Files above 10 MiB fail with a named error.
Exit 0 clean, 1 findings or scan errors, 2 usage error.
`;

/** Runs the guard. Returns the exit code. */
export function main(argv, io) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (cause) {
    io.err(`driftbench guard: ${cause.message}\n${HELP}`);
    return 2;
  }
  if (options.help) {
    io.out(HELP);
    return 0;
  }

  if (options.canary) {
    let root = io.cwd;
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: io.cwd,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    } catch {
      // Outside a repository the denylist file is looked up in the working folder.
    }
    const terms = loadDenylist(io.env, root);
    if (options.requireDenylist && terms.length === 0) {
      io.err('driftbench guard: --require-denylist is set but no denylist terms were loaded.\n');
      return 1;
    }
    const result = runCanary(terms);
    if (options.json) {
      io.out(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const parts = KINDS.map((kind) =>
        kind === 'denylist' && result.denylistTerms === 0
          ? 'denylist skipped (no terms loaded)'
          : `${kind} ${result.misses.includes(kind) ? 'MISSED' : 'caught'}`,
      );
      io.out(`driftbench guard canary: ${result.ok ? 'ok' : 'FAILED'}. ${parts.join(', ')}.\n`);
      if (result.denylistTerms > 0) io.out(`${result.denylistTerms} denylist terms loaded.\n`);
    }
    return result.ok ? 0 : 1;
  }

  let listing;
  try {
    listing = listFiles(options.paths, io.cwd, io.err);
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.err(`driftbench guard: ${cause.message}\n`);
      return 2;
    }
    throw cause;
  }
  const denylist = loadDenylist(io.env, listing.root);
  if (options.requireDenylist && denylist.length === 0) {
    io.err('driftbench guard: --require-denylist is set but no denylist terms were loaded.\n');
    return 1;
  }
  const result = scanFiles(listing.files, listing.root, denylist, loadExceptions(io.exceptionsDir));
  const shown = result.findings.map(({ file, line, kind, value, entry }) => ({
    file,
    line,
    kind: kind === 'denylist' ? `denylist #${entry}` : kind,
    redacted: redact(value, kind),
  }));
  const clean = shown.length === 0 && result.errors.length === 0;

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          clean,
          scanned: result.scanned,
          skipped: result.skipped.length,
          allowed: result.allowed,
          excused: result.excused,
          denylistTerms: denylist.length,
          findings: shown,
          errors: result.errors,
        },
        null,
        2,
      )}\n`,
    );
    return clean ? 0 : 1;
  }

  for (const error of result.errors) {
    io.err(`driftbench guard: cannot scan ${error.file}: ${error.reason}.\n`);
  }
  const allowedNote =
    (result.allowed > 0 ? ` ${result.allowed} allowed by ${ALLOW_MARKER} markers.` : '') +
    (result.excused > 0 ? ` ${result.excused} excused by fingerprint.` : '');
  const scope = `${result.scanned} files scanned, ${result.skipped.length} skipped, ${denylist.length} denylist terms`;
  if (shown.length === 0) {
    if (!clean) {
      const errors = result.errors.length;
      io.out(
        `driftbench guard: FAILED (${scope}). ${errors} file${errors === 1 ? '' : 's'} could not be scanned.${allowedNote}\n`,
      );
      return 1;
    }
    io.out(`driftbench guard: clean (${scope}).${allowedNote}\n`);
    return 0;
  }
  const files = new Set(shown.map((finding) => finding.file)).size;
  io.out(
    `driftbench guard: ${shown.length} finding${shown.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'} (${scope}).${allowedNote}\n`,
  );
  const width = Math.max(...shown.map((finding) => `${finding.file}:${finding.line}`.length));
  for (const finding of shown) {
    io.out(
      `  ${`${finding.file}:${finding.line}`.padEnd(width)}  ${finding.kind.padEnd(15)}  ${finding.redacted}\n`,
    );
  }
  io.out(
    'Replace real data with fictional data: emails at example.com, phones in +1 202 555 0100 to 0199.\n',
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    env: process.env,
  });
}
