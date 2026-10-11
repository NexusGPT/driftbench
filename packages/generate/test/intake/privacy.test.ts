import { describe, expect, it } from 'vitest';
import {
  anonymiseTurns,
  detectPass1,
  detectPass2,
  isFictionalPhone,
  isValidBelgianNationalNumber,
  isValidFrenchNir,
  isValidIban,
  luhn,
  parseCheckerAnswer,
  Redactor,
} from '../../src/intake';
import { FakeModelPort, ModelError } from '../../src/model';
import { makeBelgianNumber, makeCard, makeIban, makeNir, realEmail, realMobile } from './support';

const types = (text: string) => detectPass1(text).map((finding) => `${finding.type}:${finding.detector}`);

describe('checksums', () => {
  it('accepts an IBAN with a valid mod 97 check and refuses one digit off', () => {
    const iban = makeIban('BE', '539007547034');
    expect(isValidIban(iban)).toBe(true);
    const last = Number(iban.slice(-1));
    expect(isValidIban(`${iban.slice(0, -1)}${(last + 1) % 10}`)).toBe(false);
    expect(isValidIban(`${iban}0`)).toBe(false);
  });

  it('runs the Luhn check on card numbers', () => {
    const card = makeCard('4', 16);
    expect(luhn(card)).toBe(true);
    expect(luhn(`${card.slice(0, -1)}${(Number(card.slice(-1)) + 1) % 10}`)).toBe(false);
  });

  it('checks Belgian national register numbers and French NIRs', () => {
    const be = makeBelgianNumber('850730', '033');
    expect(isValidBelgianNationalNumber(be)).toBe(true);
    expect(isValidBelgianNationalNumber(be.replace(/\d$/, (d) => String((Number(d) + 1) % 10)))).toBe(false);
    const nir = makeNir('1850775123456');
    expect(isValidFrenchNir(nir)).toBe(true);
    expect(isValidFrenchNir(`${nir.slice(0, -1)}${(Number(nir.slice(-1)) + 1) % 10}`)).toBe(false);
  });

  it('knows the fictional phone range and nothing else', () => {
    expect(isFictionalPhone('+1 202 555 0143')).toBe(true);
    expect(isFictionalPhone('202-555-0199')).toBe(true);
    expect(isFictionalPhone('202-555-0200')).toBe(false);
    expect(isFictionalPhone(realMobile())).toBe(false);
  });
});

describe('pass 1', () => {
  it('finds each type with its detector', () => {
    const text = [
      `mail ${realEmail('jan.peeters')} or call ${realMobile()}`,
      `iban ${makeIban('BE', '539007547034')}, card ${makeCard('5', 16)
        .replace(/(\d{4})/g, '$1 ')
        .trim()}`,
      `id ${makeBelgianNumber('850730', '033')}, ssn 123-45-6789, nino AB 12 34 56 C, nir ${makeNir('1850775123456')}`,
      'I live at 12 Orchard Lane and work at Kerkstraat 14',
    ].join('\n');
    expect(types(text)).toEqual([
      'email:email-shape',
      'phone:phone-international',
      'iban:iban-mod97',
      'card:card-luhn',
      'national_id:be-national-register-mod97',
      'national_id:us-ssn',
      'national_id:uk-nino',
      'national_id:fr-nir-key',
      'address:address-number-first',
      'address:address-name-first',
    ]);
  });

  it('does not report an IBAN or a card whose checksum fails, nor plain numbers', () => {
    const iban = makeIban('BE', '539007547034');
    const broken = `${iban.slice(0, -1)}${(Number(iban.slice(-1)) + 1) % 10}`;
    const card = makeCard('4', 16);
    const badCard = `${card.slice(0, -1)}${(Number(card.slice(-1)) + 1) % 10}`;
    expect(detectPass1(`iban ${broken}`).filter((f) => f.type === 'iban')).toEqual([]);
    expect(detectPass1(`card ${badCard}`).filter((f) => f.type === 'card')).toEqual([]);
    expect(detectPass1('I want 20 GB for 25 euros, order 4471')).toEqual([]);
  });

  it('marks reserved fictional data as fictional and real-looking data as not', () => {
    const findings = detectPass1(`sam.lee@example.com, +1 202 555 0143, ${realEmail('ana')}`);
    expect(findings.map((finding) => [finding.type, finding.fictional])).toEqual([
      ['email', true],
      ['phone', true],
      ['email', false],
    ]);
  });

  it('keeps an IBAN to its country length when text follows it', () => {
    const iban = makeIban('NL', 'ABNA0417164300');
    const finding = detectPass1(`pay ${iban}ABC please`)[0];
    expect(finding?.value).toBe(iban);
  });
});

describe('pass 2', () => {
  it('finds names after a cue, spelled-out emails, long digit runs and URLs that pass 1 misses', () => {
    const text =
      'Hi, my name is Ana Duarte. Write to ana at mailbox dot be, ref 12 34 56 78, see www.x.example/u?id=9';
    expect(detectPass1(text).map((finding) => finding.type)).toEqual([]);
    expect(detectPass2(text).map((finding) => `${finding.type}=${finding.value}`)).toEqual([
      'name=Ana Duarte',
      'contact=ana at mailbox dot be',
      'long_number=12 34 56 78',
      'url=www.x.example/u?id=9',
    ]);
  });

  it('never reports a placeholder pass 1 left', () => {
    expect(detectPass2('mail [EMAIL_1] and call [PHONE_2], account [IBAN_1]')).toEqual([]);
  });

  it('reads a cue at the start of a sentence in either case, and not a lower-case word after it', () => {
    expect(detectPass2("I'm Sam").map((finding) => finding.value)).toEqual(['Sam']);
    expect(detectPass2("i'm looking for more data")).toEqual([]);
  });
});

describe('Redactor', () => {
  it('gives one value one placeholder in a conversation, and numbers each type apart', () => {
    const redactor = new Redactor();
    const email = realEmail('jo');
    const text = `${email} then ${email.toUpperCase()} then ${realMobile()}`;
    expect(redactor.redact(text, detectPass1(text))).toBe('[EMAIL_1] then [EMAIL_1] then [PHONE_1]');
  });
});

describe('anonymiseTurns', () => {
  const turns = [
    { role: 'user', text: `I'm Ana Duarte, my email is ${realEmail('ana.duarte')}` },
    { role: 'agent', text: 'Thanks Ana, what is your number?' },
    { role: 'user', text: realMobile() },
  ];

  it('runs pass 1 then the independent rules, and the second pass counts what pass 1 missed', async () => {
    const result = await anonymiseTurns('c1', turns, { second: 'rules' });
    expect(result.turns.map((turn) => turn.text)).toEqual([
      "I'm [NAME_1], my email is [EMAIL_1]",
      'Thanks Ana, what is your number?',
      '[PHONE_1]',
    ]);
    expect(result.findings.map((finding) => `${finding.turn}:${finding.pass}:${finding.type}`)).toEqual([
      '0:1:email',
      '0:2:name',
      '2:1:phone',
    ]);
    expect(result.model).toEqual({ status: 'not_run' });
  });

  it('sends only redacted text to the model checker and applies the spans it names', async () => {
    const port = new FakeModelPort([
      JSON.stringify({
        findings: [
          { turn: 1, text: 'Ana', type: 'name' },
          { turn: 0, text: 'not in the text', type: 'name' },
        ],
      }),
    ]);
    const result = await anonymiseTurns('c1', turns, { second: 'both', port });
    const sent = port.requests[0]?.user ?? '';
    expect(sent).not.toContain('ana.duarte');
    expect(sent).not.toContain('471');
    expect(sent).toContain("TURN 0 (user): I'm [NAME_1], my email is [EMAIL_1]");
    expect(result.turns[1]?.text).toBe('Thanks [NAME_2], what is your number?');
    expect(result.model).toEqual({ status: 'done', unmatched: 1 });
  });

  it('retries an unreadable answer once, then marks the conversation failed and keeps the rule passes', async () => {
    const port = new FakeModelPort(['not json', '{"nope": 1}']);
    const result = await anonymiseTurns('c1', turns, { second: 'model', port });
    expect(port.requests).toHaveLength(2);
    expect(port.requests[1]?.user).toContain('could not be read');
    expect(result.model).toEqual({ status: 'failed', reason: 'the answer has no findings list' });
    expect(result.turns[0]?.text).toBe("I'm Ana Duarte, my email is [EMAIL_1]");
  });

  it('marks the conversation failed on a model error, never clean', async () => {
    const port = new FakeModelPort([new ModelError('http', '529 overloaded', { status: 529 })]);
    const result = await anonymiseTurns('c1', turns, { second: 'model', port });
    expect(result.model.status).toBe('failed');
  });
});

describe('parseCheckerAnswer', () => {
  it('reads a fenced answer and refuses a finding without a turn number', () => {
    const turns = [{ role: 'user', text: 'call Bo' }];
    expect(parseCheckerAnswer('```json\n{"findings": []}\n```', turns)).toEqual({
      ok: true,
      findings: [],
      unmatched: 0,
    });
    expect(parseCheckerAnswer('{"findings": [{"text": "Bo"}]}', turns)).toMatchObject({ ok: false });
  });
});
