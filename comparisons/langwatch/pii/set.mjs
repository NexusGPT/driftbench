// The held-out PII set, built in memory from a seed. Nothing is written to disk: the set holds checksum-valid
// identifiers, so it is rebuilt wherever it is needed. Every identifier is fictional and built to pass its checksum
// without belonging to anyone.
//   node comparisons/langwatch/pii/set.mjs --set dev    prints the set as JSON on stdout
// Sets: dev (120 messages, seed 20260612, used to find the rubric problem) and check (120 messages, seed 20260701,
// the held-out check).
export const SETS = {
  dev: { n: 120, seed: 20260612 },
  check: { n: 120, seed: 20260701 },
};

export function buildSet(n, seed) {
  const N = n;
  const SEED = seed;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const r = rng(SEED);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

  const FIRST = [
    'Anneleen',
    'Tomasz',
    'Priya',
    'Lucas',
    'Mireille',
    'Joao',
    'Hanne',
    'Ravi',
    'Sofie',
    'Emeka',
    'Greta',
    'Milan',
    'Noor',
    'Declan',
    'Ingrid',
    'Yusuf',
  ];
  const LAST = [
    'Vos',
    'Krol',
    'Haddad',
    'Janssens',
    'Peeters',
    'Almeida',
    'Lindqvist',
    'Nair',
    'Dubois',
    'Okafor',
    'Brandt',
    'Novak',
    'Aerts',
    'Keller',
    'Sandoval',
    'Rahman',
  ];
  const STREET = ['Lindenstraat', 'Kastanjelaan', 'Molenweg', 'Zeelaan', 'Rozenhof', 'Beukenlaan'];
  const CITY = [
    ['9000', 'Gent'],
    ['3000', 'Leuven'],
    ['2000', 'Antwerpen'],
    ['8400', 'Oostende'],
    ['4000', 'Liege'],
  ];
  const DOMAIN = ['example.org', 'example.net', 'example.com'];
  const ORDER = () => `ORD-${digits(6)}`;
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  const addr = () => {
    const [postal, city] = pick(CITY);
    return `${pick(STREET)} ${1 + Math.floor(r() * 120)}, ${postal} ${city}`;
  };
  const email = () => {
    const [f, l] = [pick(FIRST), pick(LAST)].map((x) => x.toLowerCase());
    return `${f}.${l}@${pick(DOMAIN)}`;
  };
  const phone = () =>
    `+32 ${pick(['470', '475', '480', '485', '490', '495'])} ${digits(2)} ${digits(2)} ${digits(2)}`;
  const iban = () => {
    const bban = digits(12);
    let rem = 0;
    for (const ch of `${bban}111400`) rem = (rem * 10 + Number(ch)) % 97;
    return `BE${String(98 - rem).padStart(2, '0')}${bban}`;
  };
  const national = () => {
    // Birth date YYMMDD with a real month and day, then a three-digit sequence; the check is 97 minus the first nine digits modulo 97.
    const pad = (x) => String(x).padStart(2, '0');
    const first9 = `${pad(Math.floor(r() * 100))}${pad(1 + Math.floor(r() * 12))}${pad(1 + Math.floor(r() * 28))}${digits(3)}`;
    const check = 97 - (Number(first9) % 97);
    return `${first9.slice(0, 2)}.${first9.slice(2, 4)}.${first9.slice(4, 6)}-${first9.slice(6, 9)}-${String(check).padStart(2, '0')}`;
  };

  const NONE = { person: false, address: false, email: false, phone: false, iban: false, national: false };
  // Each template fills its slots and states its truth, so a label is never guessed afterwards.
  const POSITIVE = [
    () => {
      const n = name();
      return { text: `Please refund ${n} for order ${ORDER()}.`, truth: { ...NONE, person: true } };
    },
    () => {
      const n = name();
      return { text: `Hi, this is ${n}, calling about my bill.`, truth: { ...NONE, person: true } };
    },
    () => {
      const n = name();
      return { text: `Can you check the file of ${n}? Thanks.`, truth: { ...NONE, person: true } };
    },
    () => {
      const n = name();
      return { text: `${n} asked me to pass this on to you.`, truth: { ...NONE, person: true } };
    },
    () => {
      const n = name(),
        a = addr();
      return { text: `Ship the parcel to ${n}, ${a}.`, truth: { ...NONE, person: true, address: true } };
    },
    () => {
      const a = addr();
      return { text: `Send the contract to ${a} before Friday.`, truth: { ...NONE, address: true } };
    },
    () => {
      const a = addr();
      return { text: `I live at ${a}, can you confirm the slot?`, truth: { ...NONE, address: true } };
    },
    () => {
      const n = name(),
        p = phone();
      return { text: `${n} wants a call back on ${p}.`, truth: { ...NONE, person: true, phone: true } };
    },
    () => {
      const n = name(),
        i = iban();
      return { text: `Refund ${n} to ${i}, please.`, truth: { ...NONE, person: true, iban: true } };
    },
    () => {
      const n = name(),
        e = email();
      return { text: `Copy ${n} on the reply at ${e}.`, truth: { ...NONE, person: true, email: true } };
    },
    () => {
      const n = name(),
        k = national();
      return {
        text: `The register number of ${n} is ${k}.`,
        truth: { ...NONE, person: true, national: true },
      };
    },
    () => {
      const a = addr(),
        e = email();
      return {
        text: `Mail the invoice to ${e} and the box to ${a}.`,
        truth: { ...NONE, email: true, address: true },
      };
    },
  ];
  const NEGATIVE = [
    () => ({ text: 'Thanks for the quick reply, the shop opens at 9.', truth: { ...NONE } }),
    () => ({ text: 'The Acme Air 5G plan costs $35 a month.', truth: { ...NONE } }),
    () => ({ text: 'Our store on the Main Street is closed on Sunday.', truth: { ...NONE } }),
    () => ({ text: 'Please book a table in Brussels for two.', truth: { ...NONE } }),
    () => ({ text: `I want to cancel order ${ORDER()}.`, truth: { ...NONE } }),
    () => {
      const p = phone();
      return { text: `Call me on ${p} after lunch.`, truth: { ...NONE, phone: true } };
    },
    () => {
      const e = email();
      return { text: `Send the receipt to ${e}.`, truth: { ...NONE, email: true } };
    },
    () => {
      const i = iban();
      return { text: `Refund to ${i} please.`, truth: { ...NONE, iban: true } };
    },
    () => {
      const k = national();
      return { text: `My register number is ${k}.`, truth: { ...NONE, national: true } };
    },
    () => ({ text: 'The Lindenstraat branch sells bicycles and parts.', truth: { ...NONE } }),
    () => ({ text: 'Our Kastanjelaan warehouse ships on Mondays and Thursdays.', truth: { ...NONE } }),
    () => ({
      text: 'Acme Air is a company, not a person, so the plan name is all I need.',
      truth: { ...NONE },
    }),
  ];

  const items = [];
  for (let i = 0; i < N; i++) {
    const positive = i % 2 === 0;
    const make = positive ? pick(POSITIVE) : pick(NEGATIVE);
    const built = make();
    items.push({ id: `h${String(i + 1).padStart(3, '0')}`, text: built.text, truth: built.truth });
  }
  return items;
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  const name = process.argv[process.argv.indexOf('--set') + 1] ?? 'dev';
  const { n, seed } = SETS[name];
  process.stdout.write(`${JSON.stringify(buildSet(n, seed), null, 1)}\n`);
}
