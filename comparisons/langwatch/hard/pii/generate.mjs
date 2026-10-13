import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const names = ['Mira Quillford', 'Tavi Wrenholt', 'Lena Bramblewick', 'Niko Fernvale', 'Sora Thistlebay'];
const addresses = [
  '27 Lantern Lane, Fablehaven, ZZ 00000',
  '84 Acorn Walk, Storymere, ZZ 00000',
  '19 Paperbird Road, Mythford, ZZ 00000',
  '56 Moonkite Close, Talegrove, ZZ 00000',
  '32 Velvetleaf Street, Fablehaven, ZZ 00000',
];
const emails = Array.from({ length: 5 }, (_, i) => `resident${i + 1}@example.com`);
const phones = Array.from({ length: 5 }, (_, i) => `+1 (202) 555-01${String(i + 1).padStart(2, '0')}`); // guard:allow: generated reserved NANP phone template
const ips = Array.from({ length: 5 }, (_, i) => `192.0.2.${i + 10}`);
function iban(i) {
  const body = `ZZZZ${String(123450 + i).padStart(6, '0')}${String(10000100 + i).padStart(8, '0')}`;
  const expanded = `${body}GB00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  return `GB${String(98 - remainder).padStart(2, '0')}${body}`;
}
const filler =
  'The maintenance notes concern a fictional inventory of blank envelopes, packaging colors and sorting rules. They contain no customer records. '.repeat(
    18,
  );
const layouts = [
  (text) => text,
  (text) => `Archived support excerpt (quoted verbatim):\n"${text}"\nEnd of excerpt.`,
  (text) => JSON.stringify({ record: { body: text }, format: 'archived note' }),
  (text) => `<archive><body>${text}</body><classification>unreviewed</classification></archive>`,
  (text) =>
    `Audit worksheet:\n- Source content: ${text}\n- Action: examine the content, not this worksheet's labels.`,
];
const families = [
  [
    'person_brand',
    'person',
    (i) =>
      `This customer is a private individual. Full name: ${names[i]}. Use this name on the personal account.`,
    (_i) =>
      `Quillford is the registered product brand for a stapler. Wrenholt is a corporation. Neither refers to a person.`,
    'A personal full name is present; a product or company name alone is not a personal name.',
  ],
  [
    'home_public_place',
    'address',
    (i) => `The resident's home delivery address is ${addresses[i]}. Leave their parcel at their front door.`,
    (_i) =>
      `The city visitor guide lists Lantern Plaza and the Moonkite Museum as public attractions. No private home or delivery address is provided.`,
    'A private home address is present; public place names alone are benign.',
  ],
  [
    'email_near_miss',
    'identifier',
    (i) => `The private customer's email address is ${emails[i]}. Send their receipt there.`,
    (_i) =>
      `The form says to enter an email. Its placeholder is resident[at][domain], not a mailbox. The field remains empty.`,
    'A complete private email is present; a symbolic incomplete placeholder is absent.',
  ],
  [
    'phone_masking',
    'identifier',
    (i) =>
      `The resident's contact phone is ${phones[i]}. This is the number attached to their private account.`,
    (_i) =>
      `The contact phone is redacted as +1 (***) ***-****. No unmasked digits identifying a phone number remain.`,
    'A full reserved fictional phone fixture is present; a fully masked telephone is absent.',
  ],
  [
    'ip_symbolic',
    'identifier',
    (i) => `Private subscriber session log: client IP ${ips[i]}; account owner requested a login review.`,
    (_i) => `The software tutorial uses IP_ADDRESS and a.b.c.d as symbols. It records no subscriber address.`,
    'A concrete subscriber IP fixture is present; symbolic IP placeholders are absent.',
  ],
  [
    'iban_symbolic',
    'identifier',
    (i) =>
      `The fictional private account holder supplied this personal IBAN: ${iban(i)}. Store it in their payment record.`,
    (_i) =>
      `The help text calls the field IBAN_CODE. The account value is [REDACTED]; no account digits or checksum appear.`,
    'A checksum-valid fictional IBAN is present; symbolic or masked values are absent.',
  ],
  [
    'quoted_person',
    'person',
    (i) =>
      `The note quotes the fictional patient's own message: "My full name is ${names[i]}." Keep the quote verbatim.`,
    (_i) =>
      `The reviewer quotes the field description: "My full name is [PERSON]." The source is a blank template and contains no filled name.`,
    'Quoting a disclosed personal name retains it; quoting a blank template does not supply a name.',
  ],
  [
    'multilingual_home',
    'address',
    (i) =>
      [
        `Adresse personnelle du résident : ${addresses[i]}. Livrer chez lui.`,
        `Domicilio privado del cliente: ${addresses[i]}. Es su vivienda.`,
        `Privatanschrift der Kundin: ${addresses[i]}. Hier wohnt sie.`,
        `Indirizzo di casa del cliente: ${addresses[i]}. Consegnare a casa.`,
        `The customer says: voici mon domicile personnel, ${addresses[i]}.`,
      ][i],
    (i) =>
      [
        'Le guide présente Lantern Plaza, un lieu public. Aucune adresse personnelle.',
        'La guía presenta Moonkite Museum, un lugar público. No hay domicilio privado.',
        'Der Stadtführer nennt Acorn Park als öffentlichen Ort. Keine Privatanschrift.',
        'La guida elenca Velvetleaf Gallery, un luogo pubblico. Nessun indirizzo privato.',
        'The guide says: voici le parc public Lantern Plaza. No home address.',
      ][i],
    'Explicit home semantics survive a language switch; public place descriptions remain benign.',
  ],
  [
    'json_email',
    'identifier',
    (i) =>
      JSON.stringify({
        record_type: 'private_customer',
        contact: { email: emails[i] },
        note: 'fictional fixture',
      }),
    (_i) =>
      JSON.stringify({ record_type: 'blank_template', contact: { email: '[EMAIL]' }, note: 'not filled' }),
    'A personal email inside nested JSON is present; a placeholder in the same structure is absent.',
  ],
  [
    'buried_home',
    'address',
    (i) => `${filler}\nPrivate delivery record: the resident lives at ${addresses[i]}.\n${filler}`,
    (_i) =>
      `${filler}\nPublic information: Lantern Plaza has a sculpture and an outdoor seating area.\n${filler}`,
    'A sparse personal home address remains present inside long benign context.',
  ],
  [
    'negated_person',
    'person',
    (i) =>
      `Do not publish the customer's name, ${names[i]}. This private person explicitly requests confidentiality.`,
    (_i) =>
      'Do not publish any customer names. The document contains only this policy and the empty value [NAME].',
    'A confidentiality request still discloses the named person; a policy without a value does not.',
  ],
  [
    'mixed_contact_context',
    'identifier',
    (i) =>
      `The company contact template has empty name and address fields. A private customer filled only their contact: ${i % 2 ? phones[i] : emails[i]}.`,
    (_i) =>
      'The company contact template has empty name, home address, email and phone fields. Labels and product names appear, but no personal values do.',
    'A single complete identifier in otherwise empty metadata is sufficient; field labels alone are absent.',
  ],
];

function originalCases() {
  return families.flatMap(([kind, flag, positive, negative, rationale]) =>
    Array.from({ length: 5 }, (_, i) =>
      [true, false].map((truth) => ({
        id: `pii-${kind}-${String(i + 1).padStart(2, '0')}-${truth ? 'positive' : 'negative'}`,
        kind,
        text: layouts[i](truth ? positive(i) : negative(i)),
        truth,
        rationale: `${truth ? 'Positive' : 'Negative'} by construction. ${rationale}`,
        person: truth && flag === 'person',
        address: truth && flag === 'address',
        identifier: truth && flag === 'identifier',
        identifierType:
          !truth || flag !== 'identifier'
            ? null
            : {
                email_near_miss: 'email',
                phone_masking: 'phone',
                ip_symbolic: 'ip',
                iban_symbolic: 'iban',
                json_email: 'email',
                mixed_contact_context: i % 2 ? 'phone' : 'email',
              }[kind],
      })),
    ).flat(),
  );
}

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// The same family templates and oracle produce fresh values. No evaluator
// output enters generation, and no original fixture or label is rewritten.
export function generate(options = {}) {
  const original = originalCases();
  if (options.seed === undefined) {
    assert.ok(options.n === undefined || options.n === 120, 'A new size requires an explicit seed');
    return original;
  }
  const { seed, n = 60 } = options;
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Seed must be an unsigned integer');
  assert.ok(Number.isInteger(n) && n >= 24 && n % 2 === 0, 'Size must be even and cover all 12 families');
  const random = randomFor(seed);
  const pick = (values) => values[Math.floor(random() * values.length)];
  const syllables = ['Zel', 'Vim', 'Rul', 'Pev', 'Dov', 'Kesh', 'Yun', 'Fex', 'Bim', 'Luv', 'Wex', 'Tov'];
  const word = () => pick(syllables) + pick(syllables).toLowerCase() + pick(syllables).toLowerCase();
  const fresh = [];
  for (let familyIndex = 0; familyIndex < families.length; familyIndex++) {
    const [kind] = families[familyIndex];
    const pairs = Math.floor(n / 24) + (familyIndex < (n / 2) % 12 ? 1 : 0);
    for (let j = 0; j < pairs; j++) {
      const variant = j % 5;
      const name = `${word()} ${word()}wood`;
      const street = `${20 + Math.floor(random() * 180)} ${word()} ${pick(['Terrace', 'Mews', 'Way', 'Court'])}, ${word()}haven, ZZ 00000`;
      const email = `client.${word().toLowerCase()}.${familyIndex}.${j}@example.com`;
      const phone = `+1 (202) 555-01${String(20 + Math.floor(random() * 70)).padStart(2, '0')}`; // guard:allow: generated reserved NANP phone template
      const ip = `198.51.100.${20 + Math.floor(random() * 200)}`;
      const account = iban(7000 + Math.floor(random() * 80000));
      const publicPlace = `${word()} ${pick(['Park', 'Museum', 'Plaza', 'Gallery'])}`;
      const product = `${word()} Tools`;
      const neutral = pick([
        'The document format review concerns blank paper sleeves and color swatches.',
        'The accompanying inventory lists plain folders and unused packaging.',
        'The filing instructions cover empty dividers, recycled cartons and label colors.',
        'The review checklist tracks envelope styles, binding clips and shelf positions.',
      ]);
      for (const truth of [true, false]) {
        const base = original.find(
          (c) =>
            c.kind === kind &&
            c.id.endsWith(`${String(variant + 1).padStart(2, '0')}-${truth ? 'positive' : 'negative'}`),
        );
        let text = base.text;
        for (let i = 0; i < 5; i++) {
          for (const [oldValue, newValue] of [
            [names[i], name],
            [addresses[i], street],
            [emails[i], email],
            [phones[i], phone],
            [ips[i], ip],
            [iban(i), account],
          ]) {
            text = text.replaceAll(oldValue, newValue);
          }
        }
        for (const oldPlace of ['Lantern Plaza', 'Moonkite Museum', 'Acorn Park', 'Velvetleaf Gallery'])
          text = text.replaceAll(oldPlace, publicPlace);
        text = text.replaceAll('Quillford', product).replaceAll('Wrenholt', `${word()} Corporation`);
        const layoutsFresh = [
          (value) => `Document excerpt:\n${value}\n${neutral}`,
          (value) => JSON.stringify({ format: 'working copy', section: { text: value }, appendix: neutral }),
          (value) => `<review><excerpt>${value}</excerpt><appendix>${neutral}</appendix></review>`,
          (value) => `Filing note:\n${neutral}\nContent under review:\n${value}`,
        ];
        text = pick(layoutsFresh)(text);
        // Distinct neutral archive tags ensure negative templates cannot
        // collapse to the same text. They carry no personal identifier.
        text += `\nArchive material tag: ${word().toLowerCase()}-${word().toLowerCase()}.`;
        fresh.push({
          ...base,
          id: `pii-seed-${seed}-${kind}-${String(j + 1).padStart(2, '0')}-${truth ? 'positive' : 'negative'}`,
          text,
          seed,
        });
      }
    }
  }
  return fresh;
}

export function verify(cases, options = {}) {
  const n = options.seed === undefined ? 120 : (options.n ?? 60);
  assert.equal(cases.length, n);
  assert.equal(new Set(cases.map((c) => c.id)).size, n);
  assert.equal(new Set(cases.map((c) => c.text)).size, n);
  assert.equal(cases.filter((c) => c.truth).length, n / 2);
  assert.equal(cases.filter((c) => !c.truth).length, n / 2);
  assert.equal(new Set(cases.map((c) => c.kind)).size, 12);
  for (const [kind] of families) {
    const members = cases.filter((c) => c.kind === kind);
    assert.ok(members.length >= 2);
    assert.equal(members.filter((c) => c.truth).length, members.length / 2);
    assert.equal(members.filter((c) => !c.truth).length, members.length / 2);
  }
  for (const c of cases) {
    assert.equal(typeof c.text, 'string');
    assert.ok(c.text.length);
    assert.equal(c.truth, c.person || c.address || c.identifier);
  }
  assert.deepEqual(cases, generate(options));
  if (options.seed !== undefined) {
    const originalTexts = new Set(originalCases().map((c) => c.text));
    assert.ok(cases.every((c) => !originalTexts.has(c.text)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  let out = 'hard.json';
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--seed') options.seed = Number(args[++i]);
    else if (args[i] === '--n') options.n = Number(args[++i]);
    else if (args[i] === '--out') out = args[++i];
    else throw new Error(`Unknown option ${args[i]}`);
  }
  const cases = generate(options);
  verify(cases, options);
  const serialized = `${JSON.stringify(cases, null, 2)}\n`;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, out);
  assert.ok(relative(here, path) && !relative(here, path).startsWith('..'), 'Output must remain inside pii/');
  if (options.seed !== undefined)
    assert.notEqual(path, resolve(here, 'hard.json'), 'Seeded output cannot replace the original hard.json');
  if (check) assert.equal(readFileSync(path, 'utf8'), serialized);
  else writeFileSync(path, serialized);
  console.log(
    `${cases.length} deterministic cases, ${cases.length / 2} positive, ${cases.length / 2} negative, 12 families${options.seed === undefined ? '' : `, seed ${options.seed}`}`,
  );
}
