import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { between, type RawSpec, type Rng, rngFor, run, shuffled } from '../harness';
import { type FileAction, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Level 5: value checks, ask the tool what a value means (PR 459; policy/value-check/default.yaml there). The
 * ladder `runLadder(case, policy, services)` of the checks package decides whether the value the agent wrote is
 * the gold value: equal values pass and differing non-strings fail on their own (`identity`); a replayable tool
 * that declares the field and a world with distractors decides by what it resolves (`rung1_outcome`); a
 * stated format (`pattern`, `enum`, `const`) only fails a value (`rung2_contract`); a value the user or a file
 * gave may not be changed (`rung2b_as_given`); anything no rung settles is compared exactly (`exact_fallback`,
 * lint `no_decider`), so a fail stays a fail. The tools here are fictional and their truth is code: a phone
 * resolves by its digits, an email by its lower case, a bike code by its upper case.
 *
 * Every tool name, field name, file name, record and value the ladder reads is drawn from the seed and the item
 * id, so no table of what one seed draws answers another, and no catalogue of names lets a ladder key on a
 * tool. Every case runs with a twin whose right answer differs in its outcome or its rung, so no fixed verdict
 * passes both.
 */

const LADDER = 'packages/checks/src/value-check/ladder.ts';
const OUTCOME = 'packages/checks/src/value-check/outcome.ts';
const CONTRACT = 'packages/checks/src/value-check/contract.ts';
const AS_GIVEN = 'packages/checks/src/value-check/as-given.ts';

type Result = { outcome: string; rung: string; lint?: { id: string }; evidence?: unknown };
type Case = Record<string, unknown>;
type Services = Record<string, unknown>;
type Want = { outcome: string; rung: string };

type RunLadder = (value: Case, policy?: unknown, services?: Services) => Promise<Result>;

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';

/** A seeded word of lower case letters. */
function word(rng: Rng, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += LETTERS[Math.floor(rng() * LETTERS.length)];
  return out;
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A seeded run of digits, the first one not 0. */
function digits(rng: Rng, length: number): string {
  let out = String(between(rng, 1, 9));
  while (out.length < length) out += String(between(rng, 0, 9));
  return out;
}

/** The names a case hands the ladder: a tool, its field, another tool, another field, a resolved key. */
type Names = { tool: string; field: string; elsewhere: string; spare: string; resolved: string };

function namesFor(seed: number, id: string): Names {
  const name = (slot: string, length = 6) => token(seed, `${id}#${slot}`, length);
  return {
    tool: `${name('tool-a', 5)}.${name('tool-b')}`,
    field: `f${name('field')}`,
    elsewhere: `${name('else-a', 5)}.${name('else-b')}`,
    spare: `s${name('spare')}`,
    resolved: `r${name('resolved')}`,
  };
}

/** A kind of value and the tool's own rule for it: the writing a record holds, another writing, the normal form. */
type ValueKind = {
  kind: string;
  draw(rng: Rng, domain: string): string;
  other(gold: string): string;
  normal(value: string): string;
};

/** A phone written another way: spaces between groups, the same digits. */
const spaced = (phone: string) =>
  `${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;

const VALUE_KINDS: ValueKind[] = [
  {
    kind: 'phone',
    draw: (rng) => `+${between(rng, 1, 9)}${digits(rng, 10)}`,
    other: spaced,
    normal: (value) => value.replace(/\D/g, ''),
  },
  {
    kind: 'email',
    draw: (rng, domain) => `${word(rng, 5)}.${word(rng, 6)}@${domain}.example`,
    other: (gold) => gold.toUpperCase(),
    normal: (value) => value.toLowerCase(),
  },
  {
    kind: 'bike_code',
    draw: (rng) => `${word(rng, 4).toUpperCase()}${between(rng, 10, 999)}`,
    other: (gold) => gold.toLowerCase(),
    normal: (value) => value.toUpperCase(),
  },
];

/** A fictional directory of one kind of value: seeded records, each with its id and its gold writing. */
type World = { kind: ValueKind; records: { id: string; gold: string }[] };

function world(rng: Rng, kind: ValueKind): World {
  const domain = word(rng, 7);
  const count = between(rng, 5, 9);
  const records: World['records'] = [];
  const seen = new Set<string>();
  while (records.length < count) {
    const gold = kind.draw(rng, domain);
    if (seen.has(kind.normal(gold))) continue;
    seen.add(kind.normal(gold));
    records.push({ id: `${word(rng, 3)}-${between(rng, 100, 999)}`, gold });
  }
  return { kind, records };
}

/** The tool's own resolution: the id of the record a writing names, or null. */
const resolveIn = (w: World, value: string) =>
  w.records.find((record) => w.kind.normal(record.gold) === w.kind.normal(value))?.id ?? null;

const goldOf = (w: World, index: number) => (w.records[index] as World['records'][number]).gold;

type ReplayOptions = {
  declared?: boolean;
  distractors?: boolean;
  inputs?: string[];
  refuse?: string;
  /** A resolution of its own, in place of the directory's. */
  resolve?: (value: string) => string | null;
};

/** A replayer over the fictional world: the tool's own resolution, a refusal on an empty value. */
function replayer(w: World, names: Pick<Names, 'tool' | 'field' | 'resolved'>, options: ReplayOptions) {
  const resolve = options.resolve ?? ((value: string) => resolveIn(w, value));
  return {
    declaration: (tool: string) =>
      options.declared === false || tool !== names.tool
        ? undefined
        : {
            resolved: [names.resolved],
            distractors: options.distractors ?? true,
            ...(options.inputs ? { inputs: options.inputs } : {}),
          },
    call: (tool: string, input: Record<string, unknown>) => {
      if (tool !== names.tool) return { ok: false, error: `unknown tool ${tool}` };
      const value = String(input[names.field] ?? '');
      if (value === '' || value === options.refuse) return { ok: false, error: `${names.field} refused` };
      return { ok: true, output: { [names.resolved]: resolve(value) } };
    },
  };
}

/** One call of the ladder: the value and the gold, the services, and the verdict it must reach. */
type Probe = { value: unknown; gold: unknown; services: Services; want: Want; about?: string };

type OutcomeCase = {
  id: string;
  tier: Tier;
  want: Want;
  /** The case and its twin, whose right verdict differs in outcome or rung. */
  build(w: World, names: Names, rng: Rng): { main: Probe; twin: Probe };
};

const recordIndex = (rng: Rng, w: World) => between(rng, 0, w.records.length - 1);

/** Another record than `index`. */
const otherIndex = (rng: Rng, w: World, index: number) =>
  (index + 1 + between(rng, 0, w.records.length - 2)) % w.records.length;

/**
 * The pass twin: the other writing of another record, against a tool whose own truth says that writing names
 * the gold's record. Only a replay of the tool passes it: the two writings differ in every normal form.
 */
function aliasTwin(w: World, names: Names, rng: Rng, index: number, options: ReplayOptions = {}): Probe {
  const gold = goldOf(w, index);
  const value = w.kind.other(goldOf(w, otherIndex(rng, w, index)));
  return {
    value,
    gold,
    services: {
      replayer: replayer(w, names, {
        ...options,
        resolve: (written) => (written === value ? resolveIn(w, gold) : resolveIn(w, written)),
      }),
    },
    want: { outcome: 'pass', rung: 'rung1_outcome' },
    about: 'a tool whose own truth resolves both writings to one record',
  };
}

const OUTCOME_CASES: OutcomeCase[] = [
  {
    id: 'same-referent-reformatted',
    tier: 2,
    want: { outcome: 'pass', rung: 'rung1_outcome' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      const [value, gold] = [w.kind.other(goldOf(w, i)), goldOf(w, i)];
      // The twin: the same two writings against a tool that resolves the second to another record. The rung
      // compares what the tool resolves, never the form of the two writings.
      const strict = (written: string) =>
        written === gold ? resolveIn(w, gold) : `elsewhere-${names.resolved}`;
      return {
        main: {
          value,
          gold,
          services: { replayer: replayer(w, names, {}) },
          want: { outcome: 'pass', rung: 'rung1_outcome' },
        },
        twin: {
          value,
          gold,
          services: { replayer: replayer(w, names, { resolve: strict }) },
          want: { outcome: 'fail', rung: 'rung1_outcome' },
          about: 'a tool that resolves them to two records',
        },
      };
    },
  },
  {
    id: 'other-referent',
    tier: 1,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      const j = otherIndex(rng, w, i);
      return {
        main: {
          value: w.kind.other(goldOf(w, j)),
          gold: goldOf(w, i),
          services: { replayer: replayer(w, names, {}) },
          want: { outcome: 'fail', rung: 'rung1_outcome' },
        },
        twin: aliasTwin(w, names, rng, i),
      };
    },
  },
  {
    id: 'unknown-value',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      const gold = goldOf(w, i);
      let value = `${gold}${between(rng, 1, 9)}`;
      while (resolveIn(w, value) !== null) value = `${value}${between(rng, 1, 9)}`;
      return {
        main: {
          value,
          gold,
          services: { replayer: replayer(w, names, {}) },
          want: { outcome: 'fail', rung: 'rung1_outcome' },
        },
        twin: aliasTwin(w, names, rng, i),
      };
    },
  },
  {
    id: 'tool-refuses-the-value',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      const value = w.kind.other(goldOf(w, i));
      return {
        main: {
          value,
          gold: goldOf(w, i),
          services: { replayer: replayer(w, names, { refuse: value }) },
          want: { outcome: 'fail', rung: 'rung1_outcome' },
        },
        twin: aliasTwin(w, names, rng, i),
      };
    },
  },
  {
    id: 'no-distractors',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      return {
        main: {
          value: w.kind.other(goldOf(w, i)),
          gold: goldOf(w, i),
          services: { replayer: replayer(w, names, { distractors: false }) },
          want: { outcome: 'fail', rung: 'exact_fallback' },
        },
        twin: aliasTwin(w, names, rng, i, { distractors: true }),
      };
    },
  },
  {
    id: 'tool-not-declared',
    tier: 3,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      return {
        main: {
          value: w.kind.other(goldOf(w, i)),
          gold: goldOf(w, i),
          services: { replayer: replayer(w, names, { declared: false }) },
          want: { outcome: 'fail', rung: 'exact_fallback' },
        },
        twin: aliasTwin(w, names, rng, i, { declared: true }),
      };
    },
  },
  {
    id: 'field-only-stored',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      return {
        main: {
          value: w.kind.other(goldOf(w, i)),
          gold: goldOf(w, i),
          services: { replayer: replayer(w, names, { inputs: [names.spare] }) },
          want: { outcome: 'fail', rung: 'exact_fallback' },
        },
        twin: aliasTwin(w, names, rng, i, { inputs: shuffled(rng, [names.spare, names.field]) }),
      };
    },
  },
  {
    id: 'gold-refused',
    tier: 5,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, names, rng) => {
      const i = recordIndex(rng, w);
      const gold = goldOf(w, i);
      return {
        main: {
          value: w.kind.other(gold),
          gold,
          services: { replayer: replayer(w, names, { refuse: gold }) },
          want: { outcome: 'fail', rung: 'exact_fallback' },
        },
        twin: aliasTwin(w, names, rng, i, { refuse: `${gold}${word(rng, 2)}` }),
      };
    },
  },
];

function ladder(product: Parameters<BankItem['check']>[0]['product']): RunLadder {
  return need<RunLadder>(product.checks, 'checks', 'runLadder');
}

/**
 * The verdict against the one it must reach. An exact fallback carries the lint `no_decider` and its evidence
 * names the tool and the field it compared (docs/reference/block-contracts.md, Exact fallback).
 */
function judged(result: Result, want: Want, about: string, names?: { tool: string; field: string }) {
  if (result.outcome !== want.outcome || result.rung !== want.rung)
    return fail(
      `the ladder decided ${result.outcome} by ${result.rung} on ${about}, expected ${want.outcome} by ${want.rung}`,
    );
  if (want.rung === 'exact_fallback' && result.lint?.id !== 'no_decider')
    return fail(
      `an exact fallback on ${about} carries the lint ${result.lint?.id ?? 'none'}, expected no_decider`,
    );
  if (
    want.rung === 'exact_fallback' &&
    names &&
    !String(result.evidence ?? '').includes(`${names.tool}.${names.field}`)
  )
    return fail(
      `the evidence of an exact fallback on ${about} does not name ${names.tool}.${names.field}: ${String(result.evidence ?? '').slice(0, 160)}`,
    );
  return PASS;
}

/** The case and its twin through the ladder, in a seeded order: the first verdict that misses fails the item. */
async function judgedAll(
  product: BlocksProduct,
  rng: Rng,
  probes: { make: () => Case; services: Services; want: Want; about: string }[],
  names: { tool: string; field: string },
) {
  for (const probe of shuffled(rng, probes)) {
    const result = await ladder(product)(probe.make(), undefined, probe.services);
    const verdict = judged(result, probe.want, probe.about, names);
    if (!verdict.pass) return verdict;
  }
  return PASS;
}

const shown = (value: unknown, gold: unknown) => `${JSON.stringify(value)} against ${JSON.stringify(gold)}`;

function outcomeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of VALUE_KINDS) {
    for (const outcomeCase of OUTCOME_CASES) {
      const id = `values/outcome/${kind.kind}/${outcomeCase.id}`;
      items.push({
        id,
        family: 'values-outcome',
        tier: outcomeCase.tier,
        level: 4,
        component: outcomeCase.want.rung === 'rung1_outcome' ? OUTCOME : LADDER,
        title: `the ${kind.kind} written into a replayable tool (${outcomeCase.id.replace(/-/g, ' ')}) is decided ${outcomeCase.want.outcome} by ${outcomeCase.want.rung}`,
        cause:
          outcomeCase.want.rung === 'rung1_outcome'
            ? 'The outcome rung replays the call with the value and with the gold and compares what the tool resolves.'
            : `The outcome rung leaves a value it cannot decide (${outcomeCase.id.replace(/-/g, ' ')}) to the exact fallback.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const names = namesFor(seed, id);
          const w = world(rng, kind);
          const { main, twin } = outcomeCase.build(w, names, rng);
          return judgedAll(
            product,
            rng,
            [main, twin].map((probe) => ({
              make: () => ({
                tool: names.tool,
                field: names.field,
                gold: probe.gold,
                value: probe.value,
                input: { [names.field]: probe.value },
              }),
              services: probe.services,
              want: probe.want,
              about: `${shown(probe.value, probe.gold)}${probe.about ? `, ${probe.about}` : ''}`,
            })),
            names,
          );
        },
      });
    }
  }
  return items;
}

type IdentityCase = {
  id: string;
  tier: Tier;
  /** The value and the gold, and two differing strings of the same draw: past identity, to the exact fallback. */
  values(rng: Rng): { pair: [unknown, unknown]; strings: [string, string] };
  want: Want;
};

const big = (rng: Rng) => between(rng, 1000, 999_999_999);

const IDENTITY_CASES: IdentityCase[] = [
  {
    id: 'string-equal',
    tier: 1,
    values: (rng) => {
      const v = `${capital(word(rng, 5))} ${capital(word(rng, 4))}`;
      return { pair: [v, v], strings: [v.toUpperCase(), v] };
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-equal',
    tier: 1,
    values: (rng) => {
      const v = big(rng);
      return { pair: [v, v], strings: [`${v}.0`, String(v)] };
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-differs',
    tier: 1,
    values: (rng) => {
      const v = big(rng);
      const d = between(rng, 1, 999);
      return { pair: [v + d, v], strings: [String(v + d), String(v)] };
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'boolean-differs',
    tier: 2,
    values: (rng) => {
      const v = rng() < 0.5;
      const label = word(rng, 5);
      return { pair: [!v, v], strings: [`${label} ${!v}`, `${label} ${v}`] };
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'list-differs',
    tier: 2,
    values: (rng) => {
      const [a, b] = [big(rng), big(rng) + 1];
      return {
        pair: [
          [a, b],
          [b, a],
        ],
        strings: [`${a},${b}`, `${b},${a}`],
      };
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'absent',
    tier: 2,
    values: (rng) => {
      const v = `${capital(word(rng, 6))} ${between(rng, 2, 99)}`;
      return { pair: [undefined, v], strings: [`${v}${word(rng, 2)}`, v] };
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'object-equal',
    tier: 2,
    values: (rng) => {
      const [k1, k2] = [`k${word(rng, 5)}`, `q${word(rng, 5)}`];
      const [n, s] = [between(rng, 1, 9999), `${capital(word(rng, 5))} ${between(rng, 2, 99)}`];
      const a = { [k1]: n, [k2]: s };
      const b = { [k2]: s, [k1]: n };
      return { pair: [a, b], strings: [JSON.stringify(a), JSON.stringify(b)] };
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'string-number',
    tier: 3,
    values: (rng) => {
      const v = between(rng, 10, 999_999);
      return { pair: [String(v), v], strings: [`0${v}`, String(v)] };
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
];

function identityItems(): BankItem[] {
  const items: BankItem[] = [];
  const contexts = ['no-services', 'replayer', 'replayer-other-tool'] as const;
  for (const identityCase of IDENTITY_CASES) {
    for (const context of contexts) {
      const id = `values/identity/${identityCase.id}/${context}`;
      items.push({
        id,
        family: 'values-identity',
        tier: identityCase.tier,
        level: 4,
        component: LADDER,
        title: `a ${identityCase.id.replace(/-/g, ' ')} value (${context.replace(/-/g, ' ')}) is ${identityCase.want.outcome === 'pass' ? 'passed' : 'failed'} on its own, before any rung`,
        cause:
          identityCase.want.outcome === 'pass'
            ? 'The ladder passes a value equal to the gold before any rung.'
            : 'The ladder fails a differing value that is not a string before any rung.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const names = namesFor(seed, id);
          const w = world(rng, VALUE_KINDS[between(rng, 0, VALUE_KINDS.length - 1)] as ValueKind);
          const { pair, strings } = identityCase.values(rng);
          // The replayer's tool is the case's own tool or another one; its own field is not the case's field.
          const replayed = {
            tool: context === 'replayer' ? names.tool : names.elsewhere,
            field: names.spare,
            resolved: names.resolved,
          };
          const services: Services = context === 'no-services' ? {} : { replayer: replayer(w, replayed, {}) };
          const probe = (value: unknown, gold: unknown, want: Want, about: string) => ({
            make: () => ({
              tool: names.tool,
              field: names.field,
              gold,
              value,
              input: { [names.field]: value },
            }),
            services,
            want,
            about,
          });
          // The twin: two differing strings are not settled at identity; nothing here decides them, so they reach
          // the exact fallback (docs/reference/block-contracts.md, Identity).
          return judgedAll(
            product,
            rng,
            [
              probe(pair[0], pair[1], identityCase.want, shown(pair[0], pair[1])),
              probe(
                strings[0],
                strings[1],
                { outcome: 'fail', rung: 'exact_fallback' },
                `the strings ${shown(strings[0], strings[1])}`,
              ),
            ],
            names,
          );
        },
      });
    }
  }
  return items;
}

type Schema = Record<string, unknown>;

type ContractCase = {
  id: string;
  tier: Tier;
  want: Want;
  /** The case, and its twin: the same value and gold under another schema, whose right verdict differs. */
  build(rng: Rng): { schema: Schema; value: string; gold: string; twin: { schema: Schema; want: Want } };
};

/** A seeded code format: an upper case prefix, a dash, a seeded count of digits. */
function codeFormat(rng: Rng) {
  const prefix = word(rng, between(rng, 2, 3)).toUpperCase();
  const length = between(rng, 4, 6);
  return { pattern: `^${prefix}-[0-9]{${length}}$`, draw: () => `${prefix}-${digits(rng, length)}` };
}

/** A seeded enum: distinct members, each a capitalised word and a number. */
function members(rng: Rng): string[] {
  const out = new Set<string>();
  const count = between(rng, 3, 6);
  while (out.size < count) out.add(`${capital(word(rng, 5))} ${between(rng, 2, 99)}`);
  return [...out];
}

const FALLBACK: Want = { outcome: 'fail', rung: 'exact_fallback' };
const NO_FORMAT: Schema = { type: 'string' };

const CONTRACT_CASES: ContractCase[] = [
  {
    id: 'breaks-pattern',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const format = codeFormat(rng);
      const gold = format.draw();
      return {
        schema: { type: 'string', pattern: format.pattern },
        value: gold.replace('-', ' '),
        gold,
        twin: { schema: NO_FORMAT, want: FALLBACK },
      };
    },
  },
  {
    id: 'other-enum-member',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const list = members(rng);
      const [gold, value] = shuffled(rng, list) as [string, string];
      return {
        schema: { type: 'string', enum: list },
        value,
        gold,
        twin: { schema: NO_FORMAT, want: FALLBACK },
      };
    },
  },
  {
    id: 'outside-enum',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const list = members(rng);
      const gold = list[between(rng, 0, list.length - 1)] as string;
      return {
        schema: { type: 'string', enum: list },
        value: gold.toUpperCase(),
        gold,
        twin: { schema: NO_FORMAT, want: FALLBACK },
      };
    },
  },
  {
    id: 'breaks-const',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const gold = word(rng, between(rng, 3, 5)).toUpperCase();
      return {
        schema: { type: 'string', const: gold },
        value: gold.toLowerCase(),
        gold,
        twin: { schema: NO_FORMAT, want: FALLBACK },
      };
    },
  },
  {
    id: 'inside-pattern-different',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (rng) => {
      const format = codeFormat(rng);
      const gold = format.draw();
      const last = Number(gold.slice(-1));
      const value = `${gold.slice(0, -1)}${(last + between(rng, 1, 9)) % 10}`;
      return {
        schema: { type: 'string', pattern: format.pattern },
        value,
        gold,
        // The twin: the same value under a const that states the gold: the value breaks it.
        twin: { schema: { type: 'string', const: gold }, want: { outcome: 'fail', rung: 'rung2_contract' } },
      };
    },
  },
];

function contractItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const contractCase of CONTRACT_CASES) {
    for (const nesting of ['top', 'nested'] as const) {
      for (const context of ['no-replayer', 'undeclared-tool'] as const) {
        const id = `values/contract/${contractCase.id}/${nesting}/${context}`;
        items.push({
          id,
          family: 'values-contract',
          tier: Math.min(5, contractCase.tier + (nesting === 'nested' ? 1 : 0)) as Tier,
          level: 4,
          component: contractCase.want.rung === 'rung2_contract' ? CONTRACT : LADDER,
          title: `a value against the tool's stated contract (${contractCase.id.replace(/-/g, ' ')}, ${nesting} field, ${context.replace(/-/g, ' ')}) is decided ${contractCase.want.outcome} by ${contractCase.want.rung}`,
          cause:
            contractCase.want.rung === 'rung2_contract'
              ? 'The contract rung fails a value outside the pattern, enum or const the tool definition states.'
              : 'The contract rung passes nothing: a value inside the stated format goes on to the exact fallback.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const names = namesFor(seed, id);
            const { schema, value, gold, twin } = contractCase.build(rng);
            const field = nesting === 'top' ? names.field : `${names.spare}.${names.field}`;
            const definition = (stated: Schema) => ({
              name: names.tool,
              parameters:
                nesting === 'top'
                  ? { type: 'object', properties: { [names.field]: stated } }
                  : {
                      type: 'object',
                      properties: {
                        [names.spare]: { type: 'object', properties: { [names.field]: stated } },
                      },
                    },
            });
            const input =
              nesting === 'top' ? { [names.field]: value } : { [names.spare]: { [names.field]: value } };
            const services: Services =
              context === 'no-replayer'
                ? {}
                : {
                    replayer: replayer(
                      world(rng, VALUE_KINDS[0] as ValueKind),
                      { ...names, tool: names.elsewhere },
                      {},
                    ),
                  };
            const probe = (stated: Schema, want: Want) => ({
              make: () => ({ tool: names.tool, field, gold, value, input, definition: definition(stated) }),
              services,
              want,
              about: `${shown(value, gold)} under ${JSON.stringify(stated)}`,
            });
            return judgedAll(
              product,
              rng,
              [probe(schema, contractCase.want), probe(twin.schema, twin.want)],
              { tool: names.tool, field },
            );
          },
        });
      }
    }
  }
  return items;
}

type Sources = { user?: string[]; files?: Record<string, string> };

type GivenCase = {
  id: string;
  tier: Tier;
  want: Want;
  /** The case, and its twin whose right verdict differs in outcome or rung. */
  build(
    gold: string,
    other: string,
    file: string,
  ): {
    value: string;
    sources: Sources;
    twin: { value: string; sources: Sources; want: Want; about: string };
  };
};

/** The as-given twin: the expected writing only inside a longer word is no whole token, so the rung decides nothing. */
const insideAWord = (gold: string, other: string) => ({
  value: other,
  sources: { user: [`It is ${gold}s, thanks.`] },
  want: FALLBACK,
  about: `the user wrote only "${gold}s"`,
});

const GIVEN_CASES: GivenCase[] = [
  {
    id: 'altered',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({
      value: other,
      sources: { user: [`It is ${gold}, thanks.`] },
      twin: insideAWord(gold, other),
    }),
  },
  {
    id: 'stale',
    tier: 4,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({
      value: other,
      sources: { user: [`It is ${other}.`, `Sorry, it is ${gold}.`] },
      twin: insideAWord(gold, other),
    }),
  },
  {
    id: 'copied-a-wrong-value',
    tier: 3,
    want: FALLBACK,
    build: (gold, other) => ({
      value: other,
      sources: { user: [`Use ${other}.`] },
      // The twin: the same value when the user gave the gold: the agent changed it.
      twin: {
        value: other,
        sources: { user: [`Use ${gold}.`] },
        want: { outcome: 'fail', rung: 'rung2b_as_given' },
        about: `the user gave "${gold}"`,
      },
    }),
  },
  {
    id: 'altered-from-a-file',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other, file) => ({
      value: other,
      sources: { files: { [file]: `value: ${gold}\n` } },
      twin: insideAWord(gold, other),
    }),
  },
  {
    id: 'surrounding-space',
    tier: 4,
    want: { outcome: 'pass', rung: 'identity' },
    build: (gold, other) => ({
      value: gold,
      sources: { user: [`It is ${gold} .`] },
      // The twin: the same message, another writing: the space before the full stop leaves the gold a whole token.
      twin: {
        value: other,
        sources: { user: [`It is ${gold} .`] },
        want: { outcome: 'fail', rung: 'rung2b_as_given' },
        about: `the user wrote "${gold} ."`,
      },
    }),
  },
];

type GivenKind = { id: string; gold(rng: Rng): string; other(gold: string, rng: Rng): string };

const GIVEN_KINDS: GivenKind[] = [
  {
    id: 'name',
    gold: (rng) => `${capital(word(rng, 4))} ${capital(word(rng, 6))}`,
    other: (v) => v.split(' ').reverse().join(' '),
  },
  {
    id: 'bike',
    gold: (rng) => `${capital(word(rng, 5))} ${between(rng, 2, 99)}`,
    other: (v, rng) => `${v} ${capital(word(rng, 4))}`,
  },
  {
    id: 'code',
    gold: (rng) => codeFormat(rng).draw(),
    other: (v) => v.replace('-', ''),
  },
  {
    id: 'address',
    gold: (rng) => `${between(rng, 2, 990)} ${capital(word(rng, 6))} ${capital(word(rng, 3))}`,
    other: (v, rng) => `${v.slice(0, v.lastIndexOf(' '))} ${capital(word(rng, 4))}`,
  },
];

function givenItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const givenCase of GIVEN_CASES) {
    for (const kind of GIVEN_KINDS) {
      const id = `values/as-given/${givenCase.id}/${kind.id}`;
      items.push({
        id,
        family: 'values-as-given',
        tier: givenCase.tier,
        level: 4,
        component: givenCase.want.rung === 'rung2b_as_given' ? AS_GIVEN : LADDER,
        title: `a ${kind.id} the user or a file gave (${givenCase.id.replace(/-/g, ' ')}) is decided ${givenCase.want.outcome} by ${givenCase.want.rung}`,
        cause:
          givenCase.want.rung === 'rung2b_as_given'
            ? 'The as-given rung fails a value the agent changed from what the user or a file gave.'
            : 'The as-given rung never passes a copy: a copied value goes on to the exact fallback.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const names = namesFor(seed, id);
          const gold = kind.gold(rng);
          const file = `${token(seed, `${id}#file`)}.txt`;
          const { value, sources, twin } = givenCase.build(gold, kind.other(gold, rng), file);
          const probe = (written: string, given: Sources, want: Want, about: string) => ({
            make: () => ({
              tool: names.tool,
              field: names.field,
              gold,
              value: written,
              input: { [names.field]: written },
              sources: given,
            }),
            services: {},
            want,
            about,
          });
          return judgedAll(
            product,
            rng,
            [
              probe(value, sources, givenCase.want, shown(value, gold)),
              probe(twin.value, twin.sources, twin.want, `${shown(twin.value, gold)} when ${twin.about}`),
            ],
            names,
          );
        },
      });
    }
  }
  return items;
}

/** Level 5 of the blocks bank. */
export function valueItems(): BankItem[] {
  return [
    ...identityItems(),
    ...outcomeItems(),
    ...contractItems(),
    ...givenItems(),
    ...recomputeItems(),
    ...stateDiffItems(),
  ];
}

/** A one-block CODE spec whose agent writes `files` and nothing else, its sandbox kept so the item can read them. */
async function codeRun(
  product: BlocksProduct,
  seed: number,
  scratch: string,
  tag: string,
  files: FileAction[],
  extra: Record<string, unknown> = {},
) {
  const marker = token(seed, `${tag}#marker`, 8);
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    kind: 'task',
    workspace_seed: {
      files: {
        'data/rentals.csv': 'bike,days\nFern 3,4\n',
        ...((extra.seed as Record<string, string>) ?? {}),
      },
    },
    blocks: [
      {
        id: token(seed, `${tag}#id`),
        user: `${marker} Build the files.`,
        expect: { execution: { exit_code: 0 } },
      },
    ],
  };
  const agent = plantedAgent(
    product,
    'code',
    new Map([[marker, { reply: 'Done.', files, commands: [{ command: 'python make.py', exitCode: 0 }] }]]),
    { scratch, keep: true },
  );
  const record = await run(product, raw, agent.adapter);
  const block = record.blocks[0];
  const observed = (block?.observed ?? {}) as {
    sandbox?: { root?: string };
    workspaceDiff?: { created: string[]; changed: string[]; deleted: string[] };
  };
  return { root: observed.sandbox?.root, diff: observed.workspaceDiff };
}

type FormulaCase = {
  id: string;
  tier: Tier;
  produced(rng: Rng): string;
  expected: string;
  want: { outcome: string; rung: string };
};

const FORMULA_CASES: FormulaCase[] = [
  {
    id: 'same-formula',
    tier: 1,
    produced: () => 'C2*12',
    expected: 'C2*12',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'reordered-formula',
    tier: 2,
    produced: () => '12*C2',
    expected: 'C2*12',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'sum-of-range',
    tier: 3,
    produced: () => 'SUM(B2:C2)',
    expected: 'B2+C2',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'off-by-one',
    tier: 2,
    produced: () => 'C2*12+1',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'hard-coded-result',
    tier: 4,
    produced: () => 'HARD',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'wrong-operand',
    tier: 3,
    produced: () => 'B2*12',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'rounded-away',
    tier: 4,
    produced: () => 'ROUND(C2/7,0)',
    expected: 'C2/7',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
];

/**
 * CODE: a formula the code agent wrote into an xlsx cell, read back by the product's xlsx reader, decided by the
 * recompute rung: the same computation on the given and on changed inputs passes, however it is written; a
 * hard-coded result equal on the given inputs fails on changed ones.
 */
function recomputeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const formulaCase of FORMULA_CASES) {
    for (const variant of ['small', 'large', 'negative']) {
      const id = `values/recompute/code/${formulaCase.id}/${variant}`;
      items.push({
        id,
        family: 'values-recompute-code',
        tier: formulaCase.tier,
        level: 4,
        component:
          formulaCase.want.rung === 'rung1_recompute'
            ? 'packages/checks/src/value-check/recompute.ts'
            : LADDER,
        title: `a formula a code agent wrote into a workbook (${formulaCase.id.replace(/-/g, ' ')}, ${variant} inputs), read back from the file, is decided ${formulaCase.want.outcome} by ${formulaCase.want.rung}`,
        cause:
          formulaCase.want.rung === 'rung1_recompute'
            ? `The recompute rung runs the produced and the gold computation on the given and changed inputs (${formulaCase.id.replace(/-/g, ' ')}).`
            : 'The ladder passes a formula equal to the gold before any rung.',
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const scale = variant === 'large' ? 10_000 : variant === 'negative' ? -50 : 10;
          const b = between(rng, 1, 9) * scale;
          const c = between(rng, 1, 9) * scale + 3;
          const expectedValue = Number(
            new Function('B2', 'C2', `return ${formulaCase.expected.replace('SUM(B2:C2)', '(B2+C2)')}`)(b, c),
          );
          const written =
            formulaCase.produced(rng) === 'HARD' ? expectedValue : `=${formulaCase.produced(rng)}`;
          const path = `out/${token(seed, `${id}#file`)}.xlsx`;
          const { root } = await codeRun(product, seed, scratch, id, [
            {
              path,
              format: 'xlsx',
              data: {
                sheets: [
                  {
                    name: 'Rentals',
                    rows: [
                      ['Bike', 'Base', 'Days', 'Total'],
                      ['Fern 3', b, c, written],
                    ],
                  },
                ],
              },
            },
          ]);
          if (!root) return fail('the kept sandbox names no folder: the workbook cannot be read back');
          const readWorkbook = need<
            (
              bytes: Uint8Array,
            ) => Promise<
              { cell(row: number, column: number): { value: unknown; formula?: string } | undefined }[]
            >
          >(product.artifacts, 'artifacts', 'readWorkbook');
          const sheets = await readWorkbook(readFileSync(join(root, path)));
          const cell = sheets[0]?.cell(2, 4);
          const produced =
            cell?.formula !== undefined
              ? { formula: cell.formula.replace(/^=/, '') }
              : { value: cell?.value };
          const result = await ladder(product)(
            {
              field: 'Total',
              gold: `=${formulaCase.expected}`,
              value: cell?.formula !== undefined ? `=${cell.formula.replace(/^=/, '')}` : cell?.value,
              recompute: { produced, expected: { formula: formulaCase.expected }, inputs: { B2: b, C2: c } },
            },
            undefined,
            {},
          );
          const verdict = judged(
            result,
            formulaCase.want,
            `${JSON.stringify(produced)} against ${formulaCase.expected}`,
          );
          if (!verdict.pass) return verdict;
          // The twin: a formula equal to the gold on the given inputs and on any input set outside 0.5 to 1.5 times
          // them, and different inside: only the documented draws of the changed inputs tell it apart.
          const roots = [c, 2 * c - 3, 5 * c - 3, 11 * c - 3].map((r) => `(C2-(${r}))`).join('*');
          const twin = await ladder(product)(
            {
              field: 'Total',
              gold: `=${formulaCase.expected}`,
              value: `=${formulaCase.expected}+${roots}`,
              recompute: {
                produced: { formula: `${formulaCase.expected}+${roots}` },
                expected: { formula: formulaCase.expected },
                inputs: { B2: b, C2: c },
              },
            },
            undefined,
            {},
          );
          return judged(
            twin,
            { outcome: 'fail', rung: 'rung1_recompute' },
            `the gold plus ${roots}, zero on the given inputs`,
          );
        },
      });
    }
  }
  return items;
}

type DiffCase = {
  id: string;
  tier: Tier;
  want: string;
  build(
    rng: Rng,
    base: string,
  ): { files: FileAction[]; expected: Record<string, string[]>; allowed?: string[] };
};

const DIFF_CASES: DiffCase[] = [
  {
    id: 'exact',
    tier: 1,
    want: 'pass',
    build: (_r, base) => ({
      files: [{ path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] }],
      expected: { created: [`${base}/a.csv`] },
    }),
  },
  {
    id: 'extra-file',
    tier: 2,
    want: 'fail',
    build: (_r, base) => ({
      files: [
        { path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] },
        { path: `${base}/tmp.txt`, format: 'txt', data: 'scratch' },
      ],
      expected: { created: [`${base}/a.csv`] },
    }),
  },
  {
    id: 'missing-file',
    tier: 2,
    want: 'fail',
    build: (_r, base) => ({ files: [], expected: { created: [`${base}/a.csv`] } }),
  },
  {
    id: 'allowed-glob',
    tier: 3,
    want: 'pass',
    build: (_r, base) => ({
      files: [
        { path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] },
        { path: `${base}/logs/run.txt`, format: 'txt', data: 'ok' },
      ],
      expected: { created: [`${base}/a.csv`] },
      allowed: [`${base}/logs/**`],
    }),
  },
  {
    id: 'changed-not-created',
    tier: 4,
    want: 'fail',
    build: () => ({
      files: [{ path: 'data/rentals.csv', format: 'txt', data: 'bike,days\nFern 3,5\n' }],
      expected: { created: ['data/rentals.csv'] },
    }),
  },
  {
    id: 'changed-expected',
    tier: 3,
    want: 'pass',
    build: () => ({
      files: [{ path: 'data/rentals.csv', format: 'txt', data: 'bike,days\nFern 3,5\n' }],
      expected: { changed: ['data/rentals.csv'] },
    }),
  },
  {
    id: 'many-files-one-extra',
    tier: 5,
    want: 'fail',
    build: (rng, base) => {
      const n = between(rng, 20, 40);
      const files: FileAction[] = Array.from({ length: n }, (_, i) => ({
        path: `${base}/part-${i}.json`,
        format: 'json',
        data: { i },
      }));
      return {
        files: [...files, { path: `${base}/part-${n}.json`, format: 'json', data: { i: n } }],
        expected: { created: files.map((file) => file.path) },
      };
    },
  },
];

/** CODE: the state-diff rung on the workspace diff a real code run produced. */
function stateDiffItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const diffCase of DIFF_CASES) {
    for (const folder of ['out', 'reports/2026', 'deep/a/b/c']) {
      const id = `values/state-diff/code/${diffCase.id}/${folder.split('/').length}`;
      items.push({
        id,
        family: 'values-state-diff-code',
        tier: diffCase.tier,
        level: 4,
        component: 'packages/checks/src/value-check/state-diff.ts',
        title: `the workspace a code agent left (${diffCase.id.replace(/-/g, ' ')}, under ${folder}) is decided ${diffCase.want} by the state-diff rung on the run's own diff`,
        cause: `The state-diff rung compares the net workspace diff with the expected and allowed changes (${diffCase.id.replace(/-/g, ' ')}).`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const base = `${folder}/${token(seed, id)}`;
          const { files, expected, allowed } = diffCase.build(rng, base);
          const { diff } = await codeRun(product, seed, scratch, id, files);
          if (!diff) return fail('the run recorded no workspace diff');
          const result = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, ...(allowed ? { allowed } : {}) },
            },
            undefined,
            {},
          );
          const verdict = judged(
            result,
            { outcome: diffCase.want, rung: 'rung1_state_diff' },
            `the diff ${JSON.stringify(diff).slice(0, 200)}`,
          );
          if (!verdict.pass) return verdict;
          // The twin: the observed diff expected with a leading ./ on every path is the same diff: paths compare
          // with forward slashes and no leading ./ (block-contracts.md, State diff).
          // An empty run diff (a missing file) takes the expected changes as the observed diff of the twin.
          const sets = ['created', 'changed', 'deleted'] as const;
          const empty = sets.every((set) => (diff[set] ?? []).length === 0);
          const seen = empty ? { created: [], changed: [], deleted: [], ...expected } : diff;
          const dotted = Object.fromEntries(
            sets
              .filter((set) => (seen[set] ?? []).length > 0)
              .map((set) => [set, (seen[set] ?? []).map((path: string) => `./${path}`)]),
          );
          const twin = await ladder(product)(
            { field: 'workspace', gold: dotted, value: seen, stateDiff: { diff: seen, expected: dotted } },
            undefined,
            {},
          );
          const dottedVerdict = judged(
            twin,
            { outcome: 'pass', rung: 'rung1_state_diff' },
            `the diff against ${JSON.stringify(dotted).slice(0, 160)}`,
          );
          if (!dottedVerdict.pass || !allowed) return dottedVerdict;
          // The second twin: ? stands for one character, so r?n.txt allows run.txt and nothing longer.
          const single = [`${base}/logs/r?n.txt`];
          const glob = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, allowed: single },
            },
            undefined,
            {},
          );
          const globVerdict = judged(
            glob,
            { outcome: 'pass', rung: 'rung1_state_diff' },
            `the allowed glob ${single[0]}`,
          );
          if (!globVerdict.pass) return globVerdict;
          const narrow = [`${base}/logs/r?.txt`];
          const tight = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, allowed: narrow },
            },
            undefined,
            {},
          );
          return judged(
            tight,
            { outcome: 'fail', rung: 'rung1_state_diff' },
            `the allowed glob ${narrow[0]}`,
          );
        },
      });
    }
  }
  return items;
}
