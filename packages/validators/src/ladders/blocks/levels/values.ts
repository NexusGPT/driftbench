import { between, pick, type Rng, rngFor, SHOP } from '../harness';
import { need } from '../product';
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
 */

const LADDER = 'packages/checks/src/value-check/ladder.ts';
const OUTCOME = 'packages/checks/src/value-check/outcome.ts';
const CONTRACT = 'packages/checks/src/value-check/contract.ts';
const AS_GIVEN = 'packages/checks/src/value-check/as-given.ts';

type Result = { outcome: string; rung: string; lint?: { id: string } };
type Case = Record<string, unknown>;
type Services = Record<string, unknown>;

type RunLadder = (value: Case, policy?: unknown, services?: Services) => Promise<Result>;

/** A fictional directory: customers with a phone and an email, and bikes with a code. */
type World = {
  customers: { id: string; phone: string; email: string }[];
  bikes: { id: string; code: string }[];
};

function world(rng: Rng): World {
  const customers = SHOP.customers.map((name, index) => {
    const digits = `202555${String(between(rng, 1000, 9999))}${index}`.slice(0, 10);
    return {
      id: `C-${index}${between(rng, 10, 99)}`,
      phone: `+1${digits}`,
      email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@larkspur.example`,
    };
  });
  const bikes = SHOP.bikes.map((bike, index) => ({
    id: `B-${index}${between(rng, 10, 99)}`,
    code: `${bike
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 4)
      .toUpperCase()}${between(rng, 10, 99)}`,
  }));
  return { customers, bikes };
}

/** A phone written another way: spaces between groups, the same digits. */
const spaced = (phone: string) =>
  `${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;

type ToolSpec = {
  tool: string;
  field: string;
  /** The gold value of the record and the same referent written another way. */
  gold(w: World, index: number): string;
  other(w: World, index: number): string;
  /** The tool's own resolution: the record id a value names, or null. */
  resolve(w: World, value: string): string | null;
  resolved: string;
};

const TOOLS: ToolSpec[] = [
  {
    tool: 'customer.find',
    field: 'phone',
    gold: (w, i) => (w.customers[i] as World['customers'][number]).phone,
    other: (w, i) => spaced((w.customers[i] as World['customers'][number]).phone),
    resolve: (w, value) =>
      w.customers.find((c) => c.phone.replace(/\D/g, '') === value.replace(/\D/g, ''))?.id ?? null,
    resolved: 'customer_id',
  },
  {
    tool: 'customer.lookup',
    field: 'email',
    gold: (w, i) => (w.customers[i] as World['customers'][number]).email,
    other: (w, i) => (w.customers[i] as World['customers'][number]).email.toUpperCase(),
    resolve: (w, value) => w.customers.find((c) => c.email === value.toLowerCase())?.id ?? null,
    resolved: 'customer_id',
  },
  {
    tool: 'bikes.reserve',
    field: 'bike_code',
    gold: (w, i) => (w.bikes[i] as World['bikes'][number]).code,
    other: (w, i) => (w.bikes[i] as World['bikes'][number]).code.toLowerCase(),
    resolve: (w, value) => w.bikes.find((b) => b.code === value.toUpperCase())?.id ?? null,
    resolved: 'bike_id',
  },
];

/** A replayer over the fictional world: the tool's own resolution, a refusal on an empty value. */
function replayer(
  w: World,
  spec: ToolSpec,
  options: { declared?: boolean; distractors?: boolean; inputs?: string[]; refuse?: string },
) {
  return {
    declaration: (tool: string) =>
      options.declared === false || tool !== spec.tool
        ? undefined
        : {
            resolved: [spec.resolved],
            distractors: options.distractors ?? true,
            ...(options.inputs ? { inputs: options.inputs } : {}),
          },
    call: (tool: string, input: Record<string, unknown>) => {
      if (tool !== spec.tool) return { ok: false, error: `unknown tool ${tool}` };
      const value = String(input[spec.field] ?? '');
      if (value === '' || value === options.refuse) return { ok: false, error: `${spec.field} refused` };
      return { ok: true, output: { [spec.resolved]: spec.resolve(w, value) } };
    },
  };
}

type OutcomeCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(
    w: World,
    spec: ToolSpec,
    rng: Rng,
  ): { value: unknown; gold: unknown; services: Services; field?: string };
};

const recordIndex = (rng: Rng) => between(rng, 0, SHOP.customers.length - 1);

const OUTCOME_CASES: OutcomeCase[] = [
  {
    id: 'same-referent-reformatted',
    tier: 2,
    want: { outcome: 'pass', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return { value: s.other(w, i), gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'other-referent',
    tier: 1,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const j = (i + 1 + between(rng, 0, SHOP.customers.length - 2)) % SHOP.customers.length;
      return { value: s.other(w, j), gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'unknown-value',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return { value: `${s.gold(w, i)}9`, gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'tool-refuses-the-value',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const value = s.other(w, i);
      return { value, gold: s.gold(w, i), services: { replayer: replayer(w, s, { refuse: value }) } };
    },
  },
  {
    id: 'no-distractors',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { distractors: false }) },
      };
    },
  },
  {
    id: 'tool-not-declared',
    tier: 3,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { declared: false }) },
      };
    },
  },
  {
    id: 'field-only-stored',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { inputs: ['note'] }) },
      };
    },
  },
  {
    id: 'gold-refused',
    tier: 5,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const gold = s.gold(w, i);
      return { value: s.other(w, i), gold, services: { replayer: replayer(w, s, { refuse: gold }) } };
    },
  },
];

function ladder(product: Parameters<BankItem['check']>[0]['product']): RunLadder {
  return need<RunLadder>(product.checks, 'checks', 'runLadder');
}

function judged(result: Result, want: { outcome: string; rung: string }, about: string) {
  if (result.outcome !== want.outcome || result.rung !== want.rung)
    return fail(
      `the ladder decided ${result.outcome} by ${result.rung} on ${about}, expected ${want.outcome} by ${want.rung}`,
    );
  if (want.rung === 'exact_fallback' && result.lint?.id !== 'no_decider')
    return fail(
      `an exact fallback on ${about} carries the lint ${result.lint?.id ?? 'none'}, expected no_decider`,
    );
  return PASS;
}

function outcomeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const spec of TOOLS) {
    for (const outcomeCase of OUTCOME_CASES) {
      const id = `values/outcome/${spec.field}/${outcomeCase.id}`;
      items.push({
        id,
        family: 'values-outcome',
        tier: outcomeCase.tier,
        level: 4,
        component: outcomeCase.want.rung === 'rung1_outcome' ? OUTCOME : LADDER,
        title: `the ${spec.field} written into ${spec.tool} (${outcomeCase.id.replace(/-/g, ' ')}) is decided ${outcomeCase.want.outcome} by ${outcomeCase.want.rung}`,
        cause:
          outcomeCase.want.rung === 'rung1_outcome'
            ? 'The outcome rung replays the call with the value and with the gold and compares what the tool resolves.'
            : `The outcome rung leaves a value it cannot decide (${outcomeCase.id.replace(/-/g, ' ')}) to the exact fallback.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const w = world(rng);
          const { value, gold, services } = outcomeCase.build(w, spec, rng);
          const result = await ladder(product)(
            { tool: spec.tool, field: spec.field, gold, value, input: { [spec.field]: value } },
            undefined,
            services,
          );
          return judged(result, outcomeCase.want, `${JSON.stringify(value)} against ${JSON.stringify(gold)}`);
        },
      });
    }
  }
  return items;
}

type IdentityCase = {
  id: string;
  tier: Tier;
  values(rng: Rng): [unknown, unknown];
  want: { outcome: string; rung: string };
};

const IDENTITY_CASES: IdentityCase[] = [
  {
    id: 'string-equal',
    tier: 1,
    values: (rng) => {
      const v = pick(rng, SHOP.bikes);
      return [v, v];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-equal',
    tier: 1,
    values: (rng) => {
      const v = between(rng, 1, 999);
      return [v, v];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-differs',
    tier: 1,
    values: (rng) => {
      const v = between(rng, 1, 999);
      return [v + 1, v];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'boolean-differs',
    tier: 2,
    values: (rng) => {
      const v = rng() < 0.5;
      return [!v, v];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'list-differs',
    tier: 2,
    values: (rng) => {
      const v = between(rng, 1, 9);
      return [
        [v, v + 1],
        [v + 1, v],
      ];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'absent',
    tier: 2,
    values: (rng) => [undefined, pick(rng, SHOP.bikes)],
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'object-equal',
    tier: 2,
    values: (rng) => {
      const d = between(rng, 1, 28);
      return [
        { day: d, bike: 'Fern 3' },
        { bike: 'Fern 3', day: d },
      ];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'string-number',
    tier: 3,
    values: (rng) => {
      const v = between(rng, 10, 99);
      return [String(v), v];
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
          const w = world(rng);
          const [value, gold] = identityCase.values(rng);
          const spec = TOOLS[0] as ToolSpec;
          const services: Services =
            context === 'no-services'
              ? {}
              : { replayer: replayer(w, context === 'replayer' ? spec : (TOOLS[2] as ToolSpec), {}) };
          const result = await ladder(product)(
            { tool: spec.tool, field: 'slot', gold, value, input: { slot: value } },
            undefined,
            services,
          );
          return judged(
            result,
            identityCase.want,
            `${JSON.stringify(value)} against ${JSON.stringify(gold)}`,
          );
        },
      });
    }
  }
  return items;
}

type ContractCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(rng: Rng): { schema: Record<string, unknown>; value: string; gold: string };
};

const code4 = (rng: Rng) => `LK-${between(rng, 1000, 9999)}`;

const CONTRACT_CASES: ContractCase[] = [
  {
    id: 'breaks-pattern',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const gold = code4(rng);
      return { schema: { type: 'string', pattern: '^LK-[0-9]{4}$' }, value: gold.replace('-', ' '), gold };
    },
  },
  {
    id: 'other-enum-member',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const [gold, value] = [pick(rng, SHOP.bikes), pick(rng, SHOP.bikes)];
      const other = value === gold ? (SHOP.bikes.find((bike) => bike !== gold) ?? value) : value;
      return { schema: { type: 'string', enum: [...SHOP.bikes] }, value: other, gold };
    },
  },
  {
    id: 'outside-enum',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const gold = pick(rng, SHOP.bikes);
      return { schema: { type: 'string', enum: [...SHOP.bikes] }, value: gold.toUpperCase(), gold };
    },
  },
  {
    id: 'breaks-const',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: () => ({ schema: { type: 'string', const: 'EUR' }, value: 'eur', gold: 'EUR' }),
  },
  {
    id: 'inside-pattern-different',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (rng) => {
      const gold = code4(rng);
      const value = gold.endsWith('9') ? `${gold.slice(0, -1)}8` : `${gold.slice(0, -1)}9`;
      return { schema: { type: 'string', pattern: '^LK-[0-9]{4}$' }, value, gold };
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
            const { schema, value, gold } = contractCase.build(rng);
            const field = nesting === 'top' ? 'code' : 'booking.code';
            const definition = {
              name: 'booking.create',
              parameters:
                nesting === 'top'
                  ? { type: 'object', properties: { code: schema } }
                  : {
                      type: 'object',
                      properties: { booking: { type: 'object', properties: { code: schema } } },
                    },
            };
            const input = nesting === 'top' ? { code: value } : { booking: { code: value } };
            const services: Services =
              context === 'no-replayer' ? {} : { replayer: replayer(world(rng), TOOLS[0] as ToolSpec, {}) };
            const result = await ladder(product)(
              { tool: 'booking.create', field, gold, value, input, definition },
              undefined,
              services,
            );
            return judged(
              result,
              contractCase.want,
              `${JSON.stringify(value)} against ${JSON.stringify(gold)} under ${JSON.stringify(schema)}`,
            );
          },
        });
      }
    }
  }
  return items;
}

type GivenCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(gold: string, other: string): { value: string; user?: string[]; files?: Record<string, string> };
};

const GIVEN_CASES: GivenCase[] = [
  {
    id: 'altered',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, user: [`It is ${gold}, thanks.`] }),
  },
  {
    id: 'stale',
    tier: 4,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, user: [`It is ${other}.`, `Sorry, it is ${gold}.`] }),
  },
  {
    id: 'copied-a-wrong-value',
    tier: 3,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (_gold, other) => ({ value: other, user: [`Use ${other}.`] }),
  },
  {
    id: 'altered-from-a-file',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, files: { 'notes.txt': `value: ${gold}\n` } }),
  },
  {
    id: 'surrounding-space',
    tier: 4,
    want: { outcome: 'pass', rung: 'identity' },
    build: (gold) => ({ value: gold, user: [`It is ${gold} .`] }),
  },
];

function givenItems(): BankItem[] {
  const items: BankItem[] = [];
  const kinds = [
    {
      id: 'name',
      gold: (rng: Rng) => pick(rng, SHOP.customers),
      other: (v: string) => v.split(' ').reverse().join(' '),
    },
    { id: 'bike', gold: (rng: Rng) => pick(rng, SHOP.bikes), other: (v: string) => `${v} Plus` },
    { id: 'code', gold: (rng: Rng) => code4(rng), other: (v: string) => v.replace('LK-', 'LK') },
    {
      id: 'address',
      gold: (rng: Rng) => `${between(rng, 2, 90)} Fennel Row`,
      other: (v: string) => v.replace('Row', 'Rd'),
    },
  ];
  for (const givenCase of GIVEN_CASES) {
    for (const kind of kinds) {
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
          const gold = kind.gold(rng);
          const { value, user, files } = givenCase.build(gold, kind.other(gold));
          const result = await ladder(product)(
            {
              tool: 'booking.create',
              field: 'customer',
              gold,
              value,
              input: { customer: value },
              sources: { ...(user ? { user } : {}), ...(files ? { files } : {}) },
            },
            undefined,
            {},
          );
          return judged(result, givenCase.want, `${JSON.stringify(value)} against ${JSON.stringify(gold)}`);
        },
      });
    }
  }
  return items;
}

/** Level 5 of the blocks bank. */
export function valueItems(): BankItem[] {
  return [...identityItems(), ...outcomeItems(), ...contractItems(), ...givenItems()];
}
