// Every fixture is generated at runtime or split in the source, so this file passes the guard itself.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  isFictionalPhone,
  isValidIban,
  isValidNationalNumber,
  loadDenylist,
  loadExceptions,
  main,
  makeIban,
  makeNationalNumber,
  redact,
  runCanary,
  scanText,
} from './guard.mjs';

const kinds = (text, options) => scanText(text, options).findings.map((finding) => finding.kind);
const join2 = (...parts) => parts.join('');

function run(argv, cwd, env = {}, exceptionsDir) {
  let out = '';
  let err = '';
  const code = main(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env,
    exceptionsDir,
  });
  return { code, out, err };
}

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'driftbench-guard-test-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('IBAN', () => {
  const be = makeIban('BE', '539007547034');
  const de = makeIban('DE', '370400440532013000');
  const nl = makeIban('NL', `${'ABNA'}0417164300`.replace('ABNA', '0000'));

  it('accepts generated IBANs and refuses a wrong checksum or length', () => {
    expect(isValidIban(be)).toBe(true);
    expect(isValidIban(de)).toBe(true);
    expect(isValidIban(nl)).toBe(true);
    expect(isValidIban(`${be.slice(0, 2)}00${be.slice(4)}`)).toBe(false);
    expect(isValidIban(`${be}1`)).toBe(false);
    expect(isValidIban(`ZZ${be.slice(2)}`)).toBe(false);
  });

  it('finds an IBAN written in groups of four, and ignores trailing text', () => {
    const spaced = be.replace(/(.{4})/g, '$1 ').trim();
    expect(kinds(`pay to ${spaced} before Friday`)).toEqual(['iban']);
    expect(kinds(`pay to ${be}`)).toEqual(['iban']);
  });

  it('ignores an IBAN-shaped string with a bad checksum', () => {
    expect(kinds(`ref ${be.slice(0, 2)}00${be.slice(4)}`)).toEqual([]);
  });
});

describe('Belgian national register number', () => {
  const nineties = makeNationalNumber('850730', '033');

  it('accepts a valid number in every common format', () => {
    expect(isValidNationalNumber(nineties)).toBe(true);
    expect(kinds(`id ${nineties}`)).toEqual(['national-number']);
    expect(kinds(`id ${nineties.replace(/\D/g, '')}`)).toEqual(['national-number']);
  });

  it('accepts a number for a birth after 2000', () => {
    const base = '050730033';
    const check = String(97 - ((2_000_000_000 + Number(base)) % 97)).padStart(2, '0');
    expect(isValidNationalNumber(`${base}${check}`)).toBe(true);
  });

  it('refuses a wrong check, an impossible month, and longer digit runs', () => {
    const digits = nineties.replace(/\D/g, '');
    const wrong = `${digits.slice(0, 9)}${String((Number(digits.slice(9)) % 97) + 1).padStart(2, '0')}`;
    expect(isValidNationalNumber(wrong)).toBe(false);
    expect(isValidNationalNumber(`85${'13'}${digits.slice(4)}`)).toBe(false);
    expect(kinds(`ts ${digits}123`)).toEqual([]);
  });

  it('ignores valid checksummed digits embedded in hexadecimal runs', () => {
    const digits = nineties.replace(/\D/g, '');
    for (const hex of '0123456789abcdefABCDEF') {
      expect(kinds(`${hex}${digits}`)).toEqual([]);
      expect(kinds(`${digits}${hex}`)).toEqual([]);
    }
  });

  it('still finds national numbers next to punctuation, quotes and non-hex letters', () => {
    for (const number of [nineties, nineties.replace(/\D/g, '')]) {
      expect(kinds(`("${number}");`)).toEqual(['national-number']);
      expect(kinds(`g${number}z`)).toEqual(['national-number']);
    }
  });
});

describe('phones', () => {
  it('finds international numbers and Belgian mobiles', () => {
    expect(kinds(['call', join2('+', '32 470'), '12 34 56'].join(' '))).toEqual(['phone']);
    expect(kinds(['call', join2('+', '33'), '6 12 34 56 78'].join(' '))).toEqual(['phone']);
    expect(kinds(['call', join2('04', '70'), '12 34 56'].join(' '))).toEqual(['phone']);
    expect(kinds(['call', join2('0032', ' 470'), '12 34 56'].join(' '))).toEqual(['phone']);
  });

  it('ignores the request digest without changing its data', () => {
    const digest = '278fe0bdcd32343034f35dd9484c0487253533e0cf92bf0b20485aed28baf54f';
    expect(kinds(digest)).toEqual([]);
    expect(kinds(JSON.stringify({ requestSha256: digest }))).toEqual([]);
  });

  it('ignores numeric phone candidates next to hexadecimal letters or digits', () => {
    const mobile = join2('04', '70', '12', '34', '56');
    // Use the maximum valid international length so an extra digit is not another valid phone.
    const international = join2('+', '32', mobile.slice(1), '1234');
    const abroad = join2('0032', mobile.slice(1));
    for (const phone of [mobile, international, abroad]) {
      for (const hex of '0123456789abcdefABCDEF') {
        expect(kinds(`${hex}${phone}`)).toEqual([]);
        expect(kinds(`${phone}${hex}`)).toEqual([]);
      }
    }
  });

  it('keeps supported phone formats detectable, including punctuation and quotes', () => {
    for (const separator of ['', ' ', '.', '/', '-']) {
      const mobile = [join2('04', '70'), '12', '34', '56'].join(separator);
      const abroad = [join2('0032', '470'), '12', '34', '56'].join(separator);
      for (const phone of [mobile, abroad]) {
        expect(kinds(phone)).toEqual(['phone']);
        expect(kinds(`("${phone}");`)).toEqual(['phone']);
      }
    }
    for (const separator of ['', ' ', '.', '-']) {
      const phone = [join2('+', '32'), '470', '12', '34', '56'].join(separator);
      expect(kinds(phone)).toEqual(['phone']);
      expect(kinds(`("${phone}");`)).toEqual(['phone']);
    }
    expect(kinds([join2('00', '32'), '470', '12', '34', '56'].join(' '))).toEqual(['phone']);
    expect(kinds(join2('+', '33 (6) ', '12-34-56-78'))).toEqual(['phone']);
    expect(kinds(`g${join2('04', '70123456')}z`)).toEqual(['phone']);
  });

  it('lets the reserved fictional NANP range through', () => {
    expect(isFictionalPhone('12025550123')).toBe(true);
    expect(isFictionalPhone('15550199')).toBe(true);
    expect(isFictionalPhone('12025551234')).toBe(false);
    expect(kinds('call +1 202 555 0123 or +1 (415) 555-0100')).toEqual([]);
  });

  it('ignores short numbers, versions and offsets', () => {
    expect(kinds('UTC+0200, version +1.2.3, retry +3 times, care line 5000')).toEqual([]);
  });
});

describe('emails', () => {
  it('finds a personal address and lets fictional and technical ones through', () => {
    expect(kinds(`mail ${['jane.doe', 'acme-corp.io'].join('@')}`)).toEqual(['email']);
    expect(
      kinds(
        'jane@example.com bob@shop.test x@y.invalid dev@localhost 1+bot@users.noreply.github.com git@github.com',
      ),
    ).toEqual([]);
    expect(kinds('pnpm@10.30.2 @agent-nexus/driftbench-core user@host')).toEqual([]);
  });
});

describe('denylist', () => {
  it('matches terms case-insensitively and never prints them', () => {
    const term = ['Zebra', 'corp'].join('');
    expect(scanText(`we built it for ${term.toLowerCase()}`, { denylist: [term] }).findings).toEqual([
      { line: 1, kind: 'denylist', value: term.toLowerCase(), entry: 1 },
    ]);
    const dir = folder({ 'notes.md': `client: ${term}\n` });
    const { code, out } = run([dir], dir, { GUARD_DENYLIST: `${term}\nPlutonia` });
    expect(code).toBe(1);
    expect(out).toContain('denylist #1');
    expect(out).not.toMatch(/zebra/i);
  });

  it('reads the environment and the local file, drops short terms and comments', () => {
    const dir = folder({ '.guard-denylist': '# client names\nPlutonia\nab\n' });
    expect(loadDenylist({ GUARD_DENYLIST: '# names\nZebracorp, Zebracorp,Xy' }, dir)).toEqual([
      'Zebracorp',
      'Plutonia',
    ]);
  });

  it('matches whole words only', () => {
    const term = ['Zebra', 'corp'].join('');
    expect(kinds(`${term.toLowerCase()}oration`, { denylist: [term] })).toEqual([]);
    expect(kinds(`${term}_v2 and ${term}.io`, { denylist: [term] })).toEqual(['denylist', 'denylist']);
  });

  it('fails when a denylist is required and none is loaded', () => {
    const dir = folder({ 'a.md': 'clean\n' });
    expect(run(['--require-denylist', dir], dir).code).toBe(1);
    expect(run(['--canary', '--require-denylist'], dir).code).toBe(1);
    expect(run(['--require-denylist', dir], dir, { GUARD_DENYLIST: 'Zebracorp' }).code).toBe(0);
  });

  it('is not silenced by the allow marker', () => {
    const term = ['Zebra', 'corp'].join('');
    expect(kinds(`${term} guard:allow`, { denylist: [term] })).toEqual(['denylist']);
  });
});

describe('allow marker and redaction', () => {
  it('suppresses pattern findings on its line and counts them', () => {
    const email = ['jane.doe', 'acme-corp.io'].join('@');
    expect(scanText(`${email} <!-- guard:allow documented sample -->`)).toEqual({
      findings: [],
      allowed: 1,
      excused: 0,
    });
  });

  it('excuses only the exact fingerprinted value and never a denylist hit', () => {
    const number = makeNationalNumber('850730', '003');
    const other = makeNationalNumber('930518', '223');
    const exceptions = new Set([fingerprint('national-number', number)]);
    expect(scanText(`Lumen-${number}`, { exceptions })).toEqual({ findings: [], allowed: 0, excused: 1 });
    expect(kinds(`Lumen-${other}`, { exceptions })).toEqual(['national-number']);
    expect(kinds(`Lumen-${number}`, { exceptions, denylist: ['Lumen'] })).toEqual(['denylist']);
  });

  it('loads every fingerprint file in a folder and rejects a bad entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-fp-'));
    try {
      const sha256 = 'a'.repeat(64);
      writeFileSync(join(dir, 'one.json'), JSON.stringify({ entries: [{ kind: 'phone', sha256 }] }));
      writeFileSync(
        join(dir, 'two.json'),
        JSON.stringify({ entries: [{ kind: 'national-number', sha256 }] }),
      );
      expect([...loadExceptions(dir)].sort()).toEqual([`national-number:${sha256}`, `phone:${sha256}`]);
      writeFileSync(join(dir, 'bad.json'), JSON.stringify({ entries: [{ kind: 'phone', sha256: 'xyz' }] }));
      expect(() => loadExceptions(dir)).toThrow('bad fingerprint entry');
      writeFileSync(join(dir, 'bad.json'), JSON.stringify({ entries: [{ kind: 'passport', sha256 }] }));
      expect(() => loadExceptions(dir)).toThrow('bad fingerprint entry');
      rmSync(join(dir, 'bad.json'));
      expect(loadExceptions(join(dir, 'missing')).size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('masks all but the edges, and masks denylist matches entirely', () => {
    const iban = makeIban('BE', '539007547034');
    expect(redact(iban, 'iban')).toBe(`BE${'•'.repeat(12)}${iban.slice(-2)}`);
    expect(redact('abc', 'email')).toBe('•••');
    expect(redact('Zebracorp', 'denylist')).toBe('••••••••• (9 chars)');
  });
});

describe('command line', () => {
  it('exits 0 on a clean folder and says what it scanned', () => {
    const dir = folder({ 'a.md': 'jane@example.com\n', 'pic.png': 'binary-ish\n' });
    const { code, out } = run([dir], dir);
    expect(code).toBe(0);
    expect(out).toContain('clean (1 files scanned, 1 skipped, 0 denylist terms)');
  });

  it('exits 1 with redacted findings, skips lockfiles and binary content', () => {
    const iban = makeIban('BE', '539007547034');
    const dir = folder({
      'leak.md': `line one\nIBAN ${iban}\n`,
      'pnpm-lock.yaml': `integrity: ${iban}\n`,
      'blob.dat': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(iban)]),
    });
    const { code, out } = run([dir], dir);
    expect(code).toBe(1);
    expect(out).toContain('1 finding in 1 file');
    expect(out).toContain('leak.md:2');
    expect(out).not.toContain(iban);
  });

  it('counts fingerprint exceptions apart from allow markers in text and JSON', () => {
    const number = makeNationalNumber('850730', '003');
    const marked = ['jane.doe', 'acme-corp.io'].join('@');
    const dir = folder({ 'a.md': `Lumen-${number}\n${marked} guard:allow sample\n` });
    const fp = mkdtempSync(join(tmpdir(), 'guard-fp-'));
    try {
      writeFileSync(
        join(fp, 'x.json'),
        JSON.stringify({
          entries: [
            { kind: 'national-number', sha256: fingerprint('national-number', number).split(':')[1] },
          ],
        }),
      );
      const text = run([dir], dir, {}, fp);
      expect(text.code).toBe(0);
      expect(text.out).toContain('1 allowed by guard:allow markers.');
      expect(text.out).toContain('1 excused by fingerprint.');
      const json = JSON.parse(run(['--json', dir], dir, {}, fp).out);
      expect(json.allowed).toBe(1);
      expect(json.excused).toBe(1);
    } finally {
      rmSync(fp, { recursive: true, force: true });
    }
  });

  it('prints one JSON document with --json', () => {
    const email = ['jane.doe', 'acme-corp.io'].join('@');
    const dir = folder({ 'a.md': `${email}\n` });
    const { code, out } = run(['--json', dir], dir);
    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    const redacted = `ja${'•'.repeat(email.length - 4)}io`;
    expect(parsed.findings).toEqual([{ file: 'a.md', line: 1, kind: 'email', redacted }]);
    expect(out).not.toContain(email);
  });

  it('reads the root .gitleaksignore past the general limit, scans all of it, and keeps the limit for any other path', () => {
    const limit = 10 * 1024 * 1024;
    const padding = `${'0'.repeat(40)}:examples/x.jsonl:generic-api-key:1\n`;
    const email = ['canary.person', 'driftbench-canary.dev'].join('@');
    const content = padding.repeat(Math.ceil((11 * 1024 * 1024) / padding.length)) + `${email}\n`;
    expect(content.length).toBeGreaterThan(limit);
    const dir = folder({ '.gitleaksignore': content });
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', '.gitleaksignore'), content);
    try {
      const parsed = JSON.parse(run(['--json', dir], dir).out);
      // The root file is read whole: the canary at its end is found.
      expect(parsed.findings).toContainEqual(
        expect.objectContaining({ file: '.gitleaksignore', kind: 'email' }),
      );
      // The same name anywhere else keeps the general limit and fails loudly.
      expect(parsed.errors).toEqual([
        {
          file: join('sub', '.gitleaksignore'),
          reason: `size ${content.length} bytes exceeds scan limit ${limit} bytes`,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([false, true])('fails loudly on an oversized recording (JSON: %s)', (json) => {
    const limit = 10 * 1024 * 1024;
    const padding = `${JSON.stringify({ message: 'padding' })}\n`;
    const email = ['canary.person', 'driftbench-canary.dev'].join('@');
    const content =
      padding.repeat(Math.ceil((30 * 1024 * 1024) / padding.length)) +
      `${JSON.stringify({ message: email })}\n`;
    expect(content.indexOf(email)).toBeGreaterThan(limit);
    const dir = folder({ 'recordings.jsonl': content });
    try {
      const { code, out, err } = run(json ? ['--json', dir] : [dir], dir);
      expect(code).toBe(1);
      expect(out + err).toContain('recordings.jsonl');
      expect(out + err).toContain('exceeds scan limit');
      expect(out + err).not.toContain(email);
      if (json) {
        const parsed = JSON.parse(out);
        expect(parsed.clean).toBe(false);
        expect(parsed.skipped).toBe(0);
        expect(parsed.errors).toEqual([
          {
            file: 'recordings.jsonl',
            reason: `size ${content.length} bytes exceeds scan limit ${limit} bytes`,
          },
        ]);
      } else {
        expect(err).toContain('recordings.jsonl');
        expect(out).not.toContain('guard: clean');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still scans files exactly at the byte limit', () => {
    const iban = makeIban('BE', '539007547034');
    const content = Buffer.alloc(10 * 1024 * 1024, ' ');
    content.write(iban, content.length - iban.length);
    const dir = folder({ 'at-limit.jsonl': content });
    try {
      const { code, out } = run(['--json', dir], dir);
      expect(code).toBe(1);
      const parsed = JSON.parse(out);
      expect(parsed.scanned).toBe(1);
      expect(parsed.skipped).toBe(0);
      expect(parsed.errors).toEqual([]);
      expect(parsed.findings).toEqual([
        { file: 'at-limit.jsonl', line: 1, kind: 'iban', redacted: redact(iban, 'iban') },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 on a usage error', () => {
    expect(run(['--nope'], tmpdir()).code).toBe(2);
    expect(run(['/definitely/not/here'], tmpdir()).code).toBe(2);
  });
});

describe('canary', () => {
  it('catches every planted kind and lets the fictional data through', () => {
    expect(runCanary([])).toMatchObject({ ok: true, misses: [] });
    expect(runCanary(['Zebracorp'])).toMatchObject({ ok: true, got: { denylist: 1 } });
  });

  it('reports through the command line without printing the planted values', () => {
    const dir = folder({});
    const { code, out } = run(['--canary'], dir, { GUARD_DENYLIST: 'Zebracorp' });
    expect(code).toBe(0);
    expect(out).toContain('driftbench guard canary: ok.');
    expect(out).toContain('1 denylist terms loaded.');
    expect(out).not.toMatch(/zebracorp/i);
  });
});
